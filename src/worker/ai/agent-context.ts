import { and, eq, desc, ne, notInArray } from 'drizzle-orm';
import { database } from '../db/client';
import { conversationContext } from '../repositories/conversations';
import { messages, orders, settings, workspaces } from '../db/schema';
import { getDraft, type OrderContext } from '../services/orders';
import { formatMoney, type Language } from './language-style';
export async function agentContext(ctx: OrderContext, imageIds: string[]) {
  const db = database(ctx.env),
    c = await conversationContext(ctx.env, ctx.workspaceId, ctx.conversationId);
  const [draft, store, config, history, placed] = await Promise.all([
    getDraft(ctx),
    db.select().from(workspaces).where(eq(workspaces.id, ctx.workspaceId)).get(),
    db.select().from(settings).where(eq(settings.workspaceId, ctx.workspaceId)).get(),
    db
      .select({
        id: messages.id,
        text: messages.text,
        sender: messages.senderType,
        metadata: messages.aiMetadataJson,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(
        and(
          eq(messages.workspaceId, ctx.workspaceId),
          eq(messages.conversationId, ctx.conversationId),
          ne(messages.deliveryStatus, 'failed'),
          ...(ctx.sourceMessageIds.length ? [notInArray(messages.id, ctx.sourceMessageIds)] : []),
        ),
      )
      .orderBy(desc(messages.createdAt))
      .limit(20),
    db
      .select()
      .from(orders)
      .where(
        and(eq(orders.workspaceId, ctx.workspaceId), eq(orders.conversationId, ctx.conversationId)),
      )
      .orderBy(desc(orders.confirmedAt))
      .limit(3),
  ]);
  const summaries = await db
    .select({ text: messages.text, metadata: messages.aiMetadataJson })
    .from(messages)
    .where(
      and(
        eq(messages.workspaceId, ctx.workspaceId),
        eq(messages.conversationId, ctx.conversationId),
        eq(messages.direction, 'outbound'),
        eq(messages.deliveryStatus, 'sent'),
      ),
    )
    .orderBy(desc(messages.createdAt))
    .limit(10);
  let latestReview: { reviewHash: string; draftId: string; text: string | null } | null = null;
  for (const m of summaries) {
    try {
      const v = JSON.parse(m.metadata ?? '{}');
      if (
        v.tool === 'request_order_confirmation' &&
        v.reviewHash === draft?.reviewHash &&
        v.draftId === draft?.id
      ) {
        latestReview = { reviewHash: v.reviewHash, draftId: v.draftId, text: m.text };
        break;
      }
    } catch {
      /* Unrelated metadata. */
    }
  }
  const historyProducts = new Set<string>();
  const transcript = history.reverse().map((m) => {
    try {
      const v = JSON.parse(m.metadata ?? '{}');
      for (const id of JSON.parse(v.productIds ?? '[]'))
        if (typeof id === 'string') historyProducts.add(id);
    } catch {
      /* Non-product turn. */
    }
    return { speaker: m.sender, text: m.text?.slice(0, 2000) ?? '[attachment]' };
  });
  return {
    context: c,
    config,
    promptContext: {
      store: {
        name: store?.name,
        currency: store?.currency,
        tone: config?.tone,
        responseStyle: config?.responseStyle,
        sellerDictionary: config?.normalizationJson,
        handoffRules: config?.handoffRules,
      },
      customer: {
        facebookName: c.customer.facebookName,
        preferredLanguage: c.customer.languagePreference,
      },
      draft: draft
        ? {
            id: draft.id,
            state: draft.state,
            revision: draft.revision,
            customerName: draft.customerName,
            phone: draft.phone,
            deliveryAddress: draft.deliveryAddress,
            deliveryArea: draft.deliveryArea,
            items: draft.items,
            selection: JSON.parse(draft.selectionJson ?? '{}'),
          }
        : null,
      recentOrders: placed.map((o) => ({
        orderNumber: o.orderNumber,
        status: o.status,
        total: formatMoney(o.total, o.currency, 'english'),
        deliveryAddress: o.deliveryAddress,
      })),
      latestSentReview: latestReview,
      previousProductIds: [...historyProducts].slice(-8),
      history: transcript,
      currentMessage: { text: ctx.sourceText, imageIds },
    },
  };
}
export function defaultAgentLanguage(value: string | null | undefined): Language {
  return ['english', 'bangla', 'banglish', 'mixed'].includes(value ?? '')
    ? (value as Language)
    : 'unknown';
}
