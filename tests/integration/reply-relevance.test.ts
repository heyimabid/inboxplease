import { it, expect } from 'vitest';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { createStore } from '../fixtures/store';
import { database } from '../../src/worker/db/client';
import { products, variants, faqs } from '../../src/worker/db/schema';
import { getProduct } from '../../src/worker/repositories/products';
import { searchProducts } from '../../src/worker/ai/product-retrieval';
import { generateReply } from '../../src/worker/ai/reply-generator';
import { understand } from '../../src/worker/ai/intent-classifier';
import { relevantFaqs } from '../../src/worker/ai/faq-relevance';
import { persistEvent } from '../../src/worker/routes/webhooks-meta';
import { ingestEvent } from '../../src/worker/repositories/conversations';
import { orchestrate } from '../../src/worker/ai/orchestrator';
async function catalog() {
  const s = await createStore(),
    db = database(env);
  await db
    .update(products)
    .set({
      name: 'QCY Melobuds Pro HT08 ANC TWS Earbuds',
      normalizedName: 'qcy melobuds pro ht08 anc tws earbuds',
    })
    .where(eq(products.id, s.product));
  await db.delete(variants).where(eq(variants.id, s.variant));
  await db.insert(faqs).values({
    id: crypto.randomUUID(),
    workspaceId: s.w,
    question: 'Can i pay cash on delivery?',
    answer: 'yes',
    isActive: true,
  });
  const policies = await db.select().from(faqs).where(eq(faqs.workspaceId, s.w));
  return { ...s, policies };
}
it('keeps products without variants discoverable without inventing stock', async () => {
  const s = await catalog();
  for (const q of ['apnader ki earbuds ache?', 'i want to buy a earbud']) {
    const found = await searchProducts(env, s.w, q);
    expect(found.map((p) => p.id)).toContain(s.product);
    const reply = await generateReply(
      { ...env, APP_MODE: 'production' },
      found,
      q,
      'english',
      'friendly',
      s.policies,
    );
    expect(reply).toContain('QCY Melobuds');
    expect(reply).toContain('need seller confirmation');
    expect(reply).not.toContain('cash on delivery');
  }
});
it('does not let an unrelated COD FAQ replace a missing product result', async () => {
  const s = await catalog();
  for (const q of ['hello?', 'why are you replying same thing?', 'i want to buy a earbud']) {
    const reply = await generateReply(
      { ...env, APP_MODE: 'production' },
      [],
      q,
      'english',
      'friendly',
      s.policies,
    );
    expect(reply).not.toContain('cash on delivery');
    expect(reply).toContain('reliable match');
  }
  expect(relevantFaqs('Can I pay COD?', s.policies)).toHaveLength(1);
  expect(relevantFaqs('ডেলিভারি চার্জ কত?', s.policies)).toHaveLength(0);
  expect(
    await generateReply(env, [], 'Can I pay cash on delivery?', 'english', 'friendly', s.policies),
  ).toContain('yes');
});
it('recognizes fresh greetings and reply complaints despite irrelevant earlier assistant context', async () => {
  const context = JSON.stringify([{ sender: 'ai', text: 'Can i pay cash on delivery? yes' }]);
  expect((await understand({ ...env, APP_MODE: 'production' }, 'hello?', context)).intent).toBe(
    'greeting',
  );
  expect(
    (
      await understand(
        { ...env, APP_MODE: 'production' },
        'why are you replying same thing???',
        context,
      )
    ).intent,
  ).toBe('other');
});
it('answers the reported conversation without repeating a payment policy or taking an unfulfillable order', async () => {
  const s = await catalog();
  for (const text of [
    'hello?',
    'apnader ki earbuds ache?',
    'i want to buy a earbud',
    'why are you replying same thing???',
    'hello?',
  ]) {
    const id = crypto.randomUUID();
    await persistEvent(env, {
      eventId: id,
      pageId: s.page,
      senderPsid: 'reply-regression',
      timestamp: Date.now(),
      type: 'text',
      text,
    });
    const e = (await ingestEvent(env, id))!;
    const reply = await orchestrate(env, s.w, e.conversationId, text, [id]);
    expect(reply).not.toBeNull();
    expect(reply?.text).not.toContain('cash on delivery');
    if (text.includes('buy')) expect(reply?.text).toContain('before I can take an order');
    if (text === 'hello?') expect(reply?.metadata.tool).toBe('greeting');
    if (text.includes('same thing')) expect(reply?.metadata.tool).toBe('conversation_repair');
  }
  expect((await getProduct(env, s.w, s.product)).variants).toHaveLength(0);
});
