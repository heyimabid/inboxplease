import { deleteCustomer } from '../services/maintenance';
import { requireAdmin } from '../services/sessions';
import { Hono } from 'hono';
import { and, eq, desc, asc, like, sql } from 'drizzle-orm';
import { z } from 'zod';
import { database } from '../db/client';
import {
  conversations,
  customers,
  pages,
  messages,
  handoffs,
  orderDrafts,
  draftItems,
} from '../db/schema';
import { authenticated, workspace, csrf, type AppContext } from '../services/sessions';
import { pagination } from '../shared/validation';
import { conversationContext } from '../repositories/conversations';
import { handoff, resumeAi } from '../services/handoff';
import { persistEvent } from './webhooks-meta';
import { required, AppError } from '../shared/errors';
import { sha256 } from '../services/encryption';
export const conversationRoutes = new Hono<AppContext>();
conversationRoutes.use('*', authenticated, workspace, csrf);
conversationRoutes.get('/', async (c) => {
  const w = c.get('workspaceId'),
    p = pagination.parse(c.req.query()),
    q = c.req.query('q');
  const mode = z.enum(['ai', 'human']).optional().parse(c.req.query('mode'));
  const data = await database(c.env)
    .select({
      id: conversations.id,
      workspaceId: conversations.workspaceId,
      facebookPageId: conversations.facebookPageId,
      customerId: conversations.customerId,
      mode: conversations.mode,
      status: conversations.status,
      orderState: conversations.orderState,
      lastMessageAt: conversations.lastMessageAt,
      unreadCount: conversations.unreadCount,
      customerName: customers.name,
      pageName: pages.pageName,
      preview: sql<
        string | null
      >`(SELECT text FROM messages WHERE workspace_id=${w} AND conversation_id=${conversations.id} ORDER BY created_at DESC LIMIT 1)`,
    })
    .from(conversations)
    .innerJoin(
      customers,
      and(eq(customers.id, conversations.customerId), eq(customers.workspaceId, w)),
    )
    .innerJoin(pages, and(eq(pages.id, conversations.facebookPageId), eq(pages.workspaceId, w)))
    .where(
      and(
        eq(conversations.workspaceId, w),
        mode ? eq(conversations.mode, mode) : undefined,
        q ? like(customers.name, `%${q}%`) : undefined,
      ),
    )
    .orderBy(desc(conversations.lastMessageAt))
    .limit(p.limit)
    .offset(p.offset);
  return c.json({ success: true, data });
});
conversationRoutes.get('/:id', async (c) => {
  const w = c.get('workspaceId'),
    id = c.req.param('id'),
    db = database(c.env);
  const context = await conversationContext(c.env, w, id);
  const p = pagination.parse({ ...c.req.query(), limit: c.req.query('limit') ?? '100' });
  const [history, human, draft] = await Promise.all([
    db
      .select()
      .from(messages)
      .where(and(eq(messages.workspaceId, w), eq(messages.conversationId, id)))
      .orderBy(desc(messages.createdAt))
      .limit(p.limit)
      .offset(p.offset),
    db
      .select()
      .from(handoffs)
      .where(and(eq(handoffs.workspaceId, w), eq(handoffs.conversationId, id)))
      .get(),
    db
      .select()
      .from(orderDrafts)
      .where(and(eq(orderDrafts.workspaceId, w), eq(orderDrafts.conversationId, id)))
      .get(),
  ]);
  const items = draft
    ? await db
        .select()
        .from(draftItems)
        .where(and(eq(draftItems.workspaceId, w), eq(draftItems.orderDraftId, draft.id)))
    : [];
  return c.json({
    success: true,
    data: {
      conversation: context.conversation,
      customer: context.customer,
      page: { id: context.page.id, name: context.page.pageName },
      messages: history.reverse(),
      handoff: human ?? null,
      draft: draft ? { ...draft, items } : null,
    },
  });
});
conversationRoutes.post('/:id/read', async (c) => {
  const w = c.get('workspaceId'),
    id = c.req.param('id');
  await conversationContext(c.env, w, id);
  await database(c.env)
    .update(conversations)
    .set({ unreadCount: 0 })
    .where(and(eq(conversations.workspaceId, w), eq(conversations.id, id)));
  return c.json({ success: true, data: { read: true } });
});
conversationRoutes.post('/:id/mode', async (c) => {
  const { mode, assignedUserId } = z
    .object({ mode: z.enum(['ai', 'human']), assignedUserId: z.string().optional() })
    .strict()
    .parse(await c.req.json());
  const w = c.get('workspaceId'),
    id = c.req.param('id');
  await conversationContext(c.env, w, id);
  if (mode === 'human') await handoff(c.env, w, id, 'seller_takeover', assignedUserId);
  else await resumeAi(c.env, w, id);
  return c.json({ success: true, data: { mode } });
});
conversationRoutes.post('/:id/reply', async (c) => {
  const input = z
    .object({ text: z.string().trim().min(1).max(2000), idempotencyKey: z.uuid() })
    .strict()
    .parse(await c.req.json());
  const w = c.get('workspaceId'),
    id = c.req.param('id');
  const context = await conversationContext(c.env, w, id);
  await handoff(c.env, w, id, 'seller_reply', c.get('session').userId);
  const result = await c.env.CONVERSATIONS.getByName(
    `${context.page.facebookPageId}:${context.customer.platformCustomerId}`,
  ).manualReply({ ...input, workspaceId: w, conversationId: id });
  return c.json({ success: true, data: { delivery: result } });
});
conversationRoutes.post('/:id/status', async (c) => {
  const { status } = z
    .object({ status: z.enum(['open', 'resolved', 'blocked']) })
    .strict()
    .parse(await c.req.json());
  const w = c.get('workspaceId'),
    id = c.req.param('id');
  await conversationContext(c.env, w, id);
  await database(c.env)
    .update(conversations)
    .set({ status })
    .where(and(eq(conversations.workspaceId, w), eq(conversations.id, id)));
  return c.json({ success: true, data: { status } });
});
export const mockRoutes = new Hono<AppContext>();
mockRoutes.use('*', authenticated, workspace, csrf);
mockRoutes.post('/message', async (c) => {
  if (c.env.APP_MODE !== 'mock') throw new AppError('NOT_FOUND', 'Route not found', 404);
  const input = z
    .object({
      pageId: z.string(),
      customerId: z.string().min(1).max(100),
      text: z.string().min(1).max(2000),
      messageId: z.string().optional(),
    })
    .strict()
    .parse(await c.req.json());
  const page = required(
    await database(c.env)
      .select()
      .from(pages)
      .where(
        and(
          eq(pages.workspaceId, c.get('workspaceId')),
          eq(pages.id, input.pageId),
          eq(pages.status, 'active'),
        ),
      )
      .get(),
  );
  const messageId = input.messageId ?? crypto.randomUUID();
  await persistEvent(c.env, {
    eventId: await sha256(`${page.facebookPageId}:${input.customerId}:${messageId}`),
    pageId: page.facebookPageId,
    senderPsid: input.customerId,
    messageId,
    timestamp: Date.now(),
    type: 'text',
    text: input.text,
  });
  return c.json({ success: true, data: { queued: true } });
});
export const customerRoutes = new Hono<AppContext>();
customerRoutes.use('*', authenticated, workspace, csrf);
customerRoutes.get('/', async (c) => {
  const p = pagination.parse(c.req.query());
  return c.json({
    success: true,
    data: await database(c.env)
      .select()
      .from(customers)
      .where(eq(customers.workspaceId, c.get('workspaceId')))
      .orderBy(asc(customers.name))
      .limit(p.limit)
      .offset(p.offset),
  });
});
customerRoutes.get('/:id', async (c) =>
  c.json({
    success: true,
    data: required(
      await database(c.env)
        .select()
        .from(customers)
        .where(
          and(eq(customers.workspaceId, c.get('workspaceId')), eq(customers.id, c.req.param('id'))),
        )
        .get(),
    ),
  }),
);

customerRoutes.delete('/:id', async (c) => {
  requireAdmin(c);
  await deleteCustomer(c.env, c.get('workspaceId'), c.req.param('id'));
  return c.json({ success: true, data: { deleted: true } });
});
