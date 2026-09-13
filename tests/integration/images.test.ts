import { it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { orchestrate } from '../../src/worker/ai/orchestrator';
import { env } from 'cloudflare:workers';
import { encode } from 'fast-png';
import { createStore } from '../fixtures/store';
import { database } from '../../src/worker/db/client';
import {
  images,
  customers,
  temporaryImages,
  products,
  conversations,
} from '../../src/worker/db/schema';
import { sha256 } from '../../src/worker/services/encryption';
import { matchCustomerImage, indexProductImages } from '../../src/worker/ai/image-understanding';
it('matches actual R2 image bytes within the owning workspace only', async () => {
  const { w, page, product } = await createStore(),
    other = await createStore();
  const bytes = encode({
    width: 2,
    height: 2,
    channels: 4,
    data: new Uint8Array([0, 0, 0, 255, 20, 20, 20, 255, 40, 40, 40, 255, 60, 60, 60, 255]),
  });
  const buffer = new Uint8Array(bytes).buffer;
  const imageId = crypto.randomUUID(),
    customerId = crypto.randomUUID(),
    tempId = crypto.randomUUID();
  await env.PRODUCT_IMAGES.put(`catalog/${w}/${imageId}`, buffer, {
    httpMetadata: { contentType: 'image/png' },
  });
  await database(env)
    .insert(images)
    .values({
      id: imageId,
      workspaceId: w,
      productId: product,
      r2Key: `catalog/${w}/${imageId}`,
      publicUrlOrDeliveryKey: imageId,
      sha256: await sha256(buffer),
      createdAt: Date.now(),
    });
  await database(env).insert(customers).values({
    id: customerId,
    workspaceId: w,
    facebookPageId: page,
    platformCustomerId: customerId,
  });
  await env.PRODUCT_IMAGES.put(`temporary/${w}/${tempId}`, buffer, {
    httpMetadata: { contentType: 'image/png' },
  });
  await database(env)
    .insert(temporaryImages)
    .values({
      id: tempId,
      workspaceId: w,
      customerId,
      r2Key: `temporary/${w}/${tempId}`,
      expiresAt: Date.now() + 3600000,
    });
  await indexProductImages(env, w, product);
  const result = await matchCustomerImage(env, w, tempId);
  expect(result.match.kind).toBe('exact_file');
  expect(result.products.map((p) => p.id)).toEqual([product]);
  expect(result.products[0]?.images[0]?.url).toBe(`/api/images/${imageId}`);
  await expect(matchCustomerImage(env, other.w, tempId)).rejects.toThrow();
});

it('offers different earbuds only with affirmative product-type evidence and honest reply wording', async () => {
  const { vi } = await import('vitest');
  const s = await createStore(),
    db = database(env),
    customerId = crypto.randomUUID(),
    imageId = crypto.randomUUID(),
    tempId = crypto.randomUUID();
  const raster = (color: number) =>
    new Uint8Array(
      encode({ width: 2, height: 2, channels: 4, data: new Uint8Array(16).fill(color) }),
    ).buffer;
  const catalogBytes = raster(120),
    customerBytes = raster(200);
  await db.insert(customers).values({
    id: customerId,
    workspaceId: s.w,
    facebookPageId: s.page,
    platformCustomerId: customerId,
  });
  await env.PRODUCT_IMAGES.put(`catalog/${imageId}`, catalogBytes, {
    httpMetadata: { contentType: 'image/png' },
  });
  await env.PRODUCT_IMAGES.put(`temporary/${tempId}`, customerBytes, {
    httpMetadata: { contentType: 'image/png' },
  });
  await db.insert(images).values({
    id: imageId,
    workspaceId: s.w,
    productId: s.product,
    r2Key: `catalog/${imageId}`,
    publicUrlOrDeliveryKey: imageId,
    sha256: await sha256(catalogBytes),
    createdAt: Date.now(),
  });
  await db.insert(temporaryImages).values({
    id: tempId,
    workspaceId: s.w,
    customerId,
    r2Key: `temporary/${tempId}`,
    expiresAt: Date.now() + 3600000,
  });
  await db
    .update(products)
    .set({ name: 'Black earbuds', normalizedName: 'black earbuds' })
    .where(eq(products.id, s.product));
  const conversationId = crypto.randomUUID();
  await db.insert(conversations).values({
    id: conversationId,
    workspaceId: s.w,
    facebookPageId: s.page,
    customerId,
    lastMessageAt: Date.now(),
    lastCustomerMessageAt: Date.now(),
  });
  for (const [sameProduct, sameProductType, expected] of [
    [false, false, 'none'],
    [true, false, 'uncertain'],
    [false, true, 'category_alternatives'],
  ] as const) {
    const run = vi
      .fn()
      .mockResolvedValueOnce({
        response: {
          category: 'earbuds',
          subcategory: null,
          primaryColor: 'black',
          secondaryColors: [],
          pattern: null,
          materialGuess: null,
          visibleText: [],
          distinctiveFeatures: [],
          description: 'Black earbuds',
        },
      })
      .mockResolvedValueOnce({
        response: {
          sameProduct,
          sameProductType,
          score: sameProduct ? 0.99 : 0.01,
          similarities: [],
          differences: sameProduct ? [] : ['Different object category'],
        },
      });
    const testEnv = {
      ...env,
      APP_MODE: 'production',
      AI: { run } as unknown as typeof env.AI,
      IMAGE_PROBABLE_THRESHOLD: '',
      IMAGE_SIMILAR_THRESHOLD: '',
      IMAGE_NEAR_DUPLICATE_DISTANCE: '',
    };
    const result = await matchCustomerImage(testEnv, s.w, tempId);
    expect(result.match.kind).toBe(expected);
    expect(result.products.map((p) => p.id)).toEqual(sameProductType ? [s.product] : []);
    expect(run).toHaveBeenCalledTimes(2);
    run
      .mockResolvedValueOnce(run.mock.results[0]!.value)
      .mockResolvedValueOnce(run.mock.results[1]!.value);
    const reply = await orchestrate(
      testEnv,
      s.w,
      conversationId,
      'is this available?',
      [],
      [tempId],
    );
    expect(reply?.productIds).toEqual(sameProductType ? [s.product] : []);
    if (sameProductType) {
      expect(reply?.text).toContain('can’t confirm the exact model');
      expect(reply?.text).toContain('alternatives of the same product type');
      expect(reply?.text).toContain('Black earbuds');
      expect(JSON.parse(String(reply?.metadata.imageMatch)).kind).toBe('category_alternatives');
    }
    expect(run).toHaveBeenCalledTimes(4);
  }
});
