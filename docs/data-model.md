# Data model

`src/worker/db/schema.ts` is the Drizzle schema. `drizzle/migrations` contains generated SQLite migrations plus a custom migration of transaction-time order invariants. Drizzle's journal and snapshots are included so future generation stays consistent.

All timestamps are UTC Unix milliseconds. Workspaces carry a display timezone (default Asia/Dhaka) and currency (default BDT). Money is integer minor units; the UI converts display amounts at the boundary. Products cannot change currency after creation. Orders require matching product and delivery currencies.

| Tables                                            | Purpose                                                                              |
| ------------------------------------------------- | ------------------------------------------------------------------------------------ |
| users, sessions                                   | App 1 identity, revocable Auth.js JWT session records (opaque sessions in mock mode) |
| workspaces, workspace_members, workspace_settings | Tenant scope, owner/admin/agent roles, AI and retention settings                     |
| facebook_pages                                    | Globally unique Page routing; encrypted access token and key version                 |
| products, product_variants                        | Canonical names, facts, SKU, prices and inventory; soft archived products            |
| product_images, product_faqs, delivery_zones      | Tenant images/hashes/vision attributes, verified answers and delivery rules          |
| customers, conversations, messages                | Page-scoped customers, AI/human state, message history and outbound delivery ledger  |
| webhook_events, catalog_jobs                      | Idempotent ingress/indexing outboxes and processing status                           |
| local_vectors                                     | Local-only deterministic semantic index                                              |
| order_drafts, order_draft_items                   | Customer fields, selection context, review hash and current item prices              |
| orders, order_items                               | Confirmed immutable snapshots and unique idempotency/order numbers                   |
| handoff_sessions, audit_events                    | Private handoff context and actor/action audit entries                               |
| temporary_images, rate_limits, deletion_receipts  | Bounded image retention, expiring rate buckets and opaque deletion status            |

`meta_onboarding_sessions` holds hashed one-time App 2 state bound to the internal session/user/workspace. `meta_page_candidates` stores expiring encrypted Page choices. `facebook_pages` records subscription evidence, permissions/tasks, App 2 identity, connection revision and the separate AI opt-in. No Facebook user access tokens are stored.

Composite foreign keys include `workspace_id` for products, variants, images, conversations, customers, drafts and orders. Every seller API derives workspace identity from its session and membership. Object IDs supplied by browsers/models do not grant authority.

`stock_on_hand >= reserved_stock >= 0` is enforced in SQLite. This implementation decreases stock at confirmation rather than reserving during browsing. Drafts do not guarantee stock. Orders recheck inventory immediately before creation and again in transaction-time triggers.

Soft-deleting a product excludes it from retrieval but preserves historical references. Customer deletion is explicit and irreversible, removes temporary R2 objects, clears conversation state, and cascades through orders and messages. Product-image delivery uses an authenticated route or an expiring signed capability; the R2 bucket is never public.
