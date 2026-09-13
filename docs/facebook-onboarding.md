# Two-app Facebook onboarding

Seller identity and Page authorization use separate Meta apps. This matches the existing business's app setup; app-scoped Facebook IDs are never treated as a cross-app identity link.

## App 1: seller identity

`src/worker/authjs.ts` uses the Auth.js Facebook provider with **only `public_profile`** and explicitly configured Graph endpoints. The callback is:

```text
https://YOUR_APP_ORIGIN/authjs/callback/facebook
```

Set `AUTH_FACEBOOK_ID`, `AUTH_FACEBOOK_GRAPH_API_VERSION` and the secret `AUTH_FACEBOOK_SECRET`. Set `SESSION_SIGNING_SECRET` for Auth.js JWT encryption. The frontend obtains an Auth.js CSRF token and posts to `/authjs/signin/facebook`; Auth.js validates its OAuth state cookie on callback.

`ensureFacebookSellerIdentity()` creates or loads the application's seller and default workspace. The stored Facebook identity is namespaced by App 1's ID; email addresses are never used to merge accounts. The provider requests only id, name and picture, and `account: () => ({})` excludes provider token storage. No Facebook user access token is written to D1 or the JWT.

Production uses an encrypted Auth.js JWT in a Secure, HTTP-only, host-only cookie. The JWT holds an internal seller ID and random session ID. A D1 session record supplies the current workspace and immediate revocation on logout, and membership is rechecked on protected requests. Reauthentication rotates the application session. Local mock mode retains its separate signed opaque session and never contacts Meta.

Seller login works without App 2 credentials. Page connection remains unavailable until App 2 is configured.

## App 2: Messenger Page authorization

Set `META_APP_ID`, `META_GRAPH_API_VERSION` and secret `META_APP_SECRET` for the separate Messenger app. Optional `META_LOGIN_CONFIG_ID` selects a Login for Business user-token configuration in that app; the code also supports its standard authorization-code flow without this ID.

Required scopes:

```text
pages_show_list,pages_manage_metadata,pages_messaging
```

The callback is:

```text
https://YOUR_APP_ORIGIN/facebook/callback
```

1. An already signed-in owner/admin calls `POST /facebook/connect`. Origin validation rejects cross-site initiation. The server stores a hash of a random, ten-minute, one-time state in `meta_onboarding_sessions`, bound to the **exact application session, seller and workspace**.
2. `GET /facebook/callback` requires that same live session, current workspace and admin membership. Expired, replayed, signed-out, switched-user and replacement-session callbacks fail before exchanging a code. The App 2 Facebook user ID is recorded only for Messenger revocation; it is never compared with App 1's user ID or used to sign in.
3. The server exchanges the code, checks all required permissions are granted, and lists manageable Pages. Only Pages with an explicit `MESSAGE` or `MESSAGING` task are eligible. Page tokens are encrypted as short-lived candidates in `meta_page_candidates`; the transient user token is discarded.
4. The candidate list returns only IDs and names. The seller explicitly chooses a candidate with `POST /api/facebook/pages/:candidateId/approve` and `{ "consent": true }`. Tokens cannot be supplied by the browser. A Page already owned by another workspace cannot be claimed.
5. Approval consumes that candidate once, stores its encrypted Page token, subscribes `messages` and `messaging_postbacks`, and verifies the Messenger app's subscription. **AI remains off.** Failed or stale subscription completion cannot mark a disconnected Page active.
6. A separate admin action calls `PATCH /api/facebook/pages/:id/ai` with `{ "enabled": true }`. This records the Page-specific opt-in. Reconnecting a Page resets it to off.
7. `DELETE /api/facebook/pages/:id` revokes local sending and erases the token **before** attempting remote unsubscription. A failed Meta request returns `disconnected: true, unsubscribed: false`; the UI tells the seller to check the subscription. Old verification requests cannot resurrect the connection.

The Page routes are also mounted at `/facebook/pages`. `/api/facebook/pages/available` lists only candidates belonging to the caller's current session/workspace. Logout and onboarding expiry remove candidates via cascading cleanup; expired candidates are immediately inaccessible even before scheduled cleanup.

## Sending gates

AI responses require every condition below, with fresh checks immediately before delivery:

- `AI_ENABLED=true` and `MESSAGING_ENABLED=true` at platform level.
- Page status active, encrypted token present and webhook subscription confirmed.
- All three granted permissions and the Page messaging task recorded during onboarding.
- An administrator explicitly enabled that Page's AI switch.
- Workspace automatic replies enabled, conversation not blocked, and no human takeover.
- Customer inside the supported Messenger response window.

Manual seller replies still require `MESSAGING_ENABLED`, a ready Page and the response window; they do not require the AI switch. Production and staging ship both platform switches off. Local mode enables the platform switches, but Page connection still requires a separate AI opt-in. Token/permission failures disable delivery until reconnection or verification succeeds.

## Independent privacy callbacks

Configure App 1 with:

```text
/auth/privacy/facebook-login/deauthorize
/auth/privacy/facebook-login/data-deletion
```

Configure App 2 with:

```text
/auth/privacy/messenger/deauthorize
/auth/privacy/messenger/data-deletion
```

Each signed request is verified using that app's secret. App 1 revocation invalidates seller sessions and locally connected credentials; its deletion callback also removes the seller identity/memberships. App 2 revocation clears matching Messenger connections and candidate tokens while preserving App 1 sign-in. Shared workspace business records are retained according to the documented business-data policy; customer deletion is a separate administrator action.

## Migration and verification

`0003_late_sway.sql` adds candidate/onboarding tables and Page activation evidence, removes the legacy combined OAuth-state table, and drops stored Facebook user tokens from sessions. Existing connections default to AI off and require fresh App 2 authorization; existing opaque production sessions must sign in again using Auth.js. No cross-app account linking is guessed during migration.

Automated checks exercise the real Auth.js CSRF/state/callback/JWT implementation with intercepted provider responses, application-session binding, permission/task rejection, candidate isolation, replay/expiry, explicit AI activation, platform kill switches, callback-secret separation, failed unsubscribe and disconnect/verification races. These establish local behavior, not live Meta approval. Configure both real apps and run the live acceptance steps in [Meta setup](meta-setup.md).
