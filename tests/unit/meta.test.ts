import { describe, it, expect } from 'vitest';
import { hmac } from '../../src/worker/services/encryption';
import { verifySignature } from '../../src/worker/meta/signature';
import { parseWebhook } from '../../src/worker/meta/webhook-parser';
describe('Meta webhook validation', () => {
  it('validates the raw bytes and rejects tampering', async () => {
    const raw = new TextEncoder().encode('{"a":1}').buffer,
      secret = 'test-secret';
    const signature =
      'sha256=' +
      Array.from(await hmac(secret, raw), (b) => b.toString(16).padStart(2, '0')).join('');
    expect(await verifySignature(raw, signature, secret)).toBe(true);
    expect(
      await verifySignature(new TextEncoder().encode('{"a":2}').buffer, signature, secret),
    ).toBe(false);
    expect(await verifySignature(raw, undefined, secret)).toBe(false);
  });
  it('ignores echoes and scopes stable IDs to Page and sender', async () => {
    const event = {
      sender: { id: 'customer' },
      recipient: { id: 'page' },
      timestamp: 100,
      message: { mid: 'm1', text: 'dam koto' },
    };
    const body = {
      object: 'page',
      entry: [
        {
          id: 'page',
          messaging: [event, { ...event, message: { ...event.message, is_echo: true } }],
        },
      ],
    };
    const result = await parseWebhook(body);
    expect(result).toHaveLength(1);
    expect(result[0]?.text).toBe('dam koto');
    expect((await parseWebhook(body))[0]?.eventId).toBe(result[0]?.eventId);
  });
});

it('splits long replies without losing facts or breaking Unicode characters', async () => {
  const { replyChunks } = await import('../../src/worker/services/reply-chunks');
  const text = 'Verified policy বাংলা 😀 '.repeat(180),
    parts = replyChunks(text);
  expect(parts.join('')).toBe(text);
  expect(parts.every((p) => p.length <= 1900)).toBe(true);
  expect(parts.every((p) => !/[\uD800-\uDBFF]$/.test(p))).toBe(true);
});
