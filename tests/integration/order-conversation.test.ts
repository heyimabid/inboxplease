import { it, expect } from 'vitest';
import { env } from 'cloudflare:workers';
import { createStore } from '../fixtures/store';
import { persistEvent } from '../../src/worker/routes/webhooks-meta';
import { ingestEvent } from '../../src/worker/repositories/conversations';
import { orderFlow } from '../../src/worker/ai/order-flow';
import { mockIntent } from '../../src/worker/ai/intent-classifier';
import { getDraft, type OrderContext } from '../../src/worker/services/orders';

it('collects a Banglish order without confusing names, phone numbers, addresses or historical fields', async () => {
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
  async function say(text: string, stale = false) {
    ctx.sourceText = text;
    const intent = mockIntent(text);
    if (stale)
      Object.assign(intent.extractedOrderFields, {
        customerName: 'Old Name',
        phone: '1234567890',
        address: 'Old Road',
        quantity: 3,
      });
    return orderFlow(ctx, intent, 'english');
  }
  await say('black hoodie ekta nibo');
  expect((await getDraft(ctx))?.items[0]?.quantity).toBe(1);
  await say('quantity 3');
  expect((await getDraft(ctx))?.items[0]?.quantity).toBe(3);
  expect((await say('amr name e hobe'))?.text).toContain('What name');
  expect((await getDraft(ctx))?.customerName).toBeNull();
  await say('Abid Hasan', true);
  expect((await getDraft(ctx))?.customerName).toBe('Abid Hasan');
  expect((await say('1234567890'))?.text).toContain('valid Bangladeshi');
  expect((await getDraft(ctx))?.phone).toBeNull();
  await say('01712345678', true);
  expect((await getDraft(ctx))?.phone).toBe('+8801712345678');
  await say('97 Asad Ave, Dhaka, Bangladesh, 1207', true);
  expect((await getDraft(ctx))?.deliveryAddress).toBe('97 Asad Ave, Dhaka, Bangladesh, 1207');
  expect((await getDraft(ctx))?.phone).toBe('+8801712345678');
  const reply = await say('Dhakar vitore', true);
  expect(reply?.text).toContain('Abid Hasan');
  expect((await getDraft(ctx))?.state).toBe('AWAITING_CONFIRMATION');
  expect((await getDraft(ctx))?.items[0]?.quantity).toBe(3);
});
