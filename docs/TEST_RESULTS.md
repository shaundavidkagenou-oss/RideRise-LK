# Test results — Phase 1

Date: **2026-10-25** · Node.js 22.22.3 · Linux x86_64 · Run with `npm test`.

```
1..42
# tests 42
# pass 42
# fail 0
# duration_ms ~7s
```

Two suites, both executing the **real backend**:

- `tests/api.test.js` — 30 API/security/authorization tests
- `tests/ui.smoke.test.js` + `tests/ui.flows.test.js` — 12 end-to-end UI tests in `jsdom`
  that load the actual `web_app/` bundle, sign in, render every route and drive complete
  user journeys through DOM events.

## API & security suite (`tests/api.test.js`)

| # | Test | Requirement covered | Result |
|---|---|---|---|
| 1 | Health, brand config, seeded content | §1 branding, §5 ranks, §15 legal docs | PASS |
| 2 | Google sign-in removed; demo bridge rejects passwords and Google tokens | §3 auth errors, no password handling | PASS |
| 3 | Session requires valid token; tampering rejected | §3 secure session persistence, §18 auth | PASS |
| 4 | Public profiles never expose email/DOB/OAuth subject | §4, §16 private vs public data | PASS |
| 5 | Private and friends-only profiles return restricted cards | §4, §16 privacy defaults | PASS |
| 6 | Onboarding enforces age 16+, all four legal acceptances, unique usernames, minor defaults | §3, §15, §16 | PASS |
| 7 | Users cannot self-assign XP, rank or role | §5 server-side validation | PASS |
| 8 | Profile edit validation + leaderboard opt-out | §4, §5 leaderboard hiding | PASS |
| 9 | Bike Build Rating math: breakdown sums, cosmetic excluded, critical-defect cap ≤39, brakeless cap | §6 transparent rating | PASS |
| 10 | Bike preview/create/update/delete + cross-user IDOR blocked | §6, §18 IDOR | PASS |
| 11 | Safety checklist requires 7 checks; same-day repeat yields 0 XP | §5, §11 | PASS |
| 12 | 21 stunt modules across 4 categories with gear/stages/stop conditions/quizzes; advanced locked | §10 library structure | PASS |
| 13 | Stunt completion enforces prerequisites, checklist, safety ack and 100% quiz | §10, §5 | PASS |
| 14 | Feed create/like/unlike/bookmark/comment/reply/edit/delete + edit/delete of others blocked | §7 | PASS |
| 15 | Road/traffic stunt content queued as `pending_review` and hidden from the feed; GPS stripped flag | §7, §11, §12 | PASS |
| 16 | Reports validated and stored | §14, §8 | PASS |
| 17 | Friend request self/duplicate guards, accept flow | §8 | PASS |
| 18 | Friends-only DMs, mute, block → DM 403 + profile 404 + search exclusion, unblock restores | §8, §16 teen safety | PASS |
| 19 | Guild create/duplicate guard/private approval/outsider view/chat denial/promote (owner-only)/private feed 403/no PII in member lists | §9, §18 | PASS |
| 20 | Public guild join/leave, posting denied after leaving | §9 | PASS |
| 21 | Catalog: all 9 categories, “Price not verified” for unverified rows, verified filter, search, favorites, compatibility warnings | §12 | PASS |
| 22 | Events: official vs community, registration, attendee-privacy (no emails), cancellation, closed past event | §13 | PASS |
| 23 | Admin RBAC (rider 403), metrics, report resolution + audit log, rank create/update, moderator blocked from publishing official events, new part labelled unverified | §14 | PASS |
| 24 | Upload validation: non-image rejected, >5 MB rejected with 413, valid image accepted with EXIF/GPS stripped | §18 media validation | PASS |
| 25 | Post rate limit triggers 429 | §18 abuse protection | PASS |
| 26 | Account deletion cascades and invalidates the session | §3, §15, §16 | PASS |
| 27 | Ten unauthenticated write endpoints return 401 | §18 authorization on every write | PASS |
| 28 | XP engine refuses unknown action types and clamps deltas to per-action caps | §5 anti-farming | PASS |
| 29 | Google-shaped tokens can never create a session (410 `GOOGLE_SIGNIN_REMOVED`) | §3, §18 | PASS |
| 30 | Guild invitations + accept, mutual-friend counts, MP4 clip uploads (8 MB cap), warning, temporary suspension expiry, admin guild member limit | §8, §9, §7, §14 | PASS |

## UI end-to-end suite (jsdom)

| # | Journey | Result |
|---|---|---|
| UI 1 | Animated splash → welcome hero (logo, 16+, safety strip) → email/password form + demo sheet | PASS |
| UI 2 | Sign in → feed renders seeded posts, safety strip, XP bar, 5-tab bottom nav | PASS |
| UI 3 | Walk all 12 primary routes + admin console + guild detail + public profile, zero uncaught JS errors | PASS |
| UI 4 | Onboarding blocks without age confirmation → legal step → profile → privacy → lands on feed; server marks minor | PASS |
| FLOW 1 | Compose and publish a post → appears at top of the feed | PASS |
| FLOW 2 | 7-point pre-ride inspection → XP log entry created | PASS |
| FLOW 3 | 13-question bike wizard → live score preview → save → bike appears on profile | PASS |
| FLOW 4 | Stunt module: checklist + quiz → server credits XP | PASS |
| FLOW 5 | Guild chat message posts and renders | PASS |
| FLOW 6 | Parts favorite toggles; event registration persists | PASS |
| FLOW 7 | Non-friend cannot open private messaging (restriction toast, no composer) | PASS |
| FLOW 8 | Guild owner invites a rider; invitation recorded for the invitee | PASS |

## APK build verification

Both APKs were built by `scripts/build_apk.sh` and verified with `apksigner verify` **and**
an independent static analysis (`androguard`):

| Check | Debug APK | Release APK |
|---|---|---|
| Package id | `lk.shaunstudios.riderise` | `lk.shaunstudios.riderise` |
| versionName / versionCode | 1.0.0 / 1 | 1.0.0 / 1 |
| minSdk / targetSdk | 24 / 34 | 24 / 34 |
| Launcher activity | `MainActivity` (exported) | `MainActivity` (exported) |
| Permissions | INTERNET, ACCESS_NETWORK_STATE, POST_NOTIFICATIONS | same |
| `debuggable` | true | **false** |
| Signature schemes | v2 + v3 | v2 + v3 |
| Bundled web app | 15 asset files under `assets/webapp/` | same |
| Zip alignment | all stored entries 4-byte aligned | same |
| Size | 2,300,124 B | 2,304,219 B |
| SHA-256 | `eaa02613…c2ec77d` | `e8ffe5ca…478afff` |

Certificate and file digests: `release/BUILD_INFO.md`, `release/apk/SHA256SUMS.txt`.

## What was **not** testable in this environment (honest limitations)

1. **Live Firebase sign-up, verification email and password reset.** No Firebase project is
   configured in the sandbox, so the Google-hosted identity service cannot be reached. The
   verifier (RS256 signature, issuer, audience, expiry, `sub`, `email_verified`) is implemented
   and tested with locally-signed tokens, but a live round-trip must be validated by the studio
   once the project exists (`docs/FIREBASE_AUTH.md` §7). Google OAuth sign-in itself was removed.
2. **FCM push delivery.** Permission request, in-app notifications and unread counters are
   implemented and tested in-app; actual push delivery needs Firebase credentials
   (see `EXTERNAL_CONFIG.md`).
3. **On-device installation.** No Android emulator/device is available in the sandbox. The
   APK is structurally valid and fully signed (verified with two independent tools), but
   the studio should install it on a physical device for final QA.
4. **Visual screenshot review.** No browser rendering engine is available, so layout was
   verified structurally (jsdom) and by CSS review rather than pixel screenshots. The live
   preview URL shows the real rendering.
5. **Load/scale testing.** SQLite and single-process Node comfortably handle Phase 1 demo
   volumes; a production launch should migrate to Postgres and run load tests.
6. **Legal compliance.** The documents are drafts; they explicitly say so and need counsel
   review.

## Known functional limitations (by design in Phase 1)

- Media is stored as validated data URLs in the database (5 MB cap, EXIF/GPS removed).
  Production should move to object storage with signed URLs.
- Uploaded avatars/posts show the studio badge as the seeded demo image; real uploads are
  stored and served from the API session.
- Live maps, group voice and walkie-talkie are Phase 2 (no location fields exist yet).
- Session revocation is global via `JWT_SECRET` rotation (no per-device session table).
- Notification delivery is in-app only until FCM is configured.
- Advanced stunt modules are gated but cannot verify that a real coach is present; the app
  requires explicit acknowledgement and states repeatedly that in-person coaching is
  mandatory.
