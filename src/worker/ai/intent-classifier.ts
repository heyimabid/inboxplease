import { isVisualReference } from './visual-context';
import { isPhotoRequest } from './product-photos';
import { isGreeting, isReplyRepair } from './faq-relevance';
import type { Env } from '../env';
import { CustomerIntentSchema, type CustomerIntent } from './schemas';
import { detectLanguage, normalizeCommerce } from './language-style';
import { inference } from './models';
import { UNDERSTANDING_PROMPT } from './prompts';
export function mockIntent(text: string): CustomerIntent {
  const t = text.toLowerCase();
  let intent: CustomerIntent['intent'] = 'product_search';
  if (
    /human|agent|মানুষ|refund|threat|\botp\b|\bpin\b|\bpassword\b|ignore.{0,30}instruction/i.test(
      text,
    )
  )
    intent = 'human_request';
  else if (/^(confirm|হ্যাঁ|হ্যা|নিশ্চিত|confirm korchi)[.!\s]*$/iu.test(text))
    intent = 'order_confirmation';
  else if (/cancel|বাতিল|color change|রং পরিবর্তন|না,/.test(t)) intent = 'order_cancellation';
  else if (/name|phone|address|নাম|ঠিকানা|ফোন/.test(t)) intent = 'order_information';
  else if (/nibo|nimu|order korbo|নিতে চাই|নিব|buy|order/i.test(t)) intent = 'order_start';
  else if (/delivery|shipping|ডেলিভারি/.test(t)) intent = 'delivery_question';
  else if (/price|dam|daam|দাম/.test(t)) intent = 'price_question';
  else if (/available|ase|ache|hobe|stock|আছে/.test(t)) intent = 'stock_question';
  else if (/^(hi|hello|hey|হাই|সালাম|আসসালামু আলাইকুম)[.!\s]*$/iu.test(text)) intent = 'greeting';
  const field = (pattern: RegExp) => text.match(pattern)?.[1]?.trim() ?? null;
  const numberText = text.replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d)));
  return CustomerIntentSchema.parse({
    language: detectLanguage(text),
    intent,
    normalizedQuery: normalizeCommerce(text),
    productReferences: [],
    extractedOrderFields: {
      customerName: field(/(?:name|নাম)\s*[:=]?\s*(.+?)(?=\s*(?:phone|ফোন|address|ঠিকানা|,|$))/iu),
      phone: numberText.match(/(?:\+?880|0)1[3-9][\d -]{8,14}/)?.[0]?.trim() ?? null,
      address: field(
        /(?:address|ঠিকানা)\s*[:=]?\s*(.+?)(?=\s*(?:delivery area|area|zone|,\s*phone|$))/iu,
      ),
      deliveryArea: field(/(?:delivery area|area|zone)\s*[:=]?\s*(.+)$/iu),
      quantity:
        Number(
          numberText
            .match(/(?:quantity|qty)\s*[:=]?\s*(\d+)|(?:^|\s)(\d+)\s*(?:টা|ta|pcs|piece)/i)
            ?.slice(1)
            .find(Boolean),
        ) || null,
      size: field(/\b(XXL|XL|XS|L|M|S)\b/i),
      color: field(/\b(black|white|red|blue|green|কালো|সাদা)\b/i),
    },
    requestedAction: intent,
    confidence: 0.9,
  });
}
export async function understand(
  env: Env,
  text: string,
  context: string,
  dictionary: Record<string, string> = {},
  handoffRules = '',
) {
  if (isVisualReference(text)) return { ...mockIntent(text), intent: 'product_question' as const };
  if (isPhotoRequest(text) && mockIntent(text).intent !== 'human_request')
    return { ...mockIntent(text), intent: 'product_question' as const };
  if (isGreeting(text)) return { ...mockIntent(text), intent: 'greeting' as const };
  if (isReplyRepair(text)) return { ...mockIntent(text), intent: 'other' as const, confidence: 1 };
  if (env.APP_MODE === 'mock')
    return { ...mockIntent(text), normalizedQuery: normalizeCommerce(text, dictionary) };
  return inference(env).json(
    CustomerIntentSchema,
    UNDERSTANDING_PROMPT,
    JSON.stringify({
      customerMessages: text,
      normalizedMessage: normalizeCommerce(text, dictionary),
      context,
      sellerHandoffRules: handoffRules,
    }),
  );
}
