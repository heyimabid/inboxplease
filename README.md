# InboxPlease

A multi-tenant seller workspace for Facebook Page commerce. Manage a verified catalog, answer English/Bangla/Banglish messages, match customer photos, collect order details and hand conversations to a person.

The application is deployed to Cloudflare at [inboxplease.helloimabid.com](https://inboxplease.helloimabid.com), with the API at `api.inboxplease.helloimabid.com`. **Meta credentials are installed; interactive Facebook sign-in and live Page onboarding verification remain outstanding.** See the [production deployment record](docs/cloudflare-production.md).

## Run locally

Requires Node.js 22.12+ (Node 24 recommended) and npm. No Meta or Cloudflare account is needed for mock mode.

```bash
npm ci
npm run setup:local
npm run dev
```

Open **http://localhost:5173** (or the Codespaces forwarded port 5173) and choose **Explore local workspace**. Setup generates random local secrets in the ignored `.dev.vars`, applies local D1 migrations, and seeds the Everyday Studio catalog. The Vite frontend proxies the local Worker at port 8787; D1, R2, Queues and Durable Objects run in workerd. Local AI and semantic indexing are explicitly deterministic adapters.

1. In **Settings**, connect **Your local shop**. Only the selected Page is connected; enable its separate **Enable AI** switch when ready.
2. Review the seeded products, variants, delivery zones and policies. Upload a product image to try matching identical files.
3. In **Inbox**, choose **Try a conversation**. Keep the same customer ID across messages.
4. Send `black hoodie XL quantity 1 order korbo`, then `name Abid phone 01712345678 address Mirpur 10, Dhaka area Dhakar vitore`.
5. Wait for the complete order summary, then send `confirm`. Open **Orders** to view it.
6. Choose **Take over** to stop automatic responses. Incoming messages continue to appear.

Create another workspace from the sidebar to test an empty store. Setup includes fictional English, Bangla and Banglish conversation fixtures. Local Page IDs are unique across workspaces, just like real Page IDs.

## Stack and architecture

React, Vite, React Router, Tailwind, Hono, strict TypeScript, Zod and Drizzle D1. One same-origin Cloudflare Worker serves the SPA and API. D1 owns catalog/order facts, R2 stores private images, Vectorize retrieves candidates, Queues move work off the webhook path, and one SQLite Durable Object per Page/PSID serializes a conversation.

```text
Signed webhook → D1 event/outbox → Queue → Conversation Durable Object
  → persisted debounce → validated intent → canonical retrieval / image matching
  → validated order action → deterministic facts → Messenger → delivery ledger
```

A persisted send ledger prevents ordinary Queue/alarm retries from duplicating replies. An ambiguous network send is marked `unknown` and handed to a person, because Messenger does not expose a documented exactly-once send contract. Orders use unique idempotency keys and atomic database triggers for inventory and immutable snapshots.

## Commands

| Command                                          | Purpose                                                           |
| ------------------------------------------------ | ----------------------------------------------------------------- |
| `npm run setup:local`                            | Generate local secrets, migrate and seed local D1                 |
| `npm run dev`                                    | Vite on 5173 and Worker on 8787                                   |
| `npm run dev:web` / `npm run dev:worker`         | Run either process separately                                     |
| `npm run db:migrate`                             | Apply migrations to **local** D1                                  |
| `npm run db:seed`                                | Seed **local demo data**                                          |
| `npm run db:generate`                            | Generate a reviewed schema migration                              |
| `npm run types`                                  | Regenerate bindings/runtime types from Wrangler                   |
| `npm run check`                                  | Formatter check, lint, typecheck, tests, production build         |
| `npm run test:unit` / `npm run test:integration` | Focused workerd suites                                            |
| `npm run dry-run`                                | Bundle and validate production config without deployment          |
| `npm run eval:images -- labeled-pairs.json`      | Evaluate configurable image score cutoffs                         |
| `npm run eval:live`                              | Opt-in live inference; requires explicit env flag and credentials |

Never apply `scripts/seed.sql` to a remote database. Tests use isolated ephemeral workerd databases, not your local seed.

Browser checks: run `npx playwright install --with-deps chromium`, then `npm run test:browser` after local setup. These checks create local test workspaces/orders and consume demo stock.

## Configuration

`wrangler.local.jsonc` is local-only and omits remote AI/Vectorize bindings. `wrangler.jsonc` describes production bindings; its D1 ID and domain are deliberately unconfigured. Configure resources and secrets before deployment.

Secrets: `AUTH_FACEBOOK_SECRET` (identity app), `META_APP_SECRET` (Messenger app), `META_WEBHOOK_VERIFY_TOKEN`, `TOKEN_ENCRYPTION_KEY` (base64, exactly 32 random bytes), `SESSION_SIGNING_SECRET`; optional `TOKEN_ENCRYPTION_PREVIOUS_KEYS` (JSON version/key map).

Public config: `APP_MODE`, `APP_ORIGIN`, `AUTH_FACEBOOK_ID`, `AUTH_FACEBOOK_GRAPH_API_VERSION`, `META_APP_ID`, `META_LOGIN_CONFIG_ID`, `META_GRAPH_API_VERSION`, `TOKEN_KEY_VERSION`, `CHAT_MODEL`, `VISION_MODEL`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`, `RERANK_MODEL`, `AI_GATEWAY_ID`, `AI_ENABLED`, `MESSAGING_ENABLED`, debounce values, image limits/thresholds and Messenger window. See [.dev.vars.example](.dev.vars.example) and [Cloudflare setup](docs/cloudflare-setup.md).

## Production checklist

- Create/configure D1, R2, Vectorize, two Queues and their DLQs; provision no resources from local mock config.
- Configure the real domain and secrets, and validate the embedding dimension against the selected model.
- Complete [Meta setup and review](docs/meta-setup.md), including live OAuth, subscriptions, revocation and Send API tests.
- Publish reviewed privacy/data retention policies. Establish a process for ambiguous message deliveries and data deletion.
- Calibrate image thresholds on held-out seller/customer image pairs and run multilingual live evaluation.
- Run all checks and dry-run; then obtain explicit deployment authorization.

See [two-app Facebook onboarding](docs/facebook-onboarding.md), [architecture and threat model](docs/architecture.md), [data model](docs/data-model.md), [AI behavior](docs/ai-behavior.md), [deployment](docs/deployment.md), the [implementation record](docs/implementation-plan.md), and [verification results and remaining release gates](docs/verification.md).
