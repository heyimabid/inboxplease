import { apiOrigin } from '../env';
import { Hono } from 'hono';
import { and, eq, inArray } from 'drizzle-orm';
import type { AppContext } from '../services/sessions';
import { database } from '../db/client';
import { users, pages, sessions, onboardingSessions, deletionReceipts } from '../db/schema';
import { parseSignedRequest } from '../meta/signature';
import { readLimited } from '../services/images';
import { AppError } from '../shared/errors';
export const privacyRoutes = new Hono<AppContext>();
privacyRoutes.post('/:app/:action', async (c) => {
  const action = c.req.param('action'),
    source = c.req.param('app');
  if (
    !['deauthorize', 'data-deletion'].includes(action) ||
    !['facebook-login', 'messenger'].includes(source)
  )
    throw new AppError('NOT_FOUND', 'Route not found', 404);
  const secret = source === 'facebook-login' ? c.env.AUTH_FACEBOOK_SECRET : c.env.META_APP_SECRET;
  if (!secret) throw new AppError('META_NOT_CONFIGURED', 'This Meta app is not configured', 503);
  const body = new TextDecoder().decode(await readLimited(c.req.raw.body, 32000));
  const signed = await parseSignedRequest(
    new URLSearchParams(body).get('signed_request') ?? '',
    secret,
  );
  if (!signed) throw new AppError('INVALID_SIGNATURE', 'Invalid signed request', 403);
  const db = database(c.env);
  const user =
    source === 'facebook-login'
      ? await db
          .select()
          .from(users)
          .where(eq(users.facebookUserId, `${c.env.AUTH_FACEBOOK_ID}:${signed.user_id}`))
          .get()
      : null;
  const connections =
    source === 'messenger'
      ? await db.select().from(pages).where(eq(pages.messengerUserId, signed.user_id))
      : user
        ? await db.select().from(pages).where(eq(pages.connectedByUserId, user.id))
        : [];
  for (const page of connections) {
    await db
      .update(pages)
      .set({
        status: 'disconnected',
        aiEnabled: false,
        encryptedPageAccessToken: null,
        webhookSubscribedAt: null,
        connectionId: crypto.randomUUID(),
        messengerUserId: null,
        updatedAt: Date.now(),
      })
      .where(and(eq(pages.workspaceId, page.workspaceId), eq(pages.id, page.id)));
  }
  if (source === 'messenger') {
    // App 2 IDs never select or delete App 1 identities/sessions.
    await db
      .delete(onboardingSessions)
      .where(eq(onboardingSessions.messengerUserId, signed.user_id));
  } else if (user) {
    const activeSessions = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.userId, user.id));
    if (activeSessions.length)
      await db.delete(onboardingSessions).where(
        inArray(
          onboardingSessions.sessionId,
          activeSessions.map((s) => s.id),
        ),
      );
    await db.delete(sessions).where(eq(sessions.userId, user.id));
    if (action === 'data-deletion') await db.delete(users).where(eq(users.id, user.id));
  }
  if (action === 'deauthorize') return c.json({ success: true });
  const code = crypto.randomUUID();
  await db
    .insert(deletionReceipts)
    .values({ id: code, status: 'completed', createdAt: Date.now() });
  return c.json({
    url: `${apiOrigin(c.env)}/auth/privacy/deletion-status/${code}`,
    confirmation_code: code,
  });
});
privacyRoutes.get('/deletion-status/:id', async (c) => {
  const receipt = await database(c.env)
    .select({ status: deletionReceipts.status })
    .from(deletionReceipts)
    .where(eq(deletionReceipts.id, c.req.param('id')))
    .get();
  if (!receipt) throw new AppError('NOT_FOUND', 'Deletion request not found', 404);
  return c.json({ success: true, data: receipt });
});
