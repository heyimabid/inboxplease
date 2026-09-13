import { it, expect } from 'vitest';
import { env } from 'cloudflare:workers';
import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { and, eq } from 'drizzle-orm';
import { createStore } from '../fixtures/store';
import { database } from '../../src/worker/db/client';
import { messages, conversations, webhookEvents } from '../../src/worker/db/schema';
import { persistEvent } from '../../src/worker/routes/webhooks-meta';
import { handoff } from '../../src/worker/services/handoff';
import { sha256 } from '../../src/worker/services/encryption';
it('debounces ordered messages, persists the batch, and suppresses duplicate delivery', async () => {
  const { w, page } = await createStore();
  const stub = env.CONVERSATIONS.getByName(`${page}:customer`);
  const first = crypto.randomUUID(),
    second = crypto.randomUUID();
  for (const [id, text, timestamp] of [
    [first, 'black hoodie', Date.now() - 2],
    [second, 'XL e ache?', Date.now()],
  ] as const) {
    await persistEvent(env, {
      eventId: id,
      pageId: page,
      senderPsid: 'customer',
      timestamp,
      type: 'text',
      text,
      messageId: id,
    });
    await stub.receive(id);
    await stub.receive(id);
  }
  await runInDurableObject(stub, async (_instance, state) => {
    expect((await state.storage.get<unknown[]>('pending'))?.length).toBe(2);
    expect(await state.storage.getAlarm()).not.toBeNull();
  });
  await runDurableObjectAlarm(stub);
  const out = await database(env)
    .select()
    .from(messages)
    .where(and(eq(messages.workspaceId, w), eq(messages.direction, 'outbound')));
  expect(out).toHaveLength(1);
  expect(out[0]?.text).toContain('Black hoodie');
  expect(out[0]?.text).toContain('1,490');
  await stub.receive(first);
  await runDurableObjectAlarm(stub);
  expect(
    await database(env)
      .select()
      .from(messages)
      .where(and(eq(messages.workspaceId, w), eq(messages.direction, 'outbound'))),
  ).toHaveLength(1);
  expect(
    (
      await database(env)
        .select()
        .from(webhookEvents)
        .where(and(eq(webhookEvents.workspaceId, w), eq(webhookEvents.id, first)))
        .get()
    )?.status,
  ).toBe('processed');
});
it('stores inbound messages during human takeover without replying', async () => {
  const { w, page } = await createStore(),
    id = crypto.randomUUID();
  const stub = env.CONVERSATIONS.getByName(`${page}:customer`);
  await persistEvent(env, {
    eventId: id,
    pageId: page,
    senderPsid: 'customer',
    timestamp: Date.now(),
    type: 'text',
    text: 'hello',
  });
  await stub.receive(id);
  const conversation = await database(env)
    .select()
    .from(conversations)
    .where(eq(conversations.workspaceId, w))
    .get();
  expect(conversation).toBeDefined();
  await handoff(env, w, conversation!.id, 'seller_takeover');
  await runDurableObjectAlarm(stub);
  const all = await database(env).select().from(messages).where(eq(messages.workspaceId, w));
  expect(all).toHaveLength(1);
  expect(all[0]?.direction).toBe('inbound');
});
it('holds an ambiguous send for reconciliation instead of sending again', async () => {
  const { w, page } = await createStore(),
    id = crypto.randomUUID();
  const stub = env.CONVERSATIONS.getByName(`${page}:customer`);
  await persistEvent(env, {
    eventId: id,
    pageId: page,
    senderPsid: 'customer',
    timestamp: Date.now(),
    type: 'text',
    text: 'hello',
  });
  await stub.receive(id);
  const conversation = (await database(env)
    .select()
    .from(conversations)
    .where(eq(conversations.workspaceId, w))
    .get())!;
  await database(env)
    .insert(messages)
    .values({
      id: await sha256(`reply:${id}`),
      workspaceId: w,
      conversationId: conversation.id,
      direction: 'outbound',
      senderType: 'ai',
      messageType: 'text',
      text: 'A prior send',
      deliveryStatus: 'sending',
      createdAt: Date.now(),
    });
  await runDurableObjectAlarm(stub);
  expect(
    (
      await database(env)
        .select()
        .from(conversations)
        .where(eq(conversations.id, conversation.id))
        .get()
    )?.mode,
  ).toBe('human');
  const out = await database(env)
    .select()
    .from(messages)
    .where(and(eq(messages.workspaceId, w), eq(messages.direction, 'outbound')));
  expect(out).toHaveLength(1);
  expect(out[0]?.deliveryStatus).toBe('unknown');
});

it('preserves concurrent arrivals and keeps blocked conversations blocked', async () => {
  const { w, page } = await createStore(),
    stub = env.CONVERSATIONS.getByName(`${page}:concurrent`);
  const ids = Array.from({ length: 4 }, () => crypto.randomUUID());
  await Promise.all(
    ids.map(async (id, i) => {
      await persistEvent(env, {
        eventId: id,
        pageId: page,
        senderPsid: 'concurrent',
        timestamp: Date.now() + i,
        type: 'text',
        text: `black hoodie ${i}`,
      });
      await stub.receive(id);
    }),
  );
  await runInDurableObject(stub, async (_instance, state) =>
    expect(await state.storage.get<unknown[]>('pending')).toHaveLength(4),
  );
  await database(env)
    .update(conversations)
    .set({ status: 'blocked' })
    .where(eq(conversations.workspaceId, w));
  const id = crypto.randomUUID();
  await persistEvent(env, {
    eventId: id,
    pageId: page,
    senderPsid: 'concurrent',
    timestamp: Date.now(),
    type: 'text',
    text: 'hello',
  });
  await stub.receive(id);
  await runDurableObjectAlarm(stub);
  expect(
    (await database(env).select().from(conversations).where(eq(conversations.workspaceId, w)).get())
      ?.status,
  ).toBe('blocked');
  expect(
    await database(env)
      .select()
      .from(messages)
      .where(and(eq(messages.workspaceId, w), eq(messages.direction, 'outbound'))),
  ).toHaveLength(0);
});
