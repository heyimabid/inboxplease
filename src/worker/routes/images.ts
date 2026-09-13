import { Hono } from 'hono';
import { and, eq, isNull } from 'drizzle-orm';
import { database } from '../db/client';
import { images, products } from '../db/schema';
import { authenticated, workspace, type AppContext } from '../services/sessions';
import { required, AppError } from '../shared/errors';
import { validDelivery } from '../services/images';
export const imageRoutes = new Hono<AppContext>();
imageRoutes.use('*', authenticated, workspace);
imageRoutes.get('/:id', async (c) => {
  const image = required(
    await database(c.env)
      .select()
      .from(images)
      .where(and(eq(images.workspaceId, c.get('workspaceId')), eq(images.id, c.req.param('id'))))
      .get(),
  );
  const body = required(
    await c.env.PRODUCT_IMAGES.get(
      image.publicUrlOrDeliveryKey === image.id ? image.r2Key : image.publicUrlOrDeliveryKey,
    ),
  );
  c.header('Content-Type', body.httpMetadata?.contentType ?? 'application/octet-stream');
  c.header('Cache-Control', 'private, max-age=60');
  return c.body(body.body);
});
export const mediaRoutes = new Hono<AppContext>();
mediaRoutes.get('/:workspaceId/:id', async (c) => {
  const w = c.req.param('workspaceId'),
    id = c.req.param('id');
  if (
    !(await validDelivery(c.env, w, id, c.req.query('expires') ?? '', c.req.query('token') ?? ''))
  )
    throw new AppError('FORBIDDEN', 'Image link expired', 403);
  const record = required(
    await database(c.env)
      .select({ key: images.r2Key, deliveryKey: images.publicUrlOrDeliveryKey })
      .from(images)
      .innerJoin(
        products,
        and(
          eq(products.id, images.productId),
          eq(products.workspaceId, w),
          eq(products.status, 'active'),
          isNull(products.deletedAt),
        ),
      )
      .where(and(eq(images.workspaceId, w), eq(images.id, id)))
      .get(),
  );
  const body = required(
    await c.env.PRODUCT_IMAGES.get(record.deliveryKey === id ? record.key : record.deliveryKey),
  );
  c.header('Content-Type', body.httpMetadata?.contentType ?? 'application/octet-stream');
  c.header('Cache-Control', 'private, no-store');
  return c.body(body.body);
});
