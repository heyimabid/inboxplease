import { and, eq, desc, sql } from 'drizzle-orm';
import type { Env } from '../env';
import { database } from '../db/client';
import {
  orderDrafts,
  draftItems,
  orders,
  orderItems,
  variants,
  deliveryZones,
  conversations,
  messages,
  customers,
  workspaces,
} from '../db/schema';
import { conversationContext } from '../repositories/conversations';
import { getProduct } from '../repositories/products';
import { AppError, required } from '../shared/errors';
import { sha256 } from './encryption';
import {
  calculateMoney,
  draftFieldsSchema,
  normalizePhone,
  nextOrderState,
  explicitConfirmation,
  latinDigits,
} from './order-state-machine';
import { style, formatMoney, type Language } from '../ai/language-style';
import { log } from '../shared/logger';
import { touchProduct } from './product-indexer';
export type OrderContext = {
  env: Env;
  workspaceId: string;
  conversationId: string;
  sourceText: string;
  sourceMessageIds: string[];
};
export async function getDraft(ctx: OrderContext) {
  const db = database(ctx.env),
    w = ctx.workspaceId;
  const draft = await db
    .select()
    .from(orderDrafts)
    .where(and(eq(orderDrafts.workspaceId, w), eq(orderDrafts.conversationId, ctx.conversationId)))
    .get();
  if (!draft) return null;
  return {
    ...draft,
    items: await db
      .select()
      .from(draftItems)
      .where(and(eq(draftItems.workspaceId, w), eq(draftItems.orderDraftId, draft.id))),
  };
}
export async function startDraft(ctx: OrderContext) {
  const existing = await getDraft(ctx);
  if (existing && !['CONFIRMED', 'CANCELLED'].includes(existing.state)) return existing;
  const context = await conversationContext(ctx.env, ctx.workspaceId, ctx.conversationId);
  const db = database(ctx.env);
  if (existing)
    await db
      .delete(orderDrafts)
      .where(and(eq(orderDrafts.workspaceId, ctx.workspaceId), eq(orderDrafts.id, existing.id)));
  const store = required(
    await db.select().from(workspaces).where(eq(workspaces.id, ctx.workspaceId)).get(),
  );
  await db
    .insert(orderDrafts)
    .values({
      id: crypto.randomUUID(),
      workspaceId: ctx.workspaceId,
      conversationId: ctx.conversationId,
      customerId: context.customer.id,
      state: 'SELECTING_PRODUCT',
      currency: store.currency,
      lastUpdatedAt: Date.now(),
    })
    .onConflictDoNothing();
  return required(await getDraft(ctx));
}
async function invalidate(ctx: OrderContext) {
  const draft = required(await getDraft(ctx));
  const state = nextOrderState(draft);
  await database(ctx.env).batch([
    database(ctx.env)
      .update(orderDrafts)
      .set({
        state,
        reviewHash: null,
        subtotal: null,
        deliveryFee: null,
        total: null,
        revision: sql`${orderDrafts.revision}+1`,
        lastUpdatedAt: Date.now(),
      })
      .where(and(eq(orderDrafts.workspaceId, ctx.workspaceId), eq(orderDrafts.id, draft.id))),
    database(ctx.env)
      .update(conversations)
      .set({ orderState: state, updatedAt: Date.now() })
      .where(
        and(
          eq(conversations.workspaceId, ctx.workspaceId),
          eq(conversations.id, ctx.conversationId),
        ),
      ),
  ]);
  return required(await getDraft(ctx));
}
function editable(state: string) {
  if (['CONFIRMED', 'CANCELLED'].includes(state))
    throw new AppError('ORDER_TERMINAL', 'Start a new order before making changes', 409);
}
export async function updateDraft(ctx: OrderContext, input: unknown) {
  const fields = draftFieldsSchema.parse(input);
  const draft = required(await getDraft(ctx));
  editable(draft.state);
  const patch: Partial<typeof orderDrafts.$inferInsert> = {};
  const source = latinDigits(ctx.sourceText).toLowerCase();
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (key === 'phone') {
      const phone = normalizePhone(value);
      if (!source.replace(/[^\d]/g, '').includes(phone.replace(/\D/g, '').slice(-11)))
        throw new AppError('UNVERIFIED_FIELD', 'Please type your phone number again');
      patch.phone = phone;
      continue;
    }
    if (!source.includes(latinDigits(value).toLowerCase()))
      throw new AppError('UNVERIFIED_FIELD', 'Please type the order detail explicitly');
    if (key === 'customerName') patch.customerName = value;
    if (key === 'deliveryAddress') patch.deliveryAddress = value;
    if (key === 'deliveryArea') patch.deliveryArea = value;
    if (key === 'notes') patch.notes = value;
  }
  for (const key of ['customerName', 'phone', 'deliveryAddress', 'deliveryArea'] as const) {
    if (
      draft[key] &&
      patch[key] &&
      draft[key] !== patch[key] &&
      !/change|correct|instead|পরিবর্তন|সংশোধন|বদল/i.test(ctx.sourceText)
    )
      delete patch[key];
  }
  if (patch.deliveryArea) {
    const zone = await database(ctx.env)
      .select()
      .from(deliveryZones)
      .where(
        and(
          eq(deliveryZones.workspaceId, ctx.workspaceId),
          eq(deliveryZones.name, patch.deliveryArea),
          eq(deliveryZones.currency, draft.currency),
          eq(deliveryZones.isActive, true),
        ),
      )
      .get();
    if (!zone)
      throw new AppError(
        'DELIVERY_AREA_UNKNOWN',
        'Choose one of the store’s configured delivery areas',
      );
  }
  if (Object.keys(patch).length === 0) return draft;
  await database(ctx.env)
    .update(orderDrafts)
    .set(patch)
    .where(and(eq(orderDrafts.workspaceId, ctx.workspaceId), eq(orderDrafts.id, draft.id)));
  return invalidate(ctx);
}
export async function addItem(ctx: OrderContext, variantId: string, quantity: number) {
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100)
    throw new AppError('INVALID_QUANTITY', 'Choose a quantity from 1 to 100');
  const db = database(ctx.env),
    draft = required(await getDraft(ctx));
  editable(draft.state);
  const variant = required(
    await db
      .select()
      .from(variants)
      .where(
        and(
          eq(variants.workspaceId, ctx.workspaceId),
          eq(variants.id, variantId),
          eq(variants.status, 'active'),
        ),
      )
      .get(),
  );
  const product = await getProduct(ctx.env, ctx.workspaceId, variant.productId, true);
  if (variant.stockOnHand - variant.reservedStock < quantity)
    throw new AppError('OUT_OF_STOCK', 'That quantity is no longer available', 409);
  if (product.currency !== draft.currency)
    throw new AppError('CURRENCY_MISMATCH', 'Product currency differs from the order currency');
  await db
    .insert(draftItems)
    .values({
      id: `${draft.id}:${variantId}`,
      workspaceId: ctx.workspaceId,
      orderDraftId: draft.id,
      productId: product.id,
      variantId,
      quantity,
      unitPriceSnapshot: variant.priceOverride ?? product.basePrice,
    })
    .onConflictDoUpdate({
      target: [draftItems.workspaceId, draftItems.orderDraftId, draftItems.variantId],
      set: { quantity, unitPriceSnapshot: variant.priceOverride ?? product.basePrice },
    });
  return invalidate(ctx);
}
export async function removeItem(ctx: OrderContext, variantId: string) {
  const draft = required(await getDraft(ctx));
  editable(draft.state);
  await database(ctx.env)
    .delete(draftItems)
    .where(
      and(
        eq(draftItems.workspaceId, ctx.workspaceId),
        eq(draftItems.orderDraftId, draft.id),
        eq(draftItems.variantId, variantId),
      ),
    );
  return invalidate(ctx);
}
export async function calculateDraft(ctx: OrderContext) {
  const draft = required(await getDraft(ctx));
  if (nextOrderState(draft) !== 'REVIEWING')
    throw new AppError('ORDER_INCOMPLETE', 'Complete the customer and delivery details first', 409);
  const db = database(ctx.env);
  const rows = [];
  for (const item of draft.items) {
    const p = await getProduct(ctx.env, ctx.workspaceId, item.productId, true);
    const v = required(p.variants.find((v) => v.id === item.variantId && v.status === 'active'));
    if (v.stockOnHand - v.reservedStock < item.quantity)
      throw new AppError('OUT_OF_STOCK', 'Stock changed. Please choose an available variant.', 409);
    if (p.currency !== draft.currency)
      throw new AppError('CURRENCY_MISMATCH', 'Product currency changed', 409);
    rows.push({
      productId: p.id,
      variantId: v.id,
      productName: p.name,
      variantName: v.title,
      sku: v.sku,
      quantity: item.quantity,
      unitPrice: v.priceOverride ?? p.basePrice,
    });
  }
  const zone = required(
    await db
      .select()
      .from(deliveryZones)
      .where(
        and(
          eq(deliveryZones.workspaceId, ctx.workspaceId),
          eq(deliveryZones.name, draft.deliveryArea!),
          eq(deliveryZones.currency, draft.currency),
          eq(deliveryZones.isActive, true),
        ),
      )
      .get(),
    'DELIVERY_UNAVAILABLE',
    'The selected delivery option is unavailable',
  );
  const totals = calculateMoney(rows, zone.fee);
  const snapshot = {
    customerName: draft.customerName,
    phone: draft.phone,
    deliveryAddress: draft.deliveryAddress,
    deliveryArea: draft.deliveryArea,
    currency: draft.currency,
    notes: draft.notes,
    items: rows.sort((a, b) => a.variantId.localeCompare(b.variantId)),
    ...totals,
  };
  return { draft, snapshot, reviewHash: await sha256(JSON.stringify(snapshot)) };
}
export async function reviewDraft(ctx: OrderContext, language: Language) {
  const { draft, snapshot, reviewHash } = await calculateDraft(ctx);
  editable(draft.state);
  const db = database(ctx.env);
  await db.batch([
    db
      .update(orderDrafts)
      .set({
        ...calculateMoney(snapshot.items, snapshot.deliveryFee),
        state: 'AWAITING_CONFIRMATION',
        reviewHash,
        lastUpdatedAt: Date.now(),
      })
      .where(and(eq(orderDrafts.workspaceId, ctx.workspaceId), eq(orderDrafts.id, draft.id))),
    ...snapshot.items.map((i) =>
      db
        .update(draftItems)
        .set({ unitPriceSnapshot: i.unitPrice })
        .where(
          and(
            eq(draftItems.workspaceId, ctx.workspaceId),
            eq(draftItems.orderDraftId, draft.id),
            eq(draftItems.variantId, i.variantId),
          ),
        ),
    ),
    db
      .update(conversations)
      .set({ orderState: 'AWAITING_CONFIRMATION' })
      .where(
        and(
          eq(conversations.workspaceId, ctx.workspaceId),
          eq(conversations.id, ctx.conversationId),
        ),
      ),
  ]);
  const summary = [
    style(language, {
      english: 'Order summary',
      bangla: 'অর্ডারের বিবরণ',
      banglish: 'Order-er summary',
    }),
    ...snapshot.items.map(
      (i) =>
        `${i.productName} · ${i.variantName}\n${i.quantity} × ${formatMoney(i.unitPrice, snapshot.currency, language)} = ${formatMoney(i.quantity * i.unitPrice, snapshot.currency, language)}`,
    ),
    `Delivery: ${formatMoney(snapshot.deliveryFee, snapshot.currency, language)}\nTotal: ${formatMoney(snapshot.total, snapshot.currency, language)}`,
    `Name: ${snapshot.customerName}\nPhone: ${snapshot.phone}\nAddress: ${snapshot.deliveryAddress}\nArea: ${snapshot.deliveryArea}`,
    style(language, {
      english: 'Reply “Confirm” to place this order.',
      bangla: 'অর্ডারটি করতে “হ্যাঁ” বা “Confirm” লিখুন।',
      banglish: 'Order place korte “Confirm” reply korun.',
    }),
  ].join('\n\n');
  if (summary.length > 1900)
    throw new AppError(
      'SUMMARY_TOO_LONG',
      'This order needs a human to review the complete details',
      409,
    );
  return {
    text: summary,
    reviewHash,
    draftId: draft.id,
    language,
    productIds: [],
    metadata: { tool: 'request_order_confirmation', reviewHash, draftId: draft.id },
  };
}
export async function confirmDraft(ctx: OrderContext) {
  if (!explicitConfirmation(ctx.sourceText))
    throw new AppError('CONFIRMATION_REQUIRED', 'Please explicitly confirm the order summary', 409);
  const db = database(ctx.env),
    draft = required(await getDraft(ctx));
  const previous = await db
    .select()
    .from(orders)
    .where(and(eq(orders.workspaceId, ctx.workspaceId), eq(orders.idempotencyKey, draft.id)))
    .get();
  if (previous) return previous;
  if (draft.state !== 'AWAITING_CONFIRMATION' || !draft.reviewHash)
    throw new AppError('SUMMARY_REQUIRED', 'Review the complete order summary first', 409);
  const evidence = [];
  for (const id of ctx.sourceMessageIds) {
    const message = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.workspaceId, ctx.workspaceId),
          eq(messages.conversationId, ctx.conversationId),
          eq(messages.id, id),
          eq(messages.direction, 'inbound'),
        ),
      )
      .get();
    if (message) evidence.push(message);
  }
  if (!evidence.length || !evidence.some((m) => explicitConfirmation(m.text ?? '')))
    throw new AppError('CONFIRMATION_REQUIRED', 'Customer confirmation could not be verified', 409);
  const summary = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.workspaceId, ctx.workspaceId),
        eq(messages.conversationId, ctx.conversationId),
        eq(messages.deliveryStatus, 'sent'),
        sql`json_extract(${messages.aiMetadataJson},'$.reviewHash')=${draft.reviewHash}`,
        sql`json_extract(${messages.aiMetadataJson},'$.draftId')=${draft.id}`,
      ),
    )
    .orderBy(desc(messages.createdAt))
    .get();
  if (!summary || evidence.some((m) => m.createdAt <= summary.createdAt))
    throw new AppError(
      'SUMMARY_REQUIRED',
      'Please confirm after receiving the current order summary',
      409,
    );
  const current = await calculateDraft(ctx);
  if (current.reviewHash !== draft.reviewHash)
    throw new AppError(
      'ORDER_CHANGED',
      'Order details changed. Please review the updated summary before confirming.',
      409,
    );
  const id = await sha256(`order:${draft.id}`),
    now = Date.now(),
    number = `IP-${id.slice(0, 12).toUpperCase()}`;
  try {
    await db.batch([
      db
        .insert(orders)
        .values({
          id,
          workspaceId: ctx.workspaceId,
          conversationId: ctx.conversationId,
          customerId: draft.customerId,
          orderNumber: number,
          status: 'confirmed',
          customerName: current.snapshot.customerName!,
          phone: current.snapshot.phone!,
          deliveryAddress: current.snapshot.deliveryAddress!,
          deliveryArea: current.snapshot.deliveryArea!,
          currency: draft.currency,
          subtotal: current.snapshot.subtotal,
          deliveryFee: current.snapshot.deliveryFee,
          total: current.snapshot.total,
          notes: draft.notes,
          idempotencyKey: draft.id,
          confirmedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing(),
      ...current.snapshot.items.map((i) =>
        db
          .insert(orderItems)
          .values({
            id: `${id}:${i.variantId}`,
            workspaceId: ctx.workspaceId,
            orderId: id,
            productId: i.productId,
            variantId: i.variantId,
            productNameSnapshot: i.productName,
            variantNameSnapshot: i.variantName,
            skuSnapshot: i.sku,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            lineTotal: i.quantity * i.unitPrice,
          })
          .onConflictDoNothing(),
      ),
      db
        .update(orderDrafts)
        .set({ state: 'CONFIRMED', lastUpdatedAt: now })
        .where(and(eq(orderDrafts.workspaceId, ctx.workspaceId), eq(orderDrafts.id, draft.id))),
      db
        .update(conversations)
        .set({ orderState: 'CONFIRMED' })
        .where(
          and(
            eq(conversations.workspaceId, ctx.workspaceId),
            eq(conversations.id, ctx.conversationId),
          ),
        ),
      db
        .update(customers)
        .set({
          name: current.snapshot.customerName,
          phone: current.snapshot.phone,
          defaultAddress: current.snapshot.deliveryAddress,
          updatedAt: now,
        })
        .where(and(eq(customers.workspaceId, ctx.workspaceId), eq(customers.id, draft.customerId))),
    ]);
  } catch {
    const existing = await db
      .select()
      .from(orders)
      .where(and(eq(orders.workspaceId, ctx.workspaceId), eq(orders.id, id)))
      .get();
    if (existing) return existing;
    throw new AppError(
      'ORDER_CHANGED',
      'Stock or price changed. Please review your order again.',
      409,
    );
  }
  log('order_confirmed', { conversationId: ctx.conversationId, orderCount: 1 });
  for (const item of current.snapshot.items)
    await touchProduct(ctx.env, ctx.workspaceId, item.productId);
  return required(
    await db
      .select()
      .from(orders)
      .where(and(eq(orders.workspaceId, ctx.workspaceId), eq(orders.id, id)))
      .get(),
  );
}
export async function cancelDraft(ctx: OrderContext) {
  const draft = required(await getDraft(ctx));
  editable(draft.state);
  await database(ctx.env).batch([
    database(ctx.env)
      .update(orderDrafts)
      .set({ state: 'CANCELLED', reviewHash: null, lastUpdatedAt: Date.now() })
      .where(and(eq(orderDrafts.workspaceId, ctx.workspaceId), eq(orderDrafts.id, draft.id))),
    database(ctx.env)
      .update(conversations)
      .set({ orderState: 'CANCELLED' })
      .where(
        and(
          eq(conversations.workspaceId, ctx.workspaceId),
          eq(conversations.id, ctx.conversationId),
        ),
      ),
  ]);
  return { cancelled: true };
}
