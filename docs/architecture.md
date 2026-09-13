# Architecture and security boundaries

## Runtime

A Hono Worker handles `/api/*`, `/auth/*`, `/authjs/*`, `/facebook/*`, `/webhooks/meta` and expiring `/media/*` links. Static assets handle other routes with SPA fallback. Vite proxies API calls during development; production sessions stay on one origin.

Cloudflare contracts were checked on 2026-09-11 using official docs, installed Wrangler schema, generated runtime types and local workerd. Cloudflare MCP documentation search was attempted at the user's request but returned no results; direct official references were used instead.

| Component      | Authority and responsibility                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| D1             | Tenant membership, canonical catalog, customer history, drafts, orders, outboxes and delivery state    |
| Durable Object | One Page/PSID conversation; persisted pending events, atomic batch capture, alarms and retry state     |
| Queue          | At-least-once transport; consumer acknowledges only after durable ingestion                            |
| R2             | Private seller originals, bounded delivery derivatives and temporary customer images                   |
| Vectorize      | Candidate retrieval, namespace plus indexed `workspaceId` metadata filter; never price/stock authority |
| Workers AI     | Validated intent, optional response-block selection, vision extraction/comparison and embeddings       |
| AI Gateway     | Optional inference routing; cache and request logging disabled to avoid storing customer data          |

Official references: [D1 batch transactions](https://developers.cloudflare.com/d1/worker-api/d1-database/), [Durable Object alarms](https://developers.cloudflare.com/durable-objects/api/alarms/), [Queue consumer semantics](https://developers.cloudflare.com/queues/configuration/javascript-apis/), [Vectorize client API](https://developers.cloudflare.com/vectorize/reference/client-api/), [R2 binding API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/), [Workers testing](https://developers.cloudflare.com/workers/testing/vitest-integration/write-your-first-test/).

## Delivery and failure recovery

Webhook signatures cover raw bytes. Expected non-echo Messenger messages normalize to stable IDs scoped by Page and sender. The endpoint persists a normalized event before Queue send. A scheduled repair scan retries the D1-to-Queue gap. Queue payloads contain job IDs, not tokens or customer details.

The conversation object persists pending event IDs before acknowledgment, sorts by original timestamp, debounces for 2.5 seconds (8-second gathering cap), and bypasses delay for postbacks. Batch capture is one Durable Object storage transaction. Concurrent arrivals remain in the next batch.

Outbound messages have deterministic IDs and `ready → sending → sent` states. A successful write followed by a duplicate job cannot resend. Explicit transient Meta errors can return to `ready`. A network timeout or crash during `sending` produces `unknown` and human handoff. A seller must inspect the actual Messenger thread before deciding to send a new manual reply. The application deliberately does not claim distributed exactly-once Messenger delivery.

Orders are independent of delivery retries: the draft ID is a unique idempotency key; item IDs are deterministic; D1 batches atomically insert orders/items and decrease inventory. Triggers reject changed prices, stock, delivery fees, variants or summary fields. Stock is restored once for eligible cancellation transitions. Price/customer snapshots cannot be edited afterward.

## Threat model

| Threat                   | Mitigation                                                                                                                                                        | Operational consideration                                                                                 |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Cross-tenant object IDs  | Session-selected workspace, membership/role checks, composite foreign keys, workspace predicates on resource access                                               | Global ingress lookup by unique Page ID and privileged maintenance scans are documented system boundaries |
| Stolen browser data      | HTTP-only encrypted Auth.js JWT plus revocable D1 session; production Secure + host-only prefix; no Page tokens in browser storage                                | Protect the domain and TLS configuration                                                                  |
| CSRF/session fixation    | Origin validation on authenticated mutations; Auth.js state cookie for identity; one-use session/user/workspace-bound state for Page access; rotate login session | Configure exact origin and redirect URI                                                                   |
| Page-token theft         | Web Crypto AES-GCM with random IV and workspace/Page authenticated data; versioned keys                                                                           | Rotate keys and revoke compromised tokens                                                                 |
| Forged/replayed webhooks | HMAC SHA-256 verification and unique event IDs; Queue/DO/message idempotency                                                                                      | Keep replay records for configured retention                                                              |
| Prompt injection         | Untrusted content cannot choose tenant or DB access; strict tool schemas; render business facts from D1                                                           | Test new models against hostile multilingual inputs                                                       |
| Hallucinated orders      | Explicit post-summary confirmation evidence, literal field validation, integer arithmetic and transactional stock checks                                          | Seller must maintain accurate catalog data                                                                |
| Malicious uploads/SSRF   | Byte/MIME/size checks, private R2, limited decoders; HTTPS Meta CDN allowlist and redirect revalidation                                                           | Temporary-image cleanup cron must remain enabled                                                          |
| Data in logs             | Structured metric allowlist, no exception payload logging, AI Gateway `collectLog:false`                                                                          | Restrict platform logs and configure account retention                                                    |
| Resource exhaustion      | Bounded request bodies, pagination, inference context limits, API/OAuth rate limits, Queue retries/DLQs                                                           | Tune quotas and monitor queue lag under load                                                              |

## Known deployment limits

Real Meta OAuth/Page permissions, account eligibility, App Review, token lifetime and Cloudflare remote inference/index behavior require live verification. Local semantic similarity is a deterministic test adapter, not a quality estimate. Vision confidence thresholds are unset until calibrated. WebP gets exact hashing and vision; perceptual hashing currently supports bounded JPEG and simple RGB/RGBA PNG. The inbox uses polling rather than a live socket.

App 1 deletion removes seller identity, sessions and connected credentials. App 2 revocation removes Messenger connection/candidate credentials while preserving App 1 sign-in. See [two-app onboarding](facebook-onboarding.md). Business records in a shared workspace are retained for its other members; customer deletion is a separate administrator action that cascades through messages, images and orders. Publish this distinction in the actual privacy policy and define business-record retention before launch.
