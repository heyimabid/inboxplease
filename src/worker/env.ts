import { z } from 'zod';
export type Env = Cloudflare.Env & {
  API_ORIGIN?: string;
  AUTH_FACEBOOK_SECRET?: string;
  TOKEN_ENCRYPTION_PREVIOUS_KEYS?: string;
  MOCK_APP_ORIGINS?: string;
};
export const configSchema = z.object({
  APP_MODE: z.enum(['mock', 'production']),
  APP_ORIGIN: z.url(),
  API_ORIGIN: z.url().optional(),
  META_GRAPH_API_VERSION: z.string(),
  META_APP_ID: z.string(),
  META_LOGIN_CONFIG_ID: z.string(),
  META_APP_SECRET: z.string().optional(),
  META_WEBHOOK_VERIFY_TOKEN: z.string().min(24),
  SESSION_SIGNING_SECRET: z.string().min(32),
  TOKEN_ENCRYPTION_KEY: z.string().min(40),
  TOKEN_KEY_VERSION: z.string(),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive(),
  DEBOUNCE_MS: z.coerce.number().min(0).max(10000),
  DEBOUNCE_MAX_MS: z.coerce.number().min(1000).max(30000),
  IMAGE_MAX_BYTES: z.coerce.number().int().positive().max(10000000),
  AI_ENABLED: z.enum(['true', 'false']),
  MESSAGING_ENABLED: z.enum(['true', 'false']),
});
export function validateEnv(env: Env) {
  const value = configSchema.parse(env);
  if (
    value.APP_MODE === 'production' &&
    (!value.APP_ORIGIN.startsWith('https://') ||
      value.APP_ORIGIN.includes('.invalid') ||
      (value.API_ORIGIN &&
        (!value.API_ORIGIN.startsWith('https://') ||
          new URL(value.API_ORIGIN).origin !== value.API_ORIGIN)))
  )
    throw new Error('Production configuration is incomplete');
  return value;
}
export function isMock(env: Env) {
  return env.APP_MODE === 'mock';
}

export function apiOrigin(env: Env) {
  return env.API_ORIGIN || env.APP_ORIGIN;
}
