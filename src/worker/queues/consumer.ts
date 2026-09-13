import { webhookEvents } from '../db/schema';
import { normalizedEventSchema } from '../meta/types';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import type { Env } from '../env';
import { database } from '../db/client';
import { catalogJobs, products } from '../db/schema';
import { indexProduct } from '../services/product-indexer';
import { log } from '../shared/logger';
export const jobSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('catalog'), jobId: z.string() }),
  z.object({ kind: z.literal('message'), jobId: z.string() }),
]);
export async function consume(batch: MessageBatch<unknown>, env: Env) {
  for (const message of batch.messages) {
    const parsed = jobSchema.safeParse(message.body);
    if (!parsed.success) {
      message.ack();
      log('queue_invalid_job', { jobId: message.id, errorCategory: 'invalid_job' });
      continue;
    }
    const job = parsed.data;
    try {
      if (job.kind === 'catalog') await indexProduct(env, job.jobId);
      else {
        const event = await database(env)
          .select()
          .from(webhookEvents)
          .where(eq(webhookEvents.id, job.jobId))
          .get();
        if (event && event.status !== 'processed' && event.status !== 'failed') {
          const normalized = normalizedEventSchema.parse(JSON.parse(event.payloadJson));
          await env.CONVERSATIONS.getByName(
            `${normalized.pageId}:${normalized.senderPsid}`,
          ).receive(job.jobId);
        }
      }
      message.ack();
    } catch {
      log('queue_retry', {
        jobId: job.jobId,
        retryCount: message.attempts,
        errorCategory: 'processing',
      });
      if (job.kind === 'catalog') {
        const db = database(env);
        const current = await db
          .select()
          .from(catalogJobs)
          .where(eq(catalogJobs.id, job.jobId))
          .get();
        if (current && message.attempts >= 5) {
          await db
            .update(catalogJobs)
            .set({ status: 'failed', errorCategory: 'indexing' })
            .where(
              and(eq(catalogJobs.workspaceId, current.workspaceId), eq(catalogJobs.id, job.jobId)),
            );
          await db
            .update(products)
            .set({ indexStatus: 'failed' })
            .where(
              and(
                eq(products.workspaceId, current.workspaceId),
                eq(products.id, current.productId),
              ),
            );
        }
      }
      if (job.kind === 'message' && message.attempts >= 5) {
        await database(env)
          .update(webhookEvents)
          .set({
            status: 'failed',
            attemptCount: message.attempts,
            errorMessage: 'queue_delivery_failed',
          })
          .where(eq(webhookEvents.id, job.jobId));
      }
      message.retry({ delaySeconds: Math.min(60, 2 ** message.attempts) });
    }
  }
}
