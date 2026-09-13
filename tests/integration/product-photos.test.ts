import { it, expect } from 'vitest';
import { env } from 'cloudflare:workers';
import { runDurableObjectAlarm } from 'cloudflare:test';
import { and, eq } from 'drizzle-orm';
import { encode } from 'fast-png';
import { createStore } from '../fixtures/store';
import { database } from '../../src/worker/db/client';
import { images, messages, products } from '../../src/worker/db/schema';
import { sha256 } from '../../src/worker/services/encryption';
import { persistEvent } from '../../src/worker/routes/webhooks-meta';
import { productPhotoReply } from '../../src/worker/ai/product-photos';
import { app } from '../../src/worker/app';
it('delivers an actual signed catalog image for a named request and a follow-up photo request', async () => {
  const s = await createStore(),
    db = database(env),
    id = crypto.randomUUID();
  const bytes = new Uint8Array(
    encode({ width: 2, height: 2, channels: 4, data: new Uint8Array(16).fill(180) }),
  ).buffer;
  await env.PRODUCT_IMAGES.put(`catalog/${s.w}/${id}`, bytes, {
    httpMetadata: { contentType: 'image/png' },
  });
  await db.insert(images).values({
    id,
    workspaceId: s.w,
    productId: s.product,
    r2Key: `catalog/${s.w}/${id}`,
    publicUrlOrDeliveryKey: id,
    sha256: await sha256(bytes),
    createdAt: Date.now(),
  });
  const stub = env.CONVERSATIONS.getByName(`${s.page}:photo-customer`);
  for (const text of ['show me the black hoodie image', 'picture den']) {
    const eventId = crypto.randomUUID();
    await persistEvent(env, {
      eventId,
      pageId: s.page,
      senderPsid: 'photo-customer',
      timestamp: Date.now(),
      type: 'text',
      text,
    });
    await stub.receive(eventId);
    await runDurableObjectAlarm(stub);
  }
  const sent = await db
    .select()
    .from(messages)
    .where(and(eq(messages.workspaceId, s.w), eq(messages.direction, 'outbound')));
  const pictures = sent.filter((m) => m.messageType === 'image');
  expect(pictures).toHaveLength(2);
  expect(sent.filter((m) => m.text)).toHaveLength(2);
  for (const picture of pictures) {
    const payload = JSON.parse(picture.attachmentJson!);
    const serialized = JSON.stringify(payload);
    const url = serialized.match(/https?:[^" ]+/)?.[0];
    expect(url).toBeTruthy();
    const response = await app.request(url!, {}, env);
    expect(response.status).toBe(200);
    expect(await sha256(await response.arrayBuffer())).toBe(await sha256(bytes));
  }
  const conversationId = sent[0]!.conversationId;
  expect(
    (await productPhotoReply(env, s.w, conversationId, 'show chicken image', 'english')).productIds,
  ).toEqual([]);
  await db.update(products).set({ status: 'archived' }).where(eq(products.id, s.product));
  expect(
    (await productPhotoReply(env, s.w, conversationId, 'picture den', 'english')).productIds,
  ).toEqual([]);
});
it('does not promise an image when the product has no saved photo', async () => {
  const s = await createStore();
  const reply = await productPhotoReply(env, s.w, 'unused', 'black hoodie photo', 'english');
  expect(reply.productIds).toEqual([]);
  expect(reply.text).toContain('hasn’t added a photo');
});

it('keeps a human request ahead of photo handling', async () => {
  const { understand } = await import('../../src/worker/ai/intent-classifier');
  expect((await understand(env, 'human agent please send a photo', '')).intent).toBe(
    'human_request',
  );
});
