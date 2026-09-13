import { shoppingQuestion } from './conversation-routing';
import { checkoutReply } from './checkout-reply';
import { conversationContext } from '../repositories/conversations';
import { currentOrderFields } from './order-fields';
import { and, eq, desc } from 'drizzle-orm';
import { z } from 'zod';
import { database } from '../db/client';
import { deliveryZones, messages, orderDrafts } from '../db/schema';
import type { CustomerIntent } from './schemas';
import type { GeneratedReply } from './orchestrator';
import { style, type Language } from './language-style';
import {
  getDraft,
  consentedProfileName,
  startDraft,
  updateDraft,
  addItem,
  reviewDraft,
  confirmDraft,
  cancelDraft,
  removeItem,
  type OrderContext,
} from '../services/orders';
import { explicitConfirmation, nextOrderState } from '../services/order-state-machine';
import { searchProducts } from './product-retrieval';
import { canonicalCandidates } from '../repositories/products';
import { AppError } from '../shared/errors';
export async function orderFlow(
  ctx: OrderContext,
  intent: CustomerIntent,
  language: Language,
): Promise<GeneratedReply | null> {
  if (shoppingQuestion(ctx.sourceText, intent.intent)) return null;
  let draft = await getDraft(ctx);
  const orderIntent = [
    'order_start',
    'order_information',
    'order_confirmation',
    'order_cancellation',
  ].includes(intent.intent);
  if (!orderIntent && (!draft || ['CONFIRMED', 'CANCELLED'].includes(draft.state))) return null;
  const reply = (text: string): GeneratedReply => ({
    text,
    language,
    productIds: [],
    metadata: { tool: 'order_draft' },
  });
  try {
    const profileName = await consentedProfileName(ctx);
    if (explicitConfirmation(ctx.sourceText) && !profileName) {
      const order = await confirmDraft(ctx);
      return reply(
        style(language, {
          english: `Order ${order.orderNumber} is confirmed. Thank you!`,
          bangla: `আপনার অর্ডার ${order.orderNumber} নিশ্চিত হয়েছে। ধন্যবাদ!`,
          banglish: `Apnar order ${order.orderNumber} confirm hoyeche. Thank you!`,
        }),
      );
    }
    const changing =
      (/change|পরিবর্তন|বদল/i.test(ctx.sourceText) &&
        !/phone|number|name|address|নাম|নম্বর|ঠিকানা/i.test(ctx.sourceText)) ||
      intent.intent === 'order_cancellation';
    if (changing && draft && !['CONFIRMED', 'CANCELLED'].includes(draft.state)) {
      if (/cancel|বাতিল/i.test(ctx.sourceText)) {
        await cancelDraft(ctx);
        return reply(
          style(language, {
            english: 'Your order draft has been cancelled.',
            bangla: 'আপনার অর্ডারের খসড়া বাতিল হয়েছে।',
            banglish: 'Apnar order draft cancel hoyeche.',
          }),
        );
      }
      if (draft.items.length > 1)
        return reply('Please ask the seller to help edit an order with multiple items.');
      const prior = draft.items[0];
      if (prior) {
        await database(ctx.env)
          .update(orderDrafts)
          .set({
            selectionJson: JSON.stringify({ productId: prior.productId, quantity: prior.quantity }),
          })
          .where(and(eq(orderDrafts.workspaceId, ctx.workspaceId), eq(orderDrafts.id, draft.id)));
        draft = await removeItem(ctx, prior.variantId);
      }
      if (
        !intent.extractedOrderFields.color &&
        !intent.extractedOrderFields.size &&
        !intent.extractedOrderFields.quantity
      )
        return reply(
          style(language, {
            english:
              'Which product, color, or size would you like to change? Please specify the new variant.',
            bangla: 'কোন পণ্য, রং বা সাইজ বদলাতে চান? নতুন ভ্যারিয়েন্টটি বলুন।',
            banglish: 'Kon product, color ba size change korben? New variant-ta bolun.',
          }),
        );
    }
    if (
      !draft ||
      draft.state === 'CANCELLED' ||
      (draft.state === 'CONFIRMED' && intent.intent === 'order_start')
    )
      draft = await startDraft(ctx);
    if (draft.state === 'CONFIRMED')
      return reply('This order is already confirmed. Please ask the seller to help with changes.');
    const fields = currentOrderFields(
      ctx.sourceText,
      intent.extractedOrderFields,
      nextOrderState(draft),
    );
    const customer = (await conversationContext(ctx.env, ctx.workspaceId, ctx.conversationId))
      .customer;
    if (profileName) fields.customerName = profileName;
    const zones = await database(ctx.env)
      .select()
      .from(deliveryZones)
      .where(
        and(
          eq(deliveryZones.workspaceId, ctx.workspaceId),
          eq(deliveryZones.isActive, true),
          eq(deliveryZones.currency, draft.currency),
        ),
      );
    const selection = z
      .object({
        productId: z.string().optional(),
        variantId: z.string().optional(),
        quantity: z.number().optional(),
      })
      .parse(JSON.parse(draft.selectionJson ?? '{}'));
    const plainQuantity =
      /^[০-৯0-9]{1,3}$/.test(ctx.sourceText.trim()) && selection.productId
        ? Number(ctx.sourceText.trim().replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d))))
        : null;
    const quantity = fields.quantity ?? plainQuantity ?? selection.quantity ?? null;
    const patch: Record<string, string> = {};
    if (fields.customerName) patch.customerName = fields.customerName;
    if (fields.phone) patch.phone = fields.phone;
    if (fields.address) patch.deliveryAddress = fields.address;
    // An inferred city is not a configured delivery zone. Keep a valid address even
    // when the model proposes a zone the store does not support.
    const zone = zones.find((z) => ctx.sourceText.toLowerCase().includes(z.name.toLowerCase()));
    if (zone) patch.deliveryArea = zone.name;
    if (Object.keys(patch).length) draft = await updateDraft(ctx, patch);
    if (draft.items.length === 1 && fields.quantity !== null && !changing)
      draft = await addItem(ctx, draft.items[0]!.variantId, fields.quantity);
    if (!draft.items.length || changing) {
      let candidates = await searchProducts(
        ctx.env,
        ctx.workspaceId,
        intent.normalizedQuery ?? ctx.sourceText,
        { size: fields.size ?? undefined, color: fields.color ?? undefined },
      );
      if (!candidates.length && selection.productId)
        candidates = await canonicalCandidates(ctx.env, ctx.workspaceId, [selection.productId]);
      if (!candidates.length) {
        const last = await database(ctx.env)
          .select()
          .from(messages)
          .where(
            and(
              eq(messages.workspaceId, ctx.workspaceId),
              eq(messages.conversationId, ctx.conversationId),
              eq(messages.direction, 'outbound'),
            ),
          )
          .orderBy(desc(messages.createdAt))
          .limit(5);
        for (const m of last) {
          try {
            const metadata = z
              .object({ productIds: z.string() })
              .parse(JSON.parse(m.aiMetadataJson ?? '{}'));
            candidates = await canonicalCandidates(
              ctx.env,
              ctx.workspaceId,
              z.array(z.string()).parse(JSON.parse(metadata.productIds)),
            );
            if (candidates.length) break;
          } catch {
            /* A non-catalog message has no product references. */
          }
        }
      }
      if (candidates.length !== 1)
        return reply(
          style(language, {
            english: 'Which product would you like to order? Please share its name or SKU.',
            bangla: 'কোন পণ্যটি অর্ডার করবেন? নাম বা SKU বলুন।',
            banglish: 'Kon product-ta order korben? Name ba SKU bolun.',
          }),
        );
      const p = candidates[0]!;
      await database(ctx.env)
        .update(orderDrafts)
        .set({
          selectionJson: JSON.stringify({
            ...selection,
            productId: p.id,
            quantity: quantity ?? undefined,
          }),
        })
        .where(and(eq(orderDrafts.workspaceId, ctx.workspaceId), eq(orderDrafts.id, draft.id)));
      const possible = p.variants.filter(
        (v) =>
          v.status === 'active' &&
          (!selection.variantId || fields.size || fields.color || v.id === selection.variantId) &&
          (!fields.size || v.size?.toLowerCase() === fields.size.toLowerCase()) &&
          (!fields.color || v.color?.toLowerCase() === fields.color.toLowerCase()),
      );
      if (!possible.length)
        return reply(
          style(language, {
            english: `${p.name} is in the catalog, but the seller needs to confirm stock and configure an orderable option before I can take an order.`,
            bangla: `${p.name} ক্যাটালগে আছে, তবে অর্ডার নেওয়ার আগে বিক্রেতাকে স্টক ও অর্ডারের অপশন নিশ্চিত করতে হবে।`,
            banglish: `${p.name} catalog-e ache, kintu order newar age seller-ke stock ar order-er option confirm korte hobe.`,
          }),
        );
      if (possible.length !== 1)
        return reply(
          style(language, {
            english: `Which variant of ${p.name}? Available choices: ${possible.map((v) => v.title).join(', ') || 'none currently'}.`,
            bangla: `${p.name}-এর কোন ভ্যারিয়েন্টটি চান? ${possible.map((v) => v.title).join(', ')}`,
            banglish: `${p.name}-er kon variant-ta chan? ${possible.map((v) => v.title).join(', ')}`,
          }),
        );
      await database(ctx.env)
        .update(orderDrafts)
        .set({
          selectionJson: JSON.stringify({
            productId: p.id,
            variantId: possible[0]!.id,
            quantity: quantity ?? undefined,
          }),
        })
        .where(and(eq(orderDrafts.workspaceId, ctx.workspaceId), eq(orderDrafts.id, draft.id)));
      if (quantity === null)
        return reply(
          style(language, {
            english: `How many ${p.name} (${possible[0]!.title}) would you like? Reply “quantity 1”, for example.`,
            bangla: `${p.name} (${possible[0]!.title}) কয়টি চান? যেমন “quantity 1” লিখুন।`,
            banglish: `${p.name} (${possible[0]!.title}) koyta niben? Example: “quantity 1”.`,
          }),
        );
      draft = await addItem(ctx, possible[0]!.id, quantity);
    }
    const state = nextOrderState(draft);
    if (state === 'REVIEWING') return reviewDraft(ctx, language);
    return checkoutReply(
      ctx,
      draft,
      language,
      customer.facebookName,
      zones.map((z) => z.name),
      Object.keys(patch),
    );
  } catch (e) {
    if (e instanceof AppError) {
      if (e.code === 'ORDER_CHANGED') {
        try {
          return await reviewDraft(ctx, language);
        } catch {
          /* The next customer action must repair missing stock or delivery data. */
        }
      }
      if (['OUT_OF_STOCK', 'DELIVERY_UNAVAILABLE'].includes(e.code) && draft) {
        if (e.code === 'OUT_OF_STOCK') {
          for (const item of draft.items) await removeItem(ctx, item.variantId);
          await database(ctx.env)
            .update(orderDrafts)
            .set({ selectionJson: '{}' })
            .where(and(eq(orderDrafts.workspaceId, ctx.workspaceId), eq(orderDrafts.id, draft.id)));
        }
      }
      return reply(e.message);
    }
    throw e;
  }
}
