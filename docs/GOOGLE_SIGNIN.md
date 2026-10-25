# Google Sign-In: sandbox bridge → production Google Identity Services

RideRise LK never asks for a Google password. Authentication is delegated to Google and the
app only ever receives a Google-issued credential, which the **backend** verifies before
issuing a RideRise LK session token.

Two modes exist in the codebase:

| Mode | When | Behaviour |
|---|---|---|
| **Sandbox OAuth bridge** | `GOOGLE_CLIENT_ID` is unset (this sandbox) | Clearly labelled sheet with four demo Google identities and an arbitrary email. Exercises the same server-side session flow so every other feature is testable offline. No password field exists. |
| **Production GIS** | `GOOGLE_CLIENT_ID` is set and the page is served over HTTPS | Loads `https://accounts.google.com/gsi/client`, renders the official Google button, receives an ID token (`credential`) and posts it to `POST /api/auth/google` as `{ idToken }`. The server verifies signature, issuer, audience, expiry and `email_verified` before creating a session. |

## Setup steps (production)

1. **Google Cloud Console → APIs & Services → OAuth consent screen**
   - App name: `RideRise LK`
   - Support email: `support@shaundavidstudios.lk`
   - Authorised domains: your hosting domain
   - Scopes: `openid`, `email`, `profile` only
   - Publish the consent screen (or add test users while in testing)
2. **Credentials → Create credentials → OAuth client ID → Web application**
   - Authorised JavaScript origins: `https://app.yourdomain.lk`
   - Authorised redirect URIs: `https://app.yourdomain.lk`
3. **Expose the client ID to the frontend** — add to `web_app/index.html` before the app
   scripts (or inject it server-side):
   ```html
   <script>window.RR_GOOGLE_CLIENT_ID = '1234567890-abc.apps.googleusercontent.com';</script>
   ```
4. **Set the same value on the server**:
   ```bash
   export GOOGLE_CLIENT_ID="1234567890-abc.apps.googleusercontent.com"
   ```
5. **Android**: add a second OAuth client ID of type *Android*, using package
   `lk.shaunstudios.riderise` and the release **SHA-256** certificate fingerprint from
   `release/BUILD_INFO.md`. If you later add native Google sign-in via Play Services,
   request the ID token natively and pass it to the same endpoint.

## What the server verifies (`verifyGoogleIdToken`)

```text
header.alg == RS256
payload.iss ∈ {accounts.google.com, https://accounts.google.com}
payload.aud == GOOGLE_CLIENT_ID
payload.exp > now
payload.email_verified != false
signature validates against Google's JWKS (https://www.googleapis.com/oauth2/v3/certs, 1h cache)
```

Any failure returns `401 AUTH_FAILED` with a reason; the server never trusts a client-claimed
email when `GOOGLE_CLIENT_ID` is configured. If a client posts `idToken` while the server has
no client ID configured, the request is refused with
`503 GOOGLE_CLIENT_ID_NOT_CONFIGURED` — a forged token can never be replayed into a session.

## Session handling

- Sessions are stateless HMAC-SHA256 JWTs (`sub`, `role`, `exp` 7 days), signed with
  `JWT_SECRET`. The token is stored in `localStorage` on web and in WebView storage on
  Android.
- Signing out clears the token from the device. Revoking a session server-side = rotate
  `JWT_SECRET` (all sessions invalidate) or switch to a `sessions` table — the schema has
  no token table by design, documented as a Phase 1 simplification.
- Role (`rider` / `moderator` / `admin`) is read from `users_private` on every request, so
  a role change takes effect immediately.

## Error states surfaced to users (all tested)

| Code | Message |
|---|---|
| `AUTH_CANCELLED` | "Google Sign-In was cancelled before completion. No account changes were made." |
| `AUTH_UNAVAILABLE` | "Google Authentication service is temporarily unreachable. Check your internet connection and tap Retry." |
| `AUTH_FAILED` | "Google OAuth token verification failed or expired. Please try signing in again." |
| `PASSWORD_NOT_ALLOWED` | "RideRise LK never accepts Google passwords directly…" |
| `ACCOUNT_SUSPENDED` | Suspension reason + safety contact |

## Account recovery & deletion

- **Recovery**: identity recovery (password, 2FA, lost device) is handled entirely by
  Google at `accounts.google.com`. RideRise LK support can help with profile data but can
  never restore a deleted account.
- **Deletion**: Profile/Settings → *Delete my account permanently* → type `DELETE`.
  `DELETE /api/account` cascades through profiles, bicycles, posts, comments, likes,
  bookmarks, friendships, blocks, conversations, messages, guild memberships, progress,
  favourites, registrations and notifications. Resolved moderation audit logs are retained
  up to 90 days for abuse prevention, as disclosed in the Privacy Policy.
