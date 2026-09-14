import { it, expect, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { and, eq } from 'drizzle-orm';
import { createStore } from '../fixtures/store';
import { database } from '../../src/worker/db/client';
import { customers, messages, orders, variants, deliveryZones } from '../../src/worker/db/schema';
import { persistEvent } from '../../src/worker/routes/webhooks-meta';
import { ingestEvent } from '../../src/worker/repositories/conversations';
import { runGeminiAgent } from '../../src/worker/ai/orchestrator';
import {
  getDraft,
  startDraft,
  addItem,
  updateDraft,
  reviewDraft,
  type OrderContext,
} from '../../src/worker/services/orders';
import { executeAgentTool, type AgentToolState } from '../../src/worker/ai/agent-tools';

function modelSteps(steps: { name: string; args: Record<string, unknown> }[], approved = false) {
  const pending = [...steps];
  const run = vi
    .fn()
    .mockImplementation(
      async (request: {
        query: {
          generationConfig?: { responseJsonSchema?: { properties?: Record<string, unknown> } };
        };
      }) => {
        const properties = request.query.generationConfig?.responseJsonSchema?.properties;
        if (properties)
          return Response.json({
            candidates: [
              {
                finishReason: 'STOP',
                content: {
                  parts: [
                    {
                      text: JSON.stringify(
                        'approved' in properties ? { approved } : { safe: true, problem: '' },
                      ),
                    },
                  ],
                },
              },
            ],
          });
        const call = pending.shift();
        if (!call) throw new Error('Unexpected extra model step');
        return Response.json({
          candidates: [
            {
              finishReason: 'STOP',
              content: {
                role: 'model',
                parts: [
                  {
                    thoughtSignature: 'opaque-test-signature',
                    functionCall: { ...call, id: 'call-' + pending.length },
                  },
                ],
              },
            },
          ],
        });
      },
    );
  return {
    ...env,
    APP_MODE: 'production',
    CHAT_MODEL: 'google/gemini-3.5-flash-lite',
    AI_GATEWAY_ID: 'fixture',
    AI: { gateway: () => ({ run }) } as unknown as typeof env.AI,
    run,
  };
}
async function fixture(text: string) {
  const s = await createStore(),
    eventId = crypto.randomUUID();
  await persistEvent(env, {
    eventId,
    pageId: s.page,
    senderPsid: eventId,
    timestamp: Date.now(),
    type: 'text',
    text,
  });
  const event = (await ingestEvent(env, eventId))!;
  const ctx: OrderContext = {
    env,
    workspaceId: s.w,
    conversationId: event.conversationId,
    sourceText: text,
    sourceMessageIds: [eventId],
  };
  await database(env)
    .update(customers)
    .set({ facebookName: 'Abid Hasan' })
    .where(eq(customers.id, event.customerId));
  await startDraft(ctx);
  await addItem(ctx, s.variant, 1);
  return { s, ctx };
}
const finish = (text = 'Here is the answer.', language = 'english') => ({
  name: 'respond_to_customer',
  args: { text, language, referencedProductIds: [], meaningfulLanguageEvidence: false },
});
function state(): AgentToolState {
  return {
    imageIds: [],
    knownProducts: new Set(),
    imageProducts: new Set(),
    photoProducts: new Set(),
    facts: [],
  };
}
it('lets Gemini choose browsing during checkout, retaining signatures and feeding actual tool results back', async () => {
  const { ctx, s } = await fixture('ektu onno kichu dekhi age');
  const before = await getDraft(ctx);
  const e = modelSteps([
    { name: 'browse_catalog', args: {} },
    finish('Amader Black hoodie ache.', 'banglish'),
  ]);
  const reply = await runGeminiAgent(
    e,
    s.w,
    ctx.conversationId,
    ctx.sourceText,
    ctx.sourceMessageIds,
  );
  expect(reply?.text).toContain('Black hoodie');
  expect(reply?.metadata.agentVersion).toBe('tools-v1');
  expect(await getDraft(ctx)).toEqual(before);
  const second = e.run.mock.calls[1]![0];
  expect(second.query.contents[1].parts[0].thoughtSignature).toBe('opaque-test-signature');
  expect(second.query.contents[2].parts[0].functionResponse).toMatchObject({
    name: 'browse_catalog',
    id: 'call-1',
  });
  expect(JSON.stringify(second.query.contents[2])).toContain('Black hoodie');
  expect(JSON.stringify(e.run.mock.calls[0]![0])).not.toContain('encryptedPageAccessToken');
});
it('uses a configured zone ID selected by Gemini, accepts profile consent and saves valid fields despite an invalid phone', async () => {
  const text = 'amar namei den, number 1234, address 97 Asad Ave, Dhaka, ar shohorer moddhei';
  const { ctx, s } = await fixture(text);
  const zone = (await database(env)
    .select()
    .from(deliveryZones)
    .where(eq(deliveryZones.workspaceId, s.w))
    .get())!;
  const e = modelSteps([
    {
      name: 'update_order_draft',
      args: {
        evidenceQuote: text,
        fields: {
          useFacebookName: true,
          phone: '1234',
          deliveryAddress: '97 Asad Ave, Dhaka',
          deliveryZoneId: zone.id,
        },
      },
    },
    finish('Address-ta peyechi. Mobile number-ta abar diben?', 'banglish'),
  ]);
  await runGeminiAgent(e, s.w, ctx.conversationId, text, ctx.sourceMessageIds);
  const draft = await getDraft(ctx);
  expect(draft?.customerName).toBe('Abid Hasan');
  expect(draft?.deliveryArea).toBe(zone.name);
  expect(draft?.deliveryAddress).toBe('97 Asad Ave, Dhaka');
  expect(draft?.phone).toBeNull();
  expect(JSON.stringify(e.run.mock.calls[1]![0].query.contents)).toContain('fieldErrors');
});
it('rejects cross-workspace tool IDs, fabricated evidence and premature confirmation', async () => {
  const { ctx } = await fixture('ei address e pathaben'),
    other = await createStore();
  const e = modelSteps([]),
    c = { ...ctx, env: e };
  await expect(
    executeAgentTool(c, state(), { name: 'get_product_details', productId: other.product }),
  ).rejects.toThrow();
  await expect(
    executeAgentTool(c, state(), {
      name: 'add_order_item',
      variantId: other.variant,
      quantity: 1,
      evidenceQuote: ctx.sourceText,
    }),
  ).rejects.toThrow();
  await expect(
    executeAgentTool(c, state(), {
      name: 'update_order_draft',
      evidenceQuote: 'not in message',
      fields: { customerName: 'Fake Name' },
    }),
  ).rejects.toThrow();
  await expect(
    executeAgentTool(c, state(), {
      name: 'confirm_order',
      reviewHash: 'fake',
      language: 'english',
      evidenceQuote: ctx.sourceText,
    }),
  ).rejects.toThrow('summary');
  await expect(
    executeAgentTool(c, state(), { name: 'browse_catalog', workspaceId: other.w }),
  ).rejects.toThrow();
});
it('does not let a confirmation-status question place an order, but accepts semantic Banglish approval with sent-summary evidence', async () => {
  const { ctx, s } = await fixture('order');
  const prepared = {
    ...ctx,
    sourceText: 'Abid Hasan 01712345678 97 Asad Ave, Dhaka Dhakar vitore',
  };
  await updateDraft(prepared, {
    customerName: 'Abid Hasan',
    phone: '01712345678',
    deliveryAddress: '97 Asad Ave, Dhaka',
    deliveryArea: 'Dhakar vitore',
  });
  const review = await reviewDraft(prepared, 'banglish');
  await database(env)
    .insert(messages)
    .values({
      id: crypto.randomUUID(),
      workspaceId: s.w,
      conversationId: ctx.conversationId,
      direction: 'outbound',
      senderType: 'ai',
      messageType: 'text',
      text: review.text,
      aiMetadataJson: JSON.stringify(review.metadata),
      deliveryStatus: 'sent',
      createdAt: Date.now() - 100,
    });
  for (const approved of [false, true]) {
    const text = approved
      ? 'ji shob thik ase, ei order ta diye den'
      : 'amar order ta ki confirm hoilo?';
    const id = crypto.randomUUID();
    await database(env)
      .insert(messages)
      .values({
        id,
        workspaceId: s.w,
        conversationId: ctx.conversationId,
        direction: 'inbound',
        senderType: 'customer',
        messageType: 'text',
        text,
        createdAt: Date.now(),
      });
    const c = { ...ctx, env: modelSteps([], approved), sourceText: text, sourceMessageIds: [id] };
    const input = {
      name: 'confirm_order',
      language: 'banglish',
      reviewHash: review.reviewHash,
      evidenceQuote: text,
    };
    if (!approved)
      await expect(executeAgentTool(c, state(), input)).rejects.toThrow('unambiguously');
    else {
      await executeAgentTool(c, state(), input);
      await executeAgentTool(c, state(), input);
    }
    expect(
      await database(env).select().from(orders).where(eq(orders.workspaceId, s.w)),
    ).toHaveLength(approved ? 1 : 0);
  }
  expect(
    (
      await database(env)
        .select()
        .from(variants)
        .where(and(eq(variants.workspaceId, s.w), eq(variants.id, s.variant)))
        .get()
    )?.stockOnHand,
  ).toBe(4);
});
it('feeds invalid tool arguments back for recovery without losing the order', async () => {
  const { ctx, s } = await fixture('could you explain that?'),
    before = await getDraft(ctx);
  const e = modelSteps([
    { name: 'arbitrary_sql', args: { sql: 'DELETE FROM orders' } },
    finish('Of course, what would you like me to explain?'),
  ]);
  const reply = await runGeminiAgent(
    e,
    s.w,
    ctx.conversationId,
    ctx.sourceText,
    ctx.sourceMessageIds,
  );
  expect(reply?.text).toContain('explain');
  expect(await getDraft(ctx)).toEqual(before);
  expect(JSON.stringify(e.run.mock.calls[1]![0].query.contents)).toContain('INVALID_ARGUMENTS');
});
