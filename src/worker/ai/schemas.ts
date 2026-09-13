import { z } from 'zod';
export const CustomerIntentSchema = z
  .object({
    language: z.enum(['bangla', 'banglish', 'english', 'mixed', 'unknown']),
    intent: z.enum([
      'greeting',
      'product_search',
      'product_question',
      'image_search',
      'stock_question',
      'price_question',
      'delivery_question',
      'order_start',
      'order_information',
      'order_confirmation',
      'order_cancellation',
      'complaint',
      'human_request',
      'other',
    ]),
    normalizedQuery: z.string().max(500).nullable(),
    productReferences: z.array(z.string().max(160)).max(10),
    extractedOrderFields: z.object({
      customerName: z.string().max(120).nullable(),
      phone: z.string().max(40).nullable(),
      address: z.string().max(500).nullable(),
      deliveryArea: z.string().max(100).nullable(),
      quantity: z.number().int().min(1).max(100).nullable(),
      size: z.string().max(50).nullable(),
      color: z.string().max(50).nullable(),
    }),
    requestedAction: z.string().max(100),
    confidence: z.number().min(0).max(1),
  })
  .strict();
export type CustomerIntent = z.infer<typeof CustomerIntentSchema>;
export const ProductVisionSchema = z
  .object({
    category: z.string().nullable(),
    subcategory: z.string().nullable(),
    primaryColor: z.string().nullable(),
    secondaryColors: z.array(z.string()),
    pattern: z.string().nullable(),
    materialGuess: z.string().nullable(),
    visibleText: z.array(z.string()),
    distinctiveFeatures: z.array(z.string()),
    description: z.string().max(2000),
  })
  .strict();
export const ReplyPlanSchema = z
  .object({
    productIds: z.array(z.string()).max(4),
    faqIds: z.array(z.string()).max(4),
    opening: z.enum(['available', 'options', 'clarify', 'greeting', 'none']),
    askVariant: z.boolean(),
  })
  .strict();
