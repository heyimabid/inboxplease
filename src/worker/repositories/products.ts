import { and, eq, isNull, or, like, inArray, asc } from 'drizzle-orm';
import { database } from '../db/client';
import { products, variants, images, faqs } from '../db/schema';
import type { Env } from '../env';
import { required } from '../shared/errors';
export async function getProduct(env: Env, workspaceId: string, id: string, searchable = false) {
  const db = database(env);
  const product = required(
    await db
      .select()
      .from(products)
      .where(
        and(
          eq(products.workspaceId, workspaceId),
          eq(products.id, id),
          isNull(products.deletedAt),
          searchable
            ? and(eq(products.status, 'active'), eq(products.isAiSearchable, true))
            : undefined,
        ),
      )
      .get(),
    'PRODUCT_NOT_FOUND',
    'Product not found',
  );
  const [v, i, f] = await Promise.all([
    db
      .select()
      .from(variants)
      .where(and(eq(variants.workspaceId, workspaceId), eq(variants.productId, id))),
    db
      .select()
      .from(images)
      .where(and(eq(images.workspaceId, workspaceId), eq(images.productId, id)))
      .orderBy(asc(images.position)),
    db
      .select()
      .from(faqs)
      .where(
        and(eq(faqs.workspaceId, workspaceId), eq(faqs.productId, id), eq(faqs.isActive, true)),
      ),
  ]);
  return {
    ...product,
    variants: v,
    images: i.map(({ r2Key: _key, ...image }) => ({ ...image, url: `/api/images/${image.id}` })),
    faqs: f,
  };
}
export type ProductDetail = Awaited<ReturnType<typeof getProduct>>;
export async function listProducts(
  env: Env,
  workspaceId: string,
  q: string,
  limit: number,
  offset: number,
) {
  const db = database(env);
  return db
    .select()
    .from(products)
    .where(
      and(
        eq(products.workspaceId, workspaceId),
        isNull(products.deletedAt),
        q ? or(like(products.name, `%${q}%`), like(products.sku, `%${q}%`)) : undefined,
      ),
    )
    .orderBy(asc(products.name))
    .limit(limit)
    .offset(offset);
}
export async function canonicalCandidates(env: Env, workspaceId: string, ids: string[]) {
  if (!ids.length) return [];
  const rows = await database(env)
    .select({ id: products.id })
    .from(products)
    .where(
      and(
        eq(products.workspaceId, workspaceId),
        inArray(products.id, ids.slice(0, 20)),
        eq(products.status, 'active'),
        eq(products.isAiSearchable, true),
        isNull(products.deletedAt),
      ),
    );
  return Promise.all(rows.map((p) => getProduct(env, workspaceId, p.id, true)));
}
