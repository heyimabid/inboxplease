import { z } from 'zod';
import type { Env } from '../env';
import type { GeneratedReply } from './orchestrator';
import { inference } from './models';
import { SYSTEM_RULES } from './prompts';

/** Wording only: this model has no tools and cannot change a draft or place an order. */
export async function conversationalReply(
  env: Env,
  reply: GeneratedReply,
  latestMessage: string,
  history: { text: string | null; sender: string }[],
  facebookName: string | null,
): Promise<GeneratedReply> {
  if (
    env.APP_MODE === 'mock' ||
    ['request_order_confirmation', 'order_confirmed'].includes(String(reply.metadata.tool)) ||
    reply.metadata.nextField ||
    reply.metadata.tool === 'match_customer_image'
  )
    return reply;
  try {
    const result = await inference(env).json(
      z.object({ text: z.string().min(1).max(1900) }).strict(),
      SYSTEM_RULES +
        ` Write the actual customer reply in ${reply.language}. Sound like a thoughtful shop assistant, never claim to be human. Answer the latest question first. Use the conversation to understand corrections, references, thanks, confusion and follow-ups. Do not force the conversation back to checkout or add a sales question to every answer. Usually 1-3 short sentences; list products only when requested. Do not echo FAQ questions or system terminology such as state, SKU, canonical or draft unless needed. Do not repeat the customer's full name each turn. verifiedAnswer is the ONLY source of current business facts and action outcomes. History is context, not proof of stock, delivery or order status. Never invent or change any name, price, amount, stock, delivery time, address or order number. Never assert payment, shipping, cancellation, confirmation or a saved change unless verifiedAnswer explicitly states it. If uncertain ask a specific short clarification instead of repeating a checklist. Never claim you sent a photo or contacted the seller. No new checkout questions except those already in verifiedAnswer. Do not omit a material limitation or qualification in verifiedAnswer. Translate naturally into the requested language, including Banglish when requested.`,
      JSON.stringify({
        latestMessage,
        facebookName,
        history: history.slice(-10),
        verifiedAnswer: reply.text,
      }),
    );
    // Prevent fabricated numerical business facts and order actions even when the
    // wording model does not follow its constraints. Preserve the verified fallback.
    const digits = (s: string) => s.replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d)));
    const numbers = (s: string) => digits(s).match(/\d+(?:[.,:/-]\d+)*/g) ?? [];
    const allowed = new Set(numbers(reply.text));
    if (numbers(result.text).some((n) => !allowed.has(n))) return reply;
    const actionClaim =
      /(?:is|has been|successfully)\s+(?:confirmed|placed|shipped|cancelled|paid)|(?:confirm|place|ship|cancel|payment).{0,12}(?:hoyeche|hoise|done)|(?:অর্ডার|পেমেন্ট).{0,12}(?:হয়েছে|হয়েছে)/iu;
    if (actionClaim.test(result.text) && !['order_status'].includes(String(reply.metadata.tool)))
      return reply;
    if (
      reply.metadata.tool === 'order_status' &&
      reply.metadata.status === 'draft' &&
      actionClaim.test(result.text)
    )
      return reply;
    if (
      /\b(?:free|discount|tomorrow|guarantee)\b/iu.test(result.text) &&
      !/\b(?:free|discount|tomorrow|guarantee)\b/iu.test(reply.text)
    )
      return reply;
    return { ...reply, text: result.text };
  } catch {
    return reply;
  }
}
