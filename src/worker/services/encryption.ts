import type { Env } from '../env';
import { z } from 'zod';
export function base64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
export function unbase64(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}
export async function sha256(value: string | ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest(
    'SHA-256',
    typeof value === 'string' ? new TextEncoder().encode(value) : value,
  );
  return Array.from(new Uint8Array(hash), (v) => v.toString(16).padStart(2, '0')).join('');
}
export async function hmac(
  secret: string,
  value: string | ArrayBuffer,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(
    await crypto.subtle.sign(
      'HMAC',
      key,
      typeof value === 'string' ? new TextEncoder().encode(value) : value,
    ),
  );
}
export async function timingEqual(a: string, b: string) {
  const [left, right] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}
async function keyFor(env: Env, version: string) {
  const old = z
    .record(z.string(), z.string())
    .parse(JSON.parse(env.TOKEN_ENCRYPTION_PREVIOUS_KEYS || '{}'));
  const raw = version === env.TOKEN_KEY_VERSION ? env.TOKEN_ENCRYPTION_KEY : old[version];
  if (!raw) throw new Error('Encryption key unavailable');
  const bytes = unbase64(raw);
  if (bytes.byteLength !== 32) throw new Error('AES key must contain 32 bytes');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function encrypt(env: Env, plaintext: string, context: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(context) },
    await keyFor(env, env.TOKEN_KEY_VERSION),
    new TextEncoder().encode(plaintext),
  );
  return `${base64(iv)}.${base64(new Uint8Array(ciphertext))}`;
}
export async function decrypt(env: Env, ciphertext: string, version: string, context: string) {
  const [iv, body] = ciphertext.split('.');
  if (!iv || !body) throw new Error('Invalid ciphertext');
  return new TextDecoder().decode(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: unbase64(iv), additionalData: new TextEncoder().encode(context) },
      await keyFor(env, version),
      unbase64(body),
    ),
  );
}
