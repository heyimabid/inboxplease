# Verification and handoff

Latest verification: 2026-09-12; verified locally with Node 24, Wrangler 4.131.0 and Chromium. All seven local implementation phases are complete. The initial verification preceded remote provisioning. The subsequent authorized [Cloudflare staging setup](cloudflare-staging.md) created isolated resources and verified live embedding dimensions; application deployment and end-to-end live acceptance remain outstanding.

## Commands and results

| Command                   | Result                                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------------------------- |
| `npm run check`           | Formatting, ESLint, strict TypeScript, 84 tests in 15 workerd files and production Vite build passed |
| `npm run test:browser`    | All 3 Chromium tests passed                                                                          |
| `npm run dry-run:staging` | Worker and static assets bundled; no deployment                                                      |
| `npm audit`               | Zero reported vulnerabilities                                                                        |
| `git diff --check`        | Passed                                                                                               |

`npm run db:generate` found no schema changes across 28 tables. `npm run eval:images -- tests/fixtures/image-pairs.example.json` completed the synthetic score/perceptual threshold sweep. `npm run eval:live` correctly reported that live evaluation did not run: its explicit opt-in flag and credentials were absent.

The browser tests exercise local sign-in, Page selection, catalog/variant/image/FAQ management, product archiving, workspace creation and isolation, order field collection, the complete BDT 1,570 review, explicit confirmation, human takeover and a manual reply. The Orders table was loaded before checking the 390-pixel viewport for page overflow. Desktop Inbox and mobile Orders screenshots were visually reviewed. Screenshots/traces are local ignored artifacts under `test-results/`.

The two-app authentication update adds real Auth.js CSRF/state/callback/JWT tests with intercepted Meta responses, Page-candidate/session isolation, expiry/replay protection, explicit activation, independent privacy secrets, and disconnect races. Migration `0003_late_sway.sql` is applied locally and to the empty staging database; remote schema and foreign-key checks passed. The app remains undeployed and real two-app Meta acceptance remains outstanding.

Unit/integration coverage includes tenant constraints and scoped APIs, OAuth state replay and session security, signed webhook deduplication, persistent debounce, retry/unknown-send behavior, canonical retrieval, image evidence, confirmation proof, atomic inventory updates, cancellation, privacy cleanup, outbox repair and credential-request suppression. These tests use actual local workerd storage with explicit mock or intercepted external providers.

The final repository candidate-file scan found no copied local secret values or private keys. `.dev.vars` and browser artifacts are ignored. Source/test scans found no TODO/FIXME markers, skipped tests, `as any`, `as unknown` or `@ts-ignore`. Intentional production configuration placeholders remain.

## Run and inspect

```bash
npm ci
npm run setup:local
npm run dev
```

Open port **5173** and choose **Explore local workspace**. The Worker listens on 8787. Browser checks create fictional local workspaces and orders and consume demo stock; unit/integration databases are isolated. See the [README](../README.md) for a manual sample conversation.

## Remaining release gates

1. The supporting staging resources have now been provisioned; see the [setup record](cloudflare-staging.md). Complete the remaining Meta configuration and secret upload before deployment creates the Durable Object namespace and attaches Queue consumers. Keep production resources separate.
2. Complete the exact app, Login for Business, redirect, permissions, webhook, Page selection, privacy callbacks and App Review steps in [Meta setup](meta-setup.md). Exercise real OAuth, webhook subscription, revocation and Messenger delivery before claiming readiness.
3. Run opt-in live model evaluation, verify actual embedding dimensions, calibrate image cutoffs on held-out seller data, and review Bangla/Banglish quality. Local deterministic adapters and example image-score fixtures do not establish model accuracy.
4. Benchmark real image/catalog sizes, validate retention and Gateway settings, and rehearse ambiguous-send reconciliation and recovery. See [deployment and known limitations](deployment.md).

The conversational editor asks for seller assistance with multiple-item changes. JPEG/simple PNG derivatives and perceptual hashes have documented size/format limits; other supported image inputs use exact hashing and vision. No public-load or live provider reliability claim is made. The next step is credentialed staging configuration and live acceptance testing, followed by separately authorized deployment.
