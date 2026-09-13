import { it, expect, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { geminiJson } from '../../src/worker/ai/gemini';
it('routes structured multimodal Gemini requests through the stored Google AI Studio key', async () => {
  const run = vi.fn().mockResolvedValue(
    Response.json({
      candidates: [
        {
          finishReason: 'STOP',
          content: { parts: [{ thought: true, text: 'internal' }, { text: '{"ok":true}' }] },
        },
      ],
    }),
  );
  const gateway = vi.fn().mockReturnValue({ run });
  const e = {
    ...env,
    AI_GATEWAY_ID: 'fixture-gateway',
    AI: { gateway } as unknown as typeof env.AI,
  };
  expect(
    await geminiJson(
      e,
      'google/gemini-3.5-flash',
      z.object({ ok: z.boolean() }),
      'rules',
      'question',
      ['data:image/png;base64,AAAA'],
    ),
  ).toEqual({ ok: true });
  expect(gateway).toHaveBeenCalledWith('fixture-gateway');
  expect(run.mock.calls[0]![0]).toMatchObject({
    provider: 'google-ai-studio',
    endpoint: 'v1beta/models/gemini-3.5-flash:generateContent',
    headers: { 'cf-aig-byok-alias': 'default' },
    query: {
      contents: [
        {
          role: 'user',
          parts: [{ text: 'question' }, { inlineData: { mimeType: 'image/png', data: 'AAAA' } }],
        },
      ],
    },
  });
});
it('rejects truncated Gemini output rather than using partial order fields', async () => {
  const e = {
    ...env,
    AI_GATEWAY_ID: 'fixture-gateway',
    AI: {
      gateway: () => ({
        run: async () =>
          Response.json({
            candidates: [
              { finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"ok":true}' }] } },
            ],
          }),
      }),
    } as unknown as typeof env.AI,
  };
  await expect(
    geminiJson(
      e,
      'google/gemini-3.5-flash',
      z.object({ ok: z.boolean() }),
      'rules',
      'question',
      [],
    ),
  ).rejects.toThrow('incomplete');
});
