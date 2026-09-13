import { apiOrigin } from './env';
import { Auth, customFetch, type AuthConfig } from '@auth/core';
import { AuthError } from '@auth/core/errors';
import Facebook from '@auth/core/providers/facebook';
import type { TokenSet } from '@auth/core/types';
import { Hono } from 'hono';
import { and, asc, eq, gt } from 'drizzle-orm';
import { z } from 'zod';
import type { Env } from './env';
import { database } from './db/client';
import { users, workspaces, members, settings, sessions } from './db/schema';
import { cookieName, csrf, readSession, type AppContext } from './services/sessions';
import { sha256 } from './services/encryption';
import { readLimited } from './services/images';
import { log } from './shared/logger';
import { AppError } from './shared/errors';
import { rateLimit } from './services/rate-limit';

const identitySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  picture: z.object({ data: z.object({ url: z.url() }) }).optional(),
});
export async function ensureFacebookSellerIdentity(env: Env, profile: unknown) {
  const identity = identitySchema.parse(profile),
    db = database(env);
  // Namespace identity to App 1. Never merge accounts using email or an App 2 ID.
  const facebookUserId = `${env.AUTH_FACEBOOK_ID}:${identity.id}`;
  const id = await sha256(`seller:${facebookUserId}`);
  await db
    .insert(users)
    .values({ id, facebookUserId, name: identity.name, avatarUrl: identity.picture?.data.url })
    .onConflictDoUpdate({
      target: users.facebookUserId,
      set: {
        name: identity.name,
        avatarUrl: identity.picture?.data.url ?? null,
        updatedAt: Date.now(),
      },
    });
  const user = await db.select().from(users).where(eq(users.facebookUserId, facebookUserId)).get();
  if (!user) throw new Error('Seller identity could not be loaded');
  let member = await db
    .select()
    .from(members)
    .where(eq(members.userId, user.id))
    .orderBy(asc(members.createdAt))
    .get();
  if (!member) {
    const w = await sha256(`default-workspace:${user.id}`);
    await db.batch([
      db
        .insert(workspaces)
        .values({ id: w, name: `${identity.name}'s store`, slug: `store-${w}` })
        .onConflictDoNothing(),
      db
        .insert(members)
        .values({ workspaceId: w, userId: user.id, role: 'owner', createdAt: Date.now() })
        .onConflictDoNothing(),
      db.insert(settings).values({ workspaceId: w, updatedAt: Date.now() }).onConflictDoNothing(),
    ]);
    member = await db
      .select()
      .from(members)
      .where(and(eq(members.workspaceId, w), eq(members.userId, user.id)))
      .get();
  }
  return { userId: user.id, workspaceId: member?.workspaceId ?? null, name: identity.name };
}
export function authConfig(env: Env, previousSessionId?: string): AuthConfig {
  const version = env.AUTH_FACEBOOK_GRAPH_API_VERSION;
  if (!env.AUTH_FACEBOOK_ID || !env.AUTH_FACEBOOK_SECRET || !/^v\d+\.\d+$/.test(version))
    throw new AppError('AUTH_NOT_CONFIGURED', 'Seller Facebook sign-in is not configured', 503);
  if (!env.APP_ORIGIN.startsWith('https://') || env.AUTH_FACEBOOK_ID === env.META_APP_ID)
    throw new AppError(
      'AUTH_NOT_CONFIGURED',
      'Use an HTTPS origin and separate Facebook apps',
      503,
    );
  return {
    basePath: '/authjs',
    trustHost: true,
    useSecureCookies: true,
    secret: env.SESSION_SIGNING_SECRET,
    session: { strategy: 'jwt', maxAge: 7 * 86400 },
    cookies: {
      sessionToken: {
        name: cookieName(env),
        options: { httpOnly: true, secure: true, sameSite: 'lax', path: '/' },
      },
    },
    providers: [
      Facebook({
        clientId: env.AUTH_FACEBOOK_ID,
        clientSecret: env.AUTH_FACEBOOK_SECRET,
        checks: ['state'],
        [customFetch]: async (input, init) => {
          const response = await fetch(input, init);
          let code: number | undefined;
          if (!response.ok) {
            const body: unknown = await response
              .clone()
              .json()
              .catch(() => null);
            const parsed = z
              .object({ error: z.object({ code: z.number().optional() }) })
              .safeParse(body);
            if (parsed.success) code = parsed.data.error.code;
          }
          log('auth_token_exchange', {
            status: response.status,
            errorCategory: code === undefined ? undefined : `meta_${code}`,
          });
          return response;
        },
        authorization: {
          url: `https://www.facebook.com/${version}/dialog/oauth`,
          params: { scope: 'public_profile' },
        },
        token: `https://graph.facebook.com/${version}/oauth/access_token`,
        userinfo: {
          url: `https://graph.facebook.com/${version}/me?fields=id,name,picture`,
          async request({ tokens }: { tokens: TokenSet }) {
            if (!tokens.access_token) throw new Error('Missing identity token');
            const response = await fetch(
              `https://graph.facebook.com/${version}/me?fields=id,name,picture`,
              {
                headers: { Authorization: `Bearer ${tokens.access_token}` },
                redirect: 'manual',
                signal: AbortSignal.timeout(12000),
              },
            );
            log('auth_profile_response', { status: response.status });
            if (!response.ok) throw new Error('Facebook identity request failed');
            return identitySchema.parse(
              JSON.parse(new TextDecoder().decode(await readLimited(response.body, 64000))),
            );
          },
        },
        profile(profile) {
          const p = identitySchema.parse(profile);
          return { id: p.id, name: p.name, image: p.picture?.data.url ?? null };
        },
        account: () => ({}),
      }),
    ],
    callbacks: {
      async jwt({ token, account, profile }) {
        if (account?.provider === 'facebook' && profile) {
          log('auth_identity_save_started');
          const identity = await ensureFacebookSellerIdentity(env, profile);
          log('auth_identity_save_finished');
          const sid = crypto.randomUUID(),
            db = database(env);
          await db.batch([
            db.insert(sessions).values({
              id: sid,
              userId: identity.userId,
              workspaceId: identity.workspaceId,
              createdAt: Date.now(),
              expiresAt: Date.now() + 7 * 86400000,
            }),
            ...(previousSessionId
              ? [db.delete(sessions).where(eq(sessions.id, previousSessionId))]
              : []),
          ]);
          // No provider access token, refresh token, or Page credentials enter the JWT.
          return { sub: identity.userId, sid, name: identity.name };
        }
        if (typeof token.sid !== 'string' || typeof token.sub !== 'string') return null;
        const active = await database(env)
          .select({ id: sessions.id })
          .from(sessions)
          .where(
            and(
              eq(sessions.id, token.sid),
              eq(sessions.userId, token.sub),
              gt(sessions.expiresAt, Date.now()),
            ),
          )
          .get();
        return active ? token : null;
      },
      async session({ session, token }) {
        return { expires: session.expires, user: { id: token.sub, name: token.name } };
      },
      async redirect({ url }) {
        const target = new URL(url, env.APP_ORIGIN);
        return target.origin === env.APP_ORIGIN ? target.toString() : `${env.APP_ORIGIN}/`;
      },
    },
    events: {
      async signOut(message) {
        if ('token' in message && typeof message.token?.sid === 'string')
          await database(env).delete(sessions).where(eq(sessions.id, message.token.sid));
      },
    },
    logger: {
      error: (error) => {
        const cause = error instanceof AuthError ? error.cause?.err : undefined;
        const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : undefined;
        log('auth_failed', {
          errorCategory: error instanceof AuthError ? error.type : 'identity_oauth',
          tool:
            cause instanceof Error &&
            [
              'TypeError',
              'Error',
              'ZodError',
              'OperationProcessingError',
              'ResponseBodyError',
            ].includes(cause.name)
              ? cause.name
              : 'unknown',
          status: typeof code === 'string' && /^OAUTH_[A-Z_]+$/.test(code) ? code : undefined,
        });
      },
      warn: () => log('auth_warning', { errorCategory: 'identity_configuration' }),
      debug: () => {},
    },
  };
}
export const authjsRoutes = new Hono<AppContext>();
authjsRoutes.use('*', csrf);
authjsRoutes.all('*', async (c) => {
  if (c.env.APP_MODE === 'mock')
    throw new AppError('NOT_FOUND', 'Use local sign-in in mock mode', 404);
  c.header('Cache-Control', 'no-store');
  await rateLimit(c.env, `identity:${c.req.header('CF-Connecting-IP') ?? 'local'}`, 30);
  const prior = await readSession(c);
  // Pin callback origin instead of trusting an arbitrary Host or forwarding header.
  const url = new URL(c.req.url),
    canonical = new URL(apiOrigin(c.env));
  url.protocol = canonical.protocol;
  url.host = canonical.host;
  const headers = new Headers(c.req.raw.headers);
  headers.delete('x-forwarded-host');
  headers.delete('x-forwarded-proto');
  headers.set('host', canonical.host);
  return Auth(
    new Request(url, {
      method: c.req.method,
      headers,
      ...(c.req.method === 'POST' ? { body: await readLimited(c.req.raw.body, 32000) } : {}),
    }),
    authConfig(c.env, prior?.id),
  );
});
