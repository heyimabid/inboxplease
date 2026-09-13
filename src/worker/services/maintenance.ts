import { and, eq, lt, isNull, or, sql } from 'drizzle-orm';
import type { Env } from '../env';
import { database } from '../db/client';
import {
  temporaryImages,
  customers,
  pages,
  conversations,
  webhookEvents,
  products,
  catalogJobs,
  settings,
  sessions,
  onboardingSessions,
  rateLimits,
  messages,
  handoffs,
} from '../db/schema';
import { required } from '../shared/errors';
import { enqueueCatalog } from './product-indexer';
import { log } from '../shared/logger';
export async function deleteCustomer(env: Env, w: string, id: string) {
  const db = database(env);
  const customer = required(
    await db
      .select()
      .from(customers)
      .where(and(eq(customers.workspaceId, w), eq(customers.id, id)))
      .get(),
  );
  const page = required(
    await db
      .select()
      .from(pages)
      .where(and(eq(pages.workspaceId, w), eq(pages.id, customer.facebookPageId)))
      .get(),
  );
  await env.CONVERSATIONS.getByName(
    `${page.facebookPageId}:${customer.platformCustomerId}`,
  ).purge();
  const temporary = await db
    .select()
    .from(temporaryImages)
    .where(and(eq(temporaryImages.workspaceId, w), eq(temporaryImages.customerId, id)));
  for (const image of temporary) await env.PRODUCT_IMAGES.delete(image.r2Key);
  await db.batch([
    db
      .delete(webhookEvents)
      .where(
        and(
          eq(webhookEvents.workspaceId, w),
          sql`json_extract(${webhookEvents.payloadJson},'$.senderPsid')=${customer.platformCustomerId}`,
          sql`json_extract(${webhookEvents.payloadJson},'$.pageId')=${page.facebookPageId}`,
        ),
      ),
    db.delete(customers).where(and(eq(customers.workspaceId, w), eq(customers.id, id))),
  ]);
}
export async function maintenance(env: Env) {
  const db = database(env),
    now = Date.now();
  const pending = await db
    .select()
    .from(webhookEvents)
    .where(
      and(
        eq(webhookEvents.status, 'received'),
        or(isNull(webhookEvents.queuedAt), lt(webhookEvents.queuedAt, now - 5 * 60000)),
      ),
    )
    .limit(100);
  for (const event of pending) {
    try {
      await env.MESSAGE_QUEUE.send({ kind: 'message', jobId: event.id });
      await db
        .update(webhookEvents)
        .set({ queuedAt: now })
        .where(
          and(eq(webhookEvents.workspaceId, event.workspaceId), eq(webhookEvents.id, event.id)),
        );
    } catch {
      log('outbox_retry', { jobId: event.id, errorCategory: 'queue_unavailable' });
    }
  }
  const pendingProducts = await db
    .select({ id: products.id, workspaceId: products.workspaceId })
    .from(products)
    .where(eq(products.indexStatus, 'pending'))
    .limit(100);
  for (const product of pendingProducts) {
    try {
      await enqueueCatalog(env, product.workspaceId, product.id);
    } catch {
      log('catalog_outbox_retry', { jobId: product.id, errorCategory: 'queue_unavailable' });
    }
  }
  const stalled = await db
    .select()
    .from(catalogJobs)
    .where(
      and(
        eq(catalogJobs.status, 'pending'),
        or(isNull(catalogJobs.queuedAt), lt(catalogJobs.queuedAt, now - 5 * 60000)),
      ),
    )
    .limit(100);
  for (const job of stalled) {
    try {
      await env.CATALOG_QUEUE.send({ kind: 'catalog', jobId: job.id });
      await db
        .update(catalogJobs)
        .set({ queuedAt: now })
        .where(and(eq(catalogJobs.workspaceId, job.workspaceId), eq(catalogJobs.id, job.id)));
    } catch {
      log('catalog_outbox_retry', { jobId: job.id, errorCategory: 'queue_unavailable' });
    }
  }
  const expired = await db
    .select()
    .from(temporaryImages)
    .where(lt(temporaryImages.expiresAt, now))
    .limit(100);
  for (const image of expired) {
    await env.PRODUCT_IMAGES.delete(image.r2Key);
    await db
      .delete(temporaryImages)
      .where(
        and(eq(temporaryImages.workspaceId, image.workspaceId), eq(temporaryImages.id, image.id)),
      );
  }
  for (const config of await db.select().from(settings)) {
    const cutoff = now - config.retentionDays * 86400000;
    const old = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.workspaceId, config.workspaceId),
          lt(conversations.lastMessageAt, cutoff),
        ),
      )
      .limit(100);
    for (const c of old) {
      await db
        .update(handoffs)
        .set({ summary: null })
        .where(
          and(eq(handoffs.workspaceId, config.workspaceId), eq(handoffs.conversationId, c.id)),
        );
      await db
        .delete(messages)
        .where(
          and(
            eq(messages.workspaceId, config.workspaceId),
            eq(messages.conversationId, c.id),
            lt(messages.createdAt, cutoff),
          ),
        );
    }
    await db
      .delete(webhookEvents)
      .where(
        and(
          eq(webhookEvents.workspaceId, config.workspaceId),
          eq(webhookEvents.status, 'processed'),
          lt(webhookEvents.receivedAt, cutoff),
        ),
      );
  }
  await db.batch([
    db.delete(sessions).where(lt(sessions.expiresAt, now)),
    db.delete(onboardingSessions).where(lt(onboardingSessions.expiresAt, now)),
    db.delete(rateLimits).where(lt(rateLimits.expiresAt, now)),
  ]);
}
