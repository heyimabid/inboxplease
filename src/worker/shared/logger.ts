type Metric = string | number | boolean | null | undefined;
const allowed = new Set([
  'requestId',
  'jobId',
  'conversationId',
  'model',
  'latencyMs',
  'retrievalLatencyMs',
  'candidateCount',
  'tool',
  'retryCount',
  'errorCategory',
  'inputTokens',
  'outputTokens',
  'handoffCount',
  'orderCount',
  'status',
]);
export function log(event: string, fields: Record<string, Metric> = {}) {
  console.log(
    JSON.stringify({
      event,
      ...Object.fromEntries(Object.entries(fields).filter(([k]) => allowed.has(k))),
    }),
  );
}
