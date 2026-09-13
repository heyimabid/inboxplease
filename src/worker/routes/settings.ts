import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq, isNull } from 'drizzle-orm';
import { database } from '../db/client';
import { settings, faqs, deliveryZones, products, members, users } from '../db/schema';
import {
  authenticated,
  workspace,
  csrf,
  requireAdmin,
  type AppContext,
} from '../services/sessions';
import { faqInput, money } from '../shared/validation';
import { required } from '../shared/errors';
import { getProduct } from '../repositories/products';
import { touchProduct } from '../services/product-indexer';
export const settingsRoutes = new Hono<AppContext>();
settingsRoutes.use('*', authenticated, workspace, csrf);
settingsRoutes.get('/', async (c) => {
  const db = database(c.env),
    w = c.get('workspaceId');
  const [config, policies, delivery, team] = await Promise.all([
    db.select().from(settings).where(eq(settings.workspaceId, w)).get(),
    db.select().from(faqs).where(eq(faqs.workspaceId, w)),
    db.select().from(deliveryZones).where(eq(deliveryZones.workspaceId, w)),
    db
      .select({ userId: members.userId, name: users.name, role: members.role })
      .from(members)
      .innerJoin(users, eq(users.id, members.userId))
      .where(eq(members.workspaceId, w)),
  ]);
  return c.json({ success: true, data: { config, policies, delivery, team } });
});
settingsRoutes.put('/', async (c) => {
  requireAdmin(c);
  const input = z
    .object({
      autoReply: z.boolean(),
      tone: z.enum(['friendly', 'concise', 'warm']),
      responseStyle: z.enum(['match_customer', 'english', 'bangla', 'banglish', 'mixed']),
      handoffRules: z.string().max(2000),
      retentionDays: z.number().int().min(1).max(365),
      temporaryImageHours: z.number().int().min(1).max(168),
      normalization: z.record(z.string().max(60), z.string().max(100)).default({}),
    })
    .strict()
    .parse(await c.req.json());
  const { normalization, ...fields } = input;
  await database(c.env)
    .update(settings)
    .set({ ...fields, normalizationJson: JSON.stringify(normalization), updatedAt: Date.now() })
    .where(eq(settings.workspaceId, c.get('workspaceId')));
  return c.json({ success: true, data: fields });
});
async function reindexPolicies(c: Parameters<typeof requireAdmin>[0], productId: string | null) {
  const w = c.get('workspaceId');
  if (productId) {
    await touchProduct(c.env, w, productId);
    return;
  }
  const all = await database(c.env)
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.workspaceId, w), isNull(products.deletedAt)));
  for (const p of all) await touchProduct(c.env, w, p.id);
}
settingsRoutes.post('/faqs', async (c) => {
  requireAdmin(c);
  const input = faqInput.parse(await c.req.json()),
    w = c.get('workspaceId');
  if (input.productId) await getProduct(c.env, w, input.productId);
  const id = crypto.randomUUID();
  await database(c.env)
    .insert(faqs)
    .values({ id, workspaceId: w, ...input });
  await reindexPolicies(c, input.productId);
  return c.json({ success: true, data: { id } }, 201);
});
settingsRoutes.put('/faqs/:id', async (c) => {
  requireAdmin(c);
  const input = faqInput.parse(await c.req.json()),
    w = c.get('workspaceId');
  const db = database(c.env);
  const old = required(
    await db
      .select()
      .from(faqs)
      .where(and(eq(faqs.workspaceId, w), eq(faqs.id, c.req.param('id'))))
      .get(),
  );
  if (input.productId) await getProduct(c.env, w, input.productId);
  await db
    .update(faqs)
    .set({ ...input, updatedAt: Date.now() })
    .where(and(eq(faqs.workspaceId, w), eq(faqs.id, old.id)));
  await reindexPolicies(c, input.productId);
  if (old.productId !== input.productId) await reindexPolicies(c, old.productId);
  return c.json({ success: true, data: { id: old.id } });
});
settingsRoutes.delete('/faqs/:id', async (c) => {
  requireAdmin(c);
  const db = database(c.env),
    w = c.get('workspaceId');
  const old = required(
    await db
      .select()
      .from(faqs)
      .where(and(eq(faqs.workspaceId, w), eq(faqs.id, c.req.param('id'))))
      .get(),
  );
  await db.delete(faqs).where(and(eq(faqs.workspaceId, w), eq(faqs.id, old.id)));
  await reindexPolicies(c, old.productId);
  return c.json({ success: true, data: { deleted: true } });
});
const zoneInput = z
  .object({
    name: z.string().trim().min(2).max(100),
    fee: money,
    currency: z.string().regex(/^[A-Z]{3}$/),
    estimatedDays: z.string().max(100).nullable().default(null),
    isActive: z.boolean().default(true),
  })
  .strict();
settingsRoutes.post('/delivery', async (c) => {
  requireAdmin(c);
  const input = zoneInput.parse(await c.req.json());
  const id = crypto.randomUUID();
  await database(c.env)
    .insert(deliveryZones)
    .values({ id, workspaceId: c.get('workspaceId'), ...input });
  return c.json({ success: true, data: { id } }, 201);
});
settingsRoutes.put('/delivery/:id', async (c) => {
  requireAdmin(c);
  const input = zoneInput.parse(await c.req.json()),
    w = c.get('workspaceId'),
    id = c.req.param('id');
  const db = database(c.env);
  required(
    await db
      .select()
      .from(deliveryZones)
      .where(and(eq(deliveryZones.workspaceId, w), eq(deliveryZones.id, id)))
      .get(),
  );
  await db
    .update(deliveryZones)
    .set({ ...input, updatedAt: Date.now() })
    .where(and(eq(deliveryZones.workspaceId, w), eq(deliveryZones.id, id)));
  return c.json({ success: true, data: { id } });
});
