# Cloudflare staging setup

**2026-09-12: These resources now back the production `inboxplease` Worker. Do not use this configuration for staging deployments or seed test data into these resources. See [production deployment](cloudflare-production.md).**

Provisioned on 2026-09-11 following the user's Cloudflare setup request. Wrangler authenticated to account `742cce6203b13f0b3376ebaae547be83`. Existing InboxPlease resources belong to an earlier setup, so this build uses separate staging resources.

## Created and verified

| Service       | Resource                           | State                                                                        |
| ------------- | ---------------------------------- | ---------------------------------------------------------------------------- |
| D1            | `inboxplease-staging`              | ID `8316d2c4-47cd-4be0-8556-3c56525625d3`; APAC; all four migrations applied |
| R2            | `inboxplease-staging-images`       | Private; r2.dev access disabled; `temporary/` expires after seven days       |
| Vectorize     | `inboxplease-staging-catalog`      | 1024 dimensions, cosine; `workspaceId` string metadata index verified        |
| Message Queue | `inboxplease-staging-messages`     | Created; consumer configured for deployment                                  |
| Message DLQ   | `inboxplease-staging-messages-dlq` | Created                                                                      |
| Catalog Queue | `inboxplease-staging-catalog`      | Created; consumer configured for deployment                                  |
| Catalog DLQ   | `inboxplease-staging-catalog-dlq`  | Created                                                                      |
| AI Gateway    | `inboxplease-staging`              | Authentication enabled; request logging and Logpush disabled; cache TTL zero |

Remote D1 inspection confirmed all six order/inventory triggers exist and there are no workspaces or orders. Demo fixtures were not uploaded. The first two migrations applied immediately; the third exposed D1's remote splitter handling of unparenthesized `CASE` expressions inside triggers. Parenthesizing those expressions preserved their behavior and allowed the migration to succeed. This is a documented [Cloudflare D1 parser issue](https://github.com/cloudflare/workers-sdk/issues/4727). Local order/integration checks passed after the correction.

Small live Workers AI probes succeeded for BGE-M3 (one vector with 1024 dimensions), Scout (schema-constrained JSON), and BGE reranker (the matching hoodie ranked above an unrelated mug). Scout returned an object in `response`; the adapter and evaluation script now accept both parsed JSON and JSON strings and validate either against the same Zod schema. These probes used synthetic inputs through the Workers AI REST API. Vision, multilingual quality, Gateway routing through the deployed binding and end-to-end Meta messaging remain untested.

The Gateway requires authentication; requests through a Worker binding are pre-authenticated within the account according to [Cloudflare's binding guidance](https://developers.cloudflare.com/ai-gateway/configuration/authentication/). No additional API token is embedded in application code.

## Configuration and secrets

`wrangler.staging.jsonc` pins the account and all staging resource names. `APP_MODE` remains `production`, so public mock login cannot accidentally be enabled. The suggested origin is `https://inboxplease-staging.helloimabid.workers.dev`, derived from the account's existing Workers subdomain. **It is not a deployed URL**: `workers_dev` and preview URLs remain disabled, and no DNS changes were made. Select the intended origin when preparing the release.

Three independent staging secrets were generated in ignored `.secrets/staging.json`, with directory mode 0700 and file mode 0600:

- `META_WEBHOOK_VERIFY_TOKEN`
- `TOKEN_ENCRYPTION_KEY`
- `SESSION_SIGNING_SECRET`

They have not been uploaded because the staging Worker has not been deployed. They are separate from local mock keys. Store them in your password manager before deleting this workspace; do not commit the file or paste its contents into logs/chat. `META_APP_SECRET` must come from the actual Meta app and was not fabricated.

## Commands

Final validation passed: `npm run check` (formatting, lint, strict types, **71 tests across 14 files**, and production build), `npm run dry-run:staging`, and `git diff --check`. Remote migration status reports no pending migrations. Staging resource names were checked for separation from the production template, and generated secret values were absent from all repository candidate files.

```bash
# Read-only checks against staging
npx wrangler d1 migrations list DB --remote --config wrangler.staging.jsonc
npx wrangler vectorize list-metadata-index inboxplease-staging-catalog
npx wrangler r2 bucket lifecycle list inboxplease-staging-images

# Validate the exact bundle without publishing
npm run build
npm run dry-run:staging

# Apply reviewed future migrations only to staging
npm run db:migrate:staging
```

The default `npm run db:migrate` remains local-only. `wrangler.jsonc` remains the separate production template. Use `--config wrangler.staging.jsonc` for every staging operation.

## Before application deployment

Provide App 1 `AUTH_FACEBOOK_ID`, `AUTH_FACEBOOK_GRAPH_API_VERSION`, `AUTH_FACEBOOK_SECRET`, and App 2 `META_APP_ID`, `META_GRAPH_API_VERSION`, `META_APP_SECRET` (plus optional `META_LOGIN_CONFIG_ID`); choose the final HTTPS origin and configure the exact callbacks in [Meta setup](meta-setup.md). The original project brief requires explicit deployment authorization; this setup request has provisioned the supporting services without publishing the application.

On the authorized deployment, Wrangler creates the SQLite `ConversationDO` namespace and attaches the Queue consumers and five-minute schedule. Upload the prepared keys using `npx wrangler secret bulk .secrets/staging.json --config wrangler.staging.jsonc`, and set each Meta app secret separately with `npx wrangler secret put AUTH_FACEBOOK_SECRET --config wrangler.staging.jsonc` and `npx wrangler secret put META_APP_SECRET --config wrangler.staging.jsonc`. These secret commands can create or update a Worker and are release steps, not read-only checks. Complete the live acceptance checklist before enabling seller traffic.

## Two-app authentication update (2026-09-12)

Migration `0003_late_sway.sql` was applied to local and staging D1 after confirming staging had zero users, sessions and Pages. It adds expiring Messenger onboarding/candidate records and Page activation evidence, and removes stored user access tokens and the combined OAuth state table. The remote migration journal, five-column token-free session table, empty candidate tables and foreign-key integrity were verified. Wrangler reported D1 authorization error 7403 despite a valid-looking login; the authenticated Cloudflare MCP successfully applied the same migration statements and journal entry as a D1 batch. Refresh Wrangler authorization before future remote CLI migrations if that error persists.

Both platform sending switches remain off in staging. No application was deployed and no Meta credentials were uploaded. Final verification: 84 tests across 15 files, 3 Chromium browser tests, static checks, production build, staging dry-run and zero npm audit findings. See [two-app Facebook onboarding](facebook-onboarding.md) for the new callbacks and independent credentials.
