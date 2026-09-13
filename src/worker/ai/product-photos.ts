import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Env } from '../env';
import { database } from '../db/client';
import { messages, orderDrafts } from '../db/schema';
import { canonicalCandidates } from '../repositories/products';
import { searchProducts } from './product-retrieval';
import { normalizeCommerce, style, type Language } from './language-style';
import type { GeneratedReply } from './orchestrator';
export function isPhotoRequest(text: string) {
  return /\b(?:photo|photos|picture|pictures|pic|pics|image|images|chobi|chhobi|chobita)\b|ছবি/iu.test(
    text,
  );
}
export async function productPhotoReply(
  env: Env,
  w: string,
  conversationId: string,
  text: string,
  language: Language,
): Promise<GeneratedReply> {
  const query = normalizeCommerce(text)
    .replace(/ছবি(?:টা|টি)?|দেখান|দেখাবেন|দিন|পাঠান|একটা/gu, ' ')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(
      (t) =>
        !new Set(
          'photo photos picture pictures pic pics image images chobi chhobi chobita please send show give can could would you me a an the of this that it its some den din dao dekhan dekhaben dekhai dekhaw dekhao dekhte chai ekta apni i want to see'.split(
            ' ',
          ),
        ).has(t),
    )
    .join(' ');
  let found;
  if (query) {
    const words = query.split(' ');
    // Do not substitute the only catalog item for a named but unrelated object.
    found = (await searchProducts(env, w, query)).filter((p) =>
      words.some(
        (t) =>
          t.length > 2 && normalizeCommerce(`${p.name} ${p.sku ?? ''} ${p.aliases}`).includes(t),
      ),
    );
  } else {
    const db = database(env);
    const draft = await db
      .select({ selection: orderDrafts.selectionJson })
      .from(orderDrafts)
      .where(and(eq(orderDrafts.workspaceId, w), eq(orderDrafts.conversationId, conversationId)))
      .orderBy(desc(orderDrafts.lastUpdatedAt))
      .get();
    let ids: string[] = [];
    if (draft) {
      const data = z
        .object({ productId: z.string().optional() })
        .safeParse(JSON.parse(draft.selection ?? '{}'));
      if (data.success && data.data.productId) ids = [data.data.productId];
    }
    if (!ids.length) {
      const history = await db
        .select({ metadata: messages.aiMetadataJson })
        .from(messages)
        .where(
          and(
            eq(messages.workspaceId, w),
            eq(messages.conversationId, conversationId),
            eq(messages.direction, 'outbound'),
          ),
        )
        .orderBy(desc(messages.createdAt))
        .limit(12);
      for (const row of history) {
        try {
          const data = z
            .object({ productIds: z.string(), imageMatch: z.string().optional() })
            .parse(JSON.parse(row.metadata ?? '{}'));
          if (data.imageMatch && ['none', 'uncertain'].includes(JSON.parse(data.imageMatch).kind))
            continue;
          ids = z.array(z.string()).max(4).parse(JSON.parse(data.productIds));
          if (ids.length) break;
        } catch {
          /* Ignore unrelated message metadata. */
        }
      }
    }
    found = await canonicalCandidates(env, w, ids);
  }
  const reply = (message: string, ids: string[] = []): GeneratedReply => ({
    text: message,
    productIds: ids,
    language,
    metadata: { tool: 'product_photos', productIds: JSON.stringify(ids) },
  });
  if (found.length !== 1)
    return reply(
      style(language, {
        english: 'Which product would you like a photo of? Please tell me its name.',
        bangla: 'কোন পণ্যের ছবি চান? পণ্যটির নাম বলুন।',
        banglish: 'Kon product-er photo chan? Product-er name bolun.',
      }),
    );
  const product = found[0]!;
  if (!product.images.length)
    return reply(
      style(language, {
        english: `The seller hasn’t added a photo of ${product.name} yet.`,
        bangla: `বিক্রেতা এখনো ${product.name}-এর ছবি যোগ করেননি।`,
        banglish: `Seller ekhono ${product.name}-er photo add korenni.`,
      }),
    );
  return reply(
    style(language, {
      english: `Here is the catalog photo of ${product.name}.`,
      bangla: `এটি ${product.name}-এর ক্যাটালগের ছবি।`,
      banglish: `Eta ${product.name}-er catalog photo.`,
    }),
    [product.id],
  );
}
