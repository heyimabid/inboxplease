import { it, expect } from 'vitest';
import {
  normalizePhone,
  explicitConfirmation,
  calculateMoney,
  nextOrderState,
  assertTransition,
} from '../../src/worker/services/order-state-machine';
import { toolRequestSchema } from '../../src/worker/ai/tools';
it.each(['01712345678', '+880 1712-345678', '8801712345678', '০১৭১২৩৪৫৬৭৮'])(
  'normalizes local phone %s',
  (value) => expect(normalizePhone(value)).toBe('+8801712345678'),
);
it.each(['1234', '01212345678', '017123456789', '+911712345678'])(
  'rejects invalid phone %s',
  (value) => expect(() => normalizePhone(value)).toThrow(),
);
it('requires an explicit complete confirmation', () => {
  expect(explicitConfirmation('Confirm')).toBe(true);
  expect(explicitConfirmation('হ্যাঁ')).toBe(true);
  for (const text of [
    'confirm but change color',
    'do not confirm',
    'yes maybe',
    'না, color change করবো',
    'okay',
  ])
    expect(explicitConfirmation(text)).toBe(false);
  expect(() => assertTransition('REVIEWING', 'CONFIRMED', true)).toThrow();
  expect(() => assertTransition('AWAITING_CONFIRMATION', 'CONFIRMED', false)).toThrow();
  expect(() => assertTransition('AWAITING_CONFIRMATION', 'CONFIRMED', true)).not.toThrow();
});
it('calculates money in integer minor units and rejects invalid amounts', () => {
  expect(calculateMoney([{ quantity: 2, unitPrice: 149000 }], 8000)).toEqual({
    subtotal: 298000,
    deliveryFee: 8000,
    total: 306000,
  });
  expect(() => calculateMoney([{ quantity: 1.5, unitPrice: 149000 }], 8000)).toThrow();
  expect(() => calculateMoney([{ quantity: 1, unitPrice: 12.5 }], 0)).toThrow();
});
it('finds missing fields independently of collection order', () => {
  expect(
    nextOrderState({
      items: [{}],
      customerName: null,
      phone: '+8801712345678',
      deliveryAddress: 'Mirpur 10',
      deliveryArea: 'Dhakar vitore',
    }),
  ).toBe('COLLECTING_CUSTOMER_NAME');
});
it('rejects model-supplied workspace identity and invented money', () => {
  expect(toolRequestSchema.safeParse({ name: 'confirm_order', workspaceId: 'other' }).success).toBe(
    false,
  );
  expect(
    toolRequestSchema.safeParse({
      name: 'add_order_item',
      variantId: 'v',
      quantity: 1,
      unitPrice: 1,
    }).success,
  ).toBe(false);
});
