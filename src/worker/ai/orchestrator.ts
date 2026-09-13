import { isVisualReference } from './visual-context';
import { isPhotoRequest, productPhotoReply } from './product-photos';
import { isReplyRepair, relevantFaqs } from './faq-relevance';
import { matchCustomerImage } from './image-understanding';
import { groundedProductReply } from './reply-generator';
import { orderFlow } from './order-flow';
import { and, eq, desc, isNull, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { Env } from '../env';
import { database } from '../db/client';
import { settings, messages, customers, deliveryZones, faqs } from '../db/schema';
import { conversationContext } from '../repositories/conversations';
import { understand } from './intent-classifier';
import { searchProducts } from './product-retrieval';
import { generateReply } from './reply-generator';
import { detectLanguage, style, formatMoney, type Language } from './language-style';
import { handoff } from '../services/handoff';
import { log } from '../shared/logger';
export type GeneratedReply = {
  text: string;
  productIds: string[];
  language: Language;
  metadata: Record<string, string | number>;
};
export async function orchestrate(
  env: Env,
  workspaceId: string,
  conversationId: string,
  text: string,
  sourceMessageIds: string[] = [],
  imageIds: string[] = [],
): Promise<GeneratedReply | null> {
  const context = await conversationContext(env, workspaceId, conversationId),
    db = database(env);
  const config = await db
    .select()
    .from(settings)
    .where(eq(settings.workspaceId, workspaceId))
    .get();
  if (
    context.conversation.mode === 'human' ||
    context.conversation.status === 'blocked' ||
    env.AI_ENABLED !== 'true' ||
    env.MESSAGING_ENABLED !== 'true' ||
    !context.page.aiEnabled ||
    !pageReady(context.page) ||
    !config?.autoReply
  )
    return null;
  const history = await db
    .select({ text: messages.text, sender: messages.senderType })
    .from(messages)
    .where(and(eq(messages.workspaceId, workspaceId), eq(messages.conversationId, conversationId)))
    .orderBy(desc(messages.createdAt))
    .limit(12);
  let language: Language = detectLanguage(text);
  try {
    const dictionary = z.record(z.string(), z.string()).parse(JSON.parse(config.normalizationJson));
    const intent = await understand(
      env,
      text.trim() || (imageIds.length ? 'is this available?' : ''),
      JSON.stringify(history.reverse()).slice(-10000),
      dictionary,
      config.handoffRules,
    );
    language = intent.language === 'unknown' ? language : intent.language;
    if (['english', 'bangla', 'banglish', 'mixed'].includes(config.responseStyle))
      language = z.enum(['english', 'bangla', 'banglish', 'mixed']).parse(config.responseStyle);
    const detected = intent.language === 'unknown' ? detectLanguage(text) : intent.language;
    if (sourceMessageIds.length && text.length > 20 && detected !== 'unknown') {
      await db
        .update(messages)
        .set({ language: detected })
        .where(
          and(
            eq(messages.workspaceId, workspaceId),
            eq(messages.conversationId, conversationId),
            inArray(messages.id, sourceMessageIds),
            eq(messages.direction, 'inbound'),
          ),
        );
      const recent = await db
        .select({ language: messages.language })
        .from(messages)
        .where(
          and(
            eq(messages.workspaceId, workspaceId),
            eq(messages.conversationId, conversationId),
            eq(messages.direction, 'inbound'),
          ),
        )
        .orderBy(desc(messages.createdAt))
        .limit(8);
      const meaningful = recent.filter((m) => m.language).slice(0, 3);
      const evidence = meaningful.filter((m) => m.language === detected).length;
      await db
        .update(customers)
        .set({
          languageEvidence: evidence,
          ...(evidence >= 3 ? { languagePreference: detected } : {}),
          updatedAt: Date.now(),
        })
        .where(and(eq(customers.workspaceId, workspaceId), eq(customers.id, context.customer.id)));
    }
    if (language === 'unknown' && context.customer.languagePreference)
      language = z
        .enum(['english', 'bangla', 'banglish', 'mixed', 'unknown'])
        .parse(context.customer.languagePreference);
    if (
      intent.intent === 'human_request' ||
      intent.intent === 'complaint' ||
      /refund|threat|kill|password|otp|pin\s*(?:number|code)|ignore.{0,40}instructions|every seller|অভিযোগ|হুমকি|রিফান্ড/i.test(
        text,
      ) ||
      intent.confidence < 0.5
    ) {
      await handoff(env, workspaceId, conversationId, 'customer_or_safety_request');
      return null;
    }
    if (imageIds.length) {
      const result = await matchCustomerImage(env, workspaceId, imageIds[0]!, text);
      if (result.match.kind === 'none' || result.match.kind === 'uncertain')
        return {
          text: style(language, {
            english:
              'I couldn’t verify a matching product in this store from that photo. Please share the product name or a clearer photo of the item.',
            bangla:
              'এই ছবি থেকে দোকানের কোনো পণ্যের সঙ্গে মিল নিশ্চিত করতে পারিনি। পণ্যের নাম বা আরও পরিষ্কার ছবি দেবেন?',
            banglish:
              'Ei photo theke store-er kono product-er match confirm korte parini. Product-er name ba aro clear photo diben?',
          }),
          productIds: [],
          language,
          metadata: {
            tool: 'image_search',
            imageMatch: JSON.stringify(result.match),
            productIds: '[]',
          },
        };
      const prefix =
        result.match.kind === 'exact_file'
          ? style(language, {
              english: 'This is the same image file as a catalog photo.',
              bangla: 'এটি ক্যাটালগের ছবির সঙ্গে একই ফাইল।',
              banglish: 'Eta catalog photo-r same image file.',
            })
          : result.match.kind === 'category_alternatives'
            ? style(language, {
                english:
                  'I can’t confirm the exact model in your photo. We do carry these alternatives of the same product type; here are their catalog photos and details.',
                bangla:
                  'আপনার ছবির সঠিক মডেলটি নিশ্চিত করতে পারছি না। তবে একই ধরনের এই বিকল্প পণ্যগুলো আমাদের ক্যাটালগে আছে। নিচে সেগুলোর ছবি ও তথ্য দিলাম।',
                banglish:
                  'Apnar photo-r exact model-ta confirm korte parchi na. Tobe eki dhoroner ei alternative product amader catalog-e ache. Egulor photo ar details dilam.',
              })
            : style(language, {
                english: 'These may be similar products; the match is not confirmed.',
                bangla: 'এগুলো একই রকম পণ্য হতে পারে; মিল নিশ্চিত নয়।',
                banglish: 'Egulo similar product hote pare; match confirmed na.',
              });
      return {
        text: prefix + '\n\n' + groundedProductReply(result.products, language),
        productIds: result.products.map((p) => p.id),
        language,
        metadata: {
          tool: 'image_search',
          imageMatch: JSON.stringify(result.match),
          productIds: JSON.stringify(result.products.map((p) => p.id)),
        },
      };
    }
    if (isVisualReference(text))
      return {
        text: style(language, {
          english: 'Please send the product photo or name so I can check which item you mean.',
          bangla: 'কোন পণ্যটি বোঝাচ্ছেন তা দেখতে ছবি বা পণ্যের নাম দিন।',
          banglish: 'Kon product-ta bolchen? Photo ba product-er name dile check korte parbo.',
        }),
        productIds: [],
        language,
        metadata: { tool: 'visual_reference' },
      };
    if (isPhotoRequest(text))
      return productPhotoReply(env, workspaceId, conversationId, text, language);
    if (isReplyRepair(text))
      return {
        text: style(language, {
          english:
            'Sorry, my earlier reply did not answer you. Please tell me the product you want or the question you need answered.',
          bangla:
            'দুঃখিত, আগের উত্তরটি আপনার প্রশ্নের উত্তর দেয়নি। কোন পণ্য চান বা কী জানতে চান বলবেন?',
          banglish:
            'Sorry, ager reply apnar proshner answer dey nai. Kon product chan ba ki jante chan bolben?',
        }),
        productIds: [],
        language,
        metadata: { tool: 'conversation_repair' },
      };
    if (intent.intent === 'greeting')
      return {
        text: style(language, {
          english: 'Hi! I’m this store’s automated assistant. What product can I help you with?',
          bangla: 'হ্যালো! আমি এই দোকানের স্বয়ংক্রিয় সহকারী। কোন পণ্যটি খুঁজছেন?',
          banglish: 'Hi! Ami ei store-er automated assistant. Kon product-ta khujchen?',
        }),
        productIds: [],
        language,
        metadata: { tool: 'greeting' },
      };
    const orderReply = await orderFlow(
      { env, workspaceId, conversationId, sourceText: text, sourceMessageIds },
      intent,
      language,
    );
    if (orderReply) return orderReply;
    if (intent.intent === 'delivery_question') {
      const zones = await db
        .select()
        .from(deliveryZones)
        .where(and(eq(deliveryZones.workspaceId, workspaceId), eq(deliveryZones.isActive, true)));
      const policies = await db
        .select()
        .from(faqs)
        .where(
          and(eq(faqs.workspaceId, workspaceId), isNull(faqs.productId), eq(faqs.isActive, true)),
        );
      return {
        text: zones.length
          ? zones
              .map(
                (zone) =>
                  `${zone.name}: ${formatMoney(zone.fee, zone.currency, language)}${zone.estimatedDays ? ` · ${zone.estimatedDays}` : ''}`,
              )
              .join('\n') +
            (policies.length
              ? '\n\n' +
                relevantFaqs(text, policies)
                  .map((p) => `${p.question}\n${p.answer}`)
                  .join('\n\n')
              : '')
          : style(language, {
              english: 'The seller hasn’t added delivery details yet. I’ll ask them to help.',
              bangla: 'বিক্রেতা এখনো ডেলিভারির তথ্য যোগ করেননি। তাঁর সাহায্য লাগবে।',
              banglish: 'Seller ekhono delivery details denni. Seller-er help lagbe.',
            }),
        productIds: [],
        language,
        metadata: { tool: 'get_delivery_options' },
      };
    }
    const found = await searchProducts(env, workspaceId, intent.normalizedQuery ?? text, {
      size: intent.extractedOrderFields.size ?? undefined,
      color: intent.extractedOrderFields.color ?? undefined,
    });
    const storePolicies = await db
      .select()
      .from(faqs)
      .where(
        and(eq(faqs.workspaceId, workspaceId), isNull(faqs.productId), eq(faqs.isActive, true)),
      )
      .limit(20);
    return {
      text: await generateReply(env, found, text, language, config.tone, storePolicies),
      productIds: found.map((p) => p.id),
      language,
      metadata: {
        tool: 'search_products',
        candidateCount: found.length,
        productIds: JSON.stringify(found.map((p) => p.id)),
      },
    };
  } catch {
    log('orchestration_fallback', { conversationId, errorCategory: 'understanding_or_retrieval' });
    await handoff(env, workspaceId, conversationId, 'ai_uncertainty');
    return null;
  }
}
import { pageReady } from '../meta/activation';
