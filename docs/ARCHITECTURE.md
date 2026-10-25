# Architecture

## 1. System overview

```
┌──────────────────────────────┐        HTTPS + JSON        ┌──────────────────────────────┐
│  Android app                 │  ───────────────────────▶  │  Node.js API (backend/)      │
│  ─ WebView + bundled UI      │  Bearer JWT (HMAC-SHA256)  │  ─ routing & validation      │
│  ─ native share sheet        │  ◀───────────────────────  │  ─ RBAC + ownership checks   │
│  ─ system file picker        │                            │  ─ XP / rank engine          │
│  ─ notification permission   │                            │  ─ bike-rating engine        │
└──────────────────────────────┘                            │  ─ moderation & audit log    │
                                                            │  ─ static web bundle + APK   │
┌──────────────────────────────┐                            └───────────────┬──────────────┘
│  Browser (live preview/QA)   │  same API, same UI bundle                  │ SQLite (WAL)
└──────────────────────────────┘                                            ▼
                                                            ┌──────────────────────────────┐
                                                            │ riderise_lk.sqlite           │
                                                            │ 28 tables + query indexes    │
                                                            └──────────────────────────────┘
```

One UI codebase runs in both the browser and the Android WebView, so the installable app and
the live preview cannot drift apart. Upgrade path to Firebase Auth/Firestore is documented
in `EXTERNAL_CONFIG.md`; the relational schema maps 1:1.

## 2. Frontend (`web_app/`)

| File | Responsibility |
|---|---|
| `index.html` | App shell: animated splash, top strip (language/motion/contrast, APK links), header, `#mainViewport`, 5-tab bottom nav, modal + toast roots |
| `api.js` | API client (`fetch` + abort timeout), session store, error taxonomy, i18n lookup, toast/modal/empty/error/skeleton primitives, XP progress component, avatar/logo helpers |
| `views_auth.js` | Welcome hero, Firebase email/password sign-up & sign-in, verification gate, onboarding wizard, legal document reader |
| `views_feed.js` | Feed, composer, post actions, comments, sharing, reporting, 7-point safety inspection |
| `views_stunts.js` | Learning library, module reader, checklist/quiz enforcement, inline SVG technique diagrams |
| `views_guilds.js` | Guild discovery, creation, membership, roles, announcements, chat, shared posts |
| `views_profile.js` | Profile, avatar crop, 13-question bike wizard with live scoring, score breakdown, comparison, achievements, activity, settings/privacy/deletion |
| `views_explore.js` | Explore hub, leaderboards, rider search, parts catalog + compare, events, Safety Centre, notifications |
| `views_social.js` | Friends, requests, blocking, conversation list, chat with attachments/mute/report |
| `views_admin.js` | Admin metrics, report resolution, content moderation, rank editor, catalog verification, event publishing, audit log |
| `app.js` | Boot sequence, hash router, chrome painting, unread badges, reduced motion/contrast/locale controls |
| `styles.css`, `app-styles.css` | Design tokens + component layer (dark charcoal foundation, orange/amber accents from the badge, skeletons, wizard, chat, tables) |

Routing is hash-based (`#/home`, `#/stunt…`, `#/user/:id`, `#/guild/:id`, …), which works
identically under `file://` in the WebView and over HTTP in the browser.

State is intentionally simple (module-scoped state objects + `localStorage` for the token,
locale and accessibility flags). There is no build step and no framework, which keeps the
APK small (2.3 MB) and the source auditable.

## 3. Backend (`backend/`)

- `server.js` — hand-rolled HTTP router on Node's `http` module: ~60 endpoints, JSON I/O,
  request size caps, CORS, static file serving, SPA fallback, API 404 guard.
- `services.js` — pure domain logic:
  - `calculateBikeBuildRating()` — 0–100 across five weighted categories with a hard
    critical-defect cap (≤39) and cosmetic rating deliberately excluded.
  - `awardValidatedXp()` — allow-list of safe action types, per-action max clamps,
    duplicate-reference protection, automatic rank recalculation.
  - `recalculateUserRank()`.
- `schema.sql` — 28 tables with foreign keys, `CHECK` constraints on enums and indexes that
  match the actual queries (feed, leaderboards, messages, catalog, events, reports).
- `seed.js` — deterministic, substantive seed content: 7 ranks, 6 achievements, 4 demo
  riders (incl. a 16–17 account), 3 bikes (one deliberately defective to demonstrate the
  safety cap), 3 guilds, 4 posts + comments, friendships + conversation, **21 stunt
  modules**, **9 catalog categories** with honest verification labels, 4 events (3 official
  + 1 community), and the legal documents including the verbatim draft safety notice.

Security model summary (full detail in `DATABASE_SCHEMA.md` §5):

| Concern | Control |
|---|---|
| Authentication | Firebase email/password; ID token verified server-side against Google's secure-token certificates; signed session JWT. Google OAuth was removed. |
| Authorization | Role read per-request from DB; ownership checks on every mutation; guild role checks; block checks |
| IDOR | Every object mutation validates `user_id` ownership (tested) |
| Privilege escalation | `/api/profile` rejects `xp`, `rank_id`, `role`; admin routes require role (tested) |
| Abuse | Sliding-window rate limits on posts, messages, friend requests and reports |
| Uploads | MIME allow-list, strict base64 validation, 5 MB decoded-size cap, EXIF/GPS stripped |
| Privacy | `users_private` never joined into public profile responses; DOB/email/tokens excluded (tested) |
| Audit | `admin_audit_logs` for moderation actions, rank edits |

## 4. Android shell (`android/`)

`MainActivity.java` (~330 lines) hosts the WebView and exposes a **whitelisted** JavaScript
bridge (`RRAndroid`) with five methods: `getApiBase`, `setApiBase`, `shareText`,
`requestNotificationPermission`, `getPlatformInfo`, `openExternal`. No reflection, no file
system access, no credential storage.

- Navigation guard: the WebView can only load `file://…/android_asset/webapp/*`; any
  http(s) navigation opens the system browser instead, and `javascript:`, `intent:` and
  unknown schemes are blocked.
- `onShowFileChooser` → system image picker for avatar/bike/post uploads.
- Back button → SPA history, double-press to exit.
- Theme: dark splash (`@drawable/splash_background` with the badge), no action bar,
  black status/nav bars, `usesCleartextTraffic="false"`.
- Icons and adaptive icon generated from the supplied badge at build time (never stretched).

## 5. Build pipeline (`scripts/`)

`build_apk.sh` is a reproducible, SDK-free pipeline:
`make_icons.py` → bundle web assets → `aapt2 compile/link` → `ecj` (Java compile) →
`d8` (DEX) → `package_apk.py` (repackage + 4-byte zip align) → `apksigner` (v2+v3) →
verification + SHA-256. Toolchain artifacts are cached outside the repo
(`~/.cache/riderise-apk-tools`), keys stay in git-ignored `android/keystore/`.

## 6. Design system

Tokens live in `web_app/styles.css` (`:root`) and `config/brand.config.json`:

| Token | Value | Usage |
|---|---|---|
| Background | `#07090E` / `#0E131D` | App canvas, headers |
| Surfaces | `#151C2B`, `#1D263B` | Cards, elevated controls |
| Brand orange | `#FF6B00` | Primary actions, energy accents |
| Brand amber/gold | `#FF9E00`, `#FFD13B` | Gradients, rank colours, highlights |
| Cyan | `#00B4D8` | Informational badges, tags |
| Danger | `#FF3B5C` | Safety warnings, destructive actions |
| Radii | 8 / 14 / 20 px | Inputs, cards, dialogs |
| Motion | 180 ms `cubic-bezier(.16,1,.3,1)` | Micro-interactions; disabled wholesale under reduced motion |

Type: Inter/system stack, 0.66–2.6 rem scale, uppercase micro-labels with letter-spacing for
sport-product feel. Accessibility: WCAG-AA contrast on text pairs, 16 px minimum body copy in
cards, focus-visible styles, `aria-live` regions for toasts, `role="progressbar"` on XP bars,
labelled icon-only buttons, `aria-current` on bottom nav, and a reduced-motion class that
zeroes transitions/animations app-wide (plus `prefers-reduced-motion`).

## 7. Extending to Phase 2

- `guilds`/`guild_memberships` already model roles for voice channel permissions.
- No location columns exist, so adding an opt-in `ride_sessions` table requires no migration
  of existing consent.
- The notification table already supports arbitrary `type` + reference for ride invites.
- The design system and navigation have room for a sixth destination behind the Explore hub
  without breaking the 5-tab structure.
