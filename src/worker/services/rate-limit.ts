import type { Env } from '../env';
import { sha256 } from './encryption';
import { AppError } from '../shared/errors';
export async function rateLimit(env: Env, key: string, max: number, windowSeconds = 60) {
  const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
  const id = await sha256(`${key}:${bucket}`);
  const row = await env.DB.prepare(
    'INSERT INTO rate_limits(id,count,expires_at) VALUES (?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1 RETURNING count',
  )
    .bind(id, (bucket + 1) * windowSeconds * 1000)
    .first<{ count: number }>();
  if (!row || row.count > max)
    throw new AppError('RATE_LIMITED', 'Too many requests. Please try again shortly.', 429);
}
