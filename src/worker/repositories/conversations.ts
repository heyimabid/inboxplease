import { and, eq, sql } from 'drizzle-orm';
import { database } from '../db/client';
import { pages, customers, conversations, messages, webhookEvents } from '../db/schema';
import type { Env } from '../env';
import { required } from '../shared/errors';
import { sha256 } from '../services/encryption';
import { normalizedEventSchema } from '../meta/types';
export async function conversationContext(env: Env, w: string, id: string) {
  const db = database(env);
  const conversation = required(
    await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.workspaceId, w), eq(conversations.id, id)))
      .get(),
  );
  const [customer, page] = await Promise.all([
    db
      .select()
      .from(customers)
      .where(and(eq(customers.workspaceId, w), eq(customers.id, conversation.customerId)))
      .get(),
    db
      .select()
      .from(pages)
      .where(and(eq(pages.workspaceId, w), eq(pages.id, conversation.facebookPageId)))
      .get(),
  ]);
  return { workspaceId: w, conversation, customer: required(customer), page: required(page) };
}
export type ConversationContext = Awaited<ReturnType<typeof conversationContext>>;
export async function ingestEvent(env: Env, jobId: string) {
  const db = database(env);
  const event = await db.select().from(webhookEvents).where(eq(webhookEvents.id, jobId)).get();
  if (!event || event.status === 'processed') return null;
  const normalized = normalizedEventSchema.parse(JSON.parse(event.payloadJson));
  const page = await db
    .select()
    .from(pages)
    .where(
      and(
        eq(pages.workspaceId, event.workspaceId),
        eq(pages.facebookPageId, normalized.pageId),
        eq(pages.status, 'active'),
      ),
    )
    .get();
  if (!page) {
    await db
      .update(webhookEvents)
      .set({ status: 'processed', processedAt: Date.now() })
      .where(and(eq(webhookEvents.workspaceId, event.workspaceId), eq(webhookEvents.id, jobId)));
    return null;
  }
  const customerId = await sha256(
      `${page.workspaceId}:${page.facebookPageId}:${normalized.senderPsid}`,
    ),
    conversationId = await sha256(`${page.facebookPageId}:${normalized.senderPsid}`),
    now = Date.now();
  await db.batch([
    db
      .insert(customers)
      .values({
        id: customerId,
        workspaceId: page.workspaceId,
        facebookPageId: page.id,
        platformCustomerId: normalized.senderPsid,
      })
      .onConflictDoNothing(),
    db
      .insert(conversations)
      .values({
        id: conversationId,
        workspaceId: page.workspaceId,
        facebookPageId: page.id,
        customerId,
        lastMessageAt: Math.min(now, normalized.timestamp),
        lastCustomerMessageAt: Math.min(now, normalized.timestamp),
      })
      .onConflictDoNothing(),
  ]);
  const inserted = await db
    .insert(messages)
    .values({
      id: jobId,
      workspaceId: page.workspaceId,
      conversationId,
      metaMessageId: normalized.messageId ? `${page.facebookPageId}:${normalized.messageId}` : null,
      direction: 'inbound',
      senderType: 'customer',
      messageType: normalized.type,
      text: normalized.text,
      attachmentJson: normalized.attachments ? JSON.stringify(normalized.attachments) : null,
      createdAt: Math.min(normalized.timestamp, now),
    })
    .onConflictDoNothing()
    .returning({ id: messages.id });
  if (inserted.length)
    await db
      .update(conversations)
      .set({
        lastMessageAt: sql`max(${conversations.lastMessageAt},${Math.min(now, normalized.timestamp)})`,
        lastCustomerMessageAt: sql`max(${conversations.lastCustomerMessageAt},${Math.min(now, normalized.timestamp)})`,
        unreadCount: sql`${conversations.unreadCount}+1`,
        status: sql`case when ${conversations.status}='blocked' then 'blocked' else 'open' end`,
        updatedAt: now,
      })
      .where(
        and(eq(conversations.workspaceId, page.workspaceId), eq(conversations.id, conversationId)),
      );
  return { ...normalized, workspaceId: page.workspaceId, conversationId, customerId };
}
