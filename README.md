# RideRise LK — Phase 2

**RIDE / STUNT / CONNECT** — a community, learning, guild and bike-build platform for Sri
Lankan BMX and freestyle riders, built for **Shaun David Studios**.

<p align="center">
  <img src="assets/brand/riderise_logo.png" width="240" alt="Official RideRise LK BMX sunset badge by Shaun David Studios" />
</p>

| | |
|---|---|
| **Working app name** | RideRise LK *(name/brand configurable in `config/brand.config.json`)* |
| **Studio** | Shaun David Studios |
| **Android package** | `lk.shaunstudios.riderise` |
| **Version** | 2.0.0 (versionCode 2) |
| **Minimum age** | 16 (16–17 gets youth-safety defaults) |
| **Languages** | English · සිංහල · தமிழ் (localisation architecture in place) |
| **APKs** | `release/apk/riderise-lk-phase2-debug.apk`, `…-release.apk` (signed) |
| **Tests** | 78 automated tests (including 27 Firebase-auth tests) + 106 Phase 2 API assertions + 36 admin capability checks — all passing |

---

## 1. What Phase 2 adds

Everything from Phase 1 remains, including the existing database and users.

> **Sign-in is now real Firebase Authentication (email + password).** Riders create an account
> with a username, email and password, confirm the verification email, and only then reach the
> community features. Sessions survive browser and app restarts; password resets are handled by
> Firebase. Setup: [`docs/FIREBASE_AUTH.md`](docs/FIREBASE_AUTH.md). Until you connect your own
> Firebase project the sign-in form is disabled and says so — the demo accounts remain only for
> evaluating the build.

- **Live guild map** — consent-first, off by default, approximate by default, 1.5 km fixed
  radius for riders aged 16–17, short-lived precise option for adults (60 m, ≤10 min),
  immediate stop, auto-expiry, no location history, manager revoke, battery-conscious 45 s
  cadence, manual + 20 s refresh, offline/permission error states.
- **Guild voice rooms** — real WebRTC mesh between devices, members only, join/listen-only,
  mute, speaker/earpiece/Bluetooth routing, participant list, mic indicator, block/report,
  no recording, honest connection states.
- **Walkie-talkie PTT** — press-and-hold with a server-held transmission floor (overlapping
  transmissions are impossible), instant release, 30 s timeout, channel authorization,
  transmitting/listening/connecting/disconnected states, distinct visual language.
- **Guild hub** — announcements with images, discussion feed, guild events + RSVP/calendar,
  member list, roles, approvals, settings, community rules, audit log, appeals,
  report-a-manager, public/approval/private discovery.
- **Messaging & notifications** — realtime DM via SSE, typing indicators, receipts that
  respect a privacy toggle, replies, reactions, delete tombstones, mute, delivery history,
  quiet hours, notification preferences, deep links, link/scam warnings, in-app news.
- **Events** — calendar + list views, district/category filters, registration, capacity,
  waiting list, cancel, private check-in (timestamp only), announcements, reminders,
  results/galleries, organiser and safety info, admin-only official studio badge, feature
  on home, no user impersonation of the studio.
- **Learning** — five pathways, prerequisites with rationale, beginner/intermediate/
  advanced/maintenance tracks, checklists, server-graded quizzes, progress summaries, an
  admin CMS, and advanced lessons framed as references, never guarantees.
- **Parts & builds** — manufacturer/model search, LKR price filters, comparison,
  compatibility checks labelled “Check compatibility”, saved builds, verified-retailer
  links, price history only when verified, data-source and last-updated labels, admin
  verification/correction.
- **Moderation & teen safety** — report/block everywhere (including voice), moderation
  queue with escalation notes, suspension/ban/appeal workflows, human review, spam and
  suspicious-link limits, privacy-friendly defaults for 16–17.
- **Studio console** — credential or Google sign-in, forced password rotation, metrics,
  reports, appeals, users, feedback inbox, news, official events, tutorial CMS, catalogue
  verification, broadcast, push diagnostics and an append-only audit log.

---

## 2. Run it in 60 seconds

> **Setting this up for real use?** Follow **[`docs/SETUP_GUIDE.md`](docs/SETUP_GUIDE.md)** — an
> ordered walkthrough for hosting, Google sign-in, Firebase push, TURN voice, APK install and
> Play publishing, with a verification step after each one.
> `npm run check:setup` tells you exactly what is still missing.

```bash
npm start                                  # http://localhost:3000  (SQLite created, migrated, seeded)
npm test                                   # 78 automated tests (serial)
npm run apk                                # rebuild signed debug + release APKs (no SDK required)

cp .env.example .env                       # optional integrations (map, TURN, FCM, Google)
node --env-file=.env backend/server.js     # run with them enabled
```

Node.js **22.5+** is required (the backend uses the built-in `node:sqlite` module). No
external database or paid service is needed to run it locally: with no `.env` the app starts
fully functional and reports `push: false`, `turnRelay: false` honestly in `/api/health`.

### Demo rider accounts (sandbox Google sign-in)

| Account | Role | Why it matters |
|---|---|---|
| `kasun.perera.demo@gmail.com` | Rider (Stunt Specialist) | Full profile, guild owner |
| `roshan.fernando.demo@gmail.com` | Rider + guild moderator | Moderation role |
| `dilshan.student.demo@gmail.com` | **16–17 years old** | Youth defaults, location locks |
| `nethmi.admin@shaundavidstudios.lk` | **Studio administrator** | Full console |

### Administrator credential

The brief requires a working studio administrator account:

- **username:** `admin$123$`
- **password:** `admin$123$`

It can monitor and ban accounts, delete messages, receive all reports and feedback, publish
news and official events, and do everything an ordinary rider can do (the credential signs
in as the seeded studio administrator profile `nethmi_sds`).

This is a **development** credential and works exactly as written on a fresh database. It is
refused when `NODE_ENV=production`: set `ADMIN_USERNAME`/`ADMIN_PASSWORD` there, or use the
random password printed once in the server log and change it at first sign-in. You can change
it at any time in **Studio Console → 🔑 Password**; change it before any real deployment.

---

## 3. Architecture

```
android/   Native shell (WebView, microphone/location permission bridge, Bluetooth route,
           share sheet, file picker). Permission grants are limited to bundled file:// assets.
web_app/   The UI: shell, map engine (slippy tiles, no external JS), realtime client (SSE),
           WebRTC/PTT engine, and every screen.
backend/   Node HTTP API + SQLite. Phase 1 core plus backend/phase2/* feature routers.
config/    Brand, package, ranks, districts, rate limits, theme, version.
scripts/   APK pipeline (aapt2 → ecj → d8 → zip-align → apksigner) and icon generator.
tests/     node:test API suites + jsdom end-to-end UI flows (Phase 1 and Phase 2).
docs/      Setup, admin, security, schema, migration, build and test documentation.
release/   Signed APKs, checksums and build provenance.
```

The same UI runs in a browser and inside the Android WebView, so the preview and the app
never drift. Every privileged action — XP, ranks, location, voice access, messages, admin
tools — is enforced in the backend.

---

## 4. What you must configure

| Step | Doc |
|---|---|
| **Rider accounts — Firebase email/password** (`FIREBASE_PROJECT_ID`, `FIREBASE_API_KEY`, verification, password reset) | [`docs/FIREBASE_AUTH.md`](docs/FIREBASE_AUTH.md) |
| Legacy Google sign-in (optional, no longer used by the app) | [`docs/GOOGLE_SIGNIN.md`](docs/GOOGLE_SIGNIN.md) |
| Map tile provider (`MAP_PROVIDER`, `MAP_API_KEY`, optional proxy) | [`docs/PHASE2_VOICE_AND_MAP.md`](docs/PHASE2_VOICE_AND_MAP.md) |
| TURN relay for reliable voice (`TURN_URLS`, `TURN_SECRET`) | [`docs/PHASE2_VOICE_AND_MAP.md`](docs/PHASE2_VOICE_AND_MAP.md) |
| Firebase Cloud Messaging (step by step) | [`docs/PHASE2_FIREBASE_PUSH.md`](docs/PHASE2_FIREBASE_PUSH.md) |
| HTTPS hosting + API URL in the Android shell | [`docs/BUILD_INSTRUCTIONS.md`](docs/BUILD_INSTRUCTIONS.md) |
| Database migration and backup | [`docs/PHASE2_MIGRATION.md`](docs/PHASE2_MIGRATION.md) |
| Admin operations | [`docs/PHASE2_ADMIN_GUIDE.md`](docs/PHASE2_ADMIN_GUIDE.md) |
| APK build and installation walkthrough | [`docs/PHASE2_APK_BUILD.md`](docs/PHASE2_APK_BUILD.md) |
| Security and privacy review | [`docs/PHASE2_SECURITY_AND_PRIVACY.md`](docs/PHASE2_SECURITY_AND_PRIVACY.md) |
| **All third-party accounts, fees, quotas and limits** | [`docs/EXTERNAL_CONFIG.md`](docs/EXTERNAL_CONFIG.md) |

---

## 5. Honest status

**Implemented and verified here:** every feature in section 1, the schema and migration,
server-side authorization, realtime messaging, map/voice/PTT engines, APK build and signing,
and the automated suites listed in [`docs/PHASE2_TEST_RESULTS.md`](docs/PHASE2_TEST_RESULTS.md).

**Requires your credentials or hardware:**

1. **Google OAuth** — the real client id and Android client registration.
2. **Map tiles** — a provider key for production traffic (OpenStreetMap works without a key
   under its usage policy).
3. **TURN relay** — needed for calls across strict carrier NAT.
4. **Firebase push** — server sending is implemented, but the app does not yet obtain an FCM
   token; until steps 7–8 of the Firebase guide are done, notifications are in-app only.
5. **Legal review** of the draft terms, privacy policy, community rules, minor policy and
   safety notice.

**Not verified in this environment:** installation on a physical device or emulator,
two-device voice/PTT audio, Bluetooth routing, TalkBack and Sinhala/Tamil rendering on real
hardware, push delivery, and battery drain over a long session. These are listed explicitly
in `docs/PHASE2_TEST_RESULTS.md` rather than claimed as tested.

**Not claimed:** end-to-end encrypted messaging, full legal compliance, recording of voice
rooms, or a Play Store submission. The APK pipeline outputs APK files; Play requires an AAB
built with Gradle (documented in `docs/PHASE2_APK_BUILD.md`).

---

## 6. Safety stance (non-negotiable)

RideRise LK never rewards dangerous riding, road stunts, traffic riding or escalating
physical risk. XP comes from learning, inspections, verified knowledge, positive community
help and official event participation. Advanced pathways are gated behind prerequisites,
explicit acknowledgement and a recommendation for qualified in-person coaching in a
controlled facility. Every tutorial states that an online guide cannot guarantee safety.

Live location is opt-in, approximate by default, time-limited and unavailable in precise
form to riders aged 16–17. Voice rooms and PTT are never recorded, microphones start closed,
and no feature invents a “connected” state when a service is unavailable.

No prices, retailers, stock levels, certifications or reviews were invented: catalogue rows
are labelled verified or **“Price not verified”**, and compatibility is always presented as
something to check, never a guarantee.

---

## 7. Documentation index

- [`docs/PHASE2_MIGRATION.md`](docs/PHASE2_MIGRATION.md) — schema changes and migration steps
- [`docs/PHASE2_ADMIN_GUIDE.md`](docs/PHASE2_ADMIN_GUIDE.md) — full studio console guide
- [`docs/PHASE2_VOICE_AND_MAP.md`](docs/PHASE2_VOICE_AND_MAP.md) — map, voice, PTT, TURN
- [`docs/PHASE2_FIREBASE_PUSH.md`](docs/PHASE2_FIREBASE_PUSH.md) — Firebase + FCM walkthrough
- [`docs/PHASE2_SECURITY_AND_PRIVACY.md`](docs/PHASE2_SECURITY_AND_PRIVACY.md) — controls and gaps
- [`docs/PHASE2_TEST_RESULTS.md`](docs/PHASE2_TEST_RESULTS.md) — automated and manual results
- [`docs/PHASE2_PERFORMANCE_ACCESSIBILITY.md`](docs/PHASE2_PERFORMANCE_ACCESSIBILITY.md) — performance and a11y audit
- [`docs/PHASE2_APK_BUILD.md`](docs/PHASE2_APK_BUILD.md) — compile, sign, install, Play notes
- [`docs/SETUP_GUIDE.md`](docs/SETUP_GUIDE.md) — **start here**: ordered setup walkthrough + verification
- [`docs/EXTERNAL_CONFIG.md`](docs/EXTERNAL_CONFIG.md) — every third-party account, key, fee and limit
- Phase 1: [architecture](docs/ARCHITECTURE.md) · [database](docs/DATABASE_SCHEMA.md) ·
  [safety & moderation](docs/SAFETY_AND_MODERATION.md) · [admin guide](docs/ADMIN_GUIDE.md) ·
  [build instructions](docs/BUILD_INSTRUCTIONS.md)

---

*RideRise LK Phase 2 · © 2026 Shaun David Studios. Logo supplied by the studio; used as the
brand asset, unmodified in proportion.*
