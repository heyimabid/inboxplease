import { apiOrigin } from '../env';
import { Hono } from 'hono';
import { and, eq, gt, isNull, isNotNull, inArray } from 'drizzle-orm';
import type { Context } from 'hono';
import { database } from '../db/client';
import { onboardingSessions, pageCandidates, sessions, members } from '../db/schema';
import {
  authenticated,
  workspace,
  csrf,
  requireAdmin,
  type AppContext,
} from '../services/sessions';
import { encrypt, sha256 } from '../services/encryption';
import { metaClient } from './client';
import { PAGE_PERMISSIONS, hasPagePermissions, hasMessagingTask } from './activation';
import { AppError } from '../shared/errors';
import { rateLimit } from '../services/rate-limit';

export async function activeOnboarding(c: Context<AppContext>, id: string, consumed = true) {
  const s = c.get('session'),
    w = c.get('workspaceId');
  const row = await database(c.env)
    .select({ onboarding: onboardingSessions })
    .from(onboardingSessions)
    .innerJoin(sessions, eq(sessions.id, onboardingSessions.sessionId))
    .innerJoin(
      members,
      and(
        eq(members.userId, onboardingSessions.userId),
        eq(members.workspaceId, onboardingSessions.workspaceId),
      ),
    )
    .where(
      and(
        eq(onboardingSessions.id, id),
        eq(onboardingSessions.userId, s.userId),
        eq(onboardingSessions.workspaceId, w),
        eq(onboardingSessions.sessionId, s.id),
        eq(sessions.workspaceId, w),
        eq(sessions.userId, s.userId),
        gt(sessions.expiresAt, Date.now()),
        gt(onboardingSessions.expiresAt, Date.now()),
        inArray(members.role, ['owner', 'admin']),
        consumed ? isNotNull(onboardingSessions.consumedAt) : isNull(onboardingSessions.consumedAt),
      ),
    )
    .get();
  if (!row)
    throw new AppError(
      'INVALID_OAUTH_STATE',
      'Page connection expired or the signed-in workspace changed. Start again.',
      403,
    );
  return row.onboarding;
}
async function collectCandidates(c: Context<AppContext>, stateId: string, token: string) {
  const meta = metaClient(c.env),
    permissions = await meta.permissions(token);
  if (!hasPagePermissions(permissions))
    throw new AppError(
      'MISSING_PAGE_PERMISSIONS',
      'Grant all three requested Page permissions and try again.',
      403,
    );
  const identity = await meta.identity(token);
  const available = (await meta.availablePages(token)).filter((p) =>
    hasMessagingTask(p.tasks ?? []),
  );
  await activeOnboarding(c, stateId);
  const db = database(c.env);
  await db
    .update(onboardingSessions)
    .set({ messengerUserId: identity.id })
    .where(eq(onboardingSessions.id, stateId));
  for (const p of available) {
    const id = crypto.randomUUID();
    await db.insert(pageCandidates).values({
      id,
      onboardingId: stateId,
      facebookPageId: p.id,
      pageName: p.name,
      encryptedToken: await encrypt(c.env, p.access_token, `candidate:${stateId}:${id}`),
      tokenKeyVersion: c.env.TOKEN_KEY_VERSION,
      permissionsJson: JSON.stringify(permissions),
      tasksJson: JSON.stringify(p.tasks ?? []),
    });
  }
}
export const oauthRoutes = new Hono<AppContext>();
oauthRoutes.use('*', authenticated, workspace, csrf);
oauthRoutes.post('/connect', async (c) => {
  requireAdmin(c);
  await rateLimit(c.env, `page-connect:${c.get('session').userId}`, 20);
  if (
    c.env.APP_MODE !== 'mock' &&
    (!c.env.META_APP_ID ||
      !c.env.META_APP_SECRET ||
      !/^v\d+\.\d+$/.test(c.env.META_GRAPH_API_VERSION) ||
      c.env.META_APP_ID === c.env.AUTH_FACEBOOK_ID)
  )
    throw new AppError(
      'META_NOT_CONFIGURED',
      'Configure a separate Messenger app before connecting a Page',
      503,
    );
  const state = crypto.randomUUID() + crypto.randomUUID(),
    id = await sha256(state),
    db = database(c.env),
    s = c.get('session');
  // Starting over invalidates previous candidate tokens for this browser session.
  await db.delete(onboardingSessions).where(eq(onboardingSessions.sessionId, s.id));
  await db.insert(onboardingSessions).values({
    id,
    userId: s.userId,
    workspaceId: c.get('workspaceId'),
    sessionId: s.id,
    expiresAt: Date.now() + 10 * 60000,
    consumedAt: c.env.APP_MODE === 'mock' ? Date.now() : null,
  });
  if (c.env.APP_MODE === 'mock') {
    await collectCandidates(c, id, 'local-user-token');
    return c.json({ success: true, data: { url: null } });
  }
  const url = new URL(`https://www.facebook.com/${c.env.META_GRAPH_API_VERSION}/dialog/oauth`);
  Object.entries({
    client_id: c.env.META_APP_ID,
    response_type: 'code',
    redirect_uri: `${apiOrigin(c.env)}/facebook/callback`,
    state,
    scope: PAGE_PERMISSIONS.join(','),
    ...(c.env.META_LOGIN_CONFIG_ID
      ? { config_id: c.env.META_LOGIN_CONFIG_ID, override_default_response_type: 'true' }
      : {}),
  }).forEach(([k, v]) => url.searchParams.set(k, v));
  return c.json({ success: true, data: { url: url.toString() } });
});
oauthRoutes.get('/callback', async (c) => {
  requireAdmin(c);
  c.header('Cache-Control', 'no-store');
  const state = c.req.query('state');
  if (!state || state.length > 200)
    throw new AppError('INVALID_OAUTH_STATE', 'Invalid Page connection state', 403);
  const id = await sha256(state);
  await activeOnboarding(c, id, false);
  const consumed = await database(c.env)
    .update(onboardingSessions)
    .set({ consumedAt: Date.now() })
    .where(
      and(
        eq(onboardingSessions.id, id),
        isNull(onboardingSessions.consumedAt),
        gt(onboardingSessions.expiresAt, Date.now()),
      ),
    )
    .returning();
  if (!consumed.length)
    throw new AppError('INVALID_OAUTH_STATE', 'Page connection state was already used', 403);
  if (c.req.query('error'))
    return c.redirect(`${c.env.API_ORIGIN ? c.env.APP_ORIGIN : ''}/settings?facebook=denied`);
  const code = c.req.query('code');
  if (!code || code.length > 4096)
    throw new AppError('MISSING_CODE', 'Facebook did not return an authorization code');
  try {
    await collectCandidates(c, id, await metaClient(c.env).exchangeCode(code));
  } catch (error) {
    await database(c.env).delete(onboardingSessions).where(eq(onboardingSessions.id, id));
    throw error;
  }
  return c.redirect(`${c.env.API_ORIGIN ? c.env.APP_ORIGIN : ''}/settings?facebook=choose`);
});
