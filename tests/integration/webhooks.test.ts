import { it, expect } from 'vitest';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { app } from '../../src/worker/app';
import { database } from '../../src/worker/db/client';
import { pages, workspaces, webhookEvents } from '../../src/worker/db/schema';
import { hmac } from '../../src/worker/services/encryption';
it('verifies subscription tokens, signatures and duplicate events', async () => {
  const verify = await app.request(
    `/webhooks/meta?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(env.META_WEBHOOK_VERIFY_TOKEN)}&hub.challenge=123`,
    {},
    env,
  );
  expect(verify.status).toBe(200);
  expect(await verify.text()).toBe('123');
  expect(
    (await app.request('/webhooks/meta?hub.mode=subscribe&hub.verify_token=bad', {}, env)).status,
  ).toBe(403);
  expect((await app.request('/webhooks/meta', { method: 'POST', body: '{}' }, env)).status).toBe(
    403,
  );
  const w = crypto.randomUUID(),
    p = crypto.randomUUID();
  await database(env).insert(workspaces).values({ id: w, name: 'Webhook store', slug: w });
  await database(env).insert(pages).values({
    id: p,
    workspaceId: w,
    facebookPageId: p,
    pageName: 'Page',
    status: 'active',
    tokenKeyVersion: '1',
  });
  const payload = JSON.stringify({
    object: 'page',
    entry: [
      {
        id: p,
        messaging: [
          {
            sender: { id: 'customer' },
            recipient: { id: p },
            timestamp: Date.now(),
            message: { mid: 'm-' + p, text: 'Hi' },
          },
        ],
      },
    ],
  });
  const sig =
    'sha256=' +
    Array.from(await hmac(env.META_APP_SECRET, payload), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('');
  for (let i = 0; i < 2; i++)
    expect(
      (
        await app.request(
          '/webhooks/meta',
          { method: 'POST', body: payload, headers: { 'X-Hub-Signature-256': sig } },
          env,
        )
      ).status,
    ).toBe(200);
  expect(
    await database(env).select().from(webhookEvents).where(eq(webhookEvents.workspaceId, w)),
  ).toHaveLength(1);
});
