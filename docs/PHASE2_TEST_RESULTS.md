# Phase 2 — Test results

Run date: 2026-10-25 · Node 22.22.3 · SQLite (`node:sqlite`) · jsdom 30 · Linux x86_64
sandbox, **no physical Android device and no emulator**.

> **Update — Firebase email/password authentication.** 30 new tests were added after this
> Phase 2 snapshot: `tests/auth.firebase.test.js` (23 server-side tests with locally-signed ID
> tokens) and `tests/ui.auth.test.js` (7 end-to-end UI flows). Google sign-in was removed.
> Results and the tested-vs-awaiting-configuration split are in
> [`FIREBASE_AUTH.md`](FIREBASE_AUTH.md) §9.
>
> **Update — FCM server credentials.** `tests/fcm.credentials.test.js` adds **5** tests over
> `scripts/verify_fcm_credentials.js`: the service account parses, its RSA key signs and verifies
> the exact RS256 assertion the sender builds, its project/sender id match the Android config,
> the file is owner-only and untracked, and `createPushSender().status()` reports it. Suite: **92/92**.
>
> **Update — Android push (FCM) build.** `tests/android.push.test.js` adds **7** static tests
> over `scripts/verify_android_push.js` (**35 checks**): Gradle plugin/BoM/messaging, manifest
> service + channel `riderise_default`, Java bridge and deep-link contract, `POST /api/devices`,
> git-ignore hygiene, and the real `google-services.json` (package id, sender id and project id
> all match `rideriselk`). The suite is now **92/92**.
> **Gradle was not executed** in this environment and no token or notification was produced —
> see [`../android/firebase/README.md`](../android/firebase/README.md) §1.

Reproduce everything:

```bash
npm test                       # 92 node:test tests (Phase 1 + Phase 2 UI + Firebase auth + Android push + FCM creds), serially
ADMIN_PASSWORD=… npm run probe:admin   # studio-admin capability probe (needs a running server + its credential)
```

The suites bind their own ephemeral ports and their own `/tmp` databases, so they can run
alongside a dev server. They are executed with `--test-concurrency=1` because four concurrent
jsdom environments exhaust a 4 GB sandbox.

---

## 1. Automated results

| Suite | Result |
|---|---|
| `tests/api.test.js` — Phase 1 API contract | **32 / 32 pass** |
| `tests/ui.smoke.test.js` — shell, routes, onboarding | **4 / 4 pass** |
| `tests/ui.flows.test.js` — real user journeys | **8 / 8 pass** |
| `tests/ui.phase2.test.js` — Phase 2 screens | **7 / 7 pass** |
| Phase 2 probe harness — 106 assertions | **106 / 106 pass, 0 failed** |
| `scripts/probe_admin.js` — admin capability probe | passes for the console paths; rider-only paths SKIP with a reason |
| `tests/auth.firebase.test.js` — Firebase ID-token auth | **22 / 22 pass** |
| `tests/ui.auth.test.js` — Firebase sign-in / verification UI | **7 / 7 pass** |
| `tests/android.push.test.js` — FCM/Gradle wiring (static) | **7 / 7 pass** (37 verifier checks) |
| `tests/fcm.credentials.test.js` — service account + RS256 assertion | **5 / 5 pass** |

Current total: **92 automated tests + 106 API behaviour assertions.** The 51-test Phase 2
snapshot below is kept as the original record.

`tests/api.test.js` also pins two honesty rules as regressions: `/api/voice/ice` must never
say a TURN relay is configured when none is (`turn_available` is derived from the servers it
actually returns), and voice keeps `recording: false` by default.

### What the Phase 2 probe exercises

- **Live map** — consent required; approximate radius for adults; 1,500 m for 16–17; precise
  rejected for minors; non-member gets `403`; snapshot hides non-sharing members; manager
  revoke; stop clears the marker; expired session swept.
- **Voice** — join/leave, heartbeat, mute, participant limits, role-gated room creation,
  signalling relay addressed to one recipient, floor acquire/conflict (409)/release,
  walkie timeout settings, report/block, non-member denial.
- **Guild hub** — announcements (pin/delete), discussion feed, guild events + RSVP/waitlist,
  settings update, approval-based joins, audit log entries, appeals, rules.
- **Learning** — five pathways, 21 trick modules + 4 maintenance lessons, prerequisites
  locked, quiz graded server-side, `correctIndex` never leaked, 100 % required, checklist and
  safety acknowledgement enforced, XP credited once, admin CMS publish/unpublish.
- **Catalogue** — search/filters, comparison, compatibility verdicts, saved builds,
  `price_lkr` only when verified, price history appended on verification, admin unlist.
- **Messaging** — friends-only, blocked contact, typing, receipts honouring the privacy
  preference, reactions, replies, delete tombstone, mute, retention setting, preview flag,
  link-flag warnings.
- **Realtime** — single-use SSE ticket, event delivery to the recipient only, ticket reuse
  rejected.
- **Events** — calendar filters, registration, capacity + waiting list, cancel, check-in
  timestamp only, official badge admin-only, feature-on-home admin-only, announcement and
  reminder fan-out.
- **Studio console** — credential login, lockout after repeated failures, password change
  and re-login, moderator email masking, news publish/unpublish, feedback triage, broadcast,
  ban/unban/restore, report resolution, appeal resolution, audit trail.
- **Security negatives** — suspended token rejected on unrelated endpoints, rider denied
  admin APIs, anonymous writes rejected, unknown guild 404, map config requires auth.

### What the admin capability probe exercises (`npm run probe:admin`)

Run against a throwaway database so its bans and posts never touch real data.

- The credential supplied via `ADMIN_USERNAME`/`ADMIN_PASSWORD` signs in with `role: admin`,
  resolves to the linked studio profile, and loads the moderation overview.
- **As an ordinary rider** — publishes a feed post, likes and comments, lists guilds, reads
  the 21-module stunt library, opens the five learning pathways, opens events and registers,
  searches the catalogue, reads community rules.
- **Messaging** — a rider messages the admin; the admin deletes the message and the sender
  sees a tombstone, not the body.
- **Moderation** — search accounts, ban (the banned rider's existing session is terminated on
  the next request), unban, temporary suspension, restore, report queue + resolution,
  feedback inbox.
- **Publishing** — studio news, an official studio event flagged `is_official_studio_event`,
  a broadcast, and an audit trail containing the actions.
- **Honesty + isolation** — `/api/admin/push/status` reports `configured: false` without FCM
  credentials; a normal rider gets `403` from the console; anonymous moderation is `401`.

### Phase 2 UI checks in jsdom

1. Learning pathways + lesson reader + maintenance track.
2. Catalogue cards, compare tray and comparison table; price labels are “LKR” or
   “Price not verified”.
3. Events list with official badge, inline registration, calendar grid with 7 columns.
4. Messages list, notification history, preference toggles, studio news.
5. Guild map consent gate, hub tabs, voice lobby and pre-flight panel
   (“Microphone — Not opened”).
6. Studio console metrics (≥ 8 cards), moderation queue, push diagnostics.

## 2. Manual checks performed in the sandbox

- Server boots with a fresh database and with an existing Phase 1 database (idempotent
  migration).
- `/api/health` reports `phase: 2` and capability flags.
- Preview served at `http://localhost:3000`; every new route loads without a console error.
- Admin credential login, password change and re-login with the new password.
- Static serving: gzip on text assets, ETag/304 revalidation, `no-cache` SPA shell (checked
  with `curl -D -`).
- Map tile requests fail in the sandbox without outbound access to the tile host — the map
  correctly shows the offline state instead of a blank “working” map.
- Voice cannot be exercised without microphone hardware; join/leave/signalling were tested
  at the API level.

## 3. Not verified (state this to users honestly)

| Item | Why | What to do |
|---|---|---|
| Real two-device voice/PTT call | No physical devices or emulator in the build environment | Install the APK on two phones; test on Wi-Fi and mobile data; configure TURN first |
| Bluetooth routing | No paired headset | Test with a real headset; check `BLUETOOTH_CONNECT` grant |
| Push delivery | No Firebase project / no client token | Follow `PHASE2_FIREBASE_PUSH.md`, then send a test push |
| Map tiles from a commercial provider | No API key supplied | Set `MAP_PROVIDER` + `MAP_API_KEY`; verify attribution and quota |
| Google OAuth end-to-end | **removed by design** — Google sign-in no longer exists | Use Firebase email/password: `docs/FIREBASE_AUTH.md` |
| Screen-reader walkthrough with TalkBack | No device | Test with TalkBack; focus order was reviewed in code only |
| Sinhala/Tamil glyph rendering on device | No device fonts inspected | Test on a Sinhala/Tamil locale device; Noto fonts are expected on Android 8+ |
| Battery drain during a 60-minute share | No device | Measure with Android Battery Historian; cadence is 45 s |
| Load/soak beyond seed data | Sandbox data only | Load-test the API before launch |
| Independent security audit | Out of scope | Commission a review before public launch |

## 4. Regression notes

Phase 1 behaviour is unchanged: 42/42 Phase 1 tests pass with Phase 2 enabled. Two contract
details were preserved deliberately:

- `/api/stunts` still returns exactly the 21 trick modules; the four maintenance lessons are
  marked `visibility = 'learning_only'` and appear only in the learning track.
- `POST /api/admin/events` still requires the studio **admin** role and returns
  `OFFICIAL_STUDIO_ADMIN_ONLY` for moderators.

## 5. Bug status

No known failing automated checks at the time of writing. Open product limitations are
listed in `docs/PHASE2_SECURITY_AND_PRIVACY.md` §10 and in the README’s limitations table.
