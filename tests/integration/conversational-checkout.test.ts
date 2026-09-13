import { it, expect } from 'vitest';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { createStore } from '../fixtures/store';
import { database } from '../../src/worker/db/client';
import { customers, messages } from '../../src/worker/db/schema';
import { persistEvent } from '../../src/worker/routes/webhooks-meta';
import { ingestEvent } from '../../src/worker/repositories/conversations';
import { orchestrate } from '../../src/worker/ai/orchestrator';
import { orderFlow } from '../../src/worker/ai/order-flow';
import { mockIntent } from '../../src/worker/ai/intent-classifier';
import {
  getDraft,
  startDraft,
  addItem,
  updateDraft,
  type OrderContext,
} from '../../src/worker/services/orders';

async function fixture() {
  const s = await createStore(),
    id = crypto.randomUUID();
  await persistEvent(env, {
    eventId: id,
    pageId: s.page,
    senderPsid: id,
    timestamp: Date.now(),
    type: 'text',
    text: 'order',
  });
  const event = (await ingestEvent(env, id))!;
  const ctx: OrderContext = {
    env,
    workspaceId: s.w,
    conversationId: event.conversationId,
    sourceText: '',
    sourceMessageIds: [],
  };
  await database(env)
    .update(customers)
    .set({ facebookName: 'Abid Hasan' })
    .where(eq(customers.id, event.customerId));
  await startDraft(ctx);
  await addItem(ctx, s.variant, 1);
  return { s, ctx };
}
it('answers browsing questions during checkout without consuming them as customer details', async () => {
  const { s, ctx } = await fixture();
  const before = await getDraft(ctx);
  for (const text of ['Ki ki ponno ache?', 'Boltesi ki ki products ache?', 'What do you sell?']) {
    const reply = await orchestrate(env, s.w, ctx.conversationId, text);
    expect(reply?.metadata.tool).toBe('search_products');
    expect(reply?.productIds).toEqual([s.product]);
    expect(reply?.text).toContain('Black hoodie');
    expect(await getDraft(ctx)).toEqual(before);
  }
});
it('uses the authenticated customer profile on my-name consent and retains addresses despite an invented zone', async () => {
  const { ctx } = await fixture();
  ctx.sourceText = 'Amr name e';
  await orderFlow(ctx, mockIntent(ctx.sourceText), 'banglish');
  expect((await getDraft(ctx))?.customerName).toBe('Abid Hasan');
  ctx.sourceText = '01712345678';
  await orderFlow(ctx, mockIntent(ctx.sourceText), 'banglish');
  ctx.sourceText = '97 Asad Ave, Dhaka, Bangladesh, 1207';
  const intent = mockIntent(ctx.sourceText);
  intent.extractedOrderFields.deliveryArea = 'Dhaka';
  const reply = await orderFlow(ctx, intent, 'banglish');
  expect((await getDraft(ctx))?.deliveryAddress).toBe(ctx.sourceText);
  expect((await getDraft(ctx))?.deliveryArea).toBeNull();
  expect(reply?.text).toContain('address-ta peyechi');
  expect(reply?.text).toContain('Dhakar vitore');
  ctx.sourceText = '?';
  const before = await getDraft(ctx);
  const clarify = await orderFlow(ctx, mockIntent('?'), 'banglish');
  expect(clarify?.text).toContain('details save ache');
  expect(clarify?.text).toContain('Dhakar vitore');
  expect(await getDraft(ctx)).toEqual(before);
});
it('accepts yes to a displayed profile-name question without placing an order or trusting arbitrary model names', async () => {
  const { s, ctx } = await fixture();
  ctx.sourceText = 'quantity 1';
  const question = await orderFlow(ctx, mockIntent(ctx.sourceText), 'english');
  expect(question?.text).toContain('Abid Hasan');
  await database(env)
    .insert(messages)
    .values({
      id: crypto.randomUUID(),
      workspaceId: s.w,
      conversationId: ctx.conversationId,
      direction: 'outbound',
      senderType: 'ai',
      messageType: 'text',
      text: question!.text,
      aiMetadataJson: JSON.stringify(question!.metadata),
      deliveryStatus: 'sent',
      createdAt: Date.now(),
    });
  ctx.sourceText = 'হ্যাঁ';
  await orderFlow(ctx, mockIntent(ctx.sourceText), 'banglish');
  expect((await getDraft(ctx))?.customerName).toBe('Abid Hasan');
  expect((await getDraft(ctx))?.state).not.toBe('CONFIRMED');
  ctx.sourceText = 'Amr name e';
  await expect(updateDraft(ctx, { customerName: 'Another Person' })).rejects.toThrow('explicitly');
});
