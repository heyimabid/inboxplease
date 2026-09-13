import { it, expect } from 'vitest';
import { z } from 'zod';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { app } from '../../src/worker/app';
import { database } from '../../src/worker/db/client';
import {
  users,
  members,
  sessions,
  images,
  customers,
  pages,
  messages,
  temporaryImages,
} from '../../src/worker/db/schema';
import { hmac, base64, sha256 } from '../../src/worker/services/encryption';
import { createStore } from '../fixtures/store';
import { persistEvent } from '../../src/worker/routes/webhooks-meta';
import { ingestEvent } from '../../src/worker/repositories/conversations';
import {
  startDraft,
  updateDraft,
  addItem,
  reviewDraft,
  confirmDraft,
} from '../../src/worker/services/orders';

async function signedSeller(w: string, role: 'owner' | 'agent' = 'owner') {
  const db = database(env),
    user = crypto.randomUUID(),
    raw = crypto.randomUUID();
  await db.insert(users).values({ id: user, facebookUserId: user, name: 'Tenant test seller' });
  await db.insert(members).values({ workspaceId: w, userId: user, role, createdAt: Date.now() });
  await db.insert(sessions).values({
    id: await sha256(raw),
    userId: user,
    workspaceId: w,
    expiresAt: Date.now() + 60000,
    createdAt: Date.now(),
  });
  return `ip_session=${raw}.${base64(await hmac(env.SESSION_SIGNING_SECRET, raw))}`;
}
async function privateCustomer(store: Awaited<ReturnType<typeof createStore>>) {
  const id = crypto.randomUUID();
  await persistEvent(env, {
    eventId: id,
    pageId: store.page,
    senderPsid: id,
    timestamp: Date.now(),
    type: 'text',
    text: 'Private customer message',
  });
  return (await ingestEvent(env, id))!;
}
function request(cookie: string, path: string, method = 'GET', body?: unknown) {
  return app.request(
    path,
    {
      method,
      headers: { Cookie: cookie, Origin: env.APP_ORIGIN, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    env,
  );
}
it('isolates products, variants, messages, images, customers, Pages, orders and workspace selection over HTTP', async () => {
  const a = await createStore(),
    b = await createStore(),
    cookie = await signedSeller(a.w);
  const buyer = await privateCustomer(b),
    db = database(env),
    imageId = crypto.randomUUID();
  await db.insert(images).values({
    id: imageId,
    workspaceId: b.w,
    productId: b.product,
    r2Key: `private/${imageId}`,
    publicUrlOrDeliveryKey: imageId,
    createdAt: Date.now(),
    sha256: await sha256('private fixture'),
  });
  const ctx = {
    env,
    workspaceId: b.w,
    conversationId: buyer.conversationId,
    sourceText: 'Name Test Buyer phone 01712345678 address Mirpur Dhaka area Dhakar vitore',
    sourceMessageIds: [] as string[],
  };
  await startDraft(ctx);
  await updateDraft(ctx, {
    customerName: 'Test Buyer',
    phone: '01712345678',
    deliveryAddress: 'Mirpur Dhaka',
    deliveryArea: 'Dhakar vitore',
  });
  await addItem(ctx, b.variant, 1);
  const summary = await reviewDraft(ctx, 'english');
  await db.insert(messages).values({
    id: crypto.randomUUID(),
    workspaceId: b.w,
    conversationId: buyer.conversationId,
    direction: 'outbound',
    senderType: 'ai',
    messageType: 'text',
    text: summary.text,
    aiMetadataJson: JSON.stringify(summary.metadata),
    deliveryStatus: 'sent',
    createdAt: Date.now() - 100,
  });
  const confirmation = crypto.randomUUID();
  await db.insert(messages).values({
    id: confirmation,
    workspaceId: b.w,
    conversationId: buyer.conversationId,
    direction: 'inbound',
    senderType: 'customer',
    messageType: 'text',
    text: 'confirm',
    createdAt: Date.now(),
  });
  const order = await confirmDraft({
    ...ctx,
    sourceText: 'confirm',
    sourceMessageIds: [confirmation],
  });
  for (const path of [
    `/api/products/${b.product}`,
    `/api/conversations/${buyer.conversationId}`,
    `/api/images/${imageId}`,
    `/api/customers/${buyer.customerId}`,
    `/api/orders/${order.id}`,
  ]) {
    const r = await request(cookie, path);
    expect(r.status, path).toBe(404);
    expect(await r.text()).not.toContain('Private customer');
  }
  for (const [path, method, body] of [
    [`/api/products/${b.product}`, 'DELETE', undefined],
    [`/api/products/${b.product}/images/${imageId}`, 'DELETE', undefined],
    [`/api/conversations/${buyer.conversationId}/mode`, 'POST', { mode: 'human' }],
    [
      `/api/conversations/${buyer.conversationId}/reply`,
      'POST',
      { text: 'hijack', idempotencyKey: crypto.randomUUID() },
    ],
    [`/api/customers/${buyer.customerId}`, 'DELETE', undefined],
    [`/api/facebook/pages/${b.page}`, 'DELETE', {}],
    [`/api/facebook/pages/${b.page}/test`, 'POST', {}],
    [`/api/orders/${order.id}/status`, 'POST', { status: 'cancelled' }],
    [`/api/workspaces/${b.w}/select`, 'POST', {}],
  ] as const)
    expect((await request(cookie, path, method, body)).status, path).toBe(404);
  expect((await request(cookie, `/api/products/${a.product}`)).status).toBe(200);
  expect((await db.select().from(pages).where(eq(pages.id, b.page)).get())?.status).toBe('active');
  expect((await request(cookie, '/api/facebook/pages')).status).toBe(200);
  const publicPages = await (await request(cookie, '/api/facebook/pages')).text();
  expect(publicPages).not.toMatch(/token|encrypted/i);
  expect(publicPages).not.toContain(b.page);
});
it('rejects missing sessions, cross-site writes, tampered cookies and agent catalog mutation', async () => {
  const s = await createStore(),
    owner = await signedSeller(s.w),
    agent = await signedSeller(s.w, 'agent');
  expect((await request('', `/api/products/${s.product}`)).status).toBe(401);
  expect((await request(owner + 'tamper', `/api/products/${s.product}`)).status).toBe(401);
  const crossSite = await app.request(
    `/api/products/${s.product}`,
    { method: 'DELETE', headers: { Cookie: owner, Origin: 'https://attacker.example' } },
    env,
  );
  expect(crossSite.status).toBe(403);
  expect((await request(agent, `/api/products/${s.product}`, 'DELETE')).status).toBe(403);
});
it('disconnects a Page and removes its encrypted token', async () => {
  const s = await createStore(),
    cookie = await signedSeller(s.w);
  expect((await request(cookie, `/api/facebook/pages/${s.page}`, 'DELETE', {})).status).toBe(200);
  const p = await database(env).select().from(pages).where(eq(pages.id, s.page)).get();
  expect(p?.status).toBe('disconnected');
  expect(p?.encryptedPageAccessToken).toBeNull();
});
it('deletes customer data, private R2 objects, webhook payloads and pending DO state', async () => {
  const s = await createStore(),
    cookie = await signedSeller(s.w),
    buyer = await privateCustomer(s),
    db = database(env);
  const stub = env.CONVERSATIONS.getByName(`${s.page}:${buyer.senderPsid}`);
  await stub.receive(buyer.eventId);
  const image = crypto.randomUUID(),
    key = `temporary/${s.w}/${image}`;
  await env.PRODUCT_IMAGES.put(key, 'private image');
  await db.insert(temporaryImages).values({
    id: image,
    workspaceId: s.w,
    customerId: buyer.customerId,
    r2Key: key,
    expiresAt: Date.now() + 60000,
  });
  expect((await request(cookie, `/api/customers/${buyer.customerId}`, 'DELETE')).status).toBe(200);
  expect(await env.PRODUCT_IMAGES.get(key)).toBeNull();
  expect(
    await db.select().from(customers).where(eq(customers.id, buyer.customerId)).get(),
  ).toBeUndefined();
  expect(await db.select().from(messages).where(eq(messages.workspaceId, s.w))).toHaveLength(0);
});
it('allows only explicitly configured mock origins and never applies them in production', async () => {
  const origin = 'https://specific-codespace.app.github.dev';
  const response = await app.request(
    '/auth/mock',
    { method: 'POST', headers: { Origin: origin } },
    { ...env, MOCK_APP_ORIGINS: origin },
  );
  expect(response.status).toBe(200);
  const rejected = await app.request(
    '/auth/mock',
    { method: 'POST', headers: { Origin: origin } },
    { ...env, APP_MODE: 'production', MOCK_APP_ORIGINS: origin },
  );
  expect(rejected.status).toBe(403);
});

it('attributes a reconnected Page token to the current seller for revocation callbacks', async () => {
  const s = await createStore(),
    cookie = await signedSeller(s.w),
    db = database(env);
  await db
    .update(pages)
    .set({ facebookPageId: 'mock-page-2', connectedByUserId: null })
    .where(eq(pages.id, s.page));
  await request(cookie, '/facebook/connect', 'POST');
  const available = z
    .object({ data: z.array(z.object({ id: z.string(), pageId: z.string() })) })
    .parse(await (await request(cookie, '/api/facebook/pages/available')).json());
  const candidate = available.data.find((p) => p.pageId === 'mock-page-2')!;
  const connected = await request(cookie, `/api/facebook/pages/${candidate.id}/approve`, 'POST', {
    consent: true,
  });
  expect(connected.status).toBe(201);
  const p = await db.select().from(pages).where(eq(pages.id, s.page)).get();
  expect(p?.connectedByUserId).not.toBeNull();
  expect(p?.status).toBe('active');
});
