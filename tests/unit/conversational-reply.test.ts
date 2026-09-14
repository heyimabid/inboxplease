import { it, expect, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { conversationalReply } from '../../src/worker/ai/conversational-reply';
import type { GeneratedReply } from '../../src/worker/ai/orchestrator';
it('writes context-aware replies but preserves business facts and confirmation evidence', async () => {
  const verified: GeneratedReply = {
    text: 'Inside Dhaka delivery costs BDT 80 and takes 2-3 days.',
    language: 'banglish',
    productIds: [],
    metadata: { tool: 'get_delivery_options' },
  };
  const run = vi.fn();
  const e = {
    ...env,
    APP_MODE: 'production',
    CHAT_MODEL: 'google/gemini-3.5-flash-lite',
    AI_GATEWAY_ID: 'fixture',
    AI: { gateway: () => ({ run }) } as unknown as typeof env.AI,
  };
  const answer = (text: string) =>
    Response.json({
      candidates: [
        { finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ text }) }] } },
      ],
    });
  const natural = 'Dhakar vitore delivery BDT 80, shomoy lage 2-3 days.';
  run.mockResolvedValue(answer(natural));
  expect((await conversationalReply(e, verified, 'delivery koto?', [], 'Abid')).text).toBe(natural);
  for (const invalid of [
    'Delivery costs BDT 50.',
    'Your order is confirmed.',
    'Free delivery tomorrow!',
  ]) {
    run.mockResolvedValue(answer(invalid));
    expect(await conversationalReply(e, verified, 'delivery koto?', [], 'Abid')).toEqual(verified);
  }
  run.mockRejectedValue(new Error('provider unavailable'));
  expect(await conversationalReply(e, verified, 'delivery koto?', [], 'Abid')).toEqual(verified);
  run.mockClear();
  const review = {
    ...verified,
    metadata: { tool: 'request_order_confirmation', reviewHash: 'original' },
  };
  expect(await conversationalReply(e, review, 'address supplied', [], 'Abid')).toEqual(review);
  expect(run).not.toHaveBeenCalled();
});
