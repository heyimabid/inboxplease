import { z } from 'zod';
import { AppError } from '../shared/errors';
export const orderStates = [
  'BROWSING',
  'SELECTING_PRODUCT',
  'SELECTING_VARIANT',
  'COLLECTING_CUSTOMER_NAME',
  'COLLECTING_PHONE',
  'COLLECTING_ADDRESS',
  'COLLECTING_DELIVERY_AREA',
  'REVIEWING',
  'AWAITING_CONFIRMATION',
  'CONFIRMED',
  'CANCELLED',
  'HANDED_OFF',
] as const;
export type OrderState = (typeof orderStates)[number];
export function latinDigits(value: string) {
  return value.replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d)));
}
export function normalizePhone(value: string) {
  let phone = latinDigits(value).replace(/[\s()-]/g, '');
  if (phone.startsWith('+880')) phone = '0' + phone.slice(4);
  else if (phone.startsWith('880')) phone = '0' + phone.slice(3);
  if (!/^01[3-9]\d{8}$/.test(phone))
    throw new AppError('INVALID_PHONE', 'Please provide a valid Bangladeshi mobile number', 422);
  return '+88' + phone;
}
export function explicitConfirmation(text: string) {
  return /^(?:confirm|confirmed|confirm korchi|হ্যাঁ|হ্যা|হ্যাঁ কনফার্ম|নিশ্চিত|কনফার্ম)[.!।\s]*$/iu.test(
    text.trim(),
  );
}
export function validCustomerName(value: string) {
  return (
    value.trim().length >= 2 &&
    !/^(yes|no|ok|okay|sure|hello|hi|হ্যাঁ|হ্যা|জি|না)[.!\s]*$/iu.test(value.trim()) &&
    !/^(?:(?:am[ai]r|amar|amr|my|আমার)\s*(?:name|nam|নাম)(?:\s*(?:e|ei|এ|hobe|হবে|ই))*|me|myself|আমি)$/iu.test(
      value.trim(),
    ) &&
    !/[?？]|\d{5}/u.test(value)
  );
}
export function nextOrderState(draft: {
  items: unknown[];
  customerName: string | null;
  phone: string | null;
  deliveryAddress: string | null;
  deliveryArea: string | null;
}): OrderState {
  if (!draft.items.length) return 'SELECTING_PRODUCT';
  if (!draft.customerName || !validCustomerName(draft.customerName))
    return 'COLLECTING_CUSTOMER_NAME';
  if (!draft.phone) return 'COLLECTING_PHONE';
  if (!draft.deliveryAddress) return 'COLLECTING_ADDRESS';
  if (!draft.deliveryArea) return 'COLLECTING_DELIVERY_AREA';
  return 'REVIEWING';
}
export function assertTransition(from: OrderState, to: OrderState, explicit = false) {
  if (from === to) return;
  if (from === 'CONFIRMED' || from === 'CANCELLED')
    throw new AppError('ORDER_TERMINAL', 'Start a new order to make changes', 409);
  if (to === 'CONFIRMED' && (from !== 'AWAITING_CONFIRMATION' || !explicit))
    throw new AppError(
      'CONFIRMATION_REQUIRED',
      'The customer must confirm the complete order summary',
      409,
    );
}
export const draftFieldsSchema = z
  .object({
    customerName: z.string().trim().min(2).max(120).optional(),
    phone: z.string().max(40).optional(),
    deliveryAddress: z.string().trim().min(8).max(500).optional(),
    deliveryArea: z.string().trim().min(2).max(100).optional(),
    notes: z.string().max(1000).optional(),
  })
  .strict();
export function calculateMoney(
  items: { quantity: number; unitPrice: number }[],
  deliveryFee: number,
) {
  if (!Number.isSafeInteger(deliveryFee) || deliveryFee < 0)
    throw new AppError('INVALID_MONEY', 'Invalid delivery fee');
  let subtotal = 0;
  for (const i of items) {
    if (
      !Number.isSafeInteger(i.quantity) ||
      i.quantity < 1 ||
      !Number.isSafeInteger(i.unitPrice) ||
      i.unitPrice < 0
    )
      throw new AppError('INVALID_MONEY', 'Invalid item amount');
    subtotal += i.quantity * i.unitPrice;
  }
  const total = subtotal + deliveryFee;
  if (!Number.isSafeInteger(total) || total > 1000000000)
    throw new AppError('INVALID_MONEY', 'Order total is too large');
  return { subtotal, deliveryFee, total };
}
