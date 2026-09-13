# Cloudflare setup

The local application is ready to run without an account. Following the user's Cloudflare setup request, isolated staging resources have been provisioned in `wrangler.staging.jsonc`; see the [staging setup record](cloudflare-staging.md). The names below describe the separate, unprovisioned production template in `wrangler.jsonc`.

## Resources and bindings

| Binding          | Resource                        | Configuration                                                                   |
| ---------------- | ------------------------------- | ------------------------------------------------------------------------------- |
| `DB`             | D1 database                     | `inboxplease`; replace the zero UUID with the actual database ID                |
| `PRODUCT_IMAGES` | Private R2 bucket               | `inboxplease-images`; no public bucket access                                   |
| `CATALOG_INDEX`  | Vectorize index                 | `inboxplease-catalog`; cosine, 1024 dimensions for the selected BGE-M3 contract |
| `MESSAGE_QUEUE`  | Queue                           | `inboxplease-messages`, with `inboxplease-messages-dlq`                         |
| `CATALOG_QUEUE`  | Queue                           | `inboxplease-catalog`, with `inboxplease-catalog-dlq`                           |
| `CONVERSATIONS`  | SQLite Durable Object namespace | `ConversationDO`, migration tag `v1`                                            |
| `AI`             | Workers AI                      | Models below; production usage is remote and billable                           |
| `ASSETS`         | Worker static assets            | Vite output in `dist/client`                                                    |

One Worker serves the app and API on the same HTTPS origin. A five-minute scheduled handler repairs pending outboxes and removes expired private data. Create isolated resource sets for staging and production; copy the configuration into a separate staging config, changing **every** database/bucket/index/queue name and Worker name before use.

After authorization, the provisioning commands are:

```bash
npx wrangler d1 create inboxplease
npx wrangler r2 bucket create inboxplease-images
npx wrangler vectorize create inboxplease-catalog --dimensions 1024 --metric cosine
npx wrangler vectorize create-metadata-index inboxplease-catalog --propertyName workspaceId --type string
npx wrangler queues create inboxplease-messages
npx wrangler queues create inboxplease-messages-dlq
npx wrangler queues create inboxplease-catalog
npx wrangler queues create inboxplease-catalog-dlq
```

Verify the selected embedding model’s live vector length **before** provisioning the index. Every Vectorize query includes both the workspace namespace and `workspaceId` metadata filter; create its metadata index before inserting vectors. Metadata filters need configured indexes. [Vectorize metadata filtering](https://developers.cloudflare.com/vectorize/reference/metadata-filtering/)

Add an R2 lifecycle rule for the `temporary/` prefix with a seven-day maximum lifetime as a backstop. The application honors each workspace’s shorter configured expiry (default 24 hours) through scheduled deletion and rejects expired image reads immediately. Original seller images and delivery derivatives use the `catalog/` prefix and must not use that expiry rule. [R2 object lifecycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)

## Secrets and public settings

Use `wrangler secret put NAME --config wrangler.jsonc` for each production secret; do not paste values into config or command history:

- `AUTH_FACEBOOK_SECRET`: App 1 (seller identity) secret.
- `META_APP_SECRET`: App 2 (Messenger and Page authorization) secret.
- `META_WEBHOOK_VERIFY_TOKEN`: an independently generated high-entropy verification token.
- `TOKEN_ENCRYPTION_KEY`: base64 encoding of exactly 32 random bytes for AES-256-GCM.
- `SESSION_SIGNING_SECRET`: independent high-entropy session and media signing secret.
- Optional `TOKEN_ENCRYPTION_PREVIOUS_KEYS`: JSON object mapping previous key versions to base64 AES keys.

`TOKEN_KEY_VERSION` identifies the current encryption key. Retain older keys until all relevant Page/candidate tokens have been re-encrypted or pending candidates have expired. Reconnecting a Page writes its token with the current key. Remove old keys only after verifying no stored token uses them. Rotating the session signing secret invalidates existing sessions and signed media links.

Set these public values in `wrangler.jsonc`:

| Variable                                                                               | Required value                                                                          |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `APP_MODE`                                                                             | `production`                                                                            |
| `APP_ORIGIN`                                                                           | Exact HTTPS origin, with no trailing slash                                              |
| `META_APP_ID`                                                                          | From the separate Messenger app                                                         |
| `META_GRAPH_API_VERSION`                                                               | Explicit supported `vN.N` version selected after checking the app’s current API support |
| `CHAT_MODEL`, `VISION_MODEL`                                                           | Defaults: `@cf/meta/llama-4-scout-17b-16e-instruct`                                     |
| `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`                                              | `@cf/baai/bge-m3`, `1024`; runtime output length is validated                           |
| `RERANK_MODEL`                                                                         | `@cf/baai/bge-reranker-base`, or empty to disable                                       |
| `AI_GATEWAY_ID`                                                                        | Existing Gateway ID, or empty to use direct binding calls                               |
| `DEBOUNCE_MS`, `DEBOUNCE_MAX_MS`                                                       | `2500`, `8000`                                                                          |
| `IMAGE_MAX_BYTES`                                                                      | `5242880` by default                                                                    |
| `IMAGE_NEAR_DUPLICATE_DISTANCE`, `IMAGE_PROBABLE_THRESHOLD`, `IMAGE_SIMILAR_THRESHOLD` | Empty until calibrated on labeled seller/customer image pairs                           |
| `MESSENGER_WINDOW_HOURS`                                                               | `24`; the application caps it at 24                                                     |

App 1 additionally requires `AUTH_FACEBOOK_ID` and `AUTH_FACEBOOK_GRAPH_API_VERSION`. App 2 can optionally use `META_LOGIN_CONFIG_ID` for its Login for Business configuration. Set `AI_ENABLED` and `MESSAGING_ENABLED` explicitly; both ship as `false` in staging/production. The separate Page AI opt-in and workspace setting must also be enabled. See [two-app onboarding](facebook-onboarding.md).

Create an AI Gateway through the Cloudflare dashboard if desired. Structured chat/vision calls set `skipCache: true` and `collectLog: false` to avoid storing private conversations in Gateway logs. Embeddings/reranking use the Workers AI binding directly. Review your account’s retention and observability controls separately. [Workers AI through Gateway](https://developers.cloudflare.com/ai-gateway/usage/providers/workersai/)

## Local configuration

`wrangler.local.jsonc` omits AI/Vectorize bindings and uses explicit mock adapters for those services and Meta. D1/R2/Queues/DO execute locally in workerd. `npm run setup:local` creates ignored random keys, applies migrations and inserts fictional demo fixtures. It adds the current Codespaces forwarded origin to `MOCK_APP_ORIGINS`; this list is ignored in production. For another preview host, add its exact origin to that comma-separated local variable, restart the Worker, and configure Vite’s allowed host if necessary.

Binding type generation and dry-run use the installed Wrangler schema. The supported Cloudflare test plugin is `@cloudflare/vitest-plugin`, with `cloudflareTest` and `readD1Migrations`; tests exercise actual local D1/R2/DO behavior. [Workers Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/)
