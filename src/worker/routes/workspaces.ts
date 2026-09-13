import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { database } from '../db/client';
import { workspaces, members, settings, sessions } from '../db/schema';
import { authenticated, csrf, type AppContext } from '../services/sessions';
import { slug } from '../shared/validation';
import { required } from '../shared/errors';
export const workspaceRoutes = new Hono<AppContext>();
workspaceRoutes.use('*', authenticated, csrf);
workspaceRoutes.post('/', async (c) => {
  const input = z
    .object({
      name: z.string().trim().min(2).max(100),
      currency: z
        .string()
        .regex(/^[A-Z]{3}$/)
        .default('BDT'),
      timezone: z
        .string()
        .refine((s) => {
          try {
            new Intl.DateTimeFormat('en', { timeZone: s });
            return true;
          } catch {
            return false;
          }
        })
        .default('Asia/Dhaka'),
    })
    .parse(await c.req.json());
  const id = crypto.randomUUID();
  const db = database(c.env);
  const s = c.get('session');
  await db.batch([
    db.insert(workspaces).values({ id, ...input, slug: `${slug(input.name)}-${id.slice(0, 8)}` }),
    db
      .insert(members)
      .values({ workspaceId: id, userId: s.userId, role: 'owner', createdAt: Date.now() }),
    db.insert(settings).values({ workspaceId: id, updatedAt: Date.now() }),
    db.update(sessions).set({ workspaceId: id }).where(eq(sessions.id, s.id)),
  ]);
  return c.json({ success: true, data: { id, ...input } }, 201);
});
workspaceRoutes.post('/:id/select', async (c) => {
  const id = c.req.param('id');
  const s = c.get('session');
  const db = database(c.env);
  required(
    await db
      .select()
      .from(members)
      .where(and(eq(members.workspaceId, id), eq(members.userId, s.userId)))
      .get(),
  );
  await db.update(sessions).set({ workspaceId: id }).where(eq(sessions.id, s.id));
  return c.json({ success: true, data: { workspaceId: id } });
});
