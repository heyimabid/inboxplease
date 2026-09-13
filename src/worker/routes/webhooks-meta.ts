import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { database } from '../db/client';
import { pages, webhookEvents } from '../db/schema';
import type { AppContext } from '../services/sessions';
import { AppError } from '../shared/errors';
import { timingEqual } from '../services/encryption';
import { readLimited } from '../services/images';
import { verifySignature } from '../meta/signature';
import { parseWebhook } from '../meta/webhook-parser';
import type { Env } from '../env';
import type { NormalizedMessengerEvent } from '../meta/types';
export async function persistEvent(env: Env, event: NormalizedMessengerEvent) {
  const db = database(env);
  const page = await db
    .select()
    .from(pages)
    .where(and(eq(pages.facebookPageId, event.pageId), eq(pages.status, 'active')))
    .get();
  if (!page) return false;
  const existing = await db
    .select()
    .from(webhookEvents)
    .where(
      and(eq(webhookEvents.workspaceId, page.workspaceId), eq(webhookEvents.id, event.eventId)),
    )
    .get();
  if (existing?.queuedAt || existing?.status === 'processed') return false;
  await db
    .insert(webhookEvents)
    .values({
      id: event.eventId,
      workspaceId: page.workspaceId,
      metaEventId: event.eventId,
      eventType: event.type,
      payloadJson: JSON.stringify(event),
      receivedAt: Date.now(),
    })
    .onConflictDoNothing();
  await env.MESSAGE_QUEUE.send({ kind: 'message', jobId: event.eventId });
  await db
    .update(webhookEvents)
    .set({ queuedAt: Date.now() })
    .where(
      and(eq(webhookEvents.workspaceId, page.workspaceId), eq(webhookEvents.id, event.eventId)),
    );
  return true;
}
export const webhookRoutes = new Hono<AppContext>();
webhookRoutes.get('/', async (c) => {
  if (
    c.req.query('hub.mode') !== 'subscribe' ||
    !c.env.META_WEBHOOK_VERIFY_TOKEN ||
    !(await timingEqual(c.req.query('hub.verify_token') ?? '', c.env.META_WEBHOOK_VERIFY_TOKEN))
  )
    throw new AppError('WEBHOOK_VERIFICATION_FAILED', 'Verification failed', 403);
  return c.text(c.req.query('hub.challenge') ?? '');
});
webhookRoutes.post('/', async (c) => {
  const raw = await readLimited(c.req.raw.body, 1000000);
  if (!(await verifySignature(raw, c.req.header('X-Hub-Signature-256'), c.env.META_APP_SECRET)))
    throw new AppError('INVALID_SIGNATURE', 'Invalid webhook signature', 403);
  let input: unknown;
  try {
    input = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    throw new AppError('INVALID_JSON', 'Invalid webhook body');
  }
  for (const event of await parseWebhook(input)) await persistEvent(c.env, event);
  return c.json({ success: true, data: { received: true } });
});
