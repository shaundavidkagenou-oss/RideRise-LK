# Database schema & authorization model

SQLite (WAL mode, `PRAGMA foreign_keys = ON`). File: `backend/schema.sql`.
**28 tables**, 13 purpose-built indexes, `CHECK` constraints on every enum-like column.

## 1. Identity & profile

| Table | Purpose | Key rules |
|---|---|---|
| `users_private` | Google account identity, email, private DOB, minor flag, legal acceptance timestamps, role, account status | Never returned in any public API response. Email/DOB/OAuth subject excluded by `formatPublicProfile()`. |
| `profiles` | Public rider profile | `username` UNIQUE; `profile_visibility` public/friends/private; `hide_from_leaderboards`; `allow_friend_requests`; `allow_messages_from` (friends_only/nobody); locale, reduced-motion, notification prefs; `xp`, `rank_id` server-write only |
| `ranks` | 7 configurable ranks | `min_xp` thresholds; renamed/thresholded via admin API |
| `achievements`, `user_achievements` | Badge catalogue + awards | Awards are server-side only; unique per user |
| `xp_activity_log` | Immutable XP ledger | `(action_type, reference_id)` duplicate protection; used for rank recalculation and the activity feed |

**Privacy split:** a public profile reads only `profiles` + `ranks` + aggregated counts.
Email, DOB, OAuth subject and tokens live exclusively in `users_private`, which is only
queried for the signed-in owner or a role-checked admin endpoint.

## 2. Bicycles

`bicycles` stores the 13 questionnaire answers, `safety_defects_json`, `photos_json`
(frame/drivetrain/tires/brakes/complete slots), `cosmetic_rating`, `build_score`,
`score_breakdown_json`, `has_critical_safety_defect`, `safety_recommendation` and
`verification_status` (always `unverified_user_reported`).

The score is **always** produced by `calculateBikeBuildRating()` on the server; a client can
never submit a score. One primary bike per rider is enforced by the API (`POST
/api/bicycles/:id/primary`); `profiles.primary_bike_id` mirrors it for fast profile reads.

## 3. Community

| Table | Notes |
|---|---|
| `posts` | 7 categories, `moderation_status` ∈ pending_review/visible/hidden/removed, denormalised `likes_count`/`comments_count`, optional `bike_id` and `guild_id` |
| `post_likes`, `post_bookmarks` | Composite PKs prevent duplicate reactions |
| `comments` | Self-referencing `parent_comment_id` for replies; own moderation status |
| `friendships` | `requester_id` + `addressee_id` UNIQUE pair, status pending/accepted/declined |
| `user_blocks` | Composite PK `(blocker_id, blocked_id)`; checked in both directions on every read/write between users |
| `conversations`, `messages` | One row per friend pair; `muted_by_a/b`; message `delivery_status` sent/delivered/read; moderation status for reported messages |

**DM authorization:** `GET/POST /api/conversations/:friendId/messages` requires (a) an
accepted friendship, (b) no block in either direction. Otherwise `403
FRIENDS_ONLY_MESSAGING` / `403 CONTACT_BLOCKED` (both covered by test 18).

## 4. Guilds, learning, catalog, events, moderation

| Table | Notes |
|---|---|
| `guilds` | `privacy_type` public/private, `owner_id`, `member_limit` (administrator-configurable), `announcement`, `moderation_status` |
| `guild_memberships` | PK `(guild_id, user_id)`; role owner/moderator/member; status active/pending_approval/invited |
| `guild_messages` | Members-only; moderated |
| `stunt_modules` | 21 rows; JSON columns for prerequisites, gear, checklist, stages, common errors, stop conditions, quiz |
| `user_stunt_progress` | PK `(user_id, module_id)`; checklist flag, safety acknowledgement timestamp, quiz score, completion timestamp |
| `parts_catalog` | 9 categories; `price_lkr` NULL + `price_verified = 0` renders **“Price not verified”**; compatibility warning and `last_verified_date` mandatory |
| `user_part_favorites` | Composite PK |
| `studio_events` | `is_official_studio_event` distinguishes studio-hosted from community events; status featured/upcoming/past/cancelled; announcements JSON; recap |
| `event_registrations` | PK `(event_id, user_id)`, status registered/cancelled — no attendee PII is ever joined into event responses |
| `reports` | 6 target types, 8 reason categories, status pending/under_review/action_taken/dismissed, resolution note + resolving admin |
| `notifications` | Per-user; unread counters drive header badges |
| `legal_documents` | Editable Terms, Privacy, Guidelines, Safety Notice with versions |
| `admin_audit_logs` | Every moderation/configuration action with actor, target and JSON details |

## 5. Authorization matrix

| Operation | Rider | Owner of object | Guild moderator | Guild owner | Moderator | Admin |
|---|---|---|---|---|---|---|
| Read public profile | ✅ (respecting visibility) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Edit profile / privacy | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Set XP / rank / role | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (rank config only) |
| Create/edit/delete own post | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ (+ any post) |
| Like / comment / bookmark | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Send DM | only accepted friends, no block | ✅ | ✅ | ✅ | ✅ | ✅ |
| Join public guild | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Approve members / remove | ❌ | ❌ | ✅ | ✅ | ✅ (reported cases) | ✅ |
| Promote to moderator | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ |
| Read member private data | ❌ | own only | ❌ | ❌ | ❌ | ✅ (audited) |
| Publish official studio event | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Resolve report / remove content | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Edit catalog / ranks | ❌ | ❌ | ❌ | ❌ | catalog only | ✅ |

Every mutation endpoint resolves the caller from the signed JWT, then re-reads role and
ownership from the database — a forged client payload cannot widen access.

## 6. Indexes (query-driven)

```
profiles(district, xp DESC)          leaderboards by district
profiles(xp DESC)                    overall leaderboard
bicycles(user_id, is_primary DESC)   garage listing
posts(moderation_status, guild_id, created_at DESC)   feed
posts(category, created_at DESC)     category filters
comments(post_id, created_at ASC)    post threads
friendships(requester_id, addressee_id, status)
messages(conversation_id, created_at ASC)
guild_memberships(user_id, status)
parts_catalog(category, price_verified)
studio_events(status, event_date ASC)
reports(status, created_at DESC)
notifications(user_id, is_read, created_at DESC)
```

## 7. Retention & deletion

- `DELETE /api/account` deletes the `users_private` row; `ON DELETE CASCADE` removes profile,
  bicycles, posts, comments, likes, bookmarks, friendships, blocks, conversations, messages,
  memberships, progress, favourites, registrations and notifications.
- Reports and the admin audit log intentionally survive so abuse investigations are not
  erased; they contain no message bodies and are retained ≤90 days as disclosed in the
  Privacy Policy.
- No GPS coordinates, EXIF location, phone numbers or home addresses exist anywhere in the
  schema. Districts are the only location granularity in Phase 1.

## 8. Migration path

To PostgreSQL: all statements are standard SQL except `INSERT OR REPLACE` (use
`ON CONFLICT DO UPDATE`) and `MAX(0, x)` inside an UPDATE (rewrite with `GREATEST`).
To Firestore: see the collection mapping table in `EXTERNAL_CONFIG.md` §4.
