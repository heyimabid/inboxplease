import { and, eq, isNull, or, like } from 'drizzle-orm';
import { z } from 'zod';
import type { Env } from '../env';
import { database } from '../db/client';
import { products, variants, localVectors } from '../db/schema';
import { canonicalCandidates } from '../repositories/products';
import { inference, cosine } from './models';
import { normalize } from '../shared/validation';
import { normalizeCommerce } from './language-style';
import { log } from '../shared/logger';
export async function searchProducts(
  env: Env,
  workspaceId: string,
  query: string,
  filters: { color?: string; size?: string; category?: string; availableOnly?: boolean } = {},
) {
  const started = Date.now(),
    db = database(env),
    q = normalize(query);
  const active = and(
    eq(products.workspaceId, workspaceId),
    eq(products.status, 'active'),
    eq(products.isAiSearchable, true),
    isNull(products.deletedAt),
  );
  let hits = await db
    .select({ id: products.id })
    .from(products)
    .where(
      and(
        active,
        or(eq(products.id, query), eq(products.sku, query), eq(products.normalizedName, q)),
      ),
    )
    .limit(5);
  if (!hits.length) {
    const variantHits = await db
      .select({ id: variants.productId })
      .from(variants)
      .where(and(eq(variants.workspaceId, workspaceId), eq(variants.sku, query)))
      .limit(5);
    hits = variantHits;
  }
  if (!hits.length) {
    const terms = normalizeCommerce(q)
      .split(/[^\p{L}\p{N}]+/u)
      .filter(
        (w) =>
          w.length > 2 &&
          ![
            'price',
            'available',
            'how',
            'much',
            'have',
            'this',
            'eta',
            'the',
            'black',
            'white',
            'order',
            'buy',
            'please',
            'want',
          ].includes(w),
      )
      .slice(0, 5);
    if (terms.length)
      hits = await db
        .select({ id: products.id })
        .from(products)
        .where(
          and(
            active,
            or(
              ...terms.map((t) => like(products.normalizedName, `%${t}%`)),
              ...terms.map((t) => like(products.aliases, `%${t}%`)),
            ),
          ),
        )
        .limit(8);
  }
  if (!hits.length && q) {
    const vector = await inference(env).embed(normalizeCommerce(q));
    if (env.APP_MODE === 'mock') {
      const rows = await db
        .select()
        .from(localVectors)
        .where(eq(localVectors.workspaceId, workspaceId));
      hits = rows
        .map((r) => ({
          id: r.productId,
          score: cosine(vector, z.array(z.number()).parse(JSON.parse(r.valuesJson))),
        }))
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 8);
    } else {
      const result = await env.CATALOG_INDEX.query(vector, {
        topK: 8,
        namespace: workspaceId,
        filter: { workspaceId: { $eq: workspaceId } },
        returnMetadata: 'all',
      });
      hits = result.matches
        .filter(
          (m) =>
            m.metadata?.workspaceId === workspaceId && typeof m.metadata.productId === 'string',
        )
        .map((m) => ({ id: String(m.metadata?.productId) }));
    }
  }
  let candidates = await canonicalCandidates(env, workspaceId, [...new Set(hits.map((p) => p.id))]);
  candidates = candidates.filter(
    (p) =>
      (!filters.category || normalize(p.category ?? '') === normalize(filters.category)) &&
      ((!p.variants.length && !filters.color && !filters.size && !filters.availableOnly) ||
        p.variants.some(
          (v) =>
            v.status === 'active' &&
            (!filters.color || normalize(v.color ?? '') === normalize(filters.color)) &&
            (!filters.size || normalize(v.size ?? '') === normalize(filters.size)) &&
            (!filters.availableOnly || v.stockOnHand > v.reservedStock),
        )),
  );
  if (env.APP_MODE !== 'mock' && env.RERANK_MODEL && candidates.length > 1) {
    try {
      const raw = await env.AI.run(env.RERANK_MODEL, {
        query: q,
        contexts: candidates.map((p) => ({ text: `${p.name} ${p.description}` })),
      });
      const ranked = z
        .object({
          response: z.array(
            z.object({ id: z.number().int().nonnegative(), score: z.number().finite() }),
          ),
        })
        .parse(raw);
      const scores = new Map(ranked.response.map((r) => [r.id, r.score]));
      candidates = candidates
        .map((p, i) => ({ p, score: scores.get(i) ?? -Infinity }))
        .sort((a, b) => b.score - a.score)
        .map((r) => r.p);
    } catch {
      log('rerank_fallback', { errorCategory: 'model_contract' });
    }
  }
  log('catalog_retrieval', {
    retrievalLatencyMs: Date.now() - started,
    candidateCount: candidates.length,
  });
  return candidates.slice(0, 4);
}
