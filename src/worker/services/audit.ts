import { database } from '../db/client';
import { auditEvents } from '../db/schema';
import type { Env } from '../env';
export async function audit(
  env: Env,
  workspaceId: string,
  action: string,
  resourceId: string,
  actorId?: string,
) {
  await database(env).insert(auditEvents).values({
    id: crypto.randomUUID(),
    workspaceId,
    action,
    resourceId,
    actorId,
    createdAt: Date.now(),
  });
}
