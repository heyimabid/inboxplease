import { z } from 'zod';
export const normalizedEventSchema = z.object({
  eventId: z.string().min(1),
  pageId: z.string().min(1),
  senderPsid: z.string().min(1),
  timestamp: z.number().int().nonnegative(),
  messageId: z.string().optional(),
  type: z.enum(['text', 'image', 'audio', 'attachment', 'postback']),
  text: z.string().max(10000).optional(),
  attachments: z
    .array(z.object({ type: z.string(), url: z.url().optional() }))
    .max(10)
    .optional(),
  postbackPayload: z.string().max(1000).optional(),
});
export type NormalizedMessengerEvent = z.infer<typeof normalizedEventSchema>;
export const pageSchema = z.object({
  id: z.string(),
  name: z.string(),
  access_token: z.string(),
  tasks: z.array(z.string()).optional(),
});
export type AvailablePage = z.infer<typeof pageSchema>;
export type OutgoingMessage =
  | { text: string }
  | { attachment: { type: 'image'; payload: { url: string; is_reusable: false } } };
export interface MetaClient {
  customerProfile(
    psid: string,
    token: string,
  ): Promise<{ name: string | null; picture: string | null }>;
  exchangeCode(code: string): Promise<string>;
  identity(token: string): Promise<{ id: string; name: string; email?: string }>;
  permissions(token: string): Promise<string[]>;
  availablePages(userToken: string): Promise<AvailablePage[]>;
  subscribe(pageId: string, token: string): Promise<void>;
  disconnect(pageId: string, token: string): Promise<void>;
  test(pageId: string, token: string): Promise<boolean>;
  send(
    pageId: string,
    psid: string,
    token: string,
    message: OutgoingMessage,
    deliveryId: string,
  ): Promise<{ messageId: string }>;
  showTypingIndicator(pageId: string, psid: string, token: string): Promise<void>;
  markSeen(pageId: string, psid: string, token: string): Promise<void>;
}
