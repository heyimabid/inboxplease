import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:workers';
import { encrypt, decrypt, timingEqual, sha256 } from '../../src/worker/services/encryption';
describe('cryptographic boundaries', () => {
  it('encrypts non-deterministically and binds ciphertext to its tenant', async () => {
    const a = await encrypt(env, 'private-page-token', 'workspace-a:page-1');
    const b = await encrypt(env, 'private-page-token', 'workspace-a:page-1');
    expect(a).not.toBe(b);
    expect(a).not.toContain('private-page-token');
    expect(await decrypt(env, a, env.TOKEN_KEY_VERSION, 'workspace-a:page-1')).toBe(
      'private-page-token',
    );
    await expect(decrypt(env, a, env.TOKEN_KEY_VERSION, 'workspace-b:page-1')).rejects.toThrow();
  });
  it('compares secrets and hashes deterministically', async () => {
    expect(await timingEqual('abc', 'abc')).toBe(true);
    expect(await timingEqual('abc', 'abcd')).toBe(false);
    expect(await sha256('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
