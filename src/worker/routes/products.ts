import { deliveryImage } from '../services/image-delivery';
import { Hono } from 'hono';
import { and, eq, isNull } from 'drizzle-orm';
import { database } from '../db/client';
import { products, variants, images, workspaces, localVectors } from '../db/schema';
import {
  authenticated,
  workspace,
  csrf,
  requireAdmin,
  type AppContext,
} from '../services/sessions';
import { productInput, variantInput, pagination, normalize, slug } from '../shared/validation';
import { getProduct, listProducts } from '../repositories/products';
import { required, AppError } from '../shared/errors';
import { enqueueCatalog, touchProduct } from '../services/product-indexer';
import { readLimited, validateImage } from '../services/images';
import { sha256 } from '../services/encryption';
export const productRoutes = new Hono<AppContext>();
productRoutes.use('*', authenticated, workspace, csrf);
productRoutes.get('/', async (c) => {
  const p = pagination.parse(c.req.query());
  return c.json({
    success: true,
    data: await listProducts(
      c.env,
      c.get('workspaceId'),
      c.req.query('q') ?? '',
      p.limit,
      p.offset,
    ),
  });
});
productRoutes.get('/:id', async (c) =>
  c.json({ success: true, data: await getProduct(c.env, c.get('workspaceId'), c.req.param('id')) }),
);
productRoutes.post('/', async (c) => {
  requireAdmin(c);
  const input = productInput.parse(await c.req.json());
  const workspaceId = c.get('workspaceId');
  const db = database(c.env);
  const w = required(
    await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).get(),
  );
  if (input.currency !== w.currency)
    throw new AppError('CURRENCY_MISMATCH', 'Use your workspace currency');
  const id = crypto.randomUUID();
  await db.insert(products).values({
    id,
    workspaceId,
    ...input,
    normalizedName: normalize(input.name),
    slug: `${slug(input.name)}-${id.slice(0, 8)}`,
  });
  await enqueueCatalog(c.env, workspaceId, id);
  return c.json({ success: true, data: await getProduct(c.env, workspaceId, id) }, 201);
});
productRoutes.put('/:id', async (c) => {
  requireAdmin(c);
  const input = productInput.parse(await c.req.json());
  const w = c.get('workspaceId'),
    id = c.req.param('id');
  const p = await getProduct(c.env, w, id);
  if (input.currency !== p.currency)
    throw new AppError('CURRENCY_MISMATCH', 'Product currency cannot change');
  await database(c.env)
    .update(products)
    .set({ ...input, normalizedName: normalize(input.name), updatedAt: Date.now() })
    .where(and(eq(products.workspaceId, w), eq(products.id, id)));
  await touchProduct(c.env, w, id);
  return c.json({ success: true, data: await getProduct(c.env, w, id) });
});
productRoutes.delete('/:id', async (c) => {
  requireAdmin(c);
  const w = c.get('workspaceId'),
    id = c.req.param('id');
  await getProduct(c.env, w, id);
  await database(c.env)
    .update(products)
    .set({ status: 'archived', deletedAt: Date.now() })
    .where(and(eq(products.workspaceId, w), eq(products.id, id)));
  await touchProduct(c.env, w, id);
  return c.json({ success: true, data: { archived: true } });
});
productRoutes.post('/:id/variants', async (c) => {
  requireAdmin(c);
  const input = variantInput.parse(await c.req.json());
  const w = c.get('workspaceId'),
    productId = c.req.param('id');
  await getProduct(c.env, w, productId);
  const { attributes, ...fields } = input;
  const id = crypto.randomUUID();
  await database(c.env)
    .insert(variants)
    .values({
      id,
      workspaceId: w,
      productId,
      ...fields,
      attributesJson: JSON.stringify(attributes),
    });
  await touchProduct(c.env, w, productId);
  return c.json({ success: true, data: { id } }, 201);
});
productRoutes.put('/:id/variants/:variantId', async (c) => {
  requireAdmin(c);
  const input = variantInput.parse(await c.req.json());
  const w = c.get('workspaceId'),
    id = c.req.param('id'),
    v = c.req.param('variantId');
  await getProduct(c.env, w, id);
  const db = database(c.env);
  const old = required(
    await db
      .select()
      .from(variants)
      .where(and(eq(variants.workspaceId, w), eq(variants.productId, id), eq(variants.id, v)))
      .get(),
  );
  if (input.stockOnHand < old.reservedStock)
    throw new AppError('RESERVED_STOCK', 'Stock cannot be below reserved units', 409);
  const { attributes, ...fields } = input;
  await db
    .update(variants)
    .set({ ...fields, attributesJson: JSON.stringify(attributes), updatedAt: Date.now() })
    .where(and(eq(variants.workspaceId, w), eq(variants.id, v)));
  await touchProduct(c.env, w, id);
  return c.json({ success: true, data: { id: v } });
});
productRoutes.post('/:id/images', async (c) => {
  requireAdmin(c);
  const workspaceId = c.get('workspaceId'),
    productId = c.req.param('id');
  await getProduct(c.env, workspaceId, productId);
  const bytes = await readLimited(c.req.raw.body, Number(c.env.IMAGE_MAX_BYTES));
  const type = validateImage(bytes, c.req.header('Content-Type') ?? '');
  const id = crypto.randomUUID(),
    key = `catalog/${workspaceId}/${productId}/${id}`;
  const deliveryKey = `${key}/delivery`;
  const delivery = deliveryImage(bytes, type);
  await c.env.PRODUCT_IMAGES.put(key, bytes, { httpMetadata: { contentType: type } });
  await c.env.PRODUCT_IMAGES.put(deliveryKey, delivery.bytes, {
    httpMetadata: { contentType: delivery.type },
  });
  await database(c.env)
    .insert(images)
    .values({
      id,
      workspaceId,
      productId,
      r2Key: key,
      publicUrlOrDeliveryKey: deliveryKey,
      sha256: await sha256(bytes),
      createdAt: Date.now(),
      altText: c.req.header('X-Image-Alt')?.slice(0, 300) ?? null,
    });
  await touchProduct(c.env, workspaceId, productId);
  return c.json({ success: true, data: { id, url: `/api/images/${id}` } }, 201);
});
productRoutes.delete('/:id/images/:imageId', async (c) => {
  requireAdmin(c);
  const w = c.get('workspaceId'),
    productId = c.req.param('id');
  const db = database(c.env);
  const image = required(
    await db
      .select()
      .from(images)
      .innerJoin(
        products,
        and(
          eq(products.id, images.productId),
          eq(products.workspaceId, w),
          isNull(products.deletedAt),
        ),
      )
      .where(
        and(
          eq(images.workspaceId, w),
          eq(images.productId, productId),
          eq(images.id, c.req.param('imageId')),
        ),
      )
      .get(),
  );
  if (image.product_images.vectorId) {
    if (c.env.APP_MODE === 'mock')
      await db
        .delete(localVectors)
        .where(
          and(eq(localVectors.workspaceId, w), eq(localVectors.id, image.product_images.vectorId)),
        );
    else await c.env.CATALOG_INDEX.deleteByIds([image.product_images.vectorId]);
  }
  await c.env.PRODUCT_IMAGES.delete(image.product_images.r2Key);
  if (image.product_images.publicUrlOrDeliveryKey !== image.product_images.id)
    await c.env.PRODUCT_IMAGES.delete(image.product_images.publicUrlOrDeliveryKey);
  await db
    .delete(images)
    .where(and(eq(images.workspaceId, w), eq(images.id, c.req.param('imageId'))));
  await touchProduct(c.env, w, productId);
  return c.json({ success: true, data: { deleted: true } });
});
