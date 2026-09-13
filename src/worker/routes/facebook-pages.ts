import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq, gt, isNotNull } from 'drizzle-orm';
import { database } from '../db/client';
import { pages, pageCandidates, onboardingSessions } from '../db/schema';
import {
  authenticated,
  workspace,
  csrf,
  requireAdmin,
  type AppContext,
} from '../services/sessions';
import { decrypt, encrypt } from '../services/encryption';
import { metaClient } from '../meta/client';
import { activeOnboarding } from '../meta/oauth';
import { pageReady, hasPagePermissions, hasMessagingTask } from '../meta/activation';
import { required, AppError } from '../shared/errors';
import { audit } from '../services/audit';
import { log } from '../shared/logger';
export const pageRoutes = new Hono<AppContext>();
pageRoutes.use('*', authenticated, workspace, csrf);
pageRoutes.get('/', async (c) =>
  c.json({
    success: true,
    data: (
      await database(c.env)
        .select()
        .from(pages)
        .where(eq(pages.workspaceId, c.get('workspaceId')))
    ).map((p) => ({
      id: p.id,
      pageName: p.pageName,
      facebookPageId: p.facebookPageId,
      status: p.status,
      webhookSubscribedAt: p.webhookSubscribedAt,
      aiEnabled: p.aiEnabled,
      ready: pageReady(p),
      platformAiEnabled: c.env.AI_ENABLED === 'true',
      platformMessagingEnabled: c.env.MESSAGING_ENABLED === 'true',
    })),
  }),
);
pageRoutes.get('/available', async (c) => {
  requireAdmin(c);
  const s = c.get('session');
  const available = await database(c.env)
    .select({
      id: pageCandidates.id,
      pageId: pageCandidates.facebookPageId,
      name: pageCandidates.pageName,
    })
    .from(pageCandidates)
    .innerJoin(onboardingSessions, eq(onboardingSessions.id, pageCandidates.onboardingId))
    .where(
      and(
        eq(onboardingSessions.sessionId, s.id),
        eq(onboardingSessions.userId, s.userId),
        eq(onboardingSessions.workspaceId, c.get('workspaceId')),
        gt(onboardingSessions.expiresAt, Date.now()),
        isNotNull(onboardingSessions.consumedAt),
      ),
    );
  return c.json({ success: true, data: available });
});
pageRoutes.post('/:id/approve', async (c) => {
  requireAdmin(c);
  const { consent } = z
    .object({ consent: z.literal(true) })
    .strict()
    .parse(await c.req.json());
  if (!consent) throw new AppError('CONSENT_REQUIRED', 'Explicit Page approval is required');
  const db = database(c.env),
    w = c.get('workspaceId'),
    meta = metaClient(c.env);
  const candidate = required(
    await db
      .select()
      .from(pageCandidates)
      .where(eq(pageCandidates.id, c.req.param('id')))
      .get(),
  );
  const onboarding = await activeOnboarding(c, candidate.onboardingId);
  if (
    !hasPagePermissions(z.array(z.string()).parse(JSON.parse(candidate.permissionsJson))) ||
    !hasMessagingTask(z.array(z.string()).parse(JSON.parse(candidate.tasksJson)))
  )
    throw new AppError(
      'PAGE_UNAVAILABLE',
      'Required Page permissions or messaging task are missing',
      403,
    );
  const pageId = candidate.facebookPageId;
  const old = await db.select().from(pages).where(eq(pages.facebookPageId, pageId)).get();
  if (old && old.workspaceId !== w)
    throw new AppError(
      'PAGE_CONNECTED',
      'This Page is already connected to another workspace',
      409,
    );
  const claimed = await db
    .delete(pageCandidates)
    .where(eq(pageCandidates.id, candidate.id))
    .returning();
  if (!claimed.length)
    throw new AppError(
      'CANDIDATE_USED',
      'This Page choice was already used. Reconnect to try again.',
      409,
    );
  const token = await decrypt(
    c.env,
    candidate.encryptedToken,
    candidate.tokenKeyVersion,
    `candidate:${candidate.onboardingId}:${candidate.id}`,
  );
  const id = old?.id ?? crypto.randomUUID(),
    connectionId = crypto.randomUUID();
  const values = {
    pageName: candidate.pageName,
    encryptedPageAccessToken: await encrypt(c.env, token, `${w}:${pageId}`),
    tokenKeyVersion: c.env.TOKEN_KEY_VERSION,
    status: 'error' as const,
    aiEnabled: false,
    webhookSubscribedAt: null,
    permissionsJson: candidate.permissionsJson,
    tasksJson: candidate.tasksJson,
    messengerUserId: onboarding.messengerUserId,
    connectedByUserId: c.get('session').userId,
    connectionId,
    updatedAt: Date.now(),
  };
  await activeOnboarding(c, candidate.onboardingId);
  await db
    .insert(pages)
    .values({ id, workspaceId: w, facebookPageId: pageId, ...values })
    .onConflictDoUpdate({
      target: pages.facebookPageId,
      set: values,
      setWhere: eq(pages.workspaceId, w),
    });
  const guard = and(
    eq(pages.workspaceId, w),
    eq(pages.id, id),
    eq(pages.connectionId, connectionId),
  );
  try {
    await meta.subscribe(pageId, token);
    if (!(await meta.test(pageId, token)))
      throw new AppError('SUBSCRIPTION_FAILED', 'Page subscription could not be verified', 502);
    await activeOnboarding(c, candidate.onboardingId);
    const active = await db
      .update(pages)
      .set({ status: 'active', webhookSubscribedAt: Date.now(), updatedAt: Date.now() })
      .where(guard)
      .returning({ id: pages.id });
    if (!active.length)
      throw new AppError(
        'CONNECTION_CHANGED',
        'This Page connection changed. Refresh its status.',
        409,
      );
  } catch (error) {
    await db
      .update(pages)
      .set({
        status: 'error',
        aiEnabled: false,
        webhookSubscribedAt: null,
        encryptedPageAccessToken: null,
      })
      .where(guard);
    throw error;
  }
  await audit(c.env, w, 'page.connected', id, c.get('session').userId);
  return c.json(
    {
      success: true,
      data: { id, pageName: candidate.pageName, status: 'active', aiEnabled: false },
    },
    201,
  );
});
pageRoutes.patch('/:id/ai', async (c) => {
  requireAdmin(c);
  const { enabled } = z
    .object({ enabled: z.boolean() })
    .strict()
    .parse(await c.req.json());
  const db = database(c.env),
    w = c.get('workspaceId');
  const p = required(
    await db
      .select()
      .from(pages)
      .where(and(eq(pages.workspaceId, w), eq(pages.id, c.req.param('id'))))
      .get(),
  );
  if (
    enabled &&
    (!pageReady(p) || c.env.AI_ENABLED !== 'true' || c.env.MESSAGING_ENABLED !== 'true')
  )
    throw new AppError(
      'ACTIVATION_BLOCKED',
      'Verify the Page connection and enable the platform switches before activating AI.',
      409,
    );
  const updated = await db
    .update(pages)
    .set({ aiEnabled: enabled, updatedAt: Date.now() })
    .where(
      and(
        eq(pages.workspaceId, w),
        eq(pages.id, p.id),
        ...(p.connectionId ? [eq(pages.connectionId, p.connectionId)] : []),
      ),
    )
    .returning({ id: pages.id });
  if (!updated.length)
    throw new AppError(
      'CONNECTION_CHANGED',
      'This Page connection changed. Refresh its status.',
      409,
    );
  await audit(
    c.env,
    w,
    enabled ? 'page.ai_enabled' : 'page.ai_disabled',
    p.id,
    c.get('session').userId,
  );
  return c.json({ success: true, data: { aiEnabled: enabled } });
});
pageRoutes.post('/:id/test', async (c) => {
  requireAdmin(c);
  const w = c.get('workspaceId'),
    db = database(c.env);
  const p = required(
    await db
      .select()
      .from(pages)
      .where(and(eq(pages.workspaceId, w), eq(pages.id, c.req.param('id'))))
      .get(),
  );
  if (!p.encryptedPageAccessToken || !p.connectionId || p.status === 'disconnected')
    throw new AppError('PAGE_DISCONNECTED', 'Reconnect this Page', 409);
  const guard = and(
    eq(pages.workspaceId, w),
    eq(pages.id, p.id),
    eq(pages.connectionId, p.connectionId),
  );
  try {
    const ok = await metaClient(c.env).test(
      p.facebookPageId,
      await decrypt(
        c.env,
        p.encryptedPageAccessToken,
        p.tokenKeyVersion,
        `${w}:${p.facebookPageId}`,
      ),
    );
    const changed = await db
      .update(pages)
      .set({
        status: ok ? 'active' : 'error',
        webhookSubscribedAt: ok ? Date.now() : null,
        ...(!ok ? { aiEnabled: false } : {}),
        updatedAt: Date.now(),
      })
      .where(guard)
      .returning({ id: pages.id });
    return c.json({ success: true, data: { connected: ok && changed.length === 1 } });
  } catch (error) {
    await db
      .update(pages)
      .set({ status: 'error', aiEnabled: false, webhookSubscribedAt: null, updatedAt: Date.now() })
      .where(guard);
    throw error;
  }
});
pageRoutes.delete('/:id', async (c) => {
  requireAdmin(c);
  const w = c.get('workspaceId'),
    db = database(c.env);
  const p = required(
    await db
      .select()
      .from(pages)
      .where(and(eq(pages.workspaceId, w), eq(pages.id, c.req.param('id'))))
      .get(),
  );
  // Revoke local sending before making any external request, including a failing unsubscribe.
  await db
    .update(pages)
    .set({
      status: 'disconnected',
      aiEnabled: false,
      encryptedPageAccessToken: null,
      webhookSubscribedAt: null,
      connectionId: crypto.randomUUID(),
      updatedAt: Date.now(),
    })
    .where(and(eq(pages.workspaceId, w), eq(pages.id, p.id)));
  let unsubscribed = !p.encryptedPageAccessToken;
  if (p.encryptedPageAccessToken) {
    try {
      await metaClient(c.env).disconnect(
        p.facebookPageId,
        await decrypt(
          c.env,
          p.encryptedPageAccessToken,
          p.tokenKeyVersion,
          `${w}:${p.facebookPageId}`,
        ),
      );
      unsubscribed = true;
    } catch {
      log('page_unsubscribe_failed', { errorCategory: 'meta_unsubscribe', jobId: p.id });
    }
  }
  await audit(c.env, w, 'page.disconnected', p.id, c.get('session').userId);
  return c.json({ success: true, data: { disconnected: true, unsubscribed } });
});
