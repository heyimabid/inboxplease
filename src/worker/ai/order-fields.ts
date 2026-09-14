import { clarification, useMyName } from './conversation-routing';
import type { CustomerIntent } from './schemas';
import { latinDigits, normalizePhone, validCustomerName } from '../services/order-state-machine';

export function currentOrderFields(
  text: string,
  proposed: CustomerIntent['extractedOrderFields'],
  state: string,
) {
  const source = latinDigits(text).trim();
  if (clarification(text))
    return {
      ...proposed,
      customerName: null,
      phone: null,
      address: null,
      deliveryArea: null,
      quantity: null,
      size: null,
      color: null,
    };
  const contains = (value: string | null) =>
    value && source.toLowerCase().includes(latinDigits(value).toLowerCase());
  const fields = {
    ...proposed,
    customerName: null as string | null,
    phone: null as string | null,
    address: null as string | null,
    deliveryArea: null as string | null,
  };
  for (const key of ['customerName', 'address', 'deliveryArea'] as const) {
    if (contains(proposed[key])) fields[key] = proposed[key];
  }
  // Extract phone numbers from this message, never from a model's historical memory.
  const phone = source.match(/(?<!\d)(?:\+?880|0)1[3-9](?:[ -]?\d){8}(?!\d)/)?.[0];
  if (phone) fields.phone = normalizePhone(phone);
  const onlyNumber = /^[+\d\s()-]+$/.test(source);
  if (state === 'COLLECTING_PHONE' && onlyNumber) fields.phone = normalizePhone(source);
  if (
    state === 'COLLECTING_CUSTOMER_NAME' &&
    !fields.customerName &&
    !onlyNumber &&
    !phone &&
    validCustomerName(source) &&
    !/\d|\b(?:quantity|qty|order|buy|nibo|nimu|cancel|change|phone|address)\b/i.test(source)
  )
    fields.customerName = source;
  if (onlyNumber || (phone && source.replace(/[^\d]/g, '') === phone.replace(/[^\d]/g, '')))
    fields.address = null;
  if (fields.customerName && (!validCustomerName(fields.customerName) || useMyName(source)))
    fields.customerName = null;
  if (
    (state === 'COLLECTING_ADDRESS' ||
      /\d.{0,35}\b(?:road|rd|ave|avenue|street|lane|block|house|dhaka)\b|(?:বাসা|রোড|সড়ক|সড়ক)/iu.test(
        source,
      )) &&
    !fields.address &&
    !onlyNumber &&
    !phone &&
    source.length >= 8 &&
    !/[?？]/u.test(source)
  )
    fields.address = source
      .replace(/^(?:(?:amr|amar|my)\s+)?(?:address|ঠিকানা)\s*[:=]?\s*/iu, '')
      .replace(/\s+(?:e hobe|hobe|হবে)[.!]*$/iu, '')
      .trim();
  if (state === 'COLLECTING_DELIVERY_AREA' && !fields.deliveryArea && !onlyNumber && !phone)
    fields.deliveryArea = source;
  const explicitQuantity = source.match(
    /(?:quantity|qty)\s*[:=]?\s*(\d+)|\b(\d+)\s*(?:ta|pcs|pieces?)\b|(\d+)\s*টা/i,
  );
  const quantityContext =
    /nibo|nimu|buy|order|নিব|নেব|চাই/i.test(source) ||
    /^(ekta|one|duita|two|একটা|একটি|দুটি|দুইটা)[.!\s]*$/iu.test(source);
  const natural = /\b(?:ekta|ek ti|one)\b|একটা|একটি/i.test(source)
    ? 1
    : /\b(?:duita|dui ta|two)\b|দুইটা|দুটি/i.test(source)
      ? 2
      : null;
  fields.quantity = explicitQuantity
    ? Number(explicitQuantity.slice(1).find(Boolean))
    : quantityContext
      ? natural
      : null;
  return fields;
}
