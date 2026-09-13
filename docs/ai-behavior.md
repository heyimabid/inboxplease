# AI behavior and evaluation

## Verified model contracts

Reviewed 2026-09-11:

- [Llama 4 Scout](https://developers.cloudflare.com/workers-ai/models/llama-4-scout-17b-16e-instruct/) is listed for text, structured output and vision. The generated Workers type accepts `messages`, `response_format` and data-URL image content; HTTP image URLs are not passed to inference.
- [BGE-M3](https://developers.cloudflare.com/workers-ai/models/bge-m3/) is an embedding model. Its documented `text` input returns a `data` array. The application validates every output vector against the configured 1024 dimensions; remote live evaluation must confirm this before index provisioning.
- [BGE reranker](https://developers.cloudflare.com/workers-ai/models/bge-reranker-base/) accepts `query` plus `contexts:[{text}]` and returns scored context IDs. It is optional and cannot provide prices or stock.

Model names are configurable. Changing model families requires verifying compatible schemas rather than assuming interchangeability. Local mode never contacts Workers AI or Vectorize and cannot measure production retrieval quality.

## Grounding and tools

`prompts.ts` contains the production trust boundaries: no invented products, variants, prices, stock, delivery promises or discounts; no cross-workspace data; no prompt disclosure; exact images require a matching hash; sensitive payment credentials are never requested. Catalog and customer text are untrusted data.

`CustomerIntentSchema` validates language, intent, query, literal fields and confidence. Structured model output receives one retry, then safely hands the conversation to a human. Application code chooses validated actions; the model cannot directly query a database.

`tools.ts` exposes strict schemas for `search_products`, `get_product_details`, `get_product_variants`, `check_variant_stock`, `get_store_policy`, `get_delivery_options`, `start_order_draft`, `update_order_draft`, `add_order_item`, `remove_order_item`, `calculate_order_total`, `request_order_confirmation`, `confirm_order`, `cancel_order`, and `request_human_handoff`. The trusted context supplies workspace/conversation identity. Model-supplied workspace or price fields are rejected.

The second model stage selects product/FAQ IDs from the retrieved shortlist. It cannot author factual prose. A final delivery guard also rejects credential requests embedded in seller FAQ text. Localized application templates render current D1 names, variant prices and stock, and seller-written FAQs. All order summaries and calculations are deterministic. Catalog search first checks identifiers/names, then lexical candidates and semantic search, with optional reranking and current D1 reload.

## Language and order collection

English, Bangla script, Banglish and mixed writing styles are supported. `language-style.ts` includes configurable commerce normalization. A short greeting does not persist a language preference; multiple longer messages provide evidence. Product names remain as supplied by the seller.

Customer fields may arrive in any order. Extracted names/addresses must occur in the actual customer text; phones normalize local digits, spaces, hyphens and Bangladesh prefixes. Ambiguous later messages cannot overwrite existing fields. The customer must see a complete sent summary and then explicitly confirm. A question about confirmation or “confirm but change color” cannot create an order.

## Image evidence

- `exact_file`: identical SHA-256 bytes for an unambiguous catalog product.
- `near_duplicate`: perceptual distance within a configured, evaluated cutoff.
- `probable_product`: visual comparison and configured probability threshold; never described as exact.
- `similar_products`: alternatives above a configured similarity threshold.
- `uncertain`: candidates exist but evidence is insufficient or a photo is shared between products.
- `none`: no reliable candidate.

No universal score cutoffs ship enabled. Calibrate with seller/customer pairs using `npm run eval:images -- pairs.json`; the format is in `tests/fixtures/image-pairs.example.json`. Hold out a separate test set, include hard negatives, crops, screenshots, different lighting and near-identical variants, and inspect false exact/probable claims. Material guesses remain retrieval hints and never replace seller facts. Suggestions reload only the workspace’s active products and seller images. Catalog photos receive separate description embeddings with product/image/variant metadata, alongside the product document vector. Bounded JPEG/simple PNG delivery derivatives remove original metadata while private originals preserve exact-file evidence.

## Human handoff and operations

Manual takeover, low confidence, model failures, complaints, payment exceptions and prompt attacks stop automatic replies. Pending inbound messages continue to persist. The private handoff panel shows a validated assistant summary in production, with a persisted transcript excerpt as fallback; mock mode uses that excerpt directly. Resuming AI is explicit.

Tests use deterministic model behavior and real local D1/R2/DO runtime bindings. `npm run eval:live` runs only with `LIVE_AI_EVAL=1`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, and `CHAT_MODEL`. Do not send real customer PII in evaluation fixtures. Review language quality with native Bangla/Banglish speakers before launch.
