import { hmac, timingEqual, unbase64 } from '../services/encryption';
import { z } from 'zod';
export async function verifySignature(
  raw: ArrayBuffer,
  signature: string | undefined,
  secret: string,
) {
  if (!signature || !/^sha256=[0-9a-f]{64}$/.test(signature)) return false;
  const actual = Array.from(await hmac(secret, raw), (b) => b.toString(16).padStart(2, '0')).join(
    '',
  );
  return timingEqual(signature.slice(7), actual);
}
export async function parseSignedRequest(value: string, secret: string) {
  const [signature, payload] = value.split('.');
  if (!signature || !payload) return null;
  const normalize = (s: string) => s.replace(/-/g, '+').replace(/_/g, '/');
  let decoded: unknown;
  try {
    const actual = await hmac(secret, payload);
    const expected = unbase64(normalize(signature));
    if (actual.length !== expected.length) return null;
    let diff = 0;
    for (let i = 0; i < actual.length; i++) diff |= (actual[i] ?? 0) ^ (expected[i] ?? 0);
    if (diff) return null;
    decoded = JSON.parse(new TextDecoder().decode(unbase64(normalize(payload))));
  } catch {
    return null;
  }
  const result = z
    .object({
      algorithm: z.literal('HMAC-SHA256'),
      user_id: z.string(),
      issued_at: z.number().optional(),
    })
    .safeParse(decoded);
  return result.success ? result.data : null;
}
