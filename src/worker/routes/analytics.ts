import { Hono } from 'hono';
import { and, eq, gte, sql } from 'drizzle-orm';
import { database } from '../db/client';
import { orders, conversations, messages, handoffs, products } from '../db/schema';
import { authenticated, workspace, type AppContext } from '../services/sessions';
export const analyticsRoutes = new Hono<AppContext>();
analyticsRoutes.use('*', authenticated, workspace);
analyticsRoutes.get('/', async (c) => {
  const db = database(c.env),
    w = c.get('workspaceId'),
    since = Date.now() - 30 * 86400000;
  const [revenue, conversationCount, aiCount, handoffCount, productCount, daily] =
    await Promise.all([
      db
        .select({
          total: sql<number>`coalesce(sum(${orders.total}),0)`,
          count: sql<number>`count(*)`,
        })
        .from(orders)
        .where(
          and(
            eq(orders.workspaceId, w),
            gte(orders.createdAt, since),
            sql`${orders.status} != 'cancelled'`,
          ),
        )
        .get(),
      db
        .select({ count: sql<number>`count(*)` })
        .from(conversations)
        .where(and(eq(conversations.workspaceId, w), gte(conversations.createdAt, since)))
        .get(),
      db
        .select({ count: sql<number>`count(*)` })
        .from(messages)
        .where(
          and(
            eq(messages.workspaceId, w),
            eq(messages.senderType, 'ai'),
            eq(messages.deliveryStatus, 'sent'),
            gte(messages.createdAt, since),
          ),
        )
        .get(),
      db
        .select({ count: sql<number>`count(*)` })
        .from(handoffs)
        .where(and(eq(handoffs.workspaceId, w), gte(handoffs.startedAt, since)))
        .get(),
      db
        .select({ count: sql<number>`count(*)` })
        .from(products)
        .where(and(eq(products.workspaceId, w), eq(products.status, 'active')))
        .get(),
      db
        .select({
          date: sql<string>`date(${orders.createdAt}/1000,'unixepoch')`,
          count: sql<number>`count(*)`,
          total: sql<number>`sum(${orders.total})`,
        })
        .from(orders)
        .where(
          and(
            eq(orders.workspaceId, w),
            gte(orders.createdAt, since),
            sql`${orders.status} != 'cancelled'`,
          ),
        )
        .groupBy(sql`date(${orders.createdAt}/1000,'unixepoch')`),
    ]);
  return c.json({
    success: true,
    data: {
      revenue: revenue?.total ?? 0,
      orders: revenue?.count ?? 0,
      conversations: conversationCount?.count ?? 0,
      aiReplies: aiCount?.count ?? 0,
      handoffs: handoffCount?.count ?? 0,
      activeProducts: productCount?.count ?? 0,
      daily,
    },
  });
});
