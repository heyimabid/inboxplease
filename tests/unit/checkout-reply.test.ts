import { it, expect, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { checkoutReply } from '../../src/worker/ai/checkout-reply';
import type { getDraft } from '../../src/worker/services/orders';
it('uses conversational wording but falls back on unsupported promises or a model outage', async () => {
  const draft = {
    items: [{}],
    customerName: 'Abid',
    phone: '01712345678',
    deliveryAddress: 'Mirpur, Dhaka',
    deliveryArea: null,
  } as NonNullable<Awaited<ReturnType<typeof getDraft>>>;
  for (const proposed of [
    'Address-ta peyechi. Dhakar vitore naki Dhakar baire?',
    'Your order is confirmed, free delivery tomorrow!',
    null,
  ]) {
    const run = vi.fn().mockImplementation(async () => {
      if (proposed === null) throw new Error('provider unavailable');
      return Response.json({
        candidates: [
          {
            finishReason: 'STOP',
            content: { parts: [{ text: JSON.stringify({ text: proposed }) }] },
          },
        ],
      });
    });
    const e = {
      ...env,
      APP_MODE: 'production',
      CHAT_MODEL: 'google/gemini-3.5-flash-lite',
      AI_GATEWAY_ID: 'fixture',
      AI: { gateway: () => ({ run }) } as unknown as typeof env.AI,
    };
    const reply = await checkoutReply(
      {
        env: e,
        workspaceId: 'fixture',
        conversationId: 'fixture',
        sourceText: 'Mirpur, Dhaka',
        sourceMessageIds: [],
      },
      draft,
      'banglish',
      'Abid',
      ['Dhakar vitore', 'Dhakar baire'],
      ['deliveryAddress'],
    );
    expect(reply.text).toContain('Dhakar vitore');
    expect(reply.text).not.toContain('confirmed');
    expect(reply.metadata.nextField).toBe('COLLECTING_DELIVERY_AREA');
    if (proposed?.startsWith('Address-ta')) expect(reply.text).toBe(proposed);
  }
});
