import { z } from 'zod';
import { sha256 } from '../services/encryption';
import { normalizedEventSchema, type NormalizedMessengerEvent } from './types';
const entrySchema = z.object({
  id: z.string(),
  messaging: z
    .array(
      z.object({
        sender: z.object({ id: z.string() }),
        recipient: z.object({ id: z.string() }),
        timestamp: z.number().int().nonnegative(),
        message: z
          .object({
            mid: z.string(),
            text: z.string().optional(),
            is_echo: z.boolean().optional(),
            attachments: z
              .array(
                z.object({
                  type: z.string(),
                  payload: z.object({ url: z.url().optional() }).optional(),
                }),
              )
              .optional(),
          })
          .optional(),
        postback: z
          .object({ mid: z.string().optional(), title: z.string().optional(), payload: z.string() })
          .optional(),
      }),
    )
    .default([]),
});
export async function parseWebhook(input: unknown) {
  const envelope = z
    .object({ object: z.string(), entry: z.array(z.unknown()).max(100) })
    .parse(input);
  if (envelope.object !== 'page') return [];
  const normalized: NormalizedMessengerEvent[] = [];
  for (const raw of envelope.entry) {
    const entry = entrySchema.safeParse(raw);
    if (!entry.success) continue;
    for (const e of entry.data.messaging) {
      if (
        e.recipient.id !== entry.data.id ||
        e.sender.id === entry.data.id ||
        e.message?.is_echo ||
        (!e.message && !e.postback)
      )
        continue;
      const attachments = e.message?.attachments?.map((a) => ({
        type: a.type,
        url: a.payload?.url,
      }));
      const type = e.postback
        ? 'postback'
        : attachments?.some((a) => a.type === 'image')
          ? 'image'
          : attachments?.some((a) => a.type === 'audio')
            ? 'audio'
            : attachments?.length
              ? 'attachment'
              : 'text';
      const mid = e.message?.mid ?? e.postback?.mid;
      const eventId = await sha256(
        `${entry.data.id}:${e.sender.id}:${mid ?? `${e.timestamp}:${e.postback?.payload}`}`,
      );
      normalized.push(
        normalizedEventSchema.parse({
          eventId,
          pageId: entry.data.id,
          senderPsid: e.sender.id,
          timestamp: e.timestamp,
          messageId: mid,
          type,
          text: e.message?.text ?? e.postback?.title,
          attachments,
          postbackPayload: e.postback?.payload,
        }),
      );
    }
  }
  return normalized;
}
