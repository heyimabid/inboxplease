import { apiOrigin } from '../env';
import { z } from 'zod';
import type { Env } from '../env';
import { AppError } from '../shared/errors';
import { hmac } from '../services/encryption';
import { readLimited } from '../services/images';
import { pageSchema, type MetaClient } from './types';
import { mockMetaClient } from './mock-client';
export class MetaError extends AppError {
  constructor(
    public metaCode: number,
    public retryable: boolean,
  ) {
    super(
      'META_ERROR',
      metaCode === 190
        ? 'Facebook access expired or was revoked. Reconnect your Page.'
        : metaCode === 10 || metaCode === 200
          ? 'Facebook permissions are missing. Reconnect and grant the required access.'
          : 'Facebook could not complete this request',
      502,
    );
  }
}
export function metaClient(env: Env): MetaClient {
  if (env.APP_MODE === 'mock') return mockMetaClient(env);
  if (!/^v\d+\.\d+$/.test(env.META_GRAPH_API_VERSION))
    throw new AppError('META_NOT_CONFIGURED', 'Facebook connection is not configured', 503);
  const graph = `https://graph.facebook.com/${env.META_GRAPH_API_VERSION}`;
  async function call(
    path: string,
    token: string,
    method = 'GET',
    body?: unknown,
    params: Record<string, string> = {},
  ): Promise<unknown> {
    const url = new URL(`${graph}/${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    if (token)
      url.searchParams.set(
        'appsecret_proof',
        Array.from(await hmac(env.META_APP_SECRET, token), (b) =>
          b.toString(16).padStart(2, '0'),
        ).join(''),
      );
    const response = await fetch(url, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(12000),
      redirect: 'manual',
    });
    if (response.status >= 300 && response.status < 400)
      throw new Error('Meta returned an unexpected redirect');
    const raw: unknown = JSON.parse(
      new TextDecoder().decode(await readLimited(response.body, 2000000)),
    );
    const failed = z
      .object({ error: z.object({ code: z.number(), is_transient: z.boolean().optional() }) })
      .safeParse(raw);
    if (failed.success)
      throw new MetaError(
        failed.data.error.code,
        !!failed.data.error.is_transient || response.status === 429,
      );
    if (!response.ok) throw new Error('Meta returned an unclassified response');
    return raw;
  }
  return {
    async customerProfile(psid, token) {
      const profile = z
        .object({
          first_name: z.string().optional(),
          last_name: z.string().optional(),
          profile_pic: z.string().optional(),
        })
        .parse(
          await call(encodeURIComponent(psid), token, 'GET', undefined, {
            fields: 'first_name,last_name,profile_pic',
          }),
        );
      return {
        name: [profile.first_name, profile.last_name].filter(Boolean).join(' ') || null,
        picture: profile.profile_pic ?? null,
      };
    },
    async exchangeCode(code) {
      const result = await call('oauth/access_token', '', 'GET', undefined, {
        client_id: env.META_APP_ID,
        client_secret: env.META_APP_SECRET,
        redirect_uri: `${apiOrigin(env)}/facebook/callback`,
        code,
      });
      return z.object({ access_token: z.string() }).parse(result).access_token;
    },
    async identity(token) {
      return z
        .object({ id: z.string(), name: z.string(), email: z.string().optional() })
        .parse(await call('me', token, 'GET', undefined, { fields: 'id,name' }));
    },
    async permissions(token) {
      const result = z
        .object({ data: z.array(z.object({ permission: z.string(), status: z.string() })) })
        .parse(await call('me/permissions', token));
      return result.data.filter((p) => p.status === 'granted').map((p) => p.permission);
    },
    async availablePages(token) {
      const all: z.infer<typeof pageSchema>[] = [];
      let after = '';
      for (let i = 0; i < 20; i++) {
        const result = z
          .object({
            data: z.array(pageSchema),
            paging: z
              .object({
                cursors: z.object({ after: z.string().optional() }).optional(),
                next: z.string().optional(),
              })
              .optional(),
          })
          .parse(
            await call('me/accounts', token, 'GET', undefined, {
              fields: 'id,name,access_token,tasks',
              limit: '100',
              ...(after ? { after } : {}),
            }),
          );
        all.push(...result.data);
        if (!result.paging?.next) return all;
        after = result.paging.cursors?.after ?? '';
        if (!after) break;
      }
      throw new AppError('PAGE_LIST_TOO_LARGE', 'Page list is too large to load safely', 502);
    },
    async subscribe(id, token) {
      z.object({ success: z.literal(true) }).parse(
        await call(`${encodeURIComponent(id)}/subscribed_apps`, token, 'POST', {
          subscribed_fields: ['messages', 'messaging_postbacks'],
        }),
      );
    },
    async disconnect(id, token) {
      await call(`${encodeURIComponent(id)}/subscribed_apps`, token, 'DELETE');
    },
    async test(id, token) {
      const result = z
        .object({
          data: z.array(
            z.object({ id: z.string(), subscribed_fields: z.array(z.string()).optional() }),
          ),
        })
        .parse(await call(`${encodeURIComponent(id)}/subscribed_apps`, token));
      return result.data.some(
        (app) =>
          app.id === env.META_APP_ID &&
          ['messages', 'messaging_postbacks'].every((field) =>
            app.subscribed_fields?.includes(field),
          ),
      );
    },
    async send(id, psid, token, message, _deliveryId) {
      const result = z.object({ message_id: z.string() }).parse(
        await call(`${encodeURIComponent(id)}/messages`, token, 'POST', {
          recipient: { id: psid },
          messaging_type: 'RESPONSE',
          message,
        }),
      );
      return { messageId: result.message_id };
    },
    async showTypingIndicator(id, psid, token) {
      // Send API returns { recipient_id } for sender actions, not { success: true }.
      z.object({ recipient_id: z.string() }).parse(
        await call(`${encodeURIComponent(id)}/messages`, token, 'POST', {
          recipient: { id: psid },
          sender_action: 'typing_on',
        }),
      );
    },
    async markSeen(id, psid, token) {
      z.object({ recipient_id: z.string() }).parse(
        await call(`${encodeURIComponent(id)}/messages`, token, 'POST', {
          recipient: { id: psid },
          sender_action: 'mark_seen',
        }),
      );
    },
  };
}
