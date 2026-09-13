import { it, expect, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { createStore } from '../fixtures/store';
import { persistEvent } from '../../src/worker/routes/webhooks-meta';
import { ingestEvent, conversationContext } from '../../src/worker/repositories/conversations';
import { refreshCustomerProfile } from '../../src/worker/services/customer-profile';
it('loads a Page-scoped customer profile once and keeps checkout identity separate', async () => {
  const s = await createStore(),
    id = crypto.randomUUID();
  await persistEvent(env, {
    eventId: id,
    pageId: s.page,
    senderPsid: 'profile-customer',
    timestamp: Date.now(),
    type: 'text',
    text: 'hello',
  });
  const event = (await ingestEvent(env, id))!;
  const context = await conversationContext(env, s.w, event.conversationId);
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json({
      first_name: 'Abid',
      last_name: 'Hasan',
      profile_pic: 'https://platform-lookaside.fbsbx.com/photo.jpg',
    }),
  );
  try {
    await refreshCustomerProfile(
      {
        ...env,
        APP_MODE: 'production',
        META_GRAPH_API_VERSION: 'v25.0',
        META_APP_SECRET: 'fixture-secret',
      },
      context,
    );
    await refreshCustomerProfile(
      {
        ...env,
        APP_MODE: 'production',
        META_GRAPH_API_VERSION: 'v25.0',
        META_APP_SECRET: 'fixture-secret',
      },
      context,
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetcher.mock.calls[0]![0]));
    expect(url.pathname).toContain('/profile-customer');
    expect(url.searchParams.get('fields')).toBe('first_name,last_name,profile_pic');
    const updated = await conversationContext(env, s.w, event.conversationId);
    expect(updated.customer.facebookName).toBe('Abid Hasan');
    expect(updated.customer.profilePictureUrl).toContain('fbsbx.com');
    expect(updated.customer.name).toBeNull();
  } finally {
    fetcher.mockRestore();
  }
});
it('tolerates Meta profile permission failures and caches the attempt', async () => {
  const s = await createStore(),
    id = crypto.randomUUID();
  await persistEvent(env, {
    eventId: id,
    pageId: s.page,
    senderPsid: id,
    timestamp: Date.now(),
    type: 'text',
    text: 'hello',
  });
  const event = (await ingestEvent(env, id))!;
  const context = await conversationContext(env, s.w, event.conversationId);
  const fetcher = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(Response.json({ error: { code: 200 } }, { status: 403 }));
  try {
    await refreshCustomerProfile(
      {
        ...env,
        APP_MODE: 'production',
        META_GRAPH_API_VERSION: 'v25.0',
        META_APP_SECRET: 'fixture-secret',
      },
      context,
    );
    await refreshCustomerProfile(
      {
        ...env,
        APP_MODE: 'production',
        META_GRAPH_API_VERSION: 'v25.0',
        META_APP_SECRET: 'fixture-secret',
      },
      context,
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(
      (await conversationContext(env, s.w, event.conversationId)).customer.facebookName,
    ).toBeNull();
  } finally {
    fetcher.mockRestore();
  }
});
