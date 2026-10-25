# Phase 2 — Database changes and migration notes

RideRise LK Phase 2 is **additive**. No Phase 1 table is dropped, renamed or rewritten, and
no Phase 1 row is deleted by the migration. Everything below runs on the same SQLite file
(`backend/riderise_lk.sqlite` by default, override with `DB_PATH`).

The migration itself is idempotent and runs automatically on server start:

1. `backend/phase2/schema.sql` is applied with `CREATE TABLE IF NOT EXISTS` /
   `CREATE INDEX IF NOT EXISTS`.
2. `backend/phase2/core.js → migrate(db)` adds any missing columns with
   `ALTER TABLE … ADD COLUMN` (guarded by a `PRAGMA table_info` check).
3. `backend/phase2/seed2.js → seedPhase2(db)` inserts default pathways, maintenance
   lessons, guild settings, voice rooms, notification preferences and studio news with
   `INSERT OR IGNORE`, so restarting never duplicates content.

> **Before upgrading a production database**, stop the server and copy the database file
> (including `-wal` and `-shm` if present) somewhere safe. SQLite has no “down” migration;
> restoring the copy is the rollback.

---

## 1. New tables

| Area | Tables |
|---|---|
| Live location | `live_location_sessions`, `live_location_audit`, `guild_share_consent`, `guild_settings` |
| Voice / PTT | `voice_rooms`, `voice_participants`, `voice_signals`, `voice_floor`, `voice_room_bans` |
| Guild hub | `guild_announcements`, `guild_events`, `guild_event_rsvps`, `guild_audit_logs`, `guild_appeals`, `guild_discussions`, `guild_member_activity` |
| Messaging & push | `message_reactions`, `typing_indicators`, `conversation_settings`, `notification_preferences`, `device_tokens`, `push_delivery_log` |
| Events | `event_announcements`, `event_gallery`, `event_results` |
| Learning | `learning_pathways`, `learning_pathway_modules`, `learning_lesson_media`, `learning_checklist_progress`, `learning_module_reviews` |
| Parts | `part_retailers`, `part_retailer_links`, `part_price_history`, `part_compatibility`, `saved_bike_builds` |
| Moderation / studio | `moderation_appeals`, `feedback_messages`, `admin_notes`, `admin_accounts`, `studio_news`, `admin_action_log` |
| Settings | `app_settings` |

## 2. Columns added to existing Phase 1 tables

| Table | Columns |
|---|---|
| `users_private` | `banned_at`, `banned_by`, `ban_reason`, `restriction_until`, `message_retention_days` |
| `notification_preferences` | `read_receipts` |
| `admin_accounts` | `user_id` |
| `reports` | `severity`, `context_json`, `assigned_admin_id`, `escalation_level`, `appeal_status` |
| `guilds` | `join_policy`, `rules_text`, `banner_color`, `updated_at` |
| `messages` | `reply_to_id`, `read_at`, `delivered_at`, `deleted_at`, `deleted_by`, `edited_at`, `flagged_reason` |
| `stunt_modules` | `track`, `visibility`, `learning_objectives_json`, `why_prerequisites_json`, `requires_supervision`, `video_url`, `status`, `version`, `updated_at`, `updated_by` |
| `user_stunt_progress` | `started_at`, `quiz_attempts`, `last_quiz_score` |
| `studio_events` | `category`, `organizer_name`, `rules_text`, `safety_requirements`, `featured_on_home`, `waitlist_enabled`, `checkin_code`, `cancellation_deadline`, `minor_policy`, `updated_at` |
| `event_registrations` | `waitlist_position`, `checked_in_at`, `ticket_code`, `attendance_note` |
| `parts_catalog` | `manufacturer`, `model`, `spec_json`, `weight_g`, `data_source_label`, `data_updated_at`, `availability_status`, `is_listed` |

### Notes on specific columns

- **`stunt_modules.visibility`** — the four maintenance lessons are inserted with
  `visibility = 'learning_only'` so they appear in the learning track but **not** in the
  21-module trick library. `/api/stunts` filters them out; the learning API does not.
- **`studio_events`** keeps its Phase 1 `CHECK` constraint on `status`
  (`upcoming`, `featured`, `past`, `cancelled`). Phase 2 maps its UI states onto those values.
- **`admin_accounts.user_id`** — Phase 2's credential login requires the administrator
  credential to be linked to a real `users_private` row with role `admin` or `moderator`.
  The bootstrapper links the first admin account it finds. If none exists, sign in with
  Google as the admin, then link manually (see below).

## 3. Running the migration

```bash
cd /home/user/RideRise-LK
cp backend/riderise_lk.sqlite backend/riderise_lk.backup-$(date +%Y%m%d).sqlite
npm start          # applies schema + migrate + seed on boot
curl -s localhost:3000/api/health | jq   # expect "phase": 2
```

To test the migration against a throwaway copy first:

```bash
DB_PATH=/tmp/riderise-migration-test.sqlite PORT=3123 node backend/server.js
```

## 4. Administrator credential bootstrap

On first boot with an empty/legacy `admin_accounts` table:

- development (`NODE_ENV` unset): username `admin$123$`, password `admin$123$`,
  `must_change_password = 1`. The console blocks every write action until the password is
  changed. The default is refused when `NODE_ENV=production`.
- production: a random 18-byte password is generated and printed **once** to the server log.
  Set `ADMIN_USERNAME` and `ADMIN_PASSWORD` to control it yourself.

If login answers `ADMIN_ACCOUNT_UNLINKED`, the credential is not attached to an admin user.
Fix it after signing in with Google as that admin:

```sql
-- verify
SELECT id, username, user_id, must_change_password FROM admin_accounts;
SELECT id, username, role FROM users_private WHERE role IN ('admin','moderator');
-- link (use the real ids)
UPDATE admin_accounts SET user_id = 'usr_admin_nethmi' WHERE username = 'admin$123$';
```

## 5. Indexes

Phase 2 adds indexes on report status/date, live session expiry, voice participants,
message timestamps, event dates, price history and audit timestamps. If your production
database predates Phase 2 and you applied the schema manually, run
`backend/phase2/schema.sql` once through `sqlite3` to create them.

## 6. Retention and deletion

- Location: **no history table of positions is kept.** `live_location_sessions` holds one
  short-lived row per active share and is swept every 60 seconds after expiry. The audit
  table records *events* (start, stop, revoke), never coordinates.
- Direct messages: soft-deleted rows keep a tombstone (`deleted_at`, blank body) so both
  participants see “Message deleted”. A retention sweep removes messages older than
  `DM_RETENTION_DAYS` (default 365).
- Account deletion (Phase 1 endpoint) removes the profile, posts, friendships and tokens;
  Phase 2 cascades guild memberships, voice participation, tokens and sessions.
- `admin_action_log` is append-only; it stores administrator ids, action names and reasons —
  never message bodies or coordinates.

## 7. Backups

```bash
sqlite3 backend/riderise_lk.sqlite ".backup 'backup-$(date +%F).sqlite'"
```

Run this on a schedule in production. The database is the only stateful component; uploads
live under `backend/uploads/` and must be backed up separately.
