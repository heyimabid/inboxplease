import { relevantFaqs } from './faq-relevance';
import type { Env } from '../env';
import type { ProductDetail } from '../repositories/products';
import { style, formatMoney, type Language } from './language-style';
import { ReplyPlanSchema } from './schemas';
import { inference } from './models';
import { SYSTEM_RULES } from './prompts';
export function groundedProductReply(
  products: ProductDetail[],
  language: Language,
  tone = 'friendly',
) {
  if (!products.length)
    return style(language, {
      english:
        'I couldn’t find a reliable match in this store. Could you share the product name, SKU, or a photo?',
      bangla: 'এই দোকানে নিশ্চিত কোনো মিল খুঁজে পাইনি। পণ্যের নাম, SKU বা একটি ছবি দেবেন?',
      banglish: 'Ei store-e reliable match paini. Product-er name, SKU ba ekta photo diben?',
    });
  const heading = style(language, {
    english: 'Here’s what we have:',
    bangla: 'আমাদের কাছে এগুলো আছে:',
    banglish: 'Amader kache egulo ache:',
  });
  const blocks = products.map(
    (p) =>
      `${p.name}\n${
        !p.variants.some((v) => v.status === 'active')
          ? `${formatMoney(p.basePrice, p.currency, language)} · ${style(language, { english: 'Stock and available options need seller confirmation.', bangla: 'স্টক ও উপলব্ধ অপশন বিক্রেতার কাছে নিশ্চিত করতে হবে।', banglish: 'Stock ar available options seller-er kache confirm korte hobe.' })}`
          : p.variants
              .filter((v) => v.status === 'active')
              .map(
                (v) =>
                  `${v.title} · ${formatMoney(v.priceOverride ?? p.basePrice, p.currency, language)} · ${Math.max(0, v.stockOnHand - v.reservedStock)} ${style(language, { english: 'available', bangla: 'টি আছে', banglish: 'ta available' })}`,
              )
              .join('\n')
      }`,
  );
  return [
    tone === 'concise'
      ? style(language, {
          english: 'Current catalog:',
          bangla: 'ক্যাটালগের তথ্য:',
          banglish: 'Catalog details:',
        })
      : tone === 'warm'
        ? style(language, {
            english: 'Happy to help! Here’s what’s in our catalog:',
            bangla: 'অবশ্যই! আমাদের ক্যাটালগের তথ্য দিচ্ছি:',
            banglish: 'Obosshoi! Amader catalog-er details dichhi:',
          })
        : heading,
    ...blocks,
    !products.some((p) => p.variants.some((v) => v.status === 'active'))
      ? style(language, {
          english: 'Seller confirmation is needed before ordering.',
          bangla: 'অর্ডারের আগে বিক্রেতার নিশ্চিতকরণ প্রয়োজন।',
          banglish: 'Order-er age seller confirmation lagbe.',
        })
      : style(language, {
          english: 'Which one would you like to know more about?',
          bangla: 'কোনটা সম্পর্কে আরও জানতে চান?',
          banglish: 'Konta niye aro jante chan?',
        }),
  ].join('\n\n');
}
export async function generateReply(
  env: Env,
  products: ProductDetail[],
  query: string,
  language: Language,
  tone: string,
  storePolicies: ProductDetail['faqs'] = [],
) {
  const availableFaqs = relevantFaqs(query, [
    ...products.flatMap((p) => p.faqs),
    ...storePolicies,
  ]).slice(0, 30);
  if (!availableFaqs.length) return groundedProductReply(products, language, tone);
  if (env.APP_MODE === 'mock') {
    const terms = query
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(
        (t) =>
          t.length > 2 &&
          ![
            'what',
            'how',
            'the',
            'this',
            'that',
            'you',
            'does',
            'can',
            'have',
            'with',
            'for',
            'are',
          ].includes(t),
      );
    const matches = availableFaqs
      .map((f) => ({ f, score: terms.filter((t) => f.question.toLowerCase().includes(t)).length }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 2);
    if (matches.length) return matches.map(({ f }) => `${f.question}\n${f.answer}`).join('\n\n');
    return groundedProductReply(products, language, tone);
  }
  const plan = await inference(env).json(
    ReplyPlanSchema,
    SYSTEM_RULES +
      ' Answer only the current query. Select an FAQ only if its question directly matches what was asked. Never substitute payment or delivery policy for a product request. Empty selections are allowed. Select only IDs from verified candidates. Code renders the facts.',
    JSON.stringify({
      query,
      language,
      tone,
      storePolicies: availableFaqs
        .filter((f) => storePolicies.some((p) => p.id === f.id))
        .map((f) => ({ id: f.id, question: f.question, answer: f.answer }))
        .slice(0, 20),
      candidates: products.map((p) => ({
        id: p.id,
        name: p.name,
        faqs: availableFaqs
          .filter((f) => p.faqs.some((pf) => pf.id === f.id))
          .map((f) => ({ id: f.id, question: f.question, answer: f.answer })),
      })),
    }),
  );
  const allowed = new Set(products.map((p) => p.id));
  if (plan.productIds.some((id) => !allowed.has(id)))
    throw new Error('Ungrounded product reference');
  const chosen = plan.productIds.length
    ? products.filter((p) => plan.productIds.includes(p.id))
    : products;
  const faqs = availableFaqs.filter((f) => plan.faqIds.includes(f.id));
  if (plan.faqIds.some((id) => !faqs.some((f) => f.id === id)))
    throw new Error('Ungrounded FAQ reference');
  return (
    (faqs.length && !plan.productIds.length ? '' : groundedProductReply(chosen, language, tone)) +
    (faqs.length ? '\n\n' + faqs.map((f) => `${f.question}\n${f.answer}`).join('\n\n') : '')
  ).trim();
}
