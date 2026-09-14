# Cloudflare deployment

Deployed 2026-09-12 to Worker `inboxplease` in account `742cce6203b13f0b3376ebaae547be83`.

- Frontend: https://inboxplease.helloimabid.com
- API: https://api.inboxplease.helloimabid.com
- Configuration: `wrangler.production.jsonc`
- Redeploy: `npm run deploy:production`

One Worker serves both custom domains. The frontend hostname serves SPA assets; the API hostname serves Hono routes. Browser requests include credentials and CORS permits only the configured frontend origin. OAuth cookies remain host-only on the API hostname. `APP_ORIGIN` identifies the frontend; `API_ORIGIN` identifies OAuth callbacks, media links and the API. The production frontend build uses `VITE_API_ORIGIN`; use the production build script before deployment.

The previously provisioned, empty `inboxplease-staging-*` storage and queue resources were promoted for this deployment. Their resource names remain unchanged. They are now production resources: do not deploy the staging configuration against them or use them for test data. The older `inboxplease-api` Worker and its resources remain independent. Existing MX and TXT records at the frontend hostname were preserved.

## Meta configuration

System session, encryption and webhook verification secrets were installed from the ignored `.secrets/staging.json` file. Meta secrets cannot be read back from the older Worker. Provide the credentials privately in `.secrets/meta.json` (ignored, mode 0600); do not commit this file or paste its values into chat.

The file contains App 1 `AUTH_FACEBOOK_ID`, `AUTH_FACEBOOK_SECRET`, `AUTH_FACEBOOK_GRAPH_API_VERSION`, and App 2 `META_APP_ID`, `META_APP_SECRET`, `META_GRAPH_API_VERSION`, plus optional `META_LOGIN_CONFIG_ID`. Fill Graph versions with the versions configured for each verified Meta app. Before uploading, move the non-secret ID/version/config fields into `wrangler.production.jsonc` and upload only the two secrets with Wrangler. Do not place a secret in Wrangler vars. Do not reuse the mock development keys.

Set these exact OAuth redirect URIs in the corresponding Meta dashboards:

- App 1: `https://api.inboxplease.helloimabid.com/authjs/callback/facebook`
- App 2: `https://api.inboxplease.helloimabid.com/facebook/callback`
- App 2 webhook: `https://api.inboxplease.helloimabid.com/webhooks/meta`

Privacy endpoints are on the API hostname under `/auth/privacy/facebook-login/` and `/auth/privacy/messenger/`; see `meta-setup.md` for the per-app actions.

Both Meta app credential pairs have been accepted by Meta and installed on the Worker. Graph API v25.0 is configured for both flows. Complete interactive Facebook sign-in and Page onboarding to verify the live integration. AI and messaging platform switches remain disabled until real Page onboarding is verified. Each Page still needs explicit approval and a separate AI opt-in.

## Verified deployment

Worker version: `173708e1-da3b-4cc0-8be8-e4ecdf8cad6a`.

Both custom domains respond over HTTPS; Cloudflare issued the API hostname certificate. A live Chromium check loaded the Facebook sign-in button with no page errors and fetched the API health endpoint with credentials across origins (HTTP 200, production mode). Live OAuth initiation returns the Facebook authorization URL with public_profile and the API callback URI. The webhook verification challenge returns HTTP 200 using the local verify token. Mock login returns 404, and a mutation from an untrusted origin returns 403.

Validation: the full 84-test suite passed, followed by 14 focused authentication tests including the two added cross-origin cases. All three local Chromium workflow tests passed. Formatting, lint, TypeScript and the production deployment dry run passed.

The webhook verify token is the `META_WEBHOOK_VERIFY_TOKEN` value in `.secrets/staging.json`; copy it into the Messenger app webhook verification field. It was synchronized with the deployed Worker when Meta credentials were installed. Encryption and session keys were not rotated. They are server secrets and are never entered into Meta.

## Facebook callback redirect-mode fix

The live callback exchanged its code successfully (HTTP 200) and then failed with a TypeError before receiving the profile. A probe in the configured Workers runtime reproduced rejection of `redirect: 'error'`; the same request with `manual` reached Meta. Both seller profile requests and the Messenger Graph client now use `manual` and reject redirect responses without forwarding credentials. Integration fetch mocks construct actual Workers Request objects to catch unsupported options. TypeScript and 17 focused authentication/Meta tests passed.

## Reply relevance and incomplete catalog handling

On 2026-09-12, production outbound metadata showed zero retrieved products and repeated selection of the global COD FAQ. The active earbuds product had no variants, and retrieval excluded every product without a variant. Retrieval now includes such products for unfiltered browsing, but states stock/options need seller confirmation. Order collection does not invent an orderable option or stock.

FAQs are filtered for relevance to the current message before being offered to the reply selector. With no relevant FAQ, the response uses canonical product facts or asks for clarification. Fresh greetings and requests to stop repeating an answer bypass model classification and stale payment context; greetings also bypass draft field collection. The understanding prompt explicitly anchors decisions to the current message.

Regression coverage replays greetings, Banglish earbuds availability, purchase intent and repetition complaints, verifies no unrelated COD answer, and keeps a genuine COD question answerable. Live Scout evaluations correctly classified the purchase and availability examples with an earlier COD answer in the supplied history. Existing production AI and messaging switches remain enabled. Merchant must configure a variant and stock before automated checkout can accept this earbuds product.

## Product photos and image rejection

Production metadata confirmed unrelated customer photos were classified as `uncertain` yet still exposed candidate product IDs to the sender. Uncertain and no-match results now carry no customer-facing product list or attachments. Explicit negative visual comparisons cannot be promoted by a perceptual-hash collision or a high similarity score. Mere retrieval is not matching evidence; perceptual candidates require affirmative visual comparison as well as a configured threshold.

Text requests for photos use a dedicated route before checkout field collection. They resolve a named catalog product or a product referenced in the conversation/draft, recheck current workspace/catalog eligibility, and return the product ID that drives the existing image attachment sender. Missing photos and ambiguous product references produce a direct clarification rather than a promise to send an image.

Approximate image thresholds remain unset pending calibration. Identical files can still be confirmed by SHA-256. An unverified comparison does not send a suggested catalog photo. Regression tests verify negative comparisons, withholding uncertain results, exact matching, signed image retrieval, follow-up photo requests, missing photos and archived products.

Photo and image rejection fix deployed as Worker version `5d565b79-419e-4397-ab14-18a7e1e076b0`. The full 96-test suite and three focused photo-request tests passed (including the additional human-request priority case). Production API health returned HTTP 200 after deployment.

## Photo questions and category alternatives

Incoming image descriptors are persisted before downloading attachment bytes. A photo or standalone reference such as `eta ki ache?` uses the existing eight-second maximum batching window, so separate Messenger text and image webhooks can form one turn. Related arrivals during downloading or inference are merged before delivery begins; persisted batches and deterministic delivery IDs preserve retry behavior. Messages arriving after that window or after sending begins form a later turn. A standalone reference without a photo asks for the item name/photo and cannot fill fields in an existing order draft.

Pairwise visual comparison now distinguishes product identity from the same narrow product type. Affirmative type evidence can produce `category_alternatives` even when the pictured earbud model differs. The response explicitly says the exact pictured model is unverified, shows the store's alternative product photos, and uses current catalog price/stock. Broad electronics similarity, unrelated objects and unclear images do not qualify. Approximate identity thresholds remain unset. Uncertain results without affirmative type evidence still expose no product photos.

Regression coverage includes text-first and photo-first arrival, a caption arriving during attachment download, preserving an existing name-collection draft, duplicate event delivery, alternative reply wording and unrelated-image rejection. Visual model outputs are mocked in automated tests; real-photo accuracy still depends on the vision model.

Deployed on 2026-09-13 as Worker version `4bcde392-0e8f-4218-88c3-610f90265782`. Formatting, lint, TypeScript, all 102 tests across 19 files, and the production build passed. Both the frontend and production API health endpoint returned HTTP 200 after deployment.

## Checkout fields, Messenger profiles and Gemini

Checkout now extracts phone numbers and quantities from the current message, drops model fields copied from history, and accepts plain names/addresses according to the missing field. Vague self-references are not customer names. Existing drafts with a vague name ask for a real name again. Natural Banglish quantities such as `ekta nibo` are supported, quantity changes update the existing item, and contact-detail corrections do not remove the product. Confirmation still requires the deterministic order review and explicit customer approval.

Migration `0004_glossy_gideon.sql` adds separate Facebook name, profile-photo URL and refresh timestamp fields. Profiles use the connected Page token and customer PSID, with a daily refresh claim and graceful handling of unavailable Meta profile access. Inbound messages trigger a background refresh; opening a conversation refreshes existing customers. The dashboard uses Facebook identity when available, while the checkout recipient name remains separate. The displayed Messenger ID is Page-scoped, not a public Facebook account ID. Avatar loading is limited to Meta image hosts with a fallback for expired or unavailable photos.

Both chat and vision use `google/gemini-3.5-flash`. Requests go through the Google AI Studio provider-native route in `inboxplease-staging` with the stored `default` key alias. A generic AI run probe attempted Unified Billing and failed for insufficient gateway balance; the provider-native binding succeeded with the saved key. A live request using the actual structured-output adapter classified `accha ami eta ekta nibo` as Banglish `order_start` with quantity 1. Gemini JSON and inline image parts have dedicated parsing; incomplete output is rejected. Embeddings and reranking retain their existing models.

Validation: all 107 tests across 22 files, formatting, lint, TypeScript and build passed. Coverage includes the full checkout replay with injected stale model fields, profile permission failures and refresh caching, and Gemini structured image requests and truncated-output rejection. The additive profile migration was applied to the production D1 database and recorded in `d1_migrations`.

Deployed as Worker version `89049808-4a5e-4856-abd9-ac04a5c15288`. Production API health, inbox HTML and the new client asset returned HTTP 200; the live frontend CSP check identified a separate static-asset header that also needed the Meta avatar hosts.

Final deployment including the static avatar CSP fix: `c3c7ebb9-02aa-470d-ae2a-f98b8c8a5411`. Live inbox and API health returned HTTP 200, and the served frontend CSP now permits both configured Meta image domains.

## Flash Lite and conversational checkout

Chat and vision now use `google/gemini-3.5-flash-lite` through the existing Google AI Studio stored-key route. A live probe using the checkout renderer produced a Banglish acknowledgement of the saved address followed by the configured delivery-area choices.

Product, availability, price and delivery questions can interrupt checkout without becoming name/address fields. Broad catalog requests such as `ki ki ponno ache` browse active, searchable products in the current workspace. The understanding context includes the customer's Facebook name and current draft; short checkout answers can retain the conversation's Banglish/Bangla style. Greetings use the available profile name.

When the customer says `amr name e`, the server resolves the name from that customer's stored Facebook profile. A yes answer can accept a profile name only after the latest sent message offered that exact name. This consent is separate from final order confirmation and cannot authorize an arbitrary model-supplied name. A live aggregate check confirmed the current customer record already has a Facebook name and profile photo.

Delivery areas are checked against configured choices before patching the draft, so a guessed city/area cannot discard a valid address. A question mark requests an explanation without replacing saved fields. Checkout replies acknowledge newly supplied details, offer the known profile name, allow several missing details together, and list real delivery-area choices. Gemini writes the conversational wording from this constrained context; provider failures and unsupported numerical/fulfillment claims fall back to the deterministic prompt. Prices, order review and final confirmation remain controlled by the existing order services.

## Conversation-led checkout follow-ups

The September 14 update restricts checkout mutations to checkout answers and explicit actions. Product searches, warranty/delivery questions, social replies and unrelated questions can interrupt an active draft. The draft provides context for interpreting a short answer; it no longer catches every message. The classifier now distinguishes order-status questions and small talk, including Banglish status follow-ups after confirmation.

Verified details in the current message can replace saved details without requiring the word “change.” Unchanged fields and quantities do not invalidate a review; an unchanged reviewed draft gives a short follow-up instead of repeating the entire summary. An unspecified change request preserves the selected product. Natural stated Dhaka area equivalents resolve to one configured zone, while negated, ambiguous and street-address-only inputs do not choose a zone.

Normal replies use Gemini Flash Lite for wording with recent conversation context, the known Facebook name and the verified response facts. Numerical and order-action checks fall back to verified wording on unsupported output or provider failure. The wording step cannot mutate orders. Complete review summaries and successful confirmation receipts bypass rewriting, preserving confirmation evidence. Actual order status is read from the current conversation's workspace-scoped orders, not inferred from the draft or chat history.

Live tests through the saved Google AI Studio provider key correctly classified a full address correction, a warranty question during name collection, a Banglish order-status question, a natural delivery-area reply and thanks. The actual wording model answered the status follow-up directly in Banglish. These probes used synthetic customer/order context and did not send Messenger messages or create orders. The live conversation remains in seller takeover mode (`seller_reply`); this update preserves that setting.

Validation: formatting, lint, TypeScript, all 119 tests across 26 files, and the production frontend build passed. Deployed as Worker version `59fa95b7-6ee7-4b55-8ff2-902d4457c7eb`, using `google/gemini-3.5-flash-lite` for chat and vision.
