import { apiOrigin } from '../env';
import { Hono } from 'hono';
import { and, eq, gt } from 'drizzle-orm';
import { database } from '../db/client';
import { temporaryImages, pages, messages, settings } from '../db/schema';
import { authenticated, workspace, csrf, type AppContext } from '../services/sessions';
import { required, AppError } from '../shared/errors';
import { readLimited, validateImage } from '../services/images';
import { persistEvent } from './webhooks-meta';
import { ingestEvent } from '../repositories/conversations';
import { matchCustomerImage } from '../ai/image-understanding';
import { z } from 'zod';
export const customerImageRoutes = new Hono<AppContext>();
customerImageRoutes.use('*', authenticated, workspace, csrf);
customerImageRoutes.get('/:id', async (c) => {
  const image = required(
    await database(c.env)
      .select()
      .from(temporaryImages)
      .where(
        and(
          eq(temporaryImages.workspaceId, c.get('workspaceId')),
          eq(temporaryImages.id, c.req.param('id')),
          gt(temporaryImages.expiresAt, Date.now()),
        ),
      )
      .get(),
  );
  const object = required(await c.env.PRODUCT_IMAGES.get(image.r2Key));
  c.header('Content-Type', object.httpMetadata?.contentType ?? 'application/octet-stream');
  c.header('Cache-Control', 'private, no-store');
  return c.body(object.body);
});
customerImageRoutes.post('/:id/search', async (c) =>
  c.json({
    success: true,
    data: await matchCustomerImage(c.env, c.get('workspaceId'), c.req.param('id')),
  }),
);
export const mockImageRoutes = new Hono<AppContext>();
mockImageRoutes.use('*', authenticated, workspace, csrf);
mockImageRoutes.post('/', async (c) => {
  if (c.env.APP_MODE !== 'mock') throw new AppError('NOT_FOUND', 'Route not found', 404);
  const w = c.get('workspaceId'),
    db = database(c.env);
  const pageId = z.string().min(1).parse(c.req.header('X-Page-ID')),
    customerId = z.string().min(1).max(100).parse(c.req.header('X-Customer-ID'));
  const page = required(
    await db
      .select()
      .from(pages)
      .where(and(eq(pages.workspaceId, w), eq(pages.id, pageId), eq(pages.status, 'active')))
      .get(),
  );
  const bytes = await readLimited(c.req.raw.body, Number(c.env.IMAGE_MAX_BYTES)),
    type = validateImage(bytes, c.req.header('Content-Type') ?? '');
  const id = crypto.randomUUID(),
    imageId = `${id}:0`,
    url = `${apiOrigin(c.env)}/api/customer-images/${imageId}`;
  await persistEvent(c.env, {
    eventId: id,
    pageId: page.facebookPageId,
    senderPsid: customerId,
    timestamp: Date.now(),
    messageId: id,
    type: 'image',
    text: c.req.header('X-Image-Query') ?? '',
    attachments: [{ type: 'image', url }],
  });
  const event = required(await ingestEvent(c.env, id)),
    config = required(await db.select().from(settings).where(eq(settings.workspaceId, w)).get());
  const key = `temporary/${w}/${event.customerId}/${imageId}`;
  await c.env.PRODUCT_IMAGES.put(key, bytes, { httpMetadata: { contentType: type } });
  await db.insert(temporaryImages).values({
    id: imageId,
    workspaceId: w,
    customerId: event.customerId,
    r2Key: key,
    expiresAt: Date.now() + config.temporaryImageHours * 3600000,
  });
  await db
    .update(messages)
    .set({
      attachmentJson: JSON.stringify([{ type: 'image', url: `/api/customer-images/${imageId}` }]),
    })
    .where(and(eq(messages.workspaceId, w), eq(messages.id, id)));
  await c.env.CONVERSATIONS.getByName(`${page.facebookPageId}:${customerId}`).receive(id);
  return c.json({ success: true, data: { queued: true, imageId } });
});
