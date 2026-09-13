import { it, expect, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { and, eq } from 'drizzle-orm';
import { encode } from 'fast-png';
import { createStore } from '../fixtures/store';
import { database } from '../../src/worker/db/client';
import {
  conversations,
  images,
  messages,
  orderDrafts,
  webhookEvents,
} from '../../src/worker/db/schema';
import { persistEvent } from '../../src/worker/routes/webhooks-meta';
import { sha256 } from '../../src/worker/services/encryption';
import { orchestrate } from '../../src/worker/ai/orchestrator';

it.each(['text_first', 'photo_first', 'during_download'])(
  'combines photo and pointer text with an existing draft (arrival: %s)',
  async (arrival) => {
    const s = await createStore(),
      db = database(env);
    const stub = env.CONVERSATIONS.getByName(`${s.page}:visual`);
    const photoId = crypto.randomUUID(),
      textId = crypto.randomUUID(),
      imageId = crypto.randomUUID();
    const bytes = new Uint8Array(
      encode({ width: 2, height: 2, channels: 4, data: new Uint8Array(16).fill(180) }),
    ).buffer;
    await env.PRODUCT_IMAGES.put(`catalog/${imageId}`, bytes, {
      httpMetadata: { contentType: 'image/png' },
    });
    await db.insert(images).values({
      id: imageId,
      workspaceId: s.w,
      productId: s.product,
      r2Key: `catalog/${imageId}`,
      publicUrlOrDeliveryKey: imageId,
      sha256: await sha256(bytes),
      createdAt: Date.now(),
    });
    const receive = async (id: string) => {
      await persistEvent(env, {
        eventId: id,
        pageId: s.page,
        senderPsid: 'visual',
        timestamp: Date.now(),
        type: id === photoId ? 'image' : 'text',
        text: id === textId ? 'ei ta ache?' : undefined,
        attachments:
          id === photoId
            ? [{ type: 'image', url: 'https://scontent.fbcdn.net/fixture.png' }]
            : undefined,
      });
      await env.CONVERSATIONS.getByName(`${s.page}:visual`).receive(id);
    };
    const download = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      if (arrival === 'during_download') await receive(textId);
      return new Response(bytes, { headers: { 'Content-Type': 'image/png' } });
    });
    try {
      for (const id of arrival === 'during_download'
        ? [photoId]
        : arrival === 'photo_first'
          ? [photoId, textId]
          : [textId, photoId])
        await receive(id);
      // receive must persist both parts without waiting on an attachment download.
      expect(download).not.toHaveBeenCalled();
      await runInDurableObject(stub, async (_instance, state) => {
        expect(await state.storage.get<unknown[]>('pending')).toHaveLength(
          arrival === 'during_download' ? 1 : 2,
        );
        expect((await state.storage.getAlarm())! - Date.now()).toBeGreaterThan(
          Number(env.DEBOUNCE_MS),
        );
      });
      const conversation = (await db
        .select()
        .from(conversations)
        .where(eq(conversations.workspaceId, s.w))
        .get())!;
      const draftId = crypto.randomUUID();
      await db.insert(orderDrafts).values({
        id: draftId,
        workspaceId: s.w,
        conversationId: conversation.id,
        customerId: conversation.customerId,
        state: 'COLLECTING_CUSTOMER_NAME',
        currency: 'BDT',
        selectionJson: JSON.stringify({ productId: s.product, variantId: s.variant }),
        lastUpdatedAt: Date.now(),
      });
      const before = await db.select().from(orderDrafts).where(eq(orderDrafts.id, draftId)).get();
      // A pointer without a photo must also leave checkout untouched.
      const pointer = await orchestrate(env, s.w, conversation.id, 'eta nai?');
      expect(pointer?.metadata.tool).toBe('visual_reference');
      await runDurableObjectAlarm(stub);
      if (arrival === 'during_download') {
        await runInDurableObject(stub, async (_instance, state) => {
          expect((await state.storage.get<{ events: unknown[] }>('batch'))?.events).toHaveLength(2);
          expect(await state.storage.get<unknown[]>('pending')).toHaveLength(0);
          expect(await state.storage.getAlarm()).not.toBeNull();
        });
        expect(
          await db
            .select()
            .from(messages)
            .where(and(eq(messages.workspaceId, s.w), eq(messages.direction, 'outbound'))),
        ).toHaveLength(0);
        await runDurableObjectAlarm(stub);
      }
      const sent = await db
        .select()
        .from(messages)
        .where(and(eq(messages.workspaceId, s.w), eq(messages.direction, 'outbound')));
      expect(sent.filter((m) => m.text)).toHaveLength(1);
      expect(sent.filter((m) => m.messageType === 'image')).toHaveLength(1);
      expect(JSON.parse(sent.find((m) => m.text)!.aiMetadataJson!).tool).toBe('image_search');
      expect(await db.select().from(orderDrafts).where(eq(orderDrafts.id, draftId)).get()).toEqual(
        before,
      );
      expect(
        (await db.select().from(webhookEvents).where(eq(webhookEvents.workspaceId, s.w))).every(
          (e) => e.status === 'processed',
        ),
      ).toBe(true);
      await stub.receive(photoId);
      await stub.receive(textId);
      await runDurableObjectAlarm(stub);
      expect(
        await db
          .select()
          .from(messages)
          .where(and(eq(messages.workspaceId, s.w), eq(messages.direction, 'outbound'))),
      ).toHaveLength(2);
    } finally {
      download.mockRestore();
    }
  },
);
