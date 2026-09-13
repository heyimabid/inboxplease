> For this deployment, API and OAuth endpoints use `https://api.inboxplease.helloimabid.com`; the frontend uses `https://inboxplease.helloimabid.com`. See [production deployment](cloudflare-production.md).

# Meta setup: separate identity and Messenger apps

The application uses two separate Meta apps as described in [Facebook onboarding](facebook-onboarding.md). Real Meta OAuth, Page subscriptions, App Review and Messenger delivery remain untested. No app dashboard changes or App Review submissions have been made.

## App 1: Facebook Login for seller identity

1. Create/select the Facebook Login app used only for seller sign-in. Record its App ID as `AUTH_FACEBOOK_ID` and configure its App Secret through `wrangler secret put AUTH_FACEBOOK_SECRET --config wrangler.staging.jsonc` during the authorized release. Never use the Messenger app's secret here.
2. Select the version supported by this app and set `AUTH_FACEBOOK_GRAPH_API_VERSION`. The provider's versioned authorization, token and profile URLs use this setting rather than a library's default version.
3. Add the application domain and exact valid OAuth redirect URI `https://YOUR_DOMAIN/authjs/callback/facebook`. Set `APP_ORIGIN` to this same origin. The current app uses one origin for frontend and API.
4. Request only `public_profile`. No email, Page or Messenger permission is requested during identity login. Check successful/denied sign-in, first-seller workspace creation, repeat sign-in, session rotation and logout. [Manual Facebook Login flow](https://developers.facebook.com/docs/facebook-login/manually-build-a-login-flow/), [Auth.js Facebook provider](https://authjs.dev/reference/core/providers/facebook).
5. Configure deauthorization at `https://YOUR_DOMAIN/auth/privacy/facebook-login/deauthorize` and data deletion at `https://YOUR_DOMAIN/auth/privacy/facebook-login/data-deletion`.

## App 2: Page access and Messenger

1. Create/select the separate app with the Messenger customer-engagement use case and required business portfolio. Record `META_APP_ID` and secret `META_APP_SECRET`. The implementation rejects using the same app ID for both jobs.
2. Set `META_GRAPH_API_VERSION` to a version supported by this app. If your app uses a Login for Business configuration, choose a **user access token** configuration and set its `META_LOGIN_CONFIG_ID`; otherwise leave this optional value empty. Enable the authorization-code flow. [Login for Business](https://developers.facebook.com/docs/facebook-login/facebook-login-for-business/).
3. Add the application domain and exact OAuth redirect URI `https://YOUR_DOMAIN/facebook/callback`. This callback never signs a user in: it requires the same already-active InboxPlease seller/workspace/session that initiated Page connection.
4. Configure `pages_show_list`, `pages_manage_metadata`, and `pages_messaging`. The callback verifies actual granted permissions and requires the Page messaging task; App 1's Facebook user ID is not compared with the different App 2 ID. [User permissions](https://developers.facebook.com/docs/graph-api/reference/user/permissions/), [Page access tokens](https://developers.facebook.com/docs/pages/access-tokens/).
5. Configure the Page webhook callback `https://YOUR_DOMAIN/webhooks/meta` with the secret `META_WEBHOOK_VERIFY_TOKEN`. Subscribe to `messages` and `messaging_postbacks`. Incoming POST signatures use **App 2's App Secret**. [Messenger webhooks](https://developers.facebook.com/docs/messenger-platform/webhooks/).
6. Sign in using App 1, then open Settings → Connect a Page. Grant App 2 access, return to the candidate picker and explicitly choose a Page. Confirm the server verifies the selected app's Page subscription. Only then enable that Page's AI switch. [Page subscribed apps](https://developers.facebook.com/docs/graph-api/reference/page/subscribed_apps/).
7. Configure deauthorization at `https://YOUR_DOMAIN/auth/privacy/messenger/deauthorize` and data deletion at `https://YOUR_DOMAIN/auth/privacy/messenger/data-deletion`. These callbacks use App 2's secret and revoke Page access independently of seller identity. [Data deletion callback](https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback/).
8. Publish reviewed privacy/terms policies and explain shared workspace retention and customer deletion. Prepare App Review evidence for the required scopes: identity login, separate Page authorization, explicit Page selection, verified catalog, incoming message, grounded reply, human takeover and disconnect. Submit reviewer instructions/test credentials through Meta's review UI. Complete business verification and the required access review before serving sellers outside app roles.
9. After authorized release, enable `AI_ENABLED=true` and `MESSAGING_ENABLED=true` for the intended environment, plus workspace auto-replies and each Page's explicit AI switch. Repeat acceptance with an eligible non-role seller after any required approval. A working app-role test does not establish production approval.

## Live acceptance

- Confirm App 1 asks only for public profile and stores no provider token; test cancelled login, invalid/replayed state, session rotation and logout.
- Start App 2 connection, then log out, switch user/workspace or replace the session before callback. Ensure it fails before code exchange.
- Decline one required permission or remove Page messaging access. No eligible candidate/activation should result.
- Check encrypted candidates expire, remain scoped to the initiating session, and never expose tokens to the browser. Unselected Pages must remain inactive.
- Confirm Page approval does not enable AI, subscription failure blocks activation, and either platform kill switch suppresses sending.
- Deliver a signed real customer webhook; verify prompt acknowledgement, Queue ingestion, batching and one grounded reply. Exercise confirmed ordering and human takeover.
- Test encrypted Page-token sends with `messaging_type: RESPONSE` inside the standard response window. No message tags or Human Agent extensions bypass it. [Messenger Send API](https://developers.facebook.com/docs/messenger-platform/send-messages/).
- Revoke each app separately; remove Page tasks/permissions; disconnect during verification; simulate unsubscribe failure. Local sending must remain disabled and reconnection must be actionable.
- Inspect application/Gateway logs for absence of tokens, signatures, message bodies, phones and addresses. Review Bangla/Banglish quality and image calibration with real seller data.

Official references were checked during implementation. Some Meta web retrievals were rate-limited, so actual app dashboard eligibility and real provider behavior remain required live checks. The two-app separation is this application's chosen contract; it does not depend on assuming that IDs from different Meta apps match.
