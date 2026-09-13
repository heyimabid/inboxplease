import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq, desc } from 'drizzle-orm';
import { database } from '../db/client';
import { orders, orderItems } from '../db/schema';
import { authenticated, workspace, csrf, type AppContext } from '../services/sessions';
import { pagination } from '../shared/validation';
import { required, AppError } from '../shared/errors';
import { audit } from '../services/audit';
export const orderRoutes = new Hono<AppContext>();
orderRoutes.use('*', authenticated, workspace, csrf);
orderRoutes.get('/', async (c) => {
  const p = pagination.parse(c.req.query());
  return c.json({
    success: true,
    data: await database(c.env)
      .select()
      .from(orders)
      .where(eq(orders.workspaceId, c.get('workspaceId')))
      .orderBy(desc(orders.createdAt))
      .limit(p.limit)
      .offset(p.offset),
  });
});
orderRoutes.get('/:id', async (c) => {
  const w = c.get('workspaceId'),
    db = database(c.env),
    id = c.req.param('id');
  const order = required(
    await db
      .select()
      .from(orders)
      .where(and(eq(orders.workspaceId, w), eq(orders.id, id)))
      .get(),
  );
  const items = await db
    .select()
    .from(orderItems)
    .where(and(eq(orderItems.workspaceId, w), eq(orderItems.orderId, id)));
  return c.json({ success: true, data: { ...order, items } });
});
orderRoutes.post('/:id/status', async (c) => {
  const { status } = z
    .object({ status: z.enum(['processing', 'shipped', 'delivered', 'cancelled']) })
    .strict()
    .parse(await c.req.json());
  const w = c.get('workspaceId'),
    db = database(c.env),
    id = c.req.param('id');
  const order = required(
    await db
      .select()
      .from(orders)
      .where(and(eq(orders.workspaceId, w), eq(orders.id, id)))
      .get(),
  );
  const allowed: Record<string, string[]> = {
    confirmed: ['processing', 'cancelled'],
    processing: ['shipped', 'cancelled'],
    shipped: ['delivered'],
    delivered: [],
    cancelled: [],
  };
  if (order.status !== status && !allowed[order.status]?.includes(status))
    throw new AppError('INVALID_ORDER_TRANSITION', 'That order status change is not allowed', 409);
  await db
    .update(orders)
    .set({ status, updatedAt: Date.now() })
    .where(and(eq(orders.workspaceId, w), eq(orders.id, id), eq(orders.status, order.status)));
  await audit(c.env, w, `order.${status}`, id, c.get('session').userId);
  return c.json({ success: true, data: { id, status } });
});
