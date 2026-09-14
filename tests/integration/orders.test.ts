import { it, expect } from 'vitest';
import { env } from 'cloudflare:workers';
import { and, eq } from 'drizzle-orm';
import { database } from '../../src/worker/db/client';
import {
  variants,
  messages,
  orders,
  orderItems,
  orderDrafts,
  conversations,
} from '../../src/worker/db/schema';
import { createStore } from '../fixtures/store';
import { persistEvent } from '../../src/worker/routes/webhooks-meta';
import { ingestEvent } from '../../src/worker/repositories/conversations';
import {
  startDraft,
  updateDraft,
  addItem,
  reviewDraft,
  confirmDraft,
  type OrderContext,
} from '../../src/worker/services/orders';
async function readyOrder(shared?: Awaited<ReturnType<typeof createStore>>, quantity = 2) {
  const store = shared ?? (await createStore()),
    id = crypto.randomUUID();
  await persistEvent(env, {
    eventId: id,
    pageId: store.page,
    senderPsid: id,
    timestamp: Date.now() - 1000,
    type: 'text',
    text: 'order',
  });
  const event = (await ingestEvent(env, id))!;
  const ctx: OrderContext = {
    env,
    workspaceId: store.w,
    conversationId: event.conversationId,
    sourceText: 'name Abid phone 01712345678 address Mirpur 10, Dhaka area Dhakar vitore',
    sourceMessageIds: [],
  };
  await startDraft(ctx);
  await updateDraft(ctx, {
    customerName: 'Abid',
    phone: '01712345678',
    deliveryAddress: 'Mirpur 10, Dhaka',
    deliveryArea: 'Dhakar vitore',
  });
  await addItem(ctx, store.variant, quantity);
  const summary = await reviewDraft(ctx, 'english');
  await database(env)
    .insert(messages)
    .values({
      id: crypto.randomUUID(),
      workspaceId: store.w,
      conversationId: ctx.conversationId,
      direction: 'outbound',
      senderType: 'ai',
      messageType: 'text',
      text: summary.text,
      aiMetadataJson: JSON.stringify(summary.metadata),
      deliveryStatus: 'sent',
      createdAt: Date.now() - 100,
    });
  const confirmId = crypto.randomUUID();
  await database(env).insert(messages).values({
    id: confirmId,
    workspaceId: store.w,
    conversationId: ctx.conversationId,
    direction: 'inbound',
    senderType: 'customer',
    messageType: 'text',
    text: 'confirm',
    createdAt: Date.now(),
  });
  ctx.sourceText = 'confirm';
  ctx.sourceMessageIds = [confirmId];
  return { ...store, ctx, summary };
}
it('creates one atomic order with immutable snapshots and one stock decrement', async () => {
  const { ctx, w, variant } = await readyOrder();
  const first = await confirmDraft(ctx),
    second = await confirmDraft(ctx);
  expect(first.id).toBe(second.id);
  expect(first.total).toBe(306000);
  expect(await database(env).select().from(orders).where(eq(orders.workspaceId, w))).toHaveLength(
    1,
  );
  expect(
    (
      await database(env)
        .select()
        .from(variants)
        .where(and(eq(variants.workspaceId, w), eq(variants.id, variant)))
        .get()
    )?.stockOnHand,
  ).toBe(3);
  const item = (
    await database(env).select().from(orderItems).where(eq(orderItems.workspaceId, w))
  )[0]!;
  await expect(
    database(env).update(orderItems).set({ unitPrice: 1 }).where(eq(orderItems.id, item.id)),
  ).rejects.toThrow();
});
it('rejects a stock change before confirmation without partially creating an order', async () => {
  const { ctx, w, variant } = await readyOrder();
  await database(env)
    .update(variants)
    .set({ stockOnHand: 1 })
    .where(and(eq(variants.workspaceId, w), eq(variants.id, variant)));
  await expect(confirmDraft(ctx)).rejects.toThrow('Stock changed');
  expect(await database(env).select().from(orders).where(eq(orders.workspaceId, w))).toHaveLength(
    0,
  );
});
it('requires a new summary if price changes', async () => {
  const { ctx, w, variant } = await readyOrder();
  await database(env)
    .update(variants)
    .set({ priceOverride: 199000 })
    .where(and(eq(variants.workspaceId, w), eq(variants.id, variant)));
  await expect(confirmDraft(ctx)).rejects.toThrow('Order details changed');
  expect(await database(env).select().from(orders).where(eq(orders.workspaceId, w))).toHaveLength(
    0,
  );
});
it('rejects ambiguous or unproven confirmation', async () => {
  const { ctx } = await readyOrder();
  await expect(confirmDraft({ ...ctx, sourceText: 'maybe confirm' })).rejects.toThrow(
    'explicitly confirm',
  );
  await expect(confirmDraft({ ...ctx, sourceMessageIds: [] })).rejects.toThrow(
    'could not be verified',
  );
});
it('does not accept confirmation before a sent summary', async () => {
  const { ctx, w } = await readyOrder();
  await database(env)
    .update(messages)
    .set({ deliveryStatus: 'ready' })
    .where(and(eq(messages.workspaceId, w), eq(messages.direction, 'outbound')));
  await expect(confirmDraft(ctx)).rejects.toThrow('current order summary');
});
it('rejects foreign-tenant order tools', async () => {
  const { ctx } = await readyOrder();
  const other = await createStore();
  await expect(addItem({ ...ctx, workspaceId: other.w }, ctx.conversationId, 1)).rejects.toThrow();
});
it('rolls back the entire batch when the inventory trigger fails', async () => {
  const { ctx, w, variant, summary } = await readyOrder();
  await database(env)
    .update(orderDrafts)
    .set({ state: 'AWAITING_CONFIRMATION' })
    .where(and(eq(orderDrafts.workspaceId, w), eq(orderDrafts.id, summary.draftId)));
  const statements = [
    env.DB.prepare('UPDATE conversations SET mode=? WHERE workspace_id=? AND id=?').bind(
      'human',
      w,
      ctx.conversationId,
    ),
    env.DB.prepare(
      'UPDATE product_variants SET stock_on_hand=-1 WHERE workspace_id=? AND id=?',
    ).bind(w, variant),
  ];
  await expect(env.DB.batch(statements)).rejects.toThrow();
  expect(
    (
      await database(env)
        .select()
        .from(conversations)
        .where(and(eq(conversations.workspaceId, w), eq(conversations.id, ctx.conversationId)))
        .get()
    )?.mode,
  ).toBe('ai');
});

it('allows only one competing customer to purchase the last unit, and cancellation restores stock once', async () => {
  const s = await createStore(),
    a = await readyOrder(s, 1),
    b = await readyOrder(s, 1),
    db = database(env);
  await db.update(variants).set({ stockOnHand: 1 }).where(eq(variants.id, s.variant));
  const results = await Promise.allSettled([confirmDraft(a.ctx), confirmDraft(b.ctx)]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(await db.select().from(orders).where(eq(orders.workspaceId, s.w))).toHaveLength(1);
  expect(
    (await db.select().from(variants).where(eq(variants.id, s.variant)).get())?.stockOnHand,
  ).toBe(0);
  await db.update(orders).set({ status: 'cancelled' }).where(eq(orders.workspaceId, s.w));
  await db.update(orders).set({ status: 'cancelled' }).where(eq(orders.workspaceId, s.w));
  expect(
    (await db.select().from(variants).where(eq(variants.id, s.variant)).get())?.stockOnHand,
  ).toBe(1);
});

it('reports a placed order status without editing the order, restarting checkout or decrementing stock', async () => {
  const { ctx, w, variant } = await readyOrder();
  const order = await confirmDraft(ctx);
  const { orderStatusReply } = await import('../../src/worker/ai/order-status');
  const before = await database(env).select().from(orders).where(eq(orders.workspaceId, w));
  for (const status of ['confirmed', 'shipped', 'delivered'] as const) {
    await database(env).update(orders).set({ status }).where(eq(orders.id, order.id));
    ctx.sourceText = 'Amr order ki confirm hoise?';
    const reply = await orderStatusReply(ctx, 'banglish');
    expect(reply.text).toContain(order.orderNumber);
    expect(reply.metadata.status).toBe(status);
  }
  expect(await database(env).select().from(orders).where(eq(orders.workspaceId, w))).toHaveLength(
    before.length,
  );
  expect(
    (await database(env).select().from(variants).where(eq(variants.id, variant)).get())
      ?.stockOnHand,
  ).toBe(3);
  const other = await readyOrder();
  expect((await orderStatusReply(other.ctx, 'english')).text).not.toContain(order.orderNumber);
});
