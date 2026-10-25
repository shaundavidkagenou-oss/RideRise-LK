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
| **APKs** | `release/apk/riderise-lk-phase2-debug.apk`, `…-release.apk` (signed) — install steps and the two prerequisites: [`docs/BUILD_INSTRUCTIONS.md`](docs/BUILD_INSTRUCTIONS.md) §3 |
| **Android Studio project** | `android/` — Gradle 8.9, AGP 8.7.3, Firebase Cloud Messaging (BoM 35.1.0), `google-services.json` git-ignored |
| **Tests** | 92 automated tests (22 Firebase-auth + 7 Android/FCM wiring + 5 FCM credentials) + 106 Phase 2 API assertions + admin capability checks — all passing |

---

## 1. What Phase 2 adds

Everything from Phase 1 remains, including the existing database and users.

> **Sign-in is now real Firebase Authentication (email + password).** Riders create an account
> with a username, email and password, confirm the verification email, and only then reach the
> community features. Sessions survive browser and app restarts; password resets are handled by
> Firebase. Setup: [`docs/FIREBASE_AUTH.md`](docs/FIREBASE_AUTH.md). Until you connect your own
> Firebase project the sign-in form is disabled and says so. There is no demo or sandbox
> sign-in: every session comes from a verified Firebase ID token.

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
- **Studio console** — credential sign-in (rider account with an admin/moderator role), forced password rotation, metrics,
  reports, appeals, users, feedback inbox, news, official events, tutorial CMS, catalogue
  verification, broadcast, push diagnostics and an append-only audit log.

---

## 2. Run it in 60 seconds

> **Setting this up for real use?** Follow **[`docs/SETUP_GUIDE.md`](docs/SETUP_GUIDE.md)** — an
> ordered walkthrough for hosting, Firebase email/password sign-in, push, TURN voice, APK install and
> Play publishing, with a verification step after each one.
> `npm run check:setup` tells you exactly what is still missing.

```bash
npm start                                  # http://localhost:3000  (SQLite created, migrated, seeded)
npm test                                   # 103 automated tests (serial)
npm run apk                                # rebuild signed debug + release APKs (no SDK required)
npm run verify:server -- --url https://…   # is a hosted server ready to ship in the app?
npm run configure:apk -- --url https://…   # compile that address into the next APK
npm run bundle:server                      # 3.6 MB zip of just what a server needs (panel upload)
npm run setup:env                          # write .env for a hosted server (asks 3 questions)
npm run doctor                             # is this server ready? boots it and checks /api/health
npm run check:android-push                 # 37 static checks of the Gradle/FCM wiring
npm run check:fcm                          # FCM service-account validity (+ --online to call Google)

cp .env.example .env                       # optional integrations (Firebase auth, map, TURN, FCM)
node --env-file=.env backend/server.js     # run with them enabled
```

Node.js **22.13+** is required (the backend uses the built-in `node:sqlite` module, which needs the
`--experimental-sqlite` flag on 22.5–22.12). No
external database or paid service is needed to run it locally: with no `.env` the app starts
fully functional and reports `push: false`, `turnRelay: false` honestly in `/api/health`.

> **Push notifications.** The server sends FCM HTTP v1 with the studio's service account
> (`secrets/`, git-ignored, validated by `npm run check:fcm`; `/api/health` → `"push":true`), and
> the Android client is wired end to end. `android/` is a complete Android Studio project
> (Firebase BoM 35.1.0, `firebase-messaging`, token bridge, notification service, deep links);
> the studio's `google-services.json` is installed there and git-ignored. The SDK-free APK still
> has **no** Play Services, Gradle has **not** been run in this environment, and no device token
> exists yet — see [`android/firebase/README.md`](android/firebase/README.md).

### Studio administrator

The console has its own credential, separate from rider accounts. On the first boot of an empty
database the server either uses `ADMIN_USERNAME` / `ADMIN_PASSWORD` (12+ characters) or generates
a strong password, prints it **once** to the server log and forces a change at first sign-in.

No default password is shipped. The credential is linked to the studio administrator profile;
if that profile is ever removed the next boot re-links the credential automatically, so the
console cannot be locked out by deleting a user.

It can monitor and ban accounts, delete messages, receive all reports and feedback, publish
news and official events, and do everything an ordinary rider can do. Change the password at any
time in **Studio Console → 🔑 Password**.

### Sample content for local development

A fresh database contains product content only: 7 ranks, 6 achievements, the 21-module stunt
library plus its 4-module maintenance track, the draft legal documents and one non-personal
studio account.
Riders, posts, guilds, events and catalog prices are created by real accounts in the app.

Set `SEED_DEMO=1` before the first boot of a throwaway database (`npm run start:sample`) to add
four sample riders and sample community content for UI work. They have no sign-in credential —
their Firebase UIDs are local placeholders that no Firebase project can issue — so they cannot
be signed into. Production ignores the flag entirely.

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
| Map tile provider (`MAP_PROVIDER`, `MAP_API_KEY`, optional proxy) | [`docs/PHASE2_VOICE_AND_MAP.md`](docs/PHASE2_VOICE_AND_MAP.md) |
| TURN relay for reliable voice (`TURN_URLS`, `TURN_SECRET`) | [`docs/PHASE2_VOICE_AND_MAP.md`](docs/PHASE2_VOICE_AND_MAP.md) |
| Firebase Cloud Messaging (step by step) | [`docs/PHASE2_FIREBASE_PUSH.md`](docs/PHASE2_FIREBASE_PUSH.md) |
| HTTPS hosting + API URL in the Android shell | [`docs/BUILD_INSTRUCTIONS.md`](docs/BUILD_INSTRUCTIONS.md) |
| **Click-by-click server setup on a panel (first deployment)** | [`docs/SERVER_SETUP_WALKTHROUGH.md`](docs/SERVER_SETUP_WALKTHROUGH.md) |
| **Free 24/7 hosting that fits this app (VM + one setup script)** | [`docs/FREE_HOSTING_OPTIONS.md`](docs/FREE_HOSTING_OPTIONS.md) |
| **Free hosting with no credit card (alwaysdata, 15 minutes)** | [`docs/ALWAYSDATA_STEP_BY_STEP.md`](docs/ALWAYSDATA_STEP_BY_STEP.md) |
| **Why the server cannot simply be deleted (measured, with the alternative)** | [`docs/SERVERLESS_ASSESSMENT.md`](docs/SERVERLESS_ASSESSMENT.md) |
| **Deploying on a hosting panel + compiling the address into the APK** | [`docs/DEPLOY_AND_BAKE.md`](docs/DEPLOY_AND_BAKE.md) |
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

1. **Firebase Authentication** — your project id + web API key enable real email/password
   sign-up, verification emails and password resets (`docs/FIREBASE_AUTH.md`).
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
