import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Context, MiddlewareHandler } from 'hono';
import { and, eq, gt } from 'drizzle-orm';
import type { Env } from '../env';
import { database } from '../db/client';
import { members, sessions } from '../db/schema';
import { base64, hmac, sha256, timingEqual } from './encryption';
import { AppError } from '../shared/errors';
import { getToken } from '@auth/core/jwt';
export type Session = typeof sessions.$inferSelect;
export type AppContext = {
  Bindings: Env;
  Variables: {
    requestId: string;
    session: Session;
    workspaceId: string;
    role: 'owner' | 'admin' | 'agent';
  };
};
export const cookieName = (env: Env) =>
  env.APP_MODE === 'production' ? '__Host-ip_session' : 'ip_session';
export async function createSession(c: Context<AppContext>, userId: string) {
  if (c.env.APP_MODE !== 'mock') throw new Error('Production sign-in requires Auth.js');
  const raw = crypto.randomUUID() + crypto.randomUUID();
  const id = await sha256(raw);
  const signature = base64(await hmac(c.env.SESSION_SIGNING_SECRET, raw));
  const now = Date.now();
  await database(c.env)
    .insert(sessions)
    .values({ id, userId, expiresAt: now + 7 * 86400000, createdAt: now });
  setCookie(c, cookieName(c.env), `${raw}.${signature}`, {
    httpOnly: true,
    secure: false,
    sameSite: 'Lax',
    path: '/',
    maxAge: 7 * 86400,
  });
  return id;
}
export async function readSession(c: Context<AppContext>) {
  if (c.env.APP_MODE === 'production') {
    const token = await getToken({
      req: { headers: { cookie: c.req.header('Cookie') ?? '' } },
      secret: c.env.SESSION_SIGNING_SECRET,
      salt: cookieName(c.env),
      cookieName: cookieName(c.env),
      secureCookie: true,
    });
    if (typeof token?.sid !== 'string' || typeof token.sub !== 'string') return null;
    return (
      (await database(c.env)
        .select()
        .from(sessions)
        .where(
          and(
            eq(sessions.id, token.sid),
            eq(sessions.userId, token.sub),
            gt(sessions.expiresAt, Date.now()),
          ),
        )
        .get()) ?? null
    );
  }
  const value = getCookie(c, cookieName(c.env));
  if (!value) return null;
  const [raw, signature] = value.split('.');
  if (
    !raw ||
    !signature ||
    !(await timingEqual(signature, base64(await hmac(c.env.SESSION_SIGNING_SECRET, raw))))
  )
    return null;
  return (
    (await database(c.env)
      .select()
      .from(sessions)
      .where(and(eq(sessions.id, await sha256(raw)), gt(sessions.expiresAt, Date.now())))
      .get()) ?? null
  );
}
export async function logout(c: Context<AppContext>) {
  const session = await readSession(c);
  if (session) await database(c.env).delete(sessions).where(eq(sessions.id, session.id));
  deleteCookie(c, cookieName(c.env), { path: '/', secure: c.env.APP_MODE === 'production' });
}
export const authenticated: MiddlewareHandler<AppContext> = async (c, next) => {
  const session = await readSession(c);
  if (!session) throw new AppError('UNAUTHENTICATED', 'Please sign in again', 401);
  c.set('session', session);
  await next();
};
export const workspace: MiddlewareHandler<AppContext> = async (c, next) => {
  const s = c.get('session');
  if (!s.workspaceId) throw new AppError('WORKSPACE_REQUIRED', 'Create or select a workspace', 409);
  const membership = await database(c.env)
    .select()
    .from(members)
    .where(and(eq(members.workspaceId, s.workspaceId), eq(members.userId, s.userId)))
    .get();
  if (!membership) throw new AppError('FORBIDDEN', 'Workspace access denied', 403);
  c.set('workspaceId', s.workspaceId);
  c.set('role', membership.role);
  await next();
};
export function requireAdmin(c: Context<AppContext>) {
  if (c.get('role') === 'agent')
    throw new AppError('FORBIDDEN', 'Administrator access required', 403);
}
export const csrf: MiddlewareHandler<AppContext> = async (c, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    const allowed = [
      c.env.APP_ORIGIN,
      ...(c.env.APP_MODE === 'mock'
        ? (c.env.MOCK_APP_ORIGINS ?? '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : []),
    ];
    if (!allowed.includes(c.req.header('Origin') ?? ''))
      throw new AppError('CSRF_REJECTED', 'Request origin is not allowed', 403);
  }
  await next();
};
