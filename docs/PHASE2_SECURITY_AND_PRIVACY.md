# Phase 2 — Security, privacy and access-control review

This document records what Phase 2 enforces, where, and what remains open. It is an
engineering review, not a certification. No external penetration test has been performed.

---

## 1. Authentication

| Control | Implementation |
|---|---|
| Rider sign-in | Firebase email/password: ID token verified server-side (RS256 + Google's secure-token x509 certificates, `iss`/`aud`/`exp`/`sub`) — `docs/FIREBASE_AUTH.md`. Demo presets only when `NODE_ENV !== 'production'` and never with an admin role from the request |
| Session token | HS256 JWT, 7-day expiry, signed with `JWT_SECRET`; tampering is rejected. No fallback key ships in the repo — production refuses to start without a 32+ char secret, and development uses a random per-process key |
| Administrator sign-in | Separate `admin_accounts` table, scrypt password hashes with per-account salt, 5-attempt/15-minute lockout, timing-safe comparison |
| Password rotation | `must_change_password` blocks every write action until changed; set for a production-generated password. The documented `admin$123$` demo credential is refused in production |
| Suspension | Checked on **every** authenticated request, not just at sign-in; suspended tokens return 401/403 and `/api/auth/session` answers `ACCOUNT_SUSPENDED` |
| Realtime | Short-lived single-use ticket (60 s) exchanged for the SSE stream; the bearer token is never placed in a URL |

`JWT_SECRET` must be set in production. The development fallback is derived from the source
path and is publicly known.

## 2. Authorisation matrix

Every Phase 2 route re-checks role and membership server-side. The UI is never the gate.

| Resource | Rule |
|---|---|
| Guild map snapshot | Active guild member (admin override) |
| Start/stop sharing | The rider themselves; consent recorded first |
| Manager revoke | Guild owner/moderator or studio admin; rider is notified |
| Voice rooms list / join | Active guild member, room `min_role`, guild ban and block checks |
| PTT floor | Same membership checks plus a single server-held floor with timeout |
| Guild hub / announcements / discussions / events | Members; managers for write actions |
| Guild settings, audit, appeals resolution | Owner/moderator (role-checked in SQL and JS) |
| Direct messages | Accepted friends only (`FRIENDS_ONLY_MESSAGING`); blocked either way → `CONTACT_BLOCKED` |
| Message delete | Sender, or a moderator acting on a report |
| Learning dashboard | Any signed-in rider; content is public-safe and contains no personal data |
| Tutorial CMS / catalogue admin / events admin | `admin` or `moderator`, with official-event and featured-home designation limited to `admin` |
| Admin user actions | Staff role; moderator responses mask rider email addresses |
| Studio news read | Public; write requires staff |
| Feedback submit | Signed-in rider, rate-limited |

Access-control probes covered in the automated suite: non-members reading a guild, a rider
reading another rider's private profile, non-friends messaging, a suspended token calling
unrelated endpoints, a rider calling admin endpoints, and anonymous writes. All return the
expected 401/403.

## 3. Location privacy (highest-risk feature)

- Off by default, per guild. Consent text names who can see the share before the button is
  enabled.
- Approximate by default: adults 750 m, **16–17 year olds fixed at 1,500 m** with the precise
  option removed from the UI and rejected by the server (`PRECISE_NOT_ALLOWED`).
- Precise sharing is 60 m, adults only, capped at 10 minutes and one session at a time.
- No position history exists in the schema. Expired sessions are deleted by a 60-second
  sweep; the audit log records events, not coordinates.
- Sharing stops on: manual stop, session expiry, leaving the guild, sign-out, block, manager
  revoke, and page hide (keepalive stop).
- Members who hide their activity are listed without an online state; non-sharing members
  never appear on the map.
- The server never returns another guild's members, and never returns a location to a
  non-member.

Residual risk: a rider who starts precise sharing at home reveals an area near their home to
the guild. The UI says this explicitly before enabling precise mode, and the option is
short-lived and off by default. There is no way to make precise sharing risk-free; the
product therefore keeps it opt-in and time-boxed rather than hidden.

## 4. Voice and walkie-talkie

- Room access is checked on every request, including the ICE config and signalling poll.
- Microphone tracks start disabled; nothing is transmitted until unmute/PTT press.
- No recording path exists. The server rejects a `recording` field and the UI always states
  “Recording: Off”.
- Signalling rows are addressed to a specific recipient and deleted after delivery; they
  contain SDP/ICE text only.
- The floor is a single row per room, so overlapping PTT transmissions are structurally
  impossible; a timeout releases a stuck floor.
- Blocking a participant removes them from the room and prevents re-entry.
- TURN credentials are ephemeral (HMAC with expiry) so a leaked ICE response grants only a
  short-lived relay credential.

Residual risk: WebRTC media is encrypted in transit (DTLS-SRTP) but the platform does not
claim end-to-end verification beyond the browser's defaults. Participants can still record
audio with another device; the UI warns that nothing prevents that.

## 5. Messaging

- Friends-only. A blocked account cannot send, and the blocker is not notified when blocking.
- Message bodies are stored server-side; the app does **not** claim end-to-end encryption.
  The messaging screen states this and warns against sharing credentials.
- Read receipts respect `read_receipts = 0`; delivery status is hidden from the other side.
- Notification previews are off by default (`show_previews`), and blocked accounts never
  generate a notification for the blocker.
- Spam controls: per-user rate limits, repeated-link detection
  (`shortened_link`, `many_links`, `possible_scam`), and a warning shown to the sender.
- Deletion leaves a tombstone for both participants; retention sweeps remove older messages
  (`DM_RETENTION_DAYS`, default 365).

## 6. Moderation and appeals

Report types cover posts, comments, profiles, guilds, events, messages, voice and walkie
participants. Reports store a severity, optional context JSON (room id, reported user), and
the reporter. Every admin action is append-only and requires a reason. Appeals are reviewed
by a human; there is no automated ban.

Automation is limited to flagging (link patterns, rate limits, keywords). No automated
punishment is applied without a staff action.

## 7. Input validation and uploads

- JSON bodies are size-capped and parsed defensively; malformed JSON returns 400.
- IDs are validated by lookup; unknown targets return 404 rather than silently succeeding.
- Uploads: 9 MB default request cap, 24 MB for `/api/upload/media`, MIME and extension
  allow-list, 5 MB image limit, EXIF stripped by client re-encoding.
- SQL uses prepared statements everywhere, including Phase 2.
- Output is HTML-escaped in the UI; user-supplied URLs are rendered as text or `href` with
  `rel="noopener noreferrer"`.

## 8. Secrets and the APK

- No service-account JSON, TURN secret, signing key or `JWT_SECRET` is committed.
- `android/keystore/` and build artefacts are git-ignored.
- The APK contains the bundled web app and the native shell only; configuration is fetched
  from the server at runtime.
- Map keys can be proxied server-side (`MAP_PROXY_TILES=1`) so they never ship in the APK.

## 9. Logging

- Admin actions: actor, action, target, reason, timestamp (no message bodies, no coordinates).
- Push delivery: title, channel, status, provider error text.
- Console output never prints tokens or passwords except the one-time production bootstrap
  password (by design, so the operator can retrieve it).
- Reverse-proxy logs should not include query strings for the realtime stream (tickets) —
  disable access-log query capture for `/api/realtime/*`.

## 10. Known gaps (fix before scaling)

1. **No push client.** FCM server support exists; the app does not obtain tokens. See
   `PHASE2_FIREBASE_PUSH.md`.
2. **Mesh voice ceiling.** 8 participants per room; an SFU is needed beyond that.
3. **Call quality on weak networks** was not verified on real devices.
4. **IP-based rate limits** are per-process memory; behind multiple instances they must move
   to Redis or a shared store.
5. **Email verification** is enforced by Firebase Authentication and re-checked server-side on every protected request.
6. **No independent security audit or penetration test.**
7. **TURN credentials** require correct time synchronisation between app server and coturn.
8. **No legal review** of the privacy policy, community rules or minor policy; they remain
   drafts.
9. **No DM end-to-end encryption** and none is claimed.

Report security issues privately to the studio; do not publish exploit details or user data.
