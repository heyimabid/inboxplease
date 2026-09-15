import { refreshCustomerProfile } from '../services/customer-profile';
import { replyChunks } from '../services/reply-chunks';
import { captureCustomerImage } from '../ai/image-understanding';
import { getProduct } from '../repositories/products';
import { imageDeliveryUrl } from '../services/images';
import { DurableObject } from 'cloudflare:workers';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { Env } from '../env';
import { database } from '../db/client';
import { webhookEvents } from '../db/schema';
import { ingestEvent, conversationContext } from '../repositories/conversations';
import { orchestrate, type GeneratedReply } from '../ai/orchestrator';
import { deliver } from '../services/delivery';
import { sha256, decrypt } from '../services/encryption';
import { log } from '../shared/logger';
import { handoff } from '../services/handoff';
import { metaClient } from '../meta/client';
type Pending = {
  id: string;
  timestamp: number;
  text: string;
  postback: boolean;
  imageIds?: string[];
  customerId?: string;
  attachments?: { id: string; url: string }[];
  receivedAt?: number;
};
type Batch = {
  workspaceId: string;
  conversationId: string;
  events: Pending[];
  reply?: GeneratedReply | null;
  attempts: number;
  deliveryStarted?: boolean;
};
export class ConversationDO extends DurableObject<Env> {
  async purge() {
    await this.ctx.storage.deleteAll();
    await this.ctx.storage.put('deleted', true);
  }

  async receive(jobId: string) {
    const event = await ingestEvent(this.env, jobId);
    if (!event) return;
    this.ctx.waitUntil(
      conversationContext(this.env, event.workspaceId, event.conversationId)
        .then((context) => refreshCustomerProfile(this.env, context))
        .catch(() => undefined),
    );
    await this.ctx.storage.delete('deleted');
    // Register the photo before doing network I/O, so text cannot race its download.
    const attachments = (event.attachments ?? []).flatMap((attachment, i) =>
      attachment.type === 'image' && attachment.url
        ? [{ id: `${jobId}:${i}`, url: attachment.url }]
        : [],
    );
    await this.ctx.storage.transaction(async (tx) => {
      const current = await tx.get<Batch>('batch');
      if (current?.events.some((e) => e.id === jobId)) return;
      const pending = (await tx.get<Pending[]>('pending')) ?? [];
      if (!pending.some((e) => e.id === jobId))
        pending.push({
          id: jobId,
          timestamp: event.timestamp,
          text:
            event.type === 'postback'
              ? (event.postbackPayload ?? event.text ?? '')
              : (event.text ?? ''),
          postback: event.type === 'postback',
          customerId: event.customerId,
          attachments,
          receivedAt: Date.now(),
        });
      const first = (await tx.get<number>('firstPending')) ?? Date.now();
      await tx.put({
        pending,
        firstPending: first,
        identity: { workspaceId: event.workspaceId, conversationId: event.conversationId },
      });
      const delay = event.type === 'postback' ? 0 : Number(this.env.DEBOUNCE_MAX_MS);
      await tx.setAlarm(Math.min(Date.now() + delay, first + Number(this.env.DEBOUNCE_MAX_MS)));
    });
  }
  async alarm() {
    const batch = await this.ctx.storage.transaction(async (tx) => {
      const existing = await tx.get<Batch>('batch');
      if (existing) return existing;
      const pending = (await tx.get<Pending[]>('pending')) ?? [];
      if (!pending.length) return undefined;
      const identity = await tx.get<{ workspaceId: string; conversationId: string }>('identity');
      if (!identity) throw new Error('Missing persisted conversation identity');
      const next: Batch = {
        ...identity,
        events: pending.sort((a, b) => a.timestamp - b.timestamp),
        attempts: 0,
      };
      await tx.put('batch', next);
      await tx.delete(['pending', 'firstPending']);
      return next;
    });
    if (!batch) return;
    try {
      if (batch.reply === undefined) {
        const ctx = await conversationContext(this.env, batch.workspaceId, batch.conversationId);
        if (ctx.page.encryptedPageAccessToken) {
          const token = await decrypt(
            this.env,
            ctx.page.encryptedPageAccessToken,
            ctx.page.tokenKeyVersion,
            `${batch.workspaceId}:${ctx.page.facebookPageId}`,
          );
          metaClient(this.env)
            .showTypingIndicator(ctx.page.facebookPageId, ctx.customer.platformCustomerId, token)
            .catch(() => {});
        }
        for (const event of batch.events) {
          for (const attachment of event.attachments ?? []) {
            if (event.imageIds?.includes(attachment.id)) continue;
            await captureCustomerImage(
              this.env,
              batch.workspaceId,
              event.customerId!,
              attachment.id,
              attachment.url,
            );
            event.imageIds = [...(event.imageIds ?? []), attachment.id];
            await this.ctx.storage.put('batch', batch);
          }
        }
        if (await this.coalesceVisualTurn(batch, false)) return;
        batch.reply = await orchestrate(
          this.env,
          batch.workspaceId,
          batch.conversationId,
          batch.events.map((e) => e.text).join('\n'),
          batch.events.map((e) => e.id),
          batch.events.flatMap((e) => e.imageIds ?? []),
        );
        await this.ctx.storage.put('batch', batch);
      }
      if (await this.ctx.storage.get('deleted')) return;
      if (await this.coalesceVisualTurn(batch)) return;
      if (batch.reply) {
        const deliveryId = await sha256(`reply:${batch.events.map((e) => e.id).join(':')}`);
        const chunks = replyChunks(batch.reply.text);
        for (const [part, text] of chunks.entries()) {
          const result = await deliver(
            this.env,
            batch.workspaceId,
            batch.conversationId,
            part ? await sha256(`${deliveryId}:part:${part}`) : deliveryId,
            { text },
            'ai',
            batch.reply.metadata,
          );
          if (result !== 'sent') break;
        }
        for (const productId of batch.reply.productIds) {
          const product = await getProduct(this.env, batch.workspaceId, productId, true);
          const image = product.images[0];
          if (image)
            await deliver(
              this.env,
              batch.workspaceId,
              batch.conversationId,
              await sha256(`${deliveryId}:image:${image.id}`),
              {
                attachment: {
                  type: 'image',
                  payload: {
                    url: await imageDeliveryUrl(this.env, batch.workspaceId, image.id),
                    is_reusable: false,
                  },
                },
              },
              'ai',
              { imageId: image.id },
            );
        }
      }
      await database(this.env)
        .update(webhookEvents)
        .set({ status: 'processed', processedAt: Date.now() })
        .where(
          and(
            eq(webhookEvents.workspaceId, batch.workspaceId),
            inArray(
              webhookEvents.id,
              batch.events.map((e) => e.id),
            ),
          ),
        );
      await this.ctx.storage.delete('batch');
      const pending = await this.ctx.storage.get<Pending[]>('pending');
      if (pending?.length)
        await this.ctx.storage.setAlarm(Date.now() + Number(this.env.DEBOUNCE_MS));
    } catch {
      if (await this.ctx.storage.get('deleted')) return;
      batch.attempts++;
      await this.ctx.storage.put('batch', batch);
      log('conversation_retry', {
        conversationId: batch.conversationId,
        retryCount: batch.attempts,
        errorCategory: 'processing',
      });
      if (batch.attempts >= 5) {
        await handoff(this.env, batch.workspaceId, batch.conversationId, 'processing_failed');
        await database(this.env)
          .update(webhookEvents)
          .set({ status: 'failed', errorMessage: 'processing_failed' })
          .where(
            and(
              eq(webhookEvents.workspaceId, batch.workspaceId),
              inArray(
                webhookEvents.id,
                batch.events.map((e) => e.id),
              ),
            ),
          );
        await this.ctx.storage.delete('batch');
        if ((await this.ctx.storage.get<Pending[]>('pending'))?.length)
          await this.ctx.storage.setAlarm(Date.now() + Number(this.env.DEBOUNCE_MS));
      } else
        await this.ctx.storage.setAlarm(Date.now() + Math.min(60000, 2 ** batch.attempts * 1000));
    }
  }
  private async coalesceVisualTurn(batch: Batch, beginDelivery = true) {
    // Recheck after slow image/model calls, but never change IDs after sending starts.
    if (batch.deliveryStarted) return false;
    const result = await this.ctx.storage.transaction(async (tx) => {
      // Batch by arrival time, never by guessed language or visual-reference phrases.
      const visual = (e: Pending) => !e.postback;
      const pending = (await tx.get<Pending[]>('pending')) ?? [];
      const first = Math.min(...batch.events.map((e) => e.receivedAt ?? e.timestamp));
      const related = batch.events.every(visual)
        ? pending.filter(
            (e) =>
              visual(e) &&
              (e.receivedAt ?? e.timestamp) <= first + Number(this.env.DEBOUNCE_MAX_MS),
          )
        : [];
      if (related.length) {
        const next: Batch = {
          ...batch,
          events: [...batch.events, ...related].sort((a, b) => a.timestamp - b.timestamp),
        };
        delete next.reply;
        await tx.put('batch', next);
        const remaining = pending.filter((e) => !related.includes(e));
        await tx.put('pending', remaining);
        if (!remaining.length) await tx.delete('firstPending');
        await tx.setAlarm(Date.now() + Number(this.env.DEBOUNCE_MS));
        return { merged: true, next };
      }
      const next = { ...batch, deliveryStarted: beginDelivery };
      if (beginDelivery) await tx.put('batch', next);
      return { merged: false, next };
    });
    Object.assign(batch, result.next);
    if (result.merged) delete batch.reply;
    return result.merged;
  }
  async manualReply(input: unknown) {
    const p = z
      .object({
        workspaceId: z.string(),
        conversationId: z.string(),
        text: z.string().trim().min(1).max(2000),
        idempotencyKey: z.uuid(),
      })
      .strict()
      .parse(input);
    return deliver(
      this.env,
      p.workspaceId,
      p.conversationId,
      await sha256(`human:${p.workspaceId}:${p.conversationId}:${p.idempotencyKey}`),
      { text: p.text },
      'human',
    );
  }
}
