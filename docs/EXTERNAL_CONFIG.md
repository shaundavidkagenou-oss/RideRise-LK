# External configuration still required

Everything below is an **integration point that exists in code**, not a simulated control.
Where a credential is needed, the app degrades gracefully and tells the user exactly what
is missing — it never pretends a feature succeeded.

| # | Item | Status in Phase 1 | What you must supply | Where |
|---|---|---|---|---|
| 1 | **Google Sign-In** (Google Identity Services) | Sandbox OAuth bridge active; real GIS button + backend ID-token verification implemented | `GOOGLE_CLIENT_ID` (Web client ID) from Google Cloud Console | `docs/GOOGLE_SIGNIN.md` |
| 2 | **Push notifications** (Firebase Cloud Messaging) | In-app notification centre, unread badges, Android 13+ permission request and native bridge all work | Firebase project, `google-services.json`, server FCM service-account JSON | §2 below |
| 3 | **Backend hosting + domain** | Local Node/SQLite server included | HTTPS host, persistent volume, `JWT_SECRET`, domain | §3 |
| 4 | **Android app → backend URL** | Configurable in-app with a live connection test | Your hosted API URL | Settings → Server connection |
| 5 | **Release signing key custody** | Key generated locally and git-ignored | Secure backup (secrets manager) | `android/keystore/` |
| 6 | **Legal review** | Draft Terms, Privacy Policy, Community Guidelines and Safety Notice are seeded and editable | Sri Lankan legal counsel review; replace text via DB/admin tooling | `legal_documents` table, `backend/seed.js` |
| 7 | **Media storage (production)** | 5 MB validated image uploads stored as data URLs in the database; EXIF/GPS removed | Object storage (Firebase Storage / S3) + CDN, signed upload URLs | `POST /api/upload/media` |
| 8 | **Email/SMS for support** | In-app reporting + moderator workflow | Real mailboxes for `safety@` / `privacy@` / `support@` | `config/brand.config.json → contact` |
| 9 | **Firebase migration (optional)** | Relational schema is 1:1 mappable to Firestore; Google sign-in can move to Firebase Auth | Firebase project + rules | §4 |
| 10 | **Analytics/crash reporting** | Not enabled (privacy-first default) | Chosen provider + consent flow | n/a |

---

## 1. Google Sign-In

See the dedicated guide: [`GOOGLE_SIGNIN.md`](GOOGLE_SIGNIN.md).

Until configured, the app displays a **Sandbox Google OAuth bridge** sheet that is
labelled as such, offers four demo identities plus an arbitrary Google address, and
exercises the real server session token flow. It never accepts a password.

---

## 2. Firebase Cloud Messaging (push notifications)

Already implemented:

- Android `POST_NOTIFICATIONS` permission in the manifest, runtime request via
  `RRAndroid.requestNotificationPermission()`, exposed in **Settings → Notifications**.
- Server-side `notifications` table, unread counters, `/api/notifications` and
  `POST /api/notifications/read-all`.
- Automatic notification creation for friend requests, mentions, moderation decisions and
  event reminders.

To finish production push:

1. Create a Firebase project → add Android app `lk.shaunstudios.riderise` with the
   release **SHA-256** fingerprint from `release/BUILD_INFO.md`.
2. Place `google-services.json` in `android/app/` (Gradle path) or supply FCM through the
   studio's Gradle project.
3. Implement `FirebaseMessagingService` and send the device token to a new endpoint
   `POST /api/notifications/device-token` storing `{ user_id, fcm_token, platform }`.
4. On the server, send pushes for rows inserted into `notifications` using the FCM v1 API
   with the service-account JSON (`FCM_SERVICE_ACCOUNT` env var, **never** committed).
5. Keep the existing in-app notification centre as the fallback — it already works today.

---

## 3. Hosting the backend

Minimum viable production deployment:

```bash
export JWT_SECRET="$(openssl rand -hex 48)"     # store in secret manager
export GOOGLE_CLIENT_ID="xxxx.apps.googleusercontent.com"
export DB_PATH=/data/riderise_lk.sqlite          # persistent volume
node backend/server.js                           # behind nginx/Caddy with TLS
```

Checklist before launch:

- [ ] TLS only (the Android app refuses cleartext).
- [ ] Replace the wildcard CORS header with your exact origins.
- [ ] Move `JWT_SECRET` into a secret manager; rotate and invalidate sessions if leaked.
- [ ] Back up the SQLite file hourly (or migrate to Postgres — the SQL is standard).
- [ ] Set up log rotation and a health probe against `/api/health`.
- [ ] Confirm retention/deletion jobs align with the Privacy Policy (reports: 90 days).

---

## 4. Optional Firebase / Firestore migration

The Phase 1 schema uses flat collections with server-controlled writes, so it maps
directly:

| SQLite | Firestore |
|---|---|
| `users_private` | `users/{uid}` (owner + server read only) |
| `profiles` | `profiles/{uid}` (public read subject to privacy flags) |
| `bicycles` | `bicycles/{bikeId}` (owner write; server recomputes `build_score`) |
| `posts`, `comments` | `posts/{postId}`, `posts/{postId}/comments/{commentId}` |
| `friendships`, `user_blocks` | `friendships/{id}`, `blocks/{uid_targetId}` |
| `conversations`, `messages` | `conversations/{id}/messages/{msgId}` (participants only) |
| `guilds`, `guild_memberships`, `guild_messages` | same names as subcollections |
| `stunt_modules`, `user_stunt_progress` | `stuntModules/{id}`, `progress/{uid}/modules/{id}` |
| `parts_catalog` | `catalog/{partId}` (admin write only) |
| `studio_events`, `event_registrations` | `events/{id}`, `events/{id}/registrations/{uid}` |
| `reports`, `notifications`, `admin_audit_logs` | `reports/{id}`, `users/{uid}/notifications/{id}`, `auditLogs/{id}` |

Critical rules if you move to Firestore (these preserve the guarantees tested here):

- XP, rank, badges and bike scores must be written **only by Cloud Functions**; clients
  get no write access to `profiles.xp`, `rank_id`, `user_achievements`, `bicycles.build_score`.
- `users_private` is readable only by its owner and admins (never by other riders).
- `conversations/messages` require an accepted `friendships` document and no block.
- Guild content requires an active membership when `privacy_type == 'private'`.
- Moderation fields (`moderation_status`, `suspended`, `role`) are server-write only.

---

## 5. What was intentionally **not** invented

- No Sri Lankan prices, stock levels, retailer claims or product specifications were
  fabricated. Seed catalog entries are explicitly marked as administrator-verified
  references or **"Price not verified"**, each with a compatibility warning and a
  last-verified date.
- No safety certification claims are made for any product.
- No claim is made that the app is fully compliant with any particular law; the legal
  documents are drafts pending review.
