import { it, expect, vi, afterEach } from 'vitest';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { createStore } from '../fixtures/store';
import { database } from '../../src/worker/db/client';
import {
  webhookEvents,
  temporaryImages,
  messages,
  pages,
  catalogJobs,
} from '../../src/worker/db/schema';
import { persistEvent } from '../../src/worker/routes/webhooks-meta';
import { ingestEvent } from '../../src/worker/repositories/conversations';
import { maintenance } from '../../src/worker/services/maintenance';
import { deliver } from '../../src/worker/services/delivery';
import { enqueueCatalog } from '../../src/worker/services/product-indexer';
afterEach(() => vi.unstubAllGlobals());
it('repairs queue outbox gaps and expires private image bytes', async () => {
  const s = await createStore(),
    id = crypto.randomUUID(),
    db = database(env);
  await persistEvent(env, {
    eventId: id,
    pageId: s.page,
    senderPsid: 'recovery',
    timestamp: Date.now(),
    type: 'text',
    text: 'hello',
  });
  const event = (await ingestEvent(env, id))!;
  await db.update(webhookEvents).set({ queuedAt: null }).where(eq(webhookEvents.id, id));
  await enqueueCatalog(env, s.w, s.product);
  await db.update(catalogJobs).set({ queuedAt: null }).where(eq(catalogJobs.workspaceId, s.w));
  const key = `temporary/${s.w}/expired`,
    image = crypto.randomUUID();
  await env.PRODUCT_IMAGES.put(key, 'expired private bytes');
  await db.insert(temporaryImages).values({
    id: image,
    workspaceId: s.w,
    customerId: event.customerId,
    r2Key: key,
    expiresAt: Date.now() - 100,
  });
  await maintenance(env);
  expect(
    (await db.select().from(webhookEvents).where(eq(webhookEvents.id, id)).get())?.queuedAt,
  ).toBeGreaterThan(0);
  expect(
    (await db.select().from(catalogJobs).where(eq(catalogJobs.workspaceId, s.w)).get())?.queuedAt,
  ).toBeGreaterThan(0);
  expect(await env.PRODUCT_IMAGES.get(key)).toBeNull();
  expect(
    await db.select().from(temporaryImages).where(eq(temporaryImages.id, image)).get(),
  ).toBeUndefined();
});
it('retries explicit transient rejections once and suppresses subsequent duplicate sends', async () => {
  const s = await createStore(),
    id = crypto.randomUUID();
  await persistEvent(env, {
    eventId: id,
    pageId: s.page,
    senderPsid: 'retry',
    timestamp: Date.now(),
    type: 'text',
    text: 'hello',
  });
  const event = (await ingestEvent(env, id))!,
    deliveryId = crypto.randomUUID();
  const mockedFetch = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ error: { code: 4, is_transient: true } }, { status: 429 }),
    )
    .mockResolvedValueOnce(Response.json({ message_id: crypto.randomUUID() }));
  vi.stubGlobal('fetch', mockedFetch);
  const production = { ...env, APP_MODE: 'production', META_GRAPH_API_VERSION: 'v99.0' };
  await expect(
    deliver(production, s.w, event.conversationId, deliveryId, { text: 'Verified response' }, 'ai'),
  ).rejects.toThrow('Facebook');
  expect(
    (await database(env).select().from(messages).where(eq(messages.id, deliveryId)).get())
      ?.deliveryStatus,
  ).toBe('ready');
  expect(
    await deliver(
      production,
      s.w,
      event.conversationId,
      deliveryId,
      { text: 'Verified response' },
      'ai',
    ),
  ).toBe('sent');
  expect(
    await deliver(
      production,
      s.w,
      event.conversationId,
      deliveryId,
      { text: 'Verified response' },
      'ai',
    ),
  ).toBe('sent');
  expect(mockedFetch).toHaveBeenCalledTimes(2);
});
it.each([10, 190, 200])(
  'disables Page sending on revoked credentials or permissions (Meta %s)',
  async (code) => {
    const s = await createStore(),
      id = crypto.randomUUID();
    await persistEvent(env, {
      eventId: id,
      pageId: s.page,
      senderPsid: 'revoked',
      timestamp: Date.now(),
      type: 'text',
      text: 'hello',
    });
    const event = (await ingestEvent(env, id))!,
      deliveryId = crypto.randomUUID();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ error: { code } }, { status: 400 })),
    );
    // This explicit HTTP adapter test uses a synthetic version and intercepted fetch.
    const production = { ...env, APP_MODE: 'production', META_GRAPH_API_VERSION: 'v99.0' };
    expect(
      await deliver(
        production,
        s.w,
        event.conversationId,
        deliveryId,
        { text: 'Verified response' },
        'ai',
      ),
    ).toBe('failed');
    expect(
      (await database(env).select().from(pages).where(eq(pages.id, s.page)).get())?.status,
    ).toBe('error');
    expect(
      (await database(env).select().from(pages).where(eq(pages.id, s.page)).get())?.aiEnabled,
    ).toBe(false);
  },
);

it('never sends a stored policy asking for payment credentials', async () => {
  const s = await createStore(),
    id = crypto.randomUUID();
  await persistEvent(env, {
    eventId: id,
    pageId: s.page,
    senderPsid: 'unsafe-policy',
    timestamp: Date.now(),
    type: 'text',
    text: 'Store policy?',
  });
  const event = (await ingestEvent(env, id))!,
    out = crypto.randomUUID();
  expect(
    await deliver(
      env,
      s.w,
      event.conversationId,
      out,
      { text: 'Please send your OTP code to complete the order.' },
      'ai',
    ),
  ).toBe('suppressed');
  expect(
    await database(env).select().from(messages).where(eq(messages.id, out)).get(),
  ).toBeUndefined();
});
