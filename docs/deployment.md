# Deployment and operations

No application deployment has been performed. The supporting [Cloudflare staging resources](cloudflare-staging.md) are now provisioned under the user's setup request. Complete [Meta setup](meta-setup.md), then review the exact configuration and obtain release authorization. Use `wrangler.staging.jsonc` for staging; the default configuration is the separate production template.

## Preflight

```bash
npm ci
npm run check
npm run db:generate
npm run dry-run
npm audit
```

`db:generate` should report no unreviewed schema changes. `dry-run` bundles and validates bindings without publishing, provisioning, applying migrations or making Meta calls. The domain and D1 ID placeholders must be replaced before a real deployment. Do not copy local `.dev.vars` or fictional `seed.sql` into production.

Use a separate staging Worker and resources first. Confirm live embedding dimensions, model JSON/image contracts, tenant isolation, Meta OAuth/subscriptions/revocation, image calibration and Messenger response-window behavior. Test the whole order flow: combined messages → exact variant/quantity → validated customer fields → sent full review → explicit confirmation → one stock decrement. Change price/stock immediately before confirmation and ensure the customer must review again.

## Authorized release

After explicit authorization and a database backup, the operator can apply reviewed migrations and publish:

```bash
npx wrangler d1 migrations apply DB --remote --config wrangler.jsonc
npm run build
npx wrangler deploy --config wrangler.jsonc
```

Configure the reviewed custom domain/route in Cloudflare and align `APP_ORIGIN`, Meta OAuth and webhook URLs. The shipped configuration disables workers.dev and preview URLs. Namespace creation uses the SQLite Durable Object migration. Resource names must exist before deployment; do not rely on automatic provisioning.

Run the live acceptance checklist in `meta-setup.md` before enabling automatic replies for an actual seller. New workspaces default automatic replies off. Queue delays, actual latency/cost, provider failure behavior and quality under real catalog load need live monitoring.

## Recovery

- **Failed delivery:** `messages.delivery_status=unknown` means the provider may have accepted a send without returning a usable acknowledgement. The conversation switches to human mode. Check Page Inbox before sending again. Never mass-reset unknown sends to ready.
- **Queue failure:** D1 persists events/catalog jobs before enqueueing. The five-minute scheduled job requeues missing/stale pending outbox entries. Consumers and DO alarms deduplicate. Terminal failures become explicit failed records and Queue DLQs preserve exhausted jobs. Investigate the cause before replaying; replays must retain the same job ID.
- **Catalog indexing failure:** canonical D1 product details remain available; Vectorize never supplies authoritative prices/stock. Fix the cause and save the product to increment its revision and enqueue a fresh job. Editing a store policy marks affected products for reindexing.
- **Human takeover:** the server checks conversation mode before orchestration and again before send. A send already accepted by Meta cannot be recalled; the UI and operational policy must account for an in-flight request at takeover time.
- **Privacy:** scheduled cleanup expires temporary images and old conversation transcripts/handoff excerpts according to workspace settings. Retention is periodic, not a guarantee that bytes disappear at the exact expiry millisecond; API reads reject expired temporary images. Customer deletion clears DO pending state, related database rows and private R2 objects. Keep an R2 lifecycle backstop.
- **Rollback:** inspect deployed versions and use `npx wrangler rollback --config wrangler.jsonc` only after authorization and a compatibility review. A Worker rollback does not undo D1 migrations. Use additive migrations and verified database backups/Time Travel procedures; never blindly reverse inventory transactions.

## Observability and capacity

The app emits redacted event categories, request/conversation/job IDs, model names, token counts, latency, candidate counts, retries and order/handoff counts. It deliberately does not log exception payloads or customer messages. Configure Cloudflare alerts for Worker errors, Queue backlog/DLQ depth, inference failures, cost and D1/R2 usage. AI Gateway chat/vision logging and caching are disabled by request options.

Benchmark before a public launch. Initial catalog/hash scans and per-workspace maintenance are designed for small seller catalogs and must be paginated/sharded for high-volume catalogs or very large workspace counts. Worker CPU and subrequest budgets need measurement with real image sizes and traffic. Bounded JPEG/simple PNG decoding supports up to four megapixels and produces a 1024-pixel delivery image without original metadata. WebP and unsupported/oversized rasters retain their bounded original bytes; exact hashing and vision remain available, but local perceptual hashing/resizing is unavailable for those files.

## Known verification limits

Local model adapters validate application behavior, not language-model accuracy. Real OAuth, App Review access, Page messaging, Workers AI vision/structured output, remote Vectorize consistency, load limits and Gateway account policies remain live release gates. Image score cutoffs intentionally ship unset. The conversational editor asks for seller assistance when changing multiple draft items; the underlying validated item tools and order model support multiple items. Billing, shipping-carrier integrations, marketing broadcasts and automated refunds are outside this build.
