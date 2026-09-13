import { and, eq, or, isNull, lt } from 'drizzle-orm';
import type { ConversationContext } from '../repositories/conversations';
import type { Env } from '../env';
import { database } from '../db/client';
import { customers } from '../db/schema';
import { metaClient } from '../meta/client';
import { decrypt } from './encryption';
import { trustedAttachmentUrl } from '../ai/image-understanding';
import { log } from '../shared/logger';
export async function refreshCustomerProfile(env: Env, context: ConversationContext) {
  if (
    env.APP_MODE === 'mock' ||
    context.page.status !== 'active' ||
    !context.page.encryptedPageAccessToken
  )
    return;
  const db = database(env),
    now = Date.now();
  // Claim a refresh before network I/O, including failed/permission-denied lookups.
  const claimed = await db
    .update(customers)
    .set({ profileFetchedAt: now })
    .where(
      and(
        eq(customers.workspaceId, context.workspaceId),
        eq(customers.id, context.customer.id),
        or(isNull(customers.profileFetchedAt), lt(customers.profileFetchedAt, now - 86400000)),
      ),
    )
    .returning({ id: customers.id });
  if (!claimed.length) return;
  try {
    const token = await decrypt(
      env,
      context.page.encryptedPageAccessToken,
      context.page.tokenKeyVersion,
      `${context.workspaceId}:${context.page.facebookPageId}`,
    );
    const profile = await metaClient(env).customerProfile(
      context.customer.platformCustomerId,
      token,
    );
    let picture: string | null = null;
    if (profile.picture) {
      try {
        picture = trustedAttachmentUrl(profile.picture).toString();
      } catch {
        /* Only Meta image hosts are rendered. */
      }
    }
    await db
      .update(customers)
      .set({ facebookName: profile.name, profilePictureUrl: picture })
      .where(
        and(eq(customers.workspaceId, context.workspaceId), eq(customers.id, context.customer.id)),
      );
  } catch {
    log('customer_profile_unavailable', { errorCategory: 'meta_profile' });
  }
}
