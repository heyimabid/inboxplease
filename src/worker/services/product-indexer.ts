import { log } from '../shared/logger';
import { indexProductImages } from '../ai/image-understanding';
import { and, eq, sql } from 'drizzle-orm';
import { database } from '../db/client';
import { catalogJobs, localVectors, products, faqs, images } from '../db/schema';
import { getProduct } from '../repositories/products';
import type { Env } from '../env';
import { inference } from '../ai/models';
export async function enqueueCatalog(env: Env, workspaceId: string, productId: string) {
  const db = database(env);
  const product = await db
    .select()
    .from(products)
    .where(and(eq(products.workspaceId, workspaceId), eq(products.id, productId)))
    .get();
  if (!product) return;
  const jobId = `${productId}:${product.revision}`;
  await db
    .insert(catalogJobs)
    .values({
      id: jobId,
      workspaceId,
      productId,
      revision: product.revision,
      createdAt: Date.now(),
    })
    .onConflictDoNothing();
  try {
    await env.CATALOG_QUEUE.send({ kind: 'catalog', jobId });
  } catch {
    log('catalog_outbox_pending', { jobId, errorCategory: 'queue_unavailable' });
    return;
  }
  await db
    .update(catalogJobs)
    .set({ queuedAt: Date.now() })
    .where(and(eq(catalogJobs.id, jobId), eq(catalogJobs.workspaceId, workspaceId)));
}
export async function touchProduct(env: Env, workspaceId: string, id: string) {
  await database(env)
    .update(products)
    .set({ revision: sql`${products.revision}+1`, indexStatus: 'pending', updatedAt: Date.now() })
    .where(and(eq(products.workspaceId, workspaceId), eq(products.id, id)));
  await enqueueCatalog(env, workspaceId, id);
}
export async function indexProduct(env: Env, jobId: string) {
  const db = database(env);
  const job = await db.select().from(catalogJobs).where(eq(catalogJobs.id, jobId)).get();
  if (!job || job.status === 'processed') return;
  const product = await db
    .select()
    .from(products)
    .where(and(eq(products.workspaceId, job.workspaceId), eq(products.id, job.productId)))
    .get();
  if (!product) return;
  const vectorId = `${product.id}:${product.revision}`;
  await db
    .update(catalogJobs)
    .set({ attempts: sql`${catalogJobs.attempts}+1` })
    .where(and(eq(catalogJobs.workspaceId, job.workspaceId), eq(catalogJobs.id, jobId)));
  if (product.status !== 'active' || !product.isAiSearchable || product.deletedAt) {
    const imageVectors = await db
      .select({ vectorId: images.vectorId })
      .from(images)
      .where(and(eq(images.workspaceId, job.workspaceId), eq(images.productId, product.id)));
    const ids = imageVectors.flatMap((i) => (i.vectorId ? [i.vectorId] : []));
    if (env.APP_MODE !== 'mock' && ids.length) await env.CATALOG_INDEX.deleteByIds(ids);
    await db
      .update(images)
      .set({ vectorId: null })
      .where(and(eq(images.workspaceId, job.workspaceId), eq(images.productId, product.id)));
    if (env.APP_MODE === 'mock')
      await db
        .delete(localVectors)
        .where(
          and(
            eq(localVectors.workspaceId, job.workspaceId),
            eq(localVectors.productId, product.id),
          ),
        );
    else
      await env.CATALOG_INDEX.deleteByIds([
        ...new Set([vectorId, ...(product.vectorId ? [product.vectorId] : [])]),
      ]);
  } else {
    await indexProductImages(env, job.workspaceId, product.id);
    const p = await getProduct(env, job.workspaceId, product.id);
    const policies = await db
      .select()
      .from(faqs)
      .where(and(eq(faqs.workspaceId, job.workspaceId), eq(faqs.isActive, true)));
    const document = [
      p.name,
      p.sku,
      p.category,
      p.description,
      p.aliases,
      ...p.variants.map((v) => [v.sku, v.title, v.size, v.color, v.attributesJson].join(' ')),
      ...p.faqs.map((f) => `${f.question} ${f.answer}`),
      ...policies.filter((f) => f.productId === null).map((f) => `${f.question} ${f.answer}`),
      ...p.images.map((i) => i.visionDescription),
    ]
      .filter(Boolean)
      .join('\n')
      .slice(0, 20000);
    const values = await inference(env).embed(document);
    if (env.APP_MODE === 'mock')
      await db
        .insert(localVectors)
        .values({
          id: vectorId,
          workspaceId: job.workspaceId,
          productId: product.id,
          document,
          valuesJson: JSON.stringify(values),
          updatedAt: Date.now(),
        })
        .onConflictDoUpdate({
          target: localVectors.id,
          set: { document, valuesJson: JSON.stringify(values), updatedAt: Date.now() },
        });
    else
      await env.CATALOG_INDEX.upsert([
        {
          id: vectorId,
          values,
          namespace: job.workspaceId,
          metadata: {
            workspaceId: job.workspaceId,
            productId: product.id,
            revision: product.revision,
          },
        },
      ]);
  }
  const latest = await db
    .select()
    .from(products)
    .where(and(eq(products.workspaceId, job.workspaceId), eq(products.id, product.id)))
    .get();
  if (!latest || latest.revision !== product.revision) {
    if (env.APP_MODE === 'mock')
      await db
        .delete(localVectors)
        .where(and(eq(localVectors.workspaceId, job.workspaceId), eq(localVectors.id, vectorId)));
    else await env.CATALOG_INDEX.deleteByIds([vectorId]);
    if (latest) await enqueueCatalog(env, job.workspaceId, product.id);
  } else if (product.vectorId && product.vectorId !== vectorId) {
    if (env.APP_MODE === 'mock')
      await db
        .delete(localVectors)
        .where(
          and(eq(localVectors.workspaceId, job.workspaceId), eq(localVectors.id, product.vectorId)),
        );
    else await env.CATALOG_INDEX.deleteByIds([product.vectorId]);
  }
  await db
    .update(products)
    .set({ indexStatus: 'indexed', vectorId })
    .where(
      and(
        eq(products.workspaceId, job.workspaceId),
        eq(products.id, product.id),
        eq(products.revision, product.revision),
      ),
    );
  await db
    .update(catalogJobs)
    .set({ status: 'processed', errorCategory: null })
    .where(and(eq(catalogJobs.workspaceId, job.workspaceId), eq(catalogJobs.id, jobId)));
}
