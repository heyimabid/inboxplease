import { z } from 'zod';
export const identifier = z.string().min(1).max(160);
export const money = z.number().int().nonnegative().max(1000000000);
export const pagination = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(40),
});
export const productInput = z
  .object({
    name: z.string().trim().min(2).max(180),
    description: z.string().max(8000).default(''),
    sku: z.string().max(80).nullable().default(null),
    category: z.string().max(100).nullable().default(null),
    aliases: z.string().max(2000).default(''),
    basePrice: money,
    compareAtPrice: money.nullable().default(null),
    currency: z.string().regex(/^[A-Z]{3}$/),
    status: z.enum(['draft', 'active', 'archived']).default('draft'),
    isAiSearchable: z.boolean().default(true),
  })
  .strict();
export const variantInput = z
  .object({
    sku: z.string().trim().min(1).max(80),
    title: z.string().trim().min(1).max(160),
    color: z.string().max(80).nullable().default(null),
    size: z.string().max(60).nullable().default(null),
    attributes: z.record(z.string().max(50), z.string().max(200)).default({}),
    priceOverride: money.nullable().default(null),
    stockOnHand: z.number().int().min(0).max(1000000),
    status: z.enum(['active', 'inactive']).default('active'),
  })
  .strict();
export const faqInput = z
  .object({
    productId: identifier.nullable().default(null),
    question: z.string().trim().min(2).max(500),
    answer: z.string().trim().min(1).max(3000),
    language: z.string().max(30).nullable().default(null),
    isActive: z.boolean().default(true),
  })
  .strict();
export const normalize = (value: string) =>
  value.normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
export const slug = (value: string) =>
  normalize(value)
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '');
