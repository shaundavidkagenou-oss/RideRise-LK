# RideRise LK — Phase 1

**RIDE / STUNT / CONNECT** — a community, learning and bike-build platform for Sri Lankan
bicycle stunt riders, built for **Shaun David Studios**.

<p align="center">
  <img src="assets/brand/riderise_logo.png" width="240" alt="Official RideRise LK BMX sunset badge by Shaun David Studios" />
</p>

| | |
|---|---|
| **Working app name** | RideRise LK *(configurable in `config/brand.config.json`)* |
| **Studio** | Shaun David Studios |
| **Android package** | `lk.shaunstudios.riderise` |
| **Version** | 1.0.0 (versionCode 1) |
| **Minimum age** | 16 (16–17 gets youth-safety defaults) |
| **Phase** | Phase 1 — community, stunt education, bike rating, guilds, catalog, official events |
| **Languages** | English · සිංහල · தமிழ் (localization architecture in place) |
| **Delivery** | Installable signed APK + editable source + real backend + database + tests + docs |

---

## 1. What is delivered

| Deliverable (spec §20) | Where |
|---|---|
| 1. Working Android application | `release/apk/riderise-lk-phase1-release.apk` (signed) and `…-debug.apk` |
| 2. Complete editable project source code | `web_app/` (UI), `android/` (native shell), `backend/` (API), `config/`, `scripts/` |
| 3. Configured backend + database schema | `backend/server.js`, `backend/schema.sql`, `backend/seed.js` (SQLite, seeded on first run) |
| 4. Installable APK built from the actual application | `release/apk/` (+ `SHA256SUMS.txt`, `release/BUILD_INFO.md`) |
| 5. Build & installation instructions | [`docs/BUILD_INSTRUCTIONS.md`](docs/BUILD_INSTRUCTIONS.md) |
| 6. External configuration still required | [`docs/EXTERNAL_CONFIG.md`](docs/EXTERNAL_CONFIG.md) |
| 7. Test results & known limitations | [`docs/TEST_RESULTS.md`](docs/TEST_RESULTS.md) |
| 8. Admin guide (events, ranks, tutorials, parts) | [`docs/ADMIN_GUIDE.md`](docs/ADMIN_GUIDE.md) |
| Requirement-by-requirement mapping | [`docs/REQUIREMENTS_TRACEABILITY.md`](docs/REQUIREMENTS_TRACEABILITY.md) |

---

## 2. Run it in 60 seconds

```bash
npm start                 # http://localhost:3000  (SQLite auto-created & seeded)
npm test                  # 40 automated API + UI tests
npm run apk               # rebuild signed debug + release APKs
```

Node.js **22.5+** is required (the backend uses the built-in `node:sqlite` module).
No external database, cloud account or paid service is needed to run Phase 1.

### Demo rider accounts (sandbox Google sign-in)

The sign-in sheet includes four sandbox Google identities so every role can be tested:

| Account | Role | Why it matters |
|---|---|---|
| `kasun.perera.demo@gmail.com` | Rider (Stunt Specialist) | Full profile, two bicycles, guild owner |
| `roshan.fernando.demo@gmail.com` | Rider + **guild moderator** | Moderation role, dirt-jumper build |
| `dilshan.student.demo@gmail.com` | **16–17 year old** | Youth defaults: friends-only profile, hidden from leaderboards |
| `nethmi.admin@shaundavidstudios.lk` | **Studio administrator** | Admin console: reports, ranks, catalog, official events |

Sign out from the header, then sign in as another account to verify RBAC differences.

---

## 3. Feature overview (Phase 1)

**Onboarding & identity** — animated branded launch screen, Google sign-in (official
Google Identity Services when `GOOGLE_CLIENT_ID` is set, documented sandbox bridge
otherwise), mandatory 16+ confirmation, four legal acceptances, unique username rules,
privacy defaults, private/public data separation, account deletion with cascade.

**Rider profile** — avatar upload with crop + zoom + remove, display name, bio, district,
preferred riding area, rank and XP progress, badges, learning progress, community
contributions, privacy toggles, blocked list.

**Progression** — seven configurable ranks (Rookie Rider → Ride Legend), server-validated
XP with per-action caps and duplicate protection, achievements, activity history, rank
progress bar, leaderboards filtered by overall/district/guild with an opt-out.

**Bicycle profiles** — guided 13-question questionnaire (type, frame material, brand/model,
fork, tires, wheels, bars, drivetrain, brakes, condition, safety defects, discipline,
photos + optional cosmetic rating), transparent 0–100 **Bike Build Rating** with a
five-part breakdown, hard safety cap when defects are reported, multi-bike garage,
comparison view, unverified-submission labelling.

**Community feed** — real-time list with categories, tags, search, pagination, likes,
comments and replies, bookmarks, native Android share, `@mentions` (with notifications),
edit/delete own posts, reporting, moderation states, client-side GPS stripping, and
automatic queueing of dangerous road-stunt content for review.

**Friends & messaging** — requests, accept/decline/cancel/remove, username search,
blocking (bidirectional), **friends-only private messaging** with soft-delete-safe
threads, timestamps, delivery status, unread counters, image attachments (5 MB),
mute and report controls.

**Guilds** — public and approval-based private guilds, emblems, categories, districts,
owner/moderator/member roles, join/leave/invite-approval/promote/remove, announcements,
text chat, shared posts, member limits, reporting, and strict separation of guild
visibility from private member data.

**Stunt-learning library** — 21 modules across Fundamentals, Beginner freestyle,
Intermediate and Advanced (coach-supervised). Each module carries difficulty,
prerequisites, bicycle suitability, protective gear, safe environment, inspection
checklist, staged progressions, common errors, stop conditions, coaching reminder,
SVG technique diagram and a knowledge quiz. Prerequisites, safety acknowledgement and
100% quiz score are enforced server-side before XP is granted.

**Safety Centre** — permanent entry point from navigation, tutorials, bike profiles and
the composer, with the eight mandated safety rules, the verbatim draft safety notice,
Sri Lankan emergency numbers, the 7-point pre-ride inspection (+25 XP once per day),
stop conditions and reporting.

**Sri Lankan parts catalog** — nine categories, searchable, verified/unverified price
labelling ("Price not verified" is shown instead of inventing a figure), seller and
last-verified dates, compatibility warnings, favorites, comparison and administrator
curation.

**Official studio events** — featured/upcoming/past/cancelled events, capacity and
registration deadlines, eligibility, equipment requirements, organiser contact,
announcements, recap, registration/cancellation, community events clearly distinguished
from official Shaun David Studios events, suspicious-event reporting, and no public
attendee details.

**Administration** — role-gated console with operational metrics, report queue with
resolution notes and reporter notification, content moderation, rank editor, catalog
verification, official event publishing, and an audit log of every administrative action.

**Design & accessibility** — dark charcoal foundation with orange/amber accents taken
from the supplied badge, a token-based design system, skeleton loaders, empty states,
retry states, pull-to-refresh style controls, responsive layout, reduced-motion and
high-contrast modes, screen-reader labels and English/Sinhala/Tamil architecture.

---

## 4. Architecture at a glance

```
android/   Native Android shell (WebView + whitelisted JS bridge + share sheet + file picker)
web_app/   The application UI (vanilla ES5+/ES2017 JS, design-system CSS, i18n dictionaries)
backend/   Node.js HTTP API (auth, RBAC, XP engine, bike-rating engine) + SQLite schema/seed
config/    Brand, package, ranks, districts, rate limits and theme tokens
scripts/   APK build pipeline (aapt2 → ecj → d8 → zip-align → apksigner) and icon generator
tests/     node:test API suite + jsdom end-to-end UI flows
docs/      Build, configuration, admin, security, schema, safety and traceability docs
release/   Signed APKs, checksums and build metadata
```

Why this shape: the UI is a single codebase that runs both in the browser (instant
preview/testing) and inside the Android WebView, so the Android app and the live preview
never drift. Every privileged action is enforced in `backend/server.js`; the client can
never award XP, change a rank, read another rider's email or message a non-friend.

Detailed docs: [architecture](docs/ARCHITECTURE.md) · [database](docs/DATABASE_SCHEMA.md) ·
[safety & moderation](docs/SAFETY_AND_MODERATION.md) · [Phase 2 roadmap](docs/PHASE2_ROADMAP.md).

---

## 5. Honest status: what is real, what needs your credentials

**Fully implemented and tested here:** every feature listed in section 3, the backend,
database, authorization rules, XP and bike-rating engines, moderation workflow, APK
build and signing, and 40 automated tests (29 API + 11 end-to-end UI).

**Requires configuration you must supply (integration points are built, not mocked):**

1. `GOOGLE_CLIENT_ID` — enables real Google Identity Services sign-in and ID-token
   verification. Without it the app uses the clearly labelled sandbox OAuth bridge so
   Phase 1 remains testable offline. → [`docs/GOOGLE_SIGNIN.md`](docs/GOOGLE_SIGNIN.md)
2. **Firebase Cloud Messaging** credentials for push notifications (permission request
   and in-app notification centre already work; FCM token registration is the remaining
   step). → [`docs/EXTERNAL_CONFIG.md`](docs/EXTERNAL_CONFIG.md)
3. **Hosting + HTTPS domain** for the backend, and that URL entered in
   *Settings → Server connection* inside the Android app.
4. **Legal review** of the draft Terms, Privacy Policy, Community Guidelines and Safety
   Notice by qualified Sri Lankan counsel.
5. **Keystore custody** — the release key is generated locally and git-ignored; back it
   up in a secrets manager (`android/keystore/KEYSTORE-CREDENTIALS.txt`).

No prices, retailers, stock levels or product claims were invented: catalog rows are
labelled **verified** or **"Price not verified"**, and every listing carries a
compatibility warning and a last-verified date.

---

## 6. Safety stance (non-negotiable)

RideRise LK **never** rewards dangerous riding, road stunts, traffic riding or escalating
physical risk. XP comes from learning modules, inspections, verified knowledge, positive
community help and official event participation. Advanced pathways are gated behind
prerequisites, explicit acknowledgement and a requirement for qualified in-person
coaching in a padded/controlled facility. The full draft safety notice is shown verbatim
in the Safety Centre and in the Terms, and every tutorial states that an online guide
cannot guarantee safety.

---

## 7. Phase 2 readiness

The database, authorization model, rank engine, guild membership roles and design system
were built to accept Phase 2 (opt-in live ride maps, guild group voice, walkie-talkie)
without a rewrite. Location fields are deliberately absent from Phase 1 so no retrofitting
of consent is needed — see [`docs/PHASE2_ROADMAP.md`](docs/PHASE2_ROADMAP.md).

---

*RideRise LK Phase 1 · © 2026 Shaun David Studios. Logo supplied by the studio; used only
as the product brand asset, unmodified in proportion.*
