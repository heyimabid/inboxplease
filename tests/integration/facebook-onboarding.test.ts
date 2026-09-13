import { it, expect, afterEach, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { encode, getToken } from '@auth/core/jwt';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { app } from '../../src/worker/app';
import { authConfig, ensureFacebookSellerIdentity } from '../../src/worker/authjs';
import { database } from '../../src/worker/db/client';
import {
  users,
  sessions,
  members,
  workspaces,
  pages,
  onboardingSessions,
  pageCandidates,
} from '../../src/worker/db/schema';
import { sha256, hmac, base64 } from '../../src/worker/services/encryption';
import { createStore } from '../fixtures/store';
import { deliver } from '../../src/worker/services/delivery';
import { persistEvent } from '../../src/worker/routes/webhooks-meta';
import { ingestEvent } from '../../src/worker/repositories/conversations';
const production = {
  ...env,
  APP_MODE: 'production',
  APP_ORIGIN: 'https://shop.test',
  AUTH_FACEBOOK_ID: 'login-app',
  AUTH_FACEBOOK_SECRET: 'login-secret-'.repeat(4),
  AUTH_FACEBOOK_GRAPH_API_VERSION: 'v99.0',
  META_APP_ID: 'messenger-app',
  META_GRAPH_API_VERSION: 'v99.0',
  META_LOGIN_CONFIG_ID: '',
};
const db = database(env);
afterEach(() => vi.unstubAllGlobals());
async function seller(role: 'owner' | 'agent' = 'owner') {
  const s = await createStore(),
    user = crypto.randomUUID(),
    sid = crypto.randomUUID();
  await db.insert(users).values({ id: user, facebookUserId: `login-app:${user}`, name: 'Seller' });
  await db.insert(members).values({ workspaceId: s.w, userId: user, role, createdAt: Date.now() });
  await db.insert(sessions).values({
    id: sid,
    userId: user,
    workspaceId: s.w,
    createdAt: Date.now(),
    expiresAt: Date.now() + 600000,
  });
  const jwt = await encode({
    secret: env.SESSION_SIGNING_SECRET,
    salt: '__Host-ip_session',
    token: { sub: user, sid },
    maxAge: 600,
  });
  const cookie = `__Host-ip_session=${jwt}`;
  const request = (path: string, method = 'GET', body?: unknown, override = production) =>
    app.request(
      `https://shop.test${path}`,
      {
        method,
        headers: {
          Cookie: cookie,
          Origin: 'https://shop.test',
          'Content-Type': 'application/json',
          'CF-Connecting-IP': user,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      override,
    );
  return { ...s, user, sid, cookie, request };
}
function mockGraph(
  options: {
    permissions?: string[];
    tasks?: string[];
    subscription?: boolean;
    disconnectFailure?: boolean;
  } = {},
) {
  const calls: { path: string; method: string; token: string | null }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      // Construct a real Workers Request so mocks also validate runtime options.
      const url = new URL(new Request(input, init).url);
      calls.push({
        path: url.pathname,
        method: init?.method ?? 'GET',
        token: new Headers(init?.headers).get('Authorization'),
      });
      if (url.pathname.endsWith('/oauth/access_token'))
        return Response.json({ access_token: 'messenger-user-token', token_type: 'bearer' });
      if (url.pathname.endsWith('/me/permissions'))
        return Response.json({
          data: (
            options.permissions ?? ['pages_show_list', 'pages_manage_metadata', 'pages_messaging']
          ).map((permission) => ({ permission, status: 'granted' })),
        });
      if (url.pathname.endsWith('/me/accounts'))
        return Response.json({
          data: [
            {
              id: 'eligible-page',
              name: 'Eligible Page',
              access_token: 'candidate-page-token',
              tasks: options.tasks ?? ['MESSAGING'],
            },
          ],
        });
      if (url.pathname.endsWith('/me'))
        return Response.json({ id: 'different-app-scoped-id', name: 'Same human' });
      if (url.pathname.endsWith('/subscribed_apps')) {
        if (init?.method === 'DELETE' && options.disconnectFailure) throw new Error('Offline');
        if (init?.method === 'POST' || init?.method === 'DELETE')
          return Response.json({ success: true });
        return Response.json({
          data:
            options.subscription === false
              ? []
              : [{ id: 'messenger-app', subscribed_fields: ['messages', 'messaging_postbacks'] }],
        });
      }
      throw new Error('Unexpected external request');
    }),
  );
  return calls;
}
async function start(s: Awaited<ReturnType<typeof seller>>) {
  const response = await s.request('/facebook/connect', 'POST');
  expect(response.status).toBe(200);
  const result = z.object({ data: z.object({ url: z.string() }) }).parse(await response.json());
  return new URL(result.data.url);
}
async function callback(s: Awaited<ReturnType<typeof seller>>, url: URL) {
  return s.request(`/facebook/callback?state=${url.searchParams.get('state')}&code=fixture-code`);
}
async function candidateId(s: Awaited<ReturnType<typeof seller>>) {
  const response = await s.request('/api/facebook/pages/available');
  const body = z
    .object({ data: z.array(z.object({ id: z.string() })) })
    .parse(await response.json());
  return body.data[0]?.id;
}
it('requests Page scopes only from App 2 and binds state to the active application session', async () => {
  const s = await seller(),
    calls = mockGraph(),
    url = await start(s);
  expect(url.searchParams.get('client_id')).toBe('messenger-app');
  expect(url.searchParams.get('scope')).toBe(
    'pages_show_list,pages_manage_metadata,pages_messaging',
  );
  expect(url.searchParams.get('redirect_uri')).toBe('https://shop.test/facebook/callback');
  const stored = await db
    .select()
    .from(onboardingSessions)
    .where(eq(onboardingSessions.sessionId, s.sid))
    .get();
  expect(stored?.id).toBe(await sha256(url.searchParams.get('state')!));
  expect((await callback(s, url)).status).toBe(302);
  expect((await db.select().from(users).where(eq(users.id, s.user)).get())?.facebookUserId).toBe(
    `login-app:${s.user}`,
  );
  const candidate = (
    await db.select().from(pageCandidates).where(eq(pageCandidates.onboardingId, stored!.id))
  )[0]!;
  expect(candidate.encryptedToken).not.toContain('candidate-page-token');
  expect((await s.request('/api/facebook/pages/available')).status).toBe(200);
  const json = JSON.stringify(await (await s.request('/api/facebook/pages/available')).json());
  expect(json).not.toContain('token');
  expect(
    await db.select().from(pages).where(eq(pages.facebookPageId, 'eligible-page')),
  ).toHaveLength(0);
  expect(calls.some((c) => c.path.endsWith('subscribed_apps'))).toBe(false);
  const before = calls.length;
  expect((await callback(s, url)).status).toBe(403);
  expect(calls).toHaveLength(before);
});
it('rejects switched workspaces, other users, expired state and a replacement session before exchanging a code', async () => {
  const s = await seller(),
    other = await seller(),
    calls = mockGraph(),
    url = await start(s);
  expect((await callback(other, url)).status).toBe(403);
  await db.update(sessions).set({ workspaceId: other.w }).where(eq(sessions.id, s.sid));
  expect((await callback(s, url)).status).toBe(403);
  await db.update(sessions).set({ workspaceId: s.w }).where(eq(sessions.id, s.sid));
  const newSid = crypto.randomUUID();
  await db.insert(sessions).values({
    id: newSid,
    userId: s.user,
    workspaceId: s.w,
    createdAt: Date.now(),
    expiresAt: Date.now() + 60000,
  });
  const jwt = await encode({
    secret: env.SESSION_SIGNING_SECRET,
    salt: '__Host-ip_session',
    token: { sub: s.user, sid: newSid },
  });
  const replaced = await app.request(
    `https://shop.test/facebook/callback?state=${url.searchParams.get('state')}&code=fixture`,
    { headers: { Cookie: `__Host-ip_session=${jwt}` } },
    production,
  );
  expect(replaced.status).toBe(403);
  await db
    .update(onboardingSessions)
    .set({ expiresAt: Date.now() - 1 })
    .where(eq(onboardingSessions.sessionId, s.sid));
  expect((await callback(s, url)).status).toBe(403);
  expect(calls).toHaveLength(0);
});
it('rejects signed-out and agent-role Page connection attempts', async () => {
  expect(
    (
      await app.request(
        'https://shop.test/facebook/connect',
        { method: 'POST', headers: { Origin: 'https://shop.test' } },
        production,
      )
    ).status,
  ).toBe(401);
  const s = await seller('agent');
  expect((await s.request('/facebook/connect', 'POST')).status).toBe(403);
});
it('requires all granted permissions and an explicit messaging task', async () => {
  const s = await seller();
  mockGraph({ permissions: ['pages_show_list', 'pages_manage_metadata'] });
  expect((await callback(s, await start(s))).status).toBe(403);
  expect(await candidateId(s)).toBeUndefined();
  mockGraph({ tasks: ['ANALYZE'] });
  expect((await callback(s, await start(s))).status).toBe(302);
  expect(await candidateId(s)).toBeUndefined();
});
it('requires explicit approval, defaults AI off, and immediately disconnects even when Meta fails', async () => {
  const s = await seller();
  mockGraph();
  expect((await callback(s, await start(s))).status).toBe(302);
  const id = (await candidateId(s))!;
  expect(
    (await s.request(`/api/facebook/pages/${id}/approve`, 'POST', { consent: false })).status,
  ).toBe(422);
  const approved = await s.request(`/api/facebook/pages/${id}/approve`, 'POST', { consent: true });
  expect(approved.status).toBe(201);
  const p = (await db
    .select()
    .from(pages)
    .where(and(eq(pages.workspaceId, s.w), eq(pages.facebookPageId, 'eligible-page')))
    .get())!;
  expect(p.aiEnabled).toBe(false);
  expect(p.messengerUserId).toBe('different-app-scoped-id');
  expect(p.webhookSubscribedAt).toBeGreaterThan(0);
  expect(
    (await s.request(`/api/facebook/pages/${id}/approve`, 'POST', { consent: true })).status,
  ).toBe(404);
  expect(
    (
      await s.request(
        `/api/facebook/pages/${p.id}/ai`,
        'PATCH',
        { enabled: true },
        { ...production, AI_ENABLED: 'false' },
      )
    ).status,
  ).toBe(409);
  expect(
    (await s.request(`/api/facebook/pages/${p.id}/ai`, 'PATCH', { enabled: true })).status,
  ).toBe(200);
  mockGraph({ disconnectFailure: true });
  const disconnected = await s.request(`/api/facebook/pages/${p.id}`, 'DELETE');
  expect(disconnected.status).toBe(200);
  expect(await disconnected.json()).toMatchObject({
    data: { disconnected: true, unsubscribed: false },
  });
  const row = await db.select().from(pages).where(eq(pages.id, p.id)).get();
  expect(row?.encryptedPageAccessToken).toBeNull();
  expect(row?.aiEnabled).toBe(false);
  expect(row?.status).toBe('disconnected');
});
it('cannot activate a Page whose webhook subscription was not confirmed', async () => {
  const s = await seller();
  mockGraph({ subscription: false });
  await callback(s, await start(s));
  const id = (await candidateId(s))!;
  // Use a distinct Page so the global Page uniqueness invariant does not mask subscription failure.
  await db
    .update(pageCandidates)
    .set({ facebookPageId: 'unsubscribed-page' })
    .where(eq(pageCandidates.id, id));
  expect(
    (await s.request(`/api/facebook/pages/${id}/approve`, 'POST', { consent: true })).status,
  ).toBe(502);
  const p = (await db
    .select()
    .from(pages)
    .where(eq(pages.facebookPageId, 'unsubscribed-page'))
    .get())!;
  expect(p.status).toBe('error');
  expect(p.aiEnabled).toBe(false);
  expect(p.encryptedPageAccessToken).toBeNull();
});
it('applies platform and per-Page gates to persisted outgoing work', async () => {
  const s = await createStore(),
    eventId = crypto.randomUUID();
  await persistEvent(env, {
    eventId,
    pageId: s.page,
    senderPsid: crypto.randomUUID(),
    timestamp: Date.now(),
    type: 'text',
    text: 'hello',
  });
  const event = (await ingestEvent(env, eventId))!;
  const send = (overrides: Partial<typeof env> = {}, sender: 'ai' | 'human' = 'ai') =>
    deliver(
      { ...env, ...overrides },
      s.w,
      event.conversationId,
      crypto.randomUUID(),
      { text: 'Hello' },
      sender,
    );
  expect(await send({ AI_ENABLED: 'false' })).toBe('suppressed');
  expect(await send({ MESSAGING_ENABLED: 'false' }, 'human')).toBe('suppressed');
  await db.update(pages).set({ aiEnabled: false }).where(eq(pages.id, s.page));
  expect(await send()).toBe('suppressed');
  expect(await send({}, 'human')).toBe('sent');
});
it('namespaces seller identity to App 1 and never creates identity from a Messenger user ID', async () => {
  const p = { id: crypto.randomUUID(), name: 'Identity Seller' };
  const first = await ensureFacebookSellerIdentity(production, p),
    second = await ensureFacebookSellerIdentity(production, p);
  expect(second.userId).toBe(first.userId);
  expect(second.workspaceId).toBe(first.workspaceId);
  expect(
    (await db.select().from(workspaces).where(eq(workspaces.id, first.workspaceId!))).length,
  ).toBe(1);
  const provider = authConfig(production).providers[0];
  expect(typeof provider).toBe('object');
});
it.each([undefined, 'https://api.shop.test'])(
  'handles Auth.js CSRF/state/callback and revocable JWT with API origin %s',
  async (API_ORIGIN) => {
    const jar = new Map<string, string>();
    const authEnv = {
      ...production,
      API_ORIGIN,
      META_APP_ID: '',
      META_APP_SECRET: '',
      META_GRAPH_API_VERSION: '',
    };
    const call = async (path: string, method = 'GET', body?: URLSearchParams) => {
      const r = await app.request(
        `${API_ORIGIN || production.APP_ORIGIN}${path}`,
        {
          method,
          headers: {
            Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
            Origin: 'https://shop.test',
            'Content-Type': 'application/x-www-form-urlencoded',
            ...(method === 'POST' ? { 'X-Auth-Return-Redirect': '1' } : {}),
            'CF-Connecting-IP': 'identity-test',
          },
          ...(body ? { body: body.toString() } : {}),
        },
        authEnv,
      );
      for (const cookie of r.headers.getSetCookie()) {
        const pair = cookie.split(';')[0]!,
          i = pair.indexOf('=');
        jar.set(pair.slice(0, i), pair.slice(i + 1));
      }
      return r;
    };
    const csrf = await call('/authjs/csrf');
    expect(csrf.status).toBe(200);
    const value = z.object({ csrfToken: z.string() }).parse(await csrf.json());
    const bad = await call(
      '/authjs/signin/facebook',
      'POST',
      new URLSearchParams({ csrfToken: 'wrong' }),
    );
    expect(JSON.stringify(await bad.json())).not.toContain('www.facebook.com');
    const start = await call(
      '/authjs/signin/facebook',
      'POST',
      new URLSearchParams({ ...value, callbackUrl: 'https://shop.test/' }),
    );
    const url = new URL(z.object({ url: z.string() }).parse(await start.json()).url);
    expect(url.searchParams.get('scope')).toBe('public_profile');
    expect(url.searchParams.get('client_id')).toBe('login-app');
    expect(url.searchParams.get('redirect_uri')).toBe(
      `${API_ORIGIN || production.APP_ORIGIN}/authjs/callback/facebook`,
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        // Construct a real Workers Request so mocks also validate runtime options.
        const url = new URL(new Request(input, init).url);
        if (url.pathname.endsWith('/oauth/access_token'))
          return Response.json({ access_token: 'discard-this-login-token', token_type: 'bearer' });
        if (url.pathname.endsWith('/me'))
          return Response.json({
            id: 'app-one-human',
            name: 'Login Seller',
            picture: { data: { url: 'https://example.com/photo.png' } },
          });
        throw new Error('Identity flow attempted a Page API');
      }),
    );
    const done = await call(
      `/authjs/callback/facebook?state=${url.searchParams.get('state')}&code=auth-code`,
    );
    expect(done.status).toBe(302);
    expect(done.headers.get('Location')).toBe('https://shop.test/');
    expect(csrf.headers.get('Access-Control-Allow-Origin')).toBe(production.APP_ORIGIN);
    expect(csrf.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const token = await getToken({
      req: { headers: { cookie } },
      secret: env.SESSION_SIGNING_SECRET,
      salt: '__Host-ip_session',
      cookieName: '__Host-ip_session',
      secureCookie: true,
    });
    expect(token?.sub).toBeTruthy();
    expect(token?.sid).toBeTruthy();
    expect(JSON.stringify(token)).not.toContain('discard-this-login-token');
    const active = await app.request(
      'https://shop.test/auth/session',
      { headers: { Cookie: cookie } },
      authEnv,
    );
    expect(await active.json()).toMatchObject({ data: { user: { name: 'Login Seller' } } });
    expect(JSON.stringify(await db.select().from(sessions))).not.toContain(
      'discard-this-login-token',
    );
    expect(
      (
        await app.request(
          'https://shop.test/auth/logout',
          { method: 'POST', headers: { Cookie: cookie, Origin: 'https://shop.test' } },
          authEnv,
        )
      ).status,
    ).toBe(200);
    expect(
      await (
        await app.request(
          'https://shop.test/auth/session',
          { headers: { Cookie: cookie } },
          authEnv,
        )
      ).json(),
    ).toMatchObject({ data: null });
  },
);
it('validates each privacy callback with its own app secret and keeps App 1 sessions during Messenger deauthorization', async () => {
  const s = await seller();
  await db
    .update(pages)
    .set({ messengerUserId: 'scoped-messenger-id', connectedByUserId: s.user })
    .where(eq(pages.id, s.page));
  const payload = btoa(JSON.stringify({ algorithm: 'HMAC-SHA256', user_id: 'scoped-messenger-id' }))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
  const signed = async (secret: string) =>
    `${base64(await hmac(secret, payload))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replaceAll('=', '')}.${payload}`;
  const call = async (secret: string) =>
    app.request(
      'https://shop.test/auth/privacy/messenger/deauthorize',
      { method: 'POST', body: new URLSearchParams({ signed_request: await signed(secret) }) },
      production,
    );
  expect((await call(production.AUTH_FACEBOOK_SECRET)).status).toBe(403);
  expect((await call(production.META_APP_SECRET)).status).toBe(200);
  expect(
    (await db.select().from(pages).where(eq(pages.id, s.page)).get())?.encryptedPageAccessToken,
  ).toBeNull();
  expect(await db.select().from(sessions).where(eq(sessions.id, s.sid)).get()).toBeDefined();
});

it('rejects another workspace approving a candidate and expires pending encrypted candidates', async () => {
  const s = await seller(),
    other = await seller();
  mockGraph();
  await callback(s, await start(s));
  const id = (await candidateId(s))!;
  expect(
    (await other.request(`/api/facebook/pages/${id}/approve`, 'POST', { consent: true })).status,
  ).toBe(403);
  await db
    .update(onboardingSessions)
    .set({ expiresAt: Date.now() - 1 })
    .where(eq(onboardingSessions.sessionId, s.sid));
  expect(
    (await s.request(`/api/facebook/pages/${id}/approve`, 'POST', { consent: true })).status,
  ).toBe(403);
  expect(await candidateId(s)).toBeUndefined();
  await db.delete(sessions).where(eq(sessions.id, s.sid));
  expect(
    await db.select().from(pageCandidates).where(eq(pageCandidates.id, id)).get(),
  ).toBeUndefined();
});

it('does not resurrect a Page disconnected while its subscription verification is in flight', async () => {
  const s = await seller();
  mockGraph();
  await callback(s, await start(s));
  const id = (await candidateId(s))!;
  await db
    .update(pageCandidates)
    .set({ facebookPageId: 'racing-page' })
    .where(eq(pageCandidates.id, id));
  const graph = globalThis.fetch;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      // Construct a real Workers Request so mocks also validate runtime options.
      const url = new URL(new Request(input, init).url);
      if (
        url.pathname.endsWith('/racing-page/subscribed_apps') &&
        (!init?.method || init.method === 'GET')
      ) {
        const p = (await db
          .select()
          .from(pages)
          .where(eq(pages.facebookPageId, 'racing-page'))
          .get())!;
        expect((await s.request(`/api/facebook/pages/${p.id}`, 'DELETE')).status).toBe(200);
      }
      return graph(input, init);
    }),
  );
  expect(
    (await s.request(`/api/facebook/pages/${id}/approve`, 'POST', { consent: true })).status,
  ).toBe(409);
  const p = (await db.select().from(pages).where(eq(pages.facebookPageId, 'racing-page')).get())!;
  expect(p.status).toBe('disconnected');
  expect(p.aiEnabled).toBe(false);
  expect(p.encryptedPageAccessToken).toBeNull();
});

it('allows credentialed frontend preflights but rejects other origins for mutations', async () => {
  const e = { ...production, API_ORIGIN: 'https://api.shop.test' };
  const options = await app.request(
    'https://api.shop.test/authjs/signin/facebook',
    {
      method: 'OPTIONS',
      headers: {
        Origin: production.APP_ORIGIN,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'X-Auth-Return-Redirect',
      },
    },
    e,
  );
  expect(options.status).toBe(204);
  expect(options.headers.get('Access-Control-Allow-Origin')).toBe(production.APP_ORIGIN);
  const bad = await app.request(
    'https://api.shop.test/auth/logout',
    {
      method: 'POST',
      headers: { Origin: 'https://untrusted.test' },
    },
    e,
  );
  expect(bad.status).toBe(403);
  expect(bad.headers.get('Access-Control-Allow-Origin')).toBeNull();
});
