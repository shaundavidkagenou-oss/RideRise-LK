# Firebase email/password authentication — implementation & setup

RideRise LK uses **real Firebase Authentication with the Email/Password provider**. There is
no homemade password system, **no Google sign-in of any kind** (the Google button, the GIS
script, the OAuth client and the server-side Google token verifier were all removed), no
passwordless links, and no client-side-only "login". This document covers what was built, how
it works, and the exact steps to connect your own Firebase project.

> **State of this repository:** the code is complete (88 automated tests, 30 of them for
> authentication) and **your Firebase project is configured**: `rideriselk`
> (`FIREBASE_PROJECT_ID=rideriselk` in `.env`, git-ignored). The browser can now create real
> accounts, and Google will deliver the verification and password-reset emails.
>
> **One environment caveat, stated plainly:** the sandbox that served the live preview has no
> outbound route to `www.googleapis.com`, so *that host* cannot verify ID tokens and reports
> `firebaseVerifier: "unreachable"` in `/api/health`. The welcome screen shows a matching
> banner there. On your Windows machine (or any normal host with internet access) the same
> build verifies and signs in normally. Nothing about the code or the credentials is wrong —
> run `npm start` locally to use it.

---

## 1. How it fits together

```
┌──────────────────────────── Browser / APK (WebView) ─────────────────────────────┐
│  web_app/firebase_client.js   ← thin wrapper around the bundled Firebase SDK       │
│  web_app/views_auth.js        ← sign-up / sign-in / verify / reset / profile forms │
│            │                                                                       │
│            │ 1. createUserWithEmailAndPassword / signInWithEmailAndPassword         │
│            ▼                                                                       │
│   Firebase Authentication (Google)  ──► sends the verification / reset email       │
│            │ 2. ID token (RS256 JWT, ~1 h, auto-refreshed by the SDK)              │
│            ▼                                                                       │
│  POST /api/auth/firebase/signup   or   POST /api/auth/firebase/session             │
└────────────┬───────────────────────────────────────────────────────────────────────┘
             ▼
┌────────────────────────────── Node backend (backend/server.js) ────────────────────┐
│ backend/firebase_auth.js   verifies the ID token with Google's x509 certificates    │
│                            iss / aud / exp / iat / sub / email_verified             │
│ backend/auth_migrations.js adds firebase_uid, auth_provider, email_verified_at,     │
│                            last_sign_in_at, auth_events, case-insensitive indexes   │
│ SQLite (backend/riderise_lk.sqlite)  users_private ↔ profiles ↔ all existing data   │
│            │ 3. issues the normal RideRise session token (HMAC JWT, 7 days)         │
│            ▼                                                                        │
│  Every protected endpoint still authorises through getAuthUser(), which reads the   │
│  role and verification state from the database on each request.                     │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

**Key decisions**

| Decision | Why |
|---|---|
| Firebase UID is the identity | Stored in `users_private.firebase_uid`; usernames, emails and roles in a request body are ignored. |
| The verified token is the only source of `email_verified` | A client cannot unlock community features by lying about verification. |
| The RideRise session token is still a server-signed HMAC JWT | The whole app (and the legacy demo accounts) keep working; the Firebase token is only exchanged at sign-in and on session restore. |
| Role always comes from `users_private.role` | A Firebase account can never obtain `admin`/`moderator` from the client. Promotion happens in the Studio Console. |
| No merging by email | An existing profile with the same address produces `ACCOUNT_LINK_REQUIRED`; linking is an explicit, authenticated action. |
| Passwords never touch the server | Firebase holds the credential. There is no password column and no password field in any log or table. |
| Fail closed | Without `FIREBASE_PROJECT_ID` + `FIREBASE_API_KEY`, sign-up/login return `503 FIREBASE_NOT_CONFIGURED` and the UI shows a disabled form with an explanation. |

### Database additions (additive migration, safe for existing users)

`backend/auth_migrations.js` runs before seeding and only ever adds things:

- `users_private.firebase_uid` (unique), `auth_provider`, `email_verified_at`, `last_sign_in_at`
- `auth_events` — append-only audit trail: `signup`, `login`, `link`, `signout`, `blocked_unverified`, `failure` + reason, UID, IP
- unique **case-insensitive** indexes on `users_private.email` and `profiles.username`

Existing demo rows keep `firebase_uid = NULL` and continue to work through the legacy session
token; they can be linked from **Settings → Sign-in & security**.

### API surface

| Method & path | Purpose | Limits |
|---|---|---|
| `GET /api/auth/firebase/config` | Public browser config (projectId, apiKey, authDomain, appId) | — |
| `GET /api/auth/username-available?username=` | Live availability + suggestions | 60 / min / IP |
| `POST /api/auth/firebase/signup` | Verify token → create profile → session (idempotent per UID) | 10 / h / IP |
| `POST /api/auth/firebase/session` | Verify token → existing profile → session (never creates) | 20 / 5 min / IP, 30 / 5 min / UID |
| `POST /api/auth/firebase/link` | Attach a verified UID to the signed-in profile | 10 / h / user |
| `GET /api/auth/firebase/status` | Which provider/email this session uses | — |
| `POST /api/auth/firebase/logout` | Audit the sign-out | — |
| `POST /api/auth/demo` | Demo presets only (evaluation builds; refuses in production unless `ALLOW_DEMO_SIGNIN=1`) | — |
| `POST /api/auth/google` | **Deprecated alias** of `/api/auth/demo`; returns `410 GOOGLE_SIGNIN_REMOVED` for any Google ID token | — |

Error codes the UI understands: `AUTH_TOKEN_INVALID`, `AUTH_TOKEN_EXPIRED`,
`EMAIL_NOT_VERIFIED`, `ACCOUNT_SUSPENDED`, `ACCOUNT_DELETED`, `PROFILE_REQUIRED`,
`USERNAME_TAKEN`, `ACCOUNT_LINK_REQUIRED`, `ALREADY_LINKED`, `FIREBASE_ACCOUNT_IN_USE`,
`PROFILE_CREATE_FAILED` (retryable), `PROFILE_CONFLICT`, `RATE_LIMITED`,
`FIREBASE_NOT_CONFIGURED`, `AUTH_UNAVAILABLE`, `DEMO_SIGNIN_DISABLED`.

---

## 2. Create the Firebase project

1. Open <https://console.firebase.google.com/> and press **Add project**.
2. Name it (for example `riderise-lk`). Google Analytics is optional — sign-in does not use it.
3. Wait for provisioning, then continue to the console.

**Cost:** Email/password authentication is free at any realistic size for this community.
The Spark (free) plan is enough; no billing account is required for authentication.

---

## 3. Register the web app

1. On the project overview press the **Web** icon (`</>`).
2. Nickname: `RideRise LK Web`. Do **not** tick Firebase Hosting (you host the Node backend
   yourself).
3. Copy the `firebaseConfig` block shown afterwards. You need `apiKey`, `authDomain`,
   `projectId`, `appId` and `messagingSenderId`.
4. (Optional but recommended) Register a **second** web app for the installed app shell, e.g.
   `RideRise LK Android`. It can be the same config; a separate `appId` makes the analytics and
   auth audit views readable.

The APK ships the same bundled web app, so it uses the **web** config — nothing Android-native
is involved in email/password auth.

---

## 4. Enable the Email/Password provider

1. Console → **Authentication** → **Get started**.
2. **Sign-in method** tab → **Email/Password** → toggle **Enable** → **Save**.
3. Leave **Email link (passwordless sign-in)** disabled — RideRise LK does not use it.
4. Open the **Templates** tab and check the sender name/address on the
   “Email address verification” and “Password reset” emails. The default `noreply@…` works;
   customising the display name is a one-line change in the console.

> If you skip this step the client receives `auth/operation-not-allowed` and the UI explains
> exactly that: *“Email/password sign-in is not enabled for this Firebase project yet …”*

---

## 5. Configure the client (browser + APK)

The browser must never be given a service-account key. It only needs the public web config,
which the backend serves from `GET /api/auth/firebase/config`. Put the values in `.env`
(git-ignored) or your platform's environment settings:

```bash
FIREBASE_PROJECT_ID=rideriselk
FIREBASE_API_KEY=AIzaSy…                       # Project settings → Your apps → Web app → apiKey
FIREBASE_AUTH_DOMAIN=rideriselk.firebaseapp.com
FIREBASE_APP_ID=1:614966302540:web:c740ffce…   # appId from the same panel
FIREBASE_MESSAGING_SENDER_ID=614966302540
FIREBASE_STORAGE_BUCKET=rideriselk.firebasestorage.app   # optional, not used by auth
FIREBASE_MEASUREMENT_ID=G-VJ6QDQHXR4                     # optional, analytics is NOT loaded
```

`npm start` and `npm run dev` load `.env` automatically (`--env-file-if-exists=.env`), so the
file is the only place these values need to exist. `.env` is git-ignored — never commit it or
paste a service-account key into it unless you are enabling push.

Notes:

- `FIREBASE_AUTH_DOMAIN` defaults to `<projectId>.firebaseapp.com` if omitted.
- `FIREBASE_STORAGE_BUCKET` defaults to `<projectId>.firebasestorage.app`; RideRise LK does
  not initialise Firebase Analytics or Storage yet, so both are informational.
- `FIREBASE_PROJECT_ID` is also derived from `FCM_SERVICE_ACCOUNT_FILE` /
  `FCM_SERVICE_ACCOUNT_JSON` if you already configured push, so a single project configuration
  is enough for both features.
- These identifiers are **public by design** (Firebase requires them in the browser). They are
  not secrets. Never put the service-account JSON in the client bundle, the repo or the APK.

Restart the server. Confirm the hand-off:

```bash
curl -s localhost:3000/api/auth/firebase/config | python3 -m json.tool
# { "configured": true, "projectId": "rideriselk", "emailVerificationRequired": true,
#   "verifier": { "status": "ok" | "unreachable", ... } }
curl -s localhost:3000/api/health | python3 -c "import json,sys;print(json.load(sys.stdin)['capabilities'])"
# firebaseAuth: True, firebaseVerifier: 'ok'   ← must be 'ok' on the machine riders use
```

`firebaseVerifier: "unreachable"` means **this server** cannot reach
`www.googleapis.com` to fetch Google's secure-token certificates (firewall, proxy, air-gapped
host). Sign-in cannot complete on such a host; the welcome screen says exactly that instead of
blaming the password, and `/api/auth/firebase/config` carries the same status.

If `configured` is `false` the sign-in form renders **disabled** with the missing-variable
name. That is intentional: nothing pretends to work.

---

## 6. Server credentials, authorized domains and HTTPS

### 6a. Server credentials

Token verification needs **no** service-account key: it uses Google's public secure-token
certificates (`https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com`),
cached in memory and refreshed per the `Cache-Control` max-age. The only server-side secret
involved in auth is `JWT_SECRET` (32+ random characters) — generate it once:

```bash
JWT_SECRET=$(openssl rand -hex 32)
```

The service account is only needed for **push notifications** (see `docs/SETUP_GUIDE.md`
step 5a). Keep it outside the repository, `chmod 600`, and never ship it in the APK. If push
and auth use different Firebase projects, tokens are rejected (`TOKEN_AUDIENCE`) —
`npm run check:setup` warns about this.

### 6b. Authorized domains

Console → **Authentication → Settings → Authorized domains**:

| Domain | When |
|---|---|
| `localhost` (already listed) | development on this computer |
| `<projectId>.firebaseapp.com` (already listed) | default auth domain |
| your production domain, e.g. `riderise.yourdomain.lk` | every real deployment |
| your tunnel/preview host, e.g. `abc123.ngrok-free.app` | trying it on a phone before DNS is set up |
| the current Arena preview host, e.g. `3000-<sandbox-id>.e2b.app` | trying it from the browser preview (copy the host from the URL bar) |

Email/password sign-in itself does not redirect through `authDomain`, but the SDK checks the
origin for account-recovery and reCAPTCHA-style operations, and Google blocks unlisted
origins with `auth/unauthorized-domain`.

### 6c. HTTPS

Firebase requires a secure origin. `http://localhost` is exempt; anything else (LAN IP,
tunnel, production) must be `https://`. The APK shell already loads its bundled UI from
`https://appassets.androidplatform.net` (a virtual HTTPS origin served from the APK's own
assets), so the WebView is treated as a secure context and the Firebase SDK can persist
sessions — see section 8.

---

## 7. End-to-end checklist (run this after the steps above)

Work top to bottom; each line has a pass condition.

| # | Action | Pass condition |
|---|---|---|
| 1 | Open `/`, fill **Create account** (username, email, password ≥ 10 chars with a letter and a number, confirm) | "Verify your email" gate appears, listing the address |
| 2 | Check the inbox | Verification email from your Firebase project arrives (check spam) |
| 3 | Before verifying, reload and try to open `#/home` | Still gated; protected API calls return `403 EMAIL_NOT_VERIFIED` |
| 4 | Click the link, return, press **I’ve verified my email** | Onboarding wizard opens; the rider appears in `users_private` exactly once |
| 5 | **Resend verification email** from the gate | Button disables for 60 s, then can be pressed again |
| 6 | Sign out, sign in again with the same email + password | Lands in the app with the same profile, XP, friends and guilds |
| 7 | **Remember me:** close the browser completely, reopen the site | Still signed in (Firebase LOCAL persistence + server session restore) |
| 8 | Wrong password | “That email and password combination is not correct.” |
| 9 | **Forgot your password?** → enter the address | Reset email arrives; the new password works, the old one does not |
| 10 | Directory → `#/admin` as a normal rider | 403 / “Administrator sign-in required”; promotion only via the Studio Console |
| 11 | `npm run check:setup -- --url https://your-domain` | Email/password sign-in ✔, 0 blocking |
| 12 | `npm test` | 81 / 81 pass |
| 13 | Build and install the APK (section 8) | Sign-up, verification gate, restart and sign-out behave as in the browser |

---

## 8. Android (WebView shell)

What changed for auth in the shipped shell (`android/…/MainActivity.java`):

- The bundled UI is served from **`https://appassets.androidplatform.net`** through
  `shouldInterceptRequest()` instead of `file:///android_asset/`. `file://` gives the page an
  opaque origin (`Origin: null`), which breaks Firebase persistence between launches and
  makes the SDK's storage unreliable. The virtual HTTPS origin keeps every asset inside the
  APK while giving the WebView normal browser semantics.
- The JS bridge (`window.RRAndroid`) is unchanged, so shell detection, the API-base setting,
  microphone/location permissions and push registration keep working. `isBundledOrigin()`
  now trusts the virtual origin for mic/geo prompts and still refuses remote pages.
- Sessions survive an app restart through Firebase LOCAL persistence, and `app.js` re-exchanges
  the stored ID token with `POST /api/auth/firebase/session` on launch.

**Not verified here.** There is no Android SDK, emulator or device in this environment, so the
APK is only verified by *building* and *signature checking* — nobody has launched it. The
WebView changes above are the standard supported approach, but you must confirm them on a real
phone (checklist items 1–6 and 8 with the APK installed). If your WebView build still fails to
persist sessions, the fallback is the Gradle build described in `android/firebase/README.md`;
report what you see and it can be adapted.

---

## 9. What is tested vs. what waits for your Firebase project

### Tested automatically (`npm test`, 88 tests total)

`tests/auth.firebase.test.js` (23 tests, real verifier, locally-signed ID tokens):

- sign-up creates exactly one `users_private` + `profiles` row and a working session token
- a request body cannot dictate role, email, UID or verification state
- unverified email → `403 EMAIL_NOT_VERIFIED`, no token, no duplicate profile; the same account
  signs in normally once verified
- duplicate usernames rejected, including different letter case; suggestions returned
- username availability validation and collision reporting
- garbage / expired / wrong-audience / missing-subject / future-`iat` / forged-signature /
  unknown-key tokens all rejected with the right codes
- private endpoints (`/api/friends`, `/api/dm/threads`, `/api/notifications`, `/api/auth/session`)
  reject anonymous callers *and* raw Firebase tokens
- sign-in restores the same profile (XP, rank, onboarding state) and never duplicates rows
- sign-up retry is idempotent; a simulated database failure during profile creation returns
  `PROFILE_CREATE_FAILED` with nothing written, and the retry succeeds
- an existing profile with the same email is never merged (`ACCOUNT_LINK_REQUIRED`)
- linking requires an authenticated, verified action; already-linked and in-use accounts are
  refused
- status/logout report honestly and sign-outs are audit-logged
- admin/moderation endpoints deny a rider, allow after DB promotion, deny again after demotion
- no password column, no tokens or password strings in `auth_events` or `users_private`
- suspension applies to live sessions; deleted accounts return `410`
- demo sign-in cannot mint an admin role or a Firebase-linked identity
- auth endpoints are rate limited per client address, and `X-Forwarded-For` cannot be spoofed
  to reset the limit from the internet

`tests/ui.auth.test.js` (7 jsdom flows against the real backend, stubbed SDK):

- sign up → verification gate → profile created once → verified → onboarding wizard
- taken username blocked **before** any Firebase account is created
- wrong password and weak-password messages
- a remembered Firebase session restores after an "app restart" (no local token)
- sign-out clears both the RideRise token and the Firebase session
- Settings → Sign-in & security shows the provider and requests a password reset

Also updated: the smoke/flow suites still pass with the new sign-in screen (88/88).

### Awaiting your Firebase project (cannot be tested here)

| Item | Why it cannot be tested in this workspace |
|---|---|
| Account creation against real Firebase | needs a real project + API key |
| Verification and password-reset **emails** | delivered by Google; no project, no mail |
| Real ID tokens from Google | the verifier is tested with locally-signed tokens and Google's certificate contract; live x509 fetch is not exercised |
| Authorized-domain behaviour | depends on your domain list |
| Persistent session in a real browser/Android WebView | needs a browser profile / a phone |
| Disabled or deleted Firebase user behaviour | needs the console to disable an account |
| SMS/quota/pricing realities | not applicable to email/password |

Anything in that table is **unverified until you run section 7**. Do not treat the feature as
"done" for a production launch before those checks pass on your own deployment.

---

## 10. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Sign-in form disabled, “not configured on this server” | `FIREBASE_PROJECT_ID`/`FIREBASE_API_KEY` unset | section 5; restart |
| `auth/operation-not-allowed` | Email/Password provider not enabled | section 4 |
| `auth/unauthorized-domain` | origin missing from authorized domains | section 6b |
| `auth/network-request-failed` in the APK | API base unset, or device offline | Settings → Server connection; HTTPS only |
| `503 AUTH_UNAVAILABLE` / `verifier_unreachable` | the **server** cannot reach `www.googleapis.com` (firewall, proxy, sandbox) | allow outbound HTTPS to `www.googleapis.com` and `*.googleapis.com`, or run on a normal host; check `firebaseVerifier` in `/api/health` |
| Welcome screen shows the “server cannot reach Google” banner | same cause, detected at startup | as above — this is not a credential problem |
| `401 AUTH_TOKEN_EXPIRED` repeatedly | device clock far off, or a very old cached token | fix device clock; the SDK refreshes automatically |
| `409 PROFILE_REQUIRED` loop | profile creation was interrupted | complete the username form (it retries the same Firebase UID) |
| `409 ACCOUNT_LINK_REQUIRED` | a RideRise profile already uses that email | sign in to that profile, then Settings → Sign-in & security → Link |
| `403 DEMO_SIGNIN_DISABLED` on a demo account | production without `ALLOW_DEMO_SIGNIN=1` | expected; use a real account |
| Everything works but riders are always “unverified” | clicking the gate before opening the email link | open the link first; the gate re-checks with `reload()` |

---

## 11. Privacy and safety notes

- Email addresses stay in `users_private` and are never returned to other riders; only the
  rider’s own session and the Studio Console can see them.
- Password reset is entirely Firebase-hosted; RideRise LK never sees a reset token.
- The existing 16+ gate, minor safeguards, privacy settings and friends-only messaging are
  untouched: a new rider still completes onboarding (age confirmation, terms, privacy) before
  community features open.
- `auth_events` records event type, outcome, UID and IP — never tokens, never passwords.

---

## 12. File map

| File | Role |
|---|---|
| `backend/firebase_auth.js` | ID-token verifier, certificate cache, fail-closed config |
| `backend/auth_migrations.js` | additive schema migration + `auth_events` audit helper |
| `backend/server.js` | 7 auth endpoints, `getAuthUser()` verification gate, rate limits |
| `web_app/firebase_client.js` | SDK wrapper, friendly errors, pending-verification state |
| `web_app/views_auth.js` | welcome, sign-in/up, verification gate, complete-profile, reset |
| `web_app/views_profile.js` | Settings → Sign-in & security (status, link, reset) |
| `web_app/vendor/firebase-compat.min.js` | bundled Firebase SDK (offline, APK-safe) |
| `scripts/bundler/firebase-entry.js` | esbuild entry used to rebuild that bundle |
| `android/…/MainActivity.java` | virtual HTTPS origin for bundled assets |
| `tests/auth.firebase.test.js` | 23 server-side auth tests |
| `tests/ui.auth.test.js` | 7 UI flows |
| `tests/fixtures/firebase-test-*.pem` | throwaway keypair for locally-signed test tokens |
