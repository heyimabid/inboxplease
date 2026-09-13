import { Hono } from 'hono';
import { eq, asc } from 'drizzle-orm';
import { database } from '../db/client';
import { enqueueCatalog } from '../services/product-indexer';
import { and } from 'drizzle-orm';
import { products, sessions, users, members, workspaces } from '../db/schema';
import { createSession, readSession, logout, csrf, type AppContext } from '../services/sessions';
import { AppError } from '../shared/errors';
export const authRoutes = new Hono<AppContext>();
authRoutes.get('/session', async (c) => {
  const session = await readSession(c);
  if (!session) return c.json({ success: true, data: null });
  const db = database(c.env);
  const user = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, session.userId))
    .get();
  const available = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      currency: workspaces.currency,
      role: members.role,
    })
    .from(members)
    .innerJoin(workspaces, eq(workspaces.id, members.workspaceId))
    .where(eq(members.userId, session.userId));
  return c.json({
    success: true,
    data: { user, workspaces: available, workspaceId: session.workspaceId, mode: c.env.APP_MODE },
  });
});
authRoutes.post('/mock', csrf, async (c) => {
  if (c.env.APP_MODE !== 'mock') throw new AppError('NOT_FOUND', 'Route not found', 404);
  const db = database(c.env);
  let user = await db.select().from(users).where(eq(users.facebookUserId, 'local-seller')).get();
  if (!user) {
    user = (
      await db
        .insert(users)
        .values({ id: crypto.randomUUID(), facebookUserId: 'local-seller', name: 'Local seller' })
        .returning()
    )[0];
  }
  if (!user) throw new Error('Could not create local user');
  await logout(c);
  const sessionId = await createSession(c, user.id);
  const member = await db
    .select()
    .from(members)
    .where(eq(members.userId, user.id))
    .orderBy(asc(members.createdAt))
    .get();
  if (member)
    await db
      .update(sessions)
      .set({ workspaceId: member.workspaceId })
      .where(eq(sessions.id, sessionId));
  if (member) {
    const pending = await db
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.workspaceId, member.workspaceId), eq(products.indexStatus, 'pending')))
      .limit(100);
    for (const product of pending) await enqueueCatalog(c.env, member.workspaceId, product.id);
  }
  return c.json({ success: true, data: { signedIn: true } });
});
authRoutes.post('/logout', csrf, async (c) => {
  await logout(c);
  return c.json({ success: true, data: { signedOut: true } });
});
