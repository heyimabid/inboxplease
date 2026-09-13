import { it, expect } from 'vitest';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { createStore } from '../fixtures/store';
import { database } from '../../src/worker/db/client';
import { customers, variants, settings } from '../../src/worker/db/schema';
import { persistEvent } from '../../src/worker/routes/webhooks-meta';
import { ingestEvent } from '../../src/worker/repositories/conversations';
import { orchestrate } from '../../src/worker/ai/orchestrator';
import { getDraft, startDraft, addItem } from '../../src/worker/services/orders';
import { orderFlow } from '../../src/worker/ai/order-flow';
import { mockIntent } from '../../src/worker/ai/intent-classifier';
it('saves language preference only after three meaningful customer messages', async () => {
  const s = await createStore(),
    db = database(env);
  for (let i = 0; i < 3; i++) {
    const id = crypto.randomUUID();
    await persistEvent(env, {
      eventId: id,
      pageId: s.page,
      senderPsid: 'language',
      timestamp: Date.now() + i,
      type: 'text',
      text: 'black hoodie ta XL e available ache?',
    });
    const event = (await ingestEvent(env, id))!;
    await orchestrate(env, s.w, event.conversationId, 'black hoodie ta XL e available ache?', [id]);
    const customer = await db
      .select()
      .from(customers)
      .where(eq(customers.id, event.customerId))
      .get();
    expect(customer?.languagePreference).toBe(i === 2 ? 'banglish' : null);
  }
});
it('uses the seller wording dictionary in grounded retrieval', async () => {
  const s = await createStore(),
    id = crypto.randomUUID();
  await database(env)
    .update(settings)
    .set({ normalizationJson: JSON.stringify({ winterwear: 'hoodie' }) })
    .where(eq(settings.workspaceId, s.w));
  await persistEvent(env, {
    eventId: id,
    pageId: s.page,
    senderPsid: 'dictionary',
    timestamp: Date.now(),
    type: 'text',
    text: 'winterwear price',
  });
  const e = (await ingestEvent(env, id))!;
  const reply = await orchestrate(env, s.w, e.conversationId, 'winterwear price', [id]);
  expect(reply?.text).toContain('Black hoodie');
  expect(reply?.text).toContain('1,490');
});
it('persists a requested variant change, removes the old item, and accepts a plain quantity', async () => {
  const s = await createStore(),
    id = crypto.randomUUID(),
    red = crypto.randomUUID();
  await database(env).insert(variants).values({
    id: red,
    workspaceId: s.w,
    productId: s.product,
    sku: red,
    title: 'Red / XL',
    color: 'red',
    size: 'XL',
    stockOnHand: 4,
  });
  await persistEvent(env, {
    eventId: id,
    pageId: s.page,
    senderPsid: 'edit',
    timestamp: Date.now(),
    type: 'text',
    text: 'order',
  });
  const e = (await ingestEvent(env, id))!;
  const ctx = {
    env,
    workspaceId: s.w,
    conversationId: e.conversationId,
    sourceText: 'black hoodie XL',
    sourceMessageIds: [id],
  };
  await startDraft(ctx);
  await addItem(ctx, s.variant, 1);
  const change = { ...ctx, sourceText: 'না, color change' };
  await orderFlow(change, mockIntent(change.sourceText), 'banglish');
  expect((await getDraft(ctx))?.items).toHaveLength(0);
  const choose = { ...ctx, sourceText: 'red XL quantity 2' };
  await orderFlow(choose, mockIntent(choose.sourceText), 'english');
  const draft = await getDraft(ctx);
  expect(draft?.items).toHaveLength(1);
  expect(draft?.items[0]?.variantId).toBe(red);
  expect(draft?.items[0]?.quantity).toBe(2);
  expect(draft?.reviewHash).toBeNull();
});
