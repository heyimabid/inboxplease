import { and, eq, desc } from 'drizzle-orm';
import { database } from '../db/client';
import { orders } from '../db/schema';
import { getDraft, type OrderContext } from '../services/orders';
import { style, type Language } from './language-style';
import type { GeneratedReply } from './orchestrator';

export async function orderStatusReply(
  ctx: OrderContext,
  language: Language,
): Promise<GeneratedReply> {
  const order = await database(ctx.env)
    .select()
    .from(orders)
    .where(
      and(eq(orders.workspaceId, ctx.workspaceId), eq(orders.conversationId, ctx.conversationId)),
    )
    .orderBy(desc(orders.confirmedAt))
    .get();
  const draft = await getDraft(ctx);
  const text = order
    ? style(language, {
        english: `Your order ${order.orderNumber} is ${order.status}.${draft && !['CONFIRMED', 'CANCELLED'].includes(draft.state) ? ' You also have a separate unfinished order draft.' : ''}`,
        bangla: `আপনার অর্ডার ${order.orderNumber}-এর বর্তমান অবস্থা: ${order.status}।${draft && !['CONFIRMED', 'CANCELLED'].includes(draft.state) ? ' এছাড়া একটি অসম্পূর্ণ অর্ডারের খসড়া আছে।' : ''}`,
        banglish: `Apnar order ${order.orderNumber}-er current status: ${order.status}.${draft && !['CONFIRMED', 'CANCELLED'].includes(draft.state) ? ' Alada ekta unfinished order draft-o ache.' : ''}`,
      })
    : style(language, {
        english: draft
          ? 'Your order has not been placed yet. Your details are saved in the draft; we still need to finish reviewing and confirming it.'
          : 'There isn’t a placed order in this conversation yet.',
        bangla: draft
          ? 'অর্ডারটি এখনো করা হয়নি। আপনার তথ্য খসড়ায় রাখা আছে; বিবরণ দেখে নিশ্চিত করা বাকি।'
          : 'এই কথোপকথনে এখনো কোনো অর্ডার করা হয়নি।',
        banglish: draft
          ? 'Order-ta ekhono place hoyni. Apnar details draft-e save ache; details dekhe confirm kora baki.'
          : 'Ei conversation-e ekhono kono order place hoyni.',
      });
  return {
    text,
    language,
    productIds: [],
    metadata: { tool: 'order_status', status: order?.status ?? 'draft' },
  };
}
