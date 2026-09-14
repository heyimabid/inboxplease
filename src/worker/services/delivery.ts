import { requestsPaymentCredentials } from '../ai/safety';
import { and, eq } from 'drizzle-orm';
import type { Env } from '../env';
import { database } from '../db/client';
import { conversations, messages, pages, settings } from '../db/schema';
import { conversationContext } from '../repositories/conversations';
import { metaClient, MetaError } from '../meta/client';
import { decrypt } from './encryption';
import type { OutgoingMessage } from '../meta/types';
import { handoff } from './handoff';
import { AppError } from '../shared/errors';
import { pageReady } from '../meta/activation';
export async function deliver(
  env: Env,
  w: string,
  conversationId: string,
  id: string,
  message: OutgoingMessage,
  sender: 'ai' | 'human',
  metadata: Record<string, string | number> = {},
) {
  const db = database(env);
  const context = await conversationContext(env, w, conversationId);
  if (
    env.MESSAGING_ENABLED !== 'true' ||
    !pageReady(context.page) ||
    !context.page.encryptedPageAccessToken
  )
    return 'suppressed';
  if (context.conversation.status === 'blocked') return 'suppressed';
  const config = await db.select().from(settings).where(eq(settings.workspaceId, w)).get();
  if (
    sender === 'ai' &&
    (env.AI_ENABLED !== 'true' ||
      !context.page.aiEnabled ||
      context.conversation.mode === 'human' ||
      !config?.autoReply)
  )
    return 'suppressed';
  if (
    Date.now() - context.conversation.lastCustomerMessageAt >
    Math.min(24, Number(env.MESSENGER_WINDOW_HOURS)) * 3600000
  ) {
    await handoff(env, w, conversationId, 'messaging_window_closed');
    if (sender === 'human')
      throw new AppError('MESSAGING_WINDOW_CLOSED', 'The Messenger reply window has closed', 409);
    return 'suppressed';
  }
  if (
    sender === 'ai' &&
    env.APP_MODE === 'mock' &&
    'text' in message &&
    requestsPaymentCredentials(message.text)
  ) {
    await handoff(env, w, conversationId, 'unsafe_catalog_content');
    return 'suppressed';
  }
  await db
    .insert(messages)
    .values({
      id,
      workspaceId: w,
      conversationId,
      direction: 'outbound',
      senderType: sender,
      messageType: 'text' in message ? 'text' : 'image',
      text: 'text' in message ? message.text : null,
      attachmentJson: 'attachment' in message ? JSON.stringify([message.attachment]) : null,
      aiMetadataJson: JSON.stringify(metadata),
      deliveryStatus: 'ready',
      createdAt: Date.now(),
    })
    .onConflictDoNothing();
  const row = await db
    .select()
    .from(messages)
    .where(and(eq(messages.workspaceId, w), eq(messages.id, id)))
    .get();
  if (row?.deliveryStatus === 'sent') return 'sent';
  if (row?.deliveryStatus === 'sending' || row?.deliveryStatus === 'unknown') {
    await db
      .update(messages)
      .set({ deliveryStatus: 'unknown' })
      .where(and(eq(messages.workspaceId, w), eq(messages.id, id)));
    await handoff(env, w, conversationId, 'ambiguous_delivery');
    return 'unknown';
  }
  if (row?.deliveryStatus === 'failed') return 'failed';
  const token = await decrypt(
    env,
    context.page.encryptedPageAccessToken,
    context.page.tokenKeyVersion,
    `${w}:${context.page.facebookPageId}`,
  );
  // Recheck immediately before claiming a send: a seller may take over during inference.
  const latest = await conversationContext(env, w, conversationId);
  const latestConfig = await db.select().from(settings).where(eq(settings.workspaceId, w)).get();
  if (
    !pageReady(latest.page) ||
    latest.page.encryptedPageAccessToken !== context.page.encryptedPageAccessToken ||
    latest.conversation.status === 'blocked' ||
    (sender === 'ai' &&
      (!latest.page.aiEnabled || !latestConfig?.autoReply || latest.conversation.mode === 'human'))
  )
    return 'suppressed';
  const claimed = await db
    .update(messages)
    .set({ deliveryStatus: 'sending' })
    .where(
      and(eq(messages.workspaceId, w), eq(messages.id, id), eq(messages.deliveryStatus, 'ready')),
    )
    .returning({ id: messages.id });
  if (!claimed.length) return 'suppressed';
  try {
    const result = await metaClient(env).send(
      context.page.facebookPageId,
      context.customer.platformCustomerId,
      token,
      message,
      id,
    );
    await db.batch([
      db
        .update(messages)
        .set({ deliveryStatus: 'sent', metaMessageId: result.messageId })
        .where(and(eq(messages.workspaceId, w), eq(messages.id, id))),
      db
        .update(conversations)
        .set({
          lastMessageAt: Date.now(),
          ...(sender === 'ai' ? { lastAiMessageAt: Date.now() } : {}),
          updatedAt: Date.now(),
        })
        .where(and(eq(conversations.workspaceId, w), eq(conversations.id, conversationId))),
    ]);
    return 'sent';
  } catch (e) {
    if (e instanceof MetaError) {
      await db
        .update(messages)
        .set({ deliveryStatus: e.retryable ? 'ready' : 'failed' })
        .where(and(eq(messages.workspaceId, w), eq(messages.id, id)));
      if ([10, 190, 200].includes(e.metaCode))
        await db
          .update(pages)
          .set({ status: 'error', aiEnabled: false, webhookSubscribedAt: null })
          .where(and(eq(pages.workspaceId, w), eq(pages.id, context.page.id)));
      if (e.retryable) throw e;
      await handoff(env, w, conversationId, 'meta_delivery_failed');
      return 'failed';
    }
    await db
      .update(messages)
      .set({ deliveryStatus: 'unknown' })
      .where(and(eq(messages.workspaceId, w), eq(messages.id, id)));
    await handoff(env, w, conversationId, 'ambiguous_delivery');
    return 'unknown';
  }
}
