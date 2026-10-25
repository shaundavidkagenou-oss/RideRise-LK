# Phase 2 roadmap — delivered

> **Status: implemented.** This file preserves the original plan. The delivered
> implementation lives in `backend/phase2/`, the Phase 2 screens in `web_app/`, the Android
> permission bridge in `MainActivity.java`, and the Phase 2 APKs in `release/apk/`. Read
> `docs/PHASE2_TEST_RESULTS.md` for verified versus unverified items.

## Original plan — built to extend, not rebuild

Phase 1 deliberately stops before live location, voice and walkie-talkie features. The
architecture leaves clean seams so Phase 2 can be added without touching accounts, design,
or the moderation model.

## 1. Why nothing needs rewriting

| Phase 1 decision | Phase 2 benefit |
|---|---|
| `users_private` / `profiles` split | New sensitive data (live location consent, voice settings) goes into new tables without altering public profile reads |
| No GPS columns anywhere | Location consent can be introduced cleanly, opt-in by design, with no legacy data to re-consent |
| Guild roles (owner/moderator/member) | Voice-channel permissions reuse the same role checks |
| `notifications` table with free-form `type` + `reference_id` | Ride invites, "live now" alerts and walkie-talkie pings need no schema change |
| `stunt_modules` / progress tables | Live coached sessions can link to module IDs for verified progression |
| Design tokens + component layer | New screens inherit the visual system automatically |
| 5-tab navigation with an Explore hub | New destinations (Live Rides, Voice) slot into Explore or a long-press action without breaking the tab bar |

## 2. Phase 2 feature plan

### A. Live ride maps (opt-in, time-boxed)

- New tables: `ride_sessions` (host, district, start/end, visibility), `ride_participants`
  (status, share_location flag), `ride_location_pings` (session-scoped, TTL).
- Consent: explicit per-session toggle, default off; auto-expiry when the session ends;
  location shared only with accepted participants; never written to a public profile or post.
- Safety: speed/road classification warnings ("this route appears to include a main road —
  stunts are not permitted here"), pause and emergency-stop controls.
- Moderation: hosts can remove participants; sessions are reportable; no historical trail
  visible to guild moderators.

### B. Guild group voice

- WebRTC SFU (e.g. LiveKit or mediasoup) with short-lived, server-issued room tokens; the
  room is joined by guild role, never by guessing a room ID.
- Push-to-talk and mute-all-by-moderator; automatic disconnect on guild removal or block.
- No recording by default; recording requires explicit consent from every participant.

### C. Walkie-talkie push-to-talk

- Ephemeral audio channels tied to a live ride session or guild, with hold-to-talk timeouts
  and abuse rate limits mirroring the Phase 1 message limiter.
- Text fallback when bandwidth is low (common on Sri Lankan mobile networks).
- A "do not use while riding" gate: the UI requires the phone to be mounted and the rider
  stationary before enabling transmission, and states this explicitly.

### D. Additional Phase 2 quality items

- Verified coach accounts and in-person session check-ins for advanced progressions.
- Parts catalog: verified retailer integrations, price history, stock checks with audit trail.
- Marketplace escrow/structured offers (only after a secure commerce backend exists).
- Group events: team registration, consent-based results and photo galleries.
- Postgres migration and horizontal scaling; per-device session revocation.
- Firebase Auth/Firestore/Storage/FCM migration if the studio prefers a managed backend.
- Push notification delivery and deep links into posts, chats and events.
- Sinhala/Tamil translation completion for all strings (architecture and dictionaries exist).

## 3. Data-model additions (draft)

```sql
-- Phase 2 draft, NOT part of Phase 1
CREATE TABLE ride_sessions (
  id TEXT PRIMARY KEY,
  host_id TEXT NOT NULL REFERENCES users_private(id) ON DELETE CASCADE,
  guild_id TEXT REFERENCES guilds(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  meet_district TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  share_location INTEGER NOT NULL DEFAULT 0,
  visibility TEXT NOT NULL DEFAULT 'participants',
  created_at TEXT NOT NULL
);

CREATE TABLE ride_participants (
  ride_id TEXT NOT NULL REFERENCES ride_sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users_private(id) ON DELETE CASCADE,
  share_location INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'invited',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (ride_id, user_id)
);

CREATE TABLE ride_location_pings ( -- TTL-purged, never joined into public queries
  id TEXT PRIMARY KEY,
  ride_id TEXT NOT NULL REFERENCES ride_sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users_private(id) ON DELETE CASCADE,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  accuracy_m REAL,
  reported_at TEXT NOT NULL
);
```

## 4. Release gates for Phase 2

1. Independent legal review of location-sharing and voice-consent flows.
2. Threat model review covering location inference, stalking, and guild-moderator abuse.
3. On-device battery and network testing on mid-range Android hardware common in Sri Lanka.
4. Abuse-rate calibration with real moderation volume.
5. Data-retention automation (TTL purge jobs) verified in staging.
