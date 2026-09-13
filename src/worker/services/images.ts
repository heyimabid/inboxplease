import { apiOrigin } from '../env';
import type { Env } from '../env';
import { AppError } from '../shared/errors';
import { base64, hmac, timingEqual } from './encryption';
export async function readLimited(body: ReadableStream<Uint8Array> | null, max: number) {
  if (!body) throw new AppError('EMPTY_BODY', 'An image is required');
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw new AppError('TOO_LARGE', 'Image is too large', 413);
    }
    chunks.push(value);
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result.buffer;
}
export function validateImage(bytes: ArrayBuffer, declared: string) {
  const b = new Uint8Array(bytes);
  let type = '';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) type = 'image/jpeg';
  if (
    b[0] === 137 &&
    b[1] === 80 &&
    b[2] === 78 &&
    b[3] === 71 &&
    b[4] === 13 &&
    b[5] === 10 &&
    b[6] === 26 &&
    b[7] === 10
  )
    type = 'image/png';
  if (
    String.fromCharCode(...b.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...b.slice(8, 12)) === 'WEBP'
  )
    type = 'image/webp';
  if (!type || type !== declared.split(';')[0]?.trim())
    throw new AppError('INVALID_IMAGE', 'Upload a valid JPEG, PNG or WebP image', 422);
  return type;
}
export async function imageDeliveryUrl(env: Env, workspaceId: string, imageId: string) {
  const expires = Date.now() + 10 * 60 * 1000;
  const token = base64(
    await hmac(env.SESSION_SIGNING_SECRET, `${workspaceId}:${imageId}:${expires}`),
  );
  return `${apiOrigin(env)}/media/${workspaceId}/${imageId}?expires=${expires}&token=${encodeURIComponent(token)}`;
}
export async function validDelivery(
  env: Env,
  workspaceId: string,
  imageId: string,
  expires: string,
  token: string,
) {
  const time = Number(expires);
  return (
    Number.isSafeInteger(time) &&
    time > Date.now() &&
    time < Date.now() + 11 * 60 * 1000 &&
    (await timingEqual(
      token,
      base64(await hmac(env.SESSION_SIGNING_SECRET, `${workspaceId}:${imageId}:${expires}`)),
    ))
  );
}
