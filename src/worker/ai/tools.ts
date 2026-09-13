import { z } from 'zod';
import { and, eq, isNull } from 'drizzle-orm';
import { database } from '../db/client';
import { faqs, deliveryZones, variants } from '../db/schema';
import { conversationContext } from '../repositories/conversations';
import { getProduct } from '../repositories/products';
import { required } from '../shared/errors';
import { searchProducts } from './product-retrieval';
import {
  startDraft,
  updateDraft,
  addItem,
  removeItem,
  calculateDraft,
  reviewDraft,
  confirmDraft,
  cancelDraft,
  type OrderContext,
} from '../services/orders';
import { draftFieldsSchema } from '../services/order-state-machine';
import { handoff } from '../services/handoff';
const id = z.string().min(1).max(160);
export const toolRequestSchema = z.discriminatedUnion('name', [
  z.object({ name: z.literal('search_products'), query: z.string().max(500) }).strict(),
  z.object({ name: z.literal('get_product_details'), productId: id }).strict(),
  z.object({ name: z.literal('get_product_variants'), productId: id }).strict(),
  z.object({ name: z.literal('check_variant_stock'), variantId: id }).strict(),
  z.object({ name: z.literal('get_store_policy') }).strict(),
  z.object({ name: z.literal('get_delivery_options') }).strict(),
  z.object({ name: z.literal('start_order_draft') }).strict(),
  z.object({ name: z.literal('update_order_draft'), fields: draftFieldsSchema }).strict(),
  z
    .object({
      name: z.literal('add_order_item'),
      variantId: id,
      quantity: z.number().int().min(1).max(100),
    })
    .strict(),
  z.object({ name: z.literal('remove_order_item'), variantId: id }).strict(),
  z.object({ name: z.literal('calculate_order_total') }).strict(),
  z
    .object({
      name: z.literal('request_order_confirmation'),
      language: z.enum(['bangla', 'banglish', 'english', 'mixed', 'unknown']),
    })
    .strict(),
  z.object({ name: z.literal('confirm_order') }).strict(),
  z.object({ name: z.literal('cancel_order') }).strict(),
  z.object({ name: z.literal('request_human_handoff'), reason: z.string().max(100) }).strict(),
]);
export async function executeTool(ctx: OrderContext, input: unknown) {
  const request = toolRequestSchema.parse(input);
  await conversationContext(ctx.env, ctx.workspaceId, ctx.conversationId);
  const db = database(ctx.env);
  switch (request.name) {
    case 'search_products':
      return searchProducts(ctx.env, ctx.workspaceId, request.query);
    case 'get_product_details':
      return getProduct(ctx.env, ctx.workspaceId, request.productId, true);
    case 'get_product_variants':
      return (await getProduct(ctx.env, ctx.workspaceId, request.productId, true)).variants;
    case 'check_variant_stock': {
      const variant = required(
        await db
          .select()
          .from(variants)
          .where(and(eq(variants.workspaceId, ctx.workspaceId), eq(variants.id, request.variantId)))
          .get(),
      );
      await getProduct(ctx.env, ctx.workspaceId, variant.productId, true);
      return {
        variantId: variant.id,
        available: variant.status === 'active' ? variant.stockOnHand - variant.reservedStock : 0,
      };
    }
    case 'get_store_policy':
      return db
        .select()
        .from(faqs)
        .where(
          and(
            eq(faqs.workspaceId, ctx.workspaceId),
            isNull(faqs.productId),
            eq(faqs.isActive, true),
          ),
        );
    case 'get_delivery_options':
      return db
        .select()
        .from(deliveryZones)
        .where(
          and(eq(deliveryZones.workspaceId, ctx.workspaceId), eq(deliveryZones.isActive, true)),
        );
    case 'start_order_draft':
      return startDraft(ctx);
    case 'update_order_draft':
      return updateDraft(ctx, request.fields);
    case 'add_order_item':
      return addItem(ctx, request.variantId, request.quantity);
    case 'remove_order_item':
      return removeItem(ctx, request.variantId);
    case 'calculate_order_total':
      return calculateDraft(ctx);
    case 'request_order_confirmation':
      return reviewDraft(ctx, request.language);
    case 'confirm_order':
      return confirmDraft(ctx);
    case 'cancel_order':
      return cancelDraft(ctx);
    case 'request_human_handoff':
      await handoff(ctx.env, ctx.workspaceId, ctx.conversationId, request.reason);
      return { mode: 'human' };
  }
}
