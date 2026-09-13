# InboxPlease implementation plan

Repository inspection (2026-09-11): greenfield, README only, clean git status; no applicable AGENTS.md. No existing implementation or user modifications to preserve.

## Phases and verification

Each phase ends with formatting, lint, strict type checking, relevant tests and a production build. Checkboxes record verified delivery, not intent.

- [x] 1. Foundation: strict TS, React/Vite/Router/Tailwind, Hono Worker, generated bindings, environment validation, relational schema and migration, session/CSRF security, isolated mock mode.
- [x] 2. Seller/catalog: workspaces, product/variant/image/FAQ/settings management, R2 access, canonical retrieval and queued indexing.
- [x] 3. Meta: OAuth state/code/identity, explicit Page choice, encrypted tokens, subscriptions, webhook signature/deduplication/outbox, production and local adapters.
- [x] 4. Conversations: persistent Durable Object debounce, idempotent queue delivery, constrained AI understanding and grounded rendering, inbox and handoff.
- [x] 5. Orders: validated fields, explicit state machine, deterministic summaries, atomic snapshot/inventory checks, confirmation idempotency.
- [x] 6. Images: bounded ingestion, exact hashes, optional perceptual hashes, vision attributes, tenant-filtered candidates, comparison and evaluation.
- [x] 7. Hardening: adversarial/isolation/retry tests, observability, deletion/retention, local smoke test, docs, full diff and secrets review.

## Decisions

- Same-origin Worker serves the SPA and API. Vite proxies API in development.
- D1 is canonical; money is integer minor units. Composite foreign keys enforce tenant ownership in addition to repository scoping.
- Drizzle defines the schema and ordinary queries; atomic inventory/order invariants use SQLite triggers and D1 batches.
- Durable Objects persist pending events and outgoing delivery state. An ambiguous Messenger send is held for human reconciliation, never blindly retried: Meta does not provide a documented exactly-once send guarantee.
- Webhook and catalog work use durable D1 outboxes with scheduled repair of the D1-to-Queue gap.
- AI chooses validated intents and grounded response blocks. Application code renders catalog facts and all order totals; free-form model text cannot author business facts.
- Mock Meta, inference and semantic index are explicitly local-only adapters; D1, R2, Queues and Durable Objects still run in workerd locally.
- Production requires separate configuration. The subsequent Cloudflare setup request authorized staging provisioning; deployment, DNS changes and App Review remain separate release actions.

## External verification blockers

Initially, Meta credentials and Cloudflare access were unavailable. The subsequent Cloudflare setup request provided authenticated access: staging resources are provisioned and small live embedding/chat/reranking probes succeeded. Real Meta credentials, selected Graph version, Login for Business configuration and App Review/business verification remain outstanding. See [staging setup](cloudflare-staging.md) and [Meta setup](meta-setup.md).

Phase 1 verified: formatter/lint/typecheck, 2 workerd security tests, production Vite build. Production dependency audit: no known vulnerabilities. Binding types generated with current Wrangler and non-literal vars.

Phase 2 verified: catalog/settings dashboard, formatter/lint/typecheck, 7 tests, production build. Canonical facts reload after retrieval; private images use authenticated delivery or short-lived signed links. Meta official docs retrieved successfully via direct HTTPS after browser 429; permission list verified on Page/subscribed_apps and Messenger Send documentation.

Phase 3 verified: OAuth/Page adapters, token-safe Page APIs, subscription tests, signed webhook deduplication; 10 tests and all static/build checks passed. Live OAuth and Page sends remain untested without Meta credentials.

Phase 4 verified: persisted Durable Object debounce, ambiguity-safe delivery, human takeover and inbox; 21 tests and all formatting/lint/type/build checks passed. Business facts are rendered in code from canonical products; the response model selects only validated catalog/FAQ IDs.

Phase 5 verified: state machine, literal field validation, persisted variant selection, explicit post-summary confirmation, atomic D1 stock/snapshot triggers, order dashboard; 40 tests and all static/build checks passed. Integer minor units throughout money calculations.

Phase 6 verified: bounded R2 ingestion, private customer images, real hashes, configurable evidence classification, optional vision and candidate comparison, seller-image replies, evaluation script. 44 tests and all static/build checks passed. Perceptual hashes support bounded JPEG and simple PNG; WebP still has exact hashing and vision.

Phase 7 verified (2026-09-11): 64 unit/integration tests across 13 workerd files and all 3 Chromium browser tests passed. Formatter, lint, strict type checking, production Vite build and Wrangler deployment dry-run passed; npm audit reported zero vulnerabilities. Browser coverage includes catalog/variant/image/FAQ management, explicit Page selection, a customer-confirmed BDT 1,570 order, human takeover/manual reply, workspace isolation and the loaded mobile Orders view. Repository review found no copied local secrets, private keys, TODO/FIXME markers, skipped tests or unchecked `any` casts. The local preview responds on port 5173 and the Worker reports mock mode. No remote resources were created and no live integration or Meta approval is claimed. See [verification and release gates](verification.md).

Cloudflare setup follow-up (2026-09-11): authenticated account inspected; isolated staging D1/R2/Vectorize/Queues/DLQs/Gateway provisioned, migrations applied, and live embedding/chat/reranker probes passed. Corrected D1 remote trigger parsing and accepted Workers AI's parsed JSON response while retaining schema validation. All 71 tests across 14 files, static checks, production build and staging dry-run passed. Generated separate ignored staging keys; application deployment, secret upload, Durable Object namespace creation and Meta acceptance remain release steps. See [staging setup](cloudflare-staging.md).

Two-app authentication update (2026-09-12): App 1 uses Auth.js with public_profile only, encrypted JWTs plus revocable D1 sessions, seller/default-workspace creation and no stored user token. App 2 uses hashed one-time state tied to the same active user/workspace/session, actual permissions and messaging-task checks, encrypted expiring candidates, explicit approval and a separate per-Page AI toggle. Platform kill switches, independent privacy callbacks and fail-closed disconnects are enforced. Migration 0003 applied locally and to empty staging via Cloudflare MCP. 84 tests across 15 files, all 3 browser tests, static checks, production build and staging dry-run passed; audit zero vulnerabilities. Live Meta tests still require both apps and credentials.
