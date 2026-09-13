import { beforeEach, describe, it, expect } from 'vitest';
import { env } from 'cloudflare:workers';
import { and, eq } from 'drizzle-orm';
import { database } from '../../src/worker/db/client';
import {
  users,
  workspaces,
  members,
  products,
  variants,
  localVectors,
} from '../../src/worker/db/schema';
import { getProduct, canonicalCandidates } from '../../src/worker/repositories/products';
import { enqueueCatalog, indexProduct } from '../../src/worker/services/product-indexer';
import { app } from '../../src/worker/app';
let a: string, b: string, p: string;
beforeEach(async () => {
  a = crypto.randomUUID();
  b = crypto.randomUUID();
  p = crypto.randomUUID();
  const db = database(env);
  await db.insert(workspaces).values([
    { id: a, name: 'A', slug: a },
    { id: b, name: 'B', slug: b },
  ]);
  await db.insert(products).values({
    id: p,
    workspaceId: a,
    name: 'Black hoodie',
    normalizedName: 'black hoodie',
    slug: p,
    description: 'Cotton',
    basePrice: 149000,
    currency: 'BDT',
    status: 'active',
  });
  await db.insert(variants).values({
    id: crypto.randomUUID(),
    workspaceId: a,
    productId: p,
    sku: p,
    title: 'Black / XL',
    stockOnHand: 2,
  });
});
describe('catalog storage', () => {
  it('scopes product facts and candidate loading', async () => {
    expect((await getProduct(env, a, p)).variants).toHaveLength(1);
    await expect(getProduct(env, b, p)).rejects.toThrow('Product not found');
    expect(await canonicalCandidates(env, b, [p])).toEqual([]);
  });
  it('enforces tenant foreign keys', async () => {
    await expect(
      database(env).insert(variants).values({
        id: crypto.randomUUID(),
        workspaceId: b,
        productId: p,
        sku: p,
        title: 'Foreign',
        stockOnHand: 2,
      }),
    ).rejects.toThrow();
  });
  it('indexes with isolated local vectors and invalidates archives', async () => {
    await enqueueCatalog(env, a, p);
    await indexProduct(env, `${p}:1`);
    await indexProduct(env, `${p}:1`);
    expect(
      await database(env).select().from(localVectors).where(eq(localVectors.workspaceId, a)),
    ).toHaveLength(1);
    await database(env)
      .update(products)
      .set({ status: 'archived', revision: 2 })
      .where(and(eq(products.workspaceId, a), eq(products.id, p)));
    await enqueueCatalog(env, a, p);
    await indexProduct(env, `${p}:2`);
    expect(
      await database(env).select().from(localVectors).where(eq(localVectors.workspaceId, a)),
    ).toHaveLength(0);
  });
  it('allows local login and rejects cross-origin mutations', async () => {
    const request = await app.request(
      '/auth/mock',
      { method: 'POST', headers: { Origin: env.APP_ORIGIN } },
      env,
    );
    expect(request.status).toBe(200);
    expect(request.headers.get('Set-Cookie')).toContain('HttpOnly');
    expect(
      (
        await app.request(
          '/auth/mock',
          { method: 'POST', headers: { Origin: 'https://attacker.invalid' } },
          env,
        )
      ).status,
    ).toBe(403);
  });
  it('authorizes workspace selection by membership', async () => {
    const u = crypto.randomUUID();
    await database(env).insert(users).values({ id: u, facebookUserId: u, name: 'Seller' });
    await database(env)
      .insert(members)
      .values({ workspaceId: a, userId: u, role: 'owner', createdAt: Date.now() });
    expect(
      await database(env)
        .select()
        .from(members)
        .where(and(eq(members.workspaceId, b), eq(members.userId, u))),
    ).toEqual([]);
  });
});

it('always filters remote Vectorize candidates by workspace and reloads canonical prices', async () => {
  const { vi } = await import('vitest');
  const models = await import('../../src/worker/ai/models');
  const { createStore } = await import('../fixtures/store');
  const { searchProducts } = await import('../../src/worker/ai/product-retrieval');
  const a = await createStore(),
    b = await createStore();
  const query = vi.fn().mockResolvedValue({
    matches: [
      { id: 'foreign', score: 1, metadata: { workspaceId: b.w, productId: b.product } },
      { id: 'spoofed', score: 1, metadata: { workspaceId: a.w, productId: b.product } },
      { id: 'own', score: 0.8, metadata: { workspaceId: a.w, productId: a.product } },
    ],
  });
  const mocked = vi.spyOn(models, 'inference').mockReturnValue({
    embed: async () => [1, 0],
    json: async () => {
      throw new Error('Unexpected generation model call');
    },
  });
  try {
    const result = await searchProducts(
      {
        ...env,
        APP_MODE: 'production',
        RERANK_MODEL: '',
        CATALOG_INDEX: {
          query,
          describe: async () => {
            throw new Error('Unexpected index call');
          },
          insert: async () => {
            throw new Error('Unexpected index call');
          },
          upsert: async () => {
            throw new Error('Unexpected index call');
          },
          deleteByIds: async () => {
            throw new Error('Unexpected index call');
          },
          getByIds: async () => {
            throw new Error('Unexpected index call');
          },
        },
      },
      a.w,
      'unmatched wording',
    );
    expect(query).toHaveBeenCalledWith(
      [1, 0],
      expect.objectContaining({ namespace: a.w, filter: { workspaceId: { $eq: a.w } } }),
    );
    expect(result.map((p) => p.id)).toEqual([a.product]);
    expect(result[0]?.basePrice).toBe(149000);
  } finally {
    mocked.mockRestore();
  }
});
