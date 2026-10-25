-- =============================================================================
-- RideRise LK — Phase 2 additive schema (idempotent)
-- Applied after the Phase 1 schema. Every statement is CREATE ... IF NOT EXISTS
-- so existing Phase 1 databases upgrade in place with no data loss.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Application settings (server-side feature switches, no secrets)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- 1. LIVE GUILD MAP — ephemeral location sessions (never a history trail)
--    Only the *current* session is stored. Rows are deleted when sharing stops,
--    when the session lease expires, or when the member leaves the guild.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS live_location_sessions (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users_private(id) ON DELETE CASCADE,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  accuracy_m REAL,
  -- 'approximate' (grid-snapped, default) or 'precise' (short-lived, 18+ only)
  precision_mode TEXT NOT NULL DEFAULT 'approximate' CHECK (precision_mode IN ('approximate', 'precise')),
  radius_m INTEGER NOT NULL DEFAULT 750,
  started_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS live_location_audit (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('started', 'updated', 'stopped', 'expired', 'revoked', 'denied')),
  -- Deliberately no coordinates in the audit trail.
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

-- Per-guild share consent. Sharing is off unless this is explicitly enabled by
-- the member AND a live session exists.
CREATE TABLE IF NOT EXISTS guild_share_consent (
  guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users_private(id) ON DELETE CASCADE,
  allowed INTEGER NOT NULL DEFAULT 0,
  precision_allowed INTEGER NOT NULL DEFAULT 0,
  consented_at TEXT,
  revoked_at TEXT,
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS guild_settings (
  guild_id TEXT PRIMARY KEY REFERENCES guilds(id) ON DELETE CASCADE,
  location_sharing_enabled INTEGER NOT NULL DEFAULT 1,
  voice_enabled INTEGER NOT NULL DEFAULT 1,
  walkie_enabled INTEGER NOT NULL DEFAULT 1,
  activity_visible INTEGER NOT NULL DEFAULT 1,
  rules_text TEXT NOT NULL DEFAULT '',
  welcome_message TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

-- ---------------------------------------------------------------------------
-- 2 & 3. GUILD VOICE CHAT + WALKIE-TALKIE
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS voice_rooms (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'group' CHECK (kind IN ('group', 'walkie')),
  min_role TEXT NOT NULL DEFAULT 'member' CHECK (min_role IN ('member', 'moderator', 'owner')),
  max_participants INTEGER NOT NULL DEFAULT 8,
  -- Seconds a single push-to-talk transmission may hold the floor (stuck-mic guard)
  max_transmission_seconds INTEGER NOT NULL DEFAULT 30,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES users_private(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS voice_participants (
  room_id TEXT NOT NULL REFERENCES voice_rooms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users_private(id) ON DELETE CASCADE,
  joined_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  muted INTEGER NOT NULL DEFAULT 0,
  self_muted INTEGER NOT NULL DEFAULT 0,
  connection_state TEXT NOT NULL DEFAULT 'connecting',
  audio_route TEXT NOT NULL DEFAULT 'speaker',
  PRIMARY KEY (room_id, user_id)
);

-- Ephemeral WebRTC signalling envelopes. Pruned aggressively by the sweeper.
CREATE TABLE IF NOT EXISTS voice_signals (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES voice_rooms(id) ON DELETE CASCADE,
  from_user TEXT NOT NULL,
  to_user TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('offer', 'answer', 'ice', 'renegotiate')),
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Server-authoritative half-duplex transmission floor for walkie-talkie.
CREATE TABLE IF NOT EXISTS voice_floor (
  room_id TEXT PRIMARY KEY REFERENCES voice_rooms(id) ON DELETE CASCADE,
  holder_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  request_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS voice_room_bans (
  room_id TEXT NOT NULL REFERENCES voice_rooms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users_private(id) ON DELETE CASCADE,
  banned_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (room_id, user_id)
);

-- ---------------------------------------------------------------------------
-- 4. ADVANCED GUILD MANAGEMENT
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS guild_announcements (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users_private(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  media_json TEXT NOT NULL DEFAULT '[]',
  pinned INTEGER NOT NULL DEFAULT 0,
  moderation_status TEXT NOT NULL DEFAULT 'visible' CHECK (moderation_status IN ('visible', 'hidden', 'removed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS guild_events (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'meetup',
  venue TEXT NOT NULL,
  district TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  capacity INTEGER NOT NULL DEFAULT 40,
  waitlist_enabled INTEGER NOT NULL DEFAULT 1,
  rules_text TEXT NOT NULL DEFAULT '',
  safety_requirements TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'cancelled', 'completed')),
  created_by TEXT NOT NULL REFERENCES users_private(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS guild_event_rsvps (
  event_id TEXT NOT NULL REFERENCES guild_events(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users_private(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'going' CHECK (status IN ('going', 'waitlist', 'cancelled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (event_id, user_id)
);

CREATE TABLE IF NOT EXISTS guild_audit_logs (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT '',
  target_id TEXT NOT NULL DEFAULT '',
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS guild_appeals (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users_private(id) ON DELETE CASCADE,
  action_ref TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'upheld', 'overturned')),
  reviewer_id TEXT,
  resolution TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS guild_discussions (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users_private(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  media_url TEXT NOT NULL DEFAULT '',
  media_type TEXT NOT NULL DEFAULT 'none' CHECK (media_type IN ('none', 'image', 'video')),
  pinned INTEGER NOT NULL DEFAULT 0,
  moderation_status TEXT NOT NULL DEFAULT 'visible' CHECK (moderation_status IN ('visible', 'hidden', 'removed')),
  reply_to_id TEXT,
  created_at TEXT NOT NULL
);

-- Per-member guild activity preferences (appear in "active" lists etc.)
CREATE TABLE IF NOT EXISTS guild_member_activity (
  guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users_private(id) ON DELETE CASCADE,
  show_activity INTEGER NOT NULL DEFAULT 1,
  notifications_level TEXT NOT NULL DEFAULT 'all' CHECK (notifications_level IN ('all', 'mentions', 'none')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);

-- ---------------------------------------------------------------------------
-- 5. MESSAGING & NOTIFICATIONS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS message_reactions (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users_private(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (message_id, user_id, emoji)
);

CREATE TABLE IF NOT EXISTS typing_indicators (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users_private(id) ON DELETE CASCADE,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS conversation_settings (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users_private(id) ON DELETE CASCADE,
  muted INTEGER NOT NULL DEFAULT 0,
  preview_allowed INTEGER NOT NULL DEFAULT 1,
  archived INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users_private(id) ON DELETE CASCADE,
  messages INTEGER NOT NULL DEFAULT 1,
  friend_requests INTEGER NOT NULL DEFAULT 1,
  guild_invites INTEGER NOT NULL DEFAULT 1,
  events INTEGER NOT NULL DEFAULT 1,
  moderation INTEGER NOT NULL DEFAULT 1,
  news INTEGER NOT NULL DEFAULT 1,
  show_previews INTEGER NOT NULL DEFAULT 1,
  quiet_hours_start INTEGER,
  quiet_hours_end INTEGER,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS device_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users_private(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'android',
  app_version TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  UNIQUE (user_id, token)
);

CREATE TABLE IF NOT EXISTS push_delivery_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- 6. EVENTS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS event_announcements (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES studio_events(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS event_gallery (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES studio_events(id) ON DELETE CASCADE,
  media_url TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  uploaded_by TEXT NOT NULL,
  approved INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS event_results (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES studio_events(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT 'open',
  rider_name TEXT NOT NULL,
  placement INTEGER,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- 7. LEARNING
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS learning_pathways (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  track TEXT NOT NULL CHECK (track IN ('beginner', 'intermediate', 'advanced', 'maintenance')),
  description TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '🎯',
  display_order INTEGER NOT NULL DEFAULT 1,
  is_published INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS learning_pathway_modules (
  pathway_id TEXT NOT NULL REFERENCES learning_pathways(id) ON DELETE CASCADE,
  module_id TEXT NOT NULL REFERENCES stunt_modules(id) ON DELETE CASCADE,
  display_order INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (pathway_id, module_id)
);

CREATE TABLE IF NOT EXISTS learning_lesson_media (
  id TEXT PRIMARY KEY,
  module_id TEXT NOT NULL REFERENCES stunt_modules(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'video', 'diagram')),
  url TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  display_order INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS learning_checklist_progress (
  user_id TEXT NOT NULL REFERENCES users_private(id) ON DELETE CASCADE,
  module_id TEXT NOT NULL REFERENCES stunt_modules(id) ON DELETE CASCADE,
  item_index INTEGER NOT NULL,
  checked_at TEXT NOT NULL,
  PRIMARY KEY (user_id, module_id, item_index)
);

CREATE TABLE IF NOT EXISTS learning_module_reviews (
  id TEXT PRIMARY KEY,
  module_id TEXT NOT NULL REFERENCES stunt_modules(id) ON DELETE CASCADE,
  reviewer_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'changes_requested')),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- 8. PARTS & BICYCLE DATABASE
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS part_retailers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  district TEXT NOT NULL DEFAULT '',
  verification_note TEXT NOT NULL DEFAULT '',
  verified_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS part_retailer_links (
  part_id TEXT NOT NULL REFERENCES parts_catalog(id) ON DELETE CASCADE,
  retailer_id TEXT NOT NULL REFERENCES part_retailers(id) ON DELETE CASCADE,
  product_url TEXT NOT NULL DEFAULT '',
  last_checked_at TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (part_id, retailer_id)
);

CREATE TABLE IF NOT EXISTS part_price_history (
  id TEXT PRIMARY KEY,
  part_id TEXT NOT NULL REFERENCES parts_catalog(id) ON DELETE CASCADE,
  price_lkr INTEGER NOT NULL,
  source_label TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  recorded_by TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS part_compatibility (
  id TEXT PRIMARY KEY,
  part_id TEXT NOT NULL REFERENCES parts_catalog(id) ON DELETE CASCADE,
  bike_type TEXT NOT NULL,
  spec_key TEXT NOT NULL,
  expected_value TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('fits', 'check', 'no_fit')),
  notes TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS saved_bike_builds (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users_private(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  base_bike_id TEXT,
  parts_json TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  total_estimate_lkr INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- 9. MODERATION, TEEN SAFETY & APPEALS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS moderation_appeals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users_private(id) ON DELETE CASCADE,
  action_ref TEXT NOT NULL DEFAULT '',
  scope TEXT NOT NULL DEFAULT 'platform' CHECK (scope IN ('platform', 'guild', 'event', 'voice')),
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'upheld', 'overturned')),
  reviewer_id TEXT,
  resolution TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS feedback_messages (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users_private(id) ON DELETE SET NULL,
  category TEXT NOT NULL DEFAULT 'general',
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  contact_email TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'read', 'in_progress', 'resolved')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  admin_note TEXT NOT NULL DEFAULT '',
  assigned_admin_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_notes (
  id TEXT PRIMARY KEY,
  subject_user_id TEXT NOT NULL,
  admin_id TEXT NOT NULL,
  note TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- 10. ADMIN CREDENTIAL LOGIN + STUDIO NEWS
--    Passwords are stored as scrypt hashes (never plaintext, never shipped in
--    the client bundle). The default bootstrap credential is development-only
--    and must be changed at first login.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_accounts (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'moderator')),
  user_id TEXT,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS studio_news (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'announcement',
  pinned INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 1,
  is_official INTEGER NOT NULL DEFAULT 1,
  author_admin_id TEXT,
  published_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_action_log (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Indexes for Phase 2 query patterns
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_live_sessions_guild ON live_location_sessions(guild_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_live_sessions_user ON live_location_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_voice_rooms_guild ON voice_rooms(guild_id, kind, is_active);
CREATE INDEX IF NOT EXISTS idx_voice_participants_room ON voice_participants(room_id, last_seen_at);
CREATE INDEX IF NOT EXISTS idx_voice_signals_target ON voice_signals(room_id, to_user, created_at);
CREATE INDEX IF NOT EXISTS idx_guild_announcements ON guild_announcements(guild_id, pinned DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_guild_events_start ON guild_events(guild_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_guild_discussions ON guild_discussions(guild_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_guild_audit ON guild_audit_logs(guild_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reactions_message ON message_reactions(message_id);
CREATE INDEX IF NOT EXISTS idx_price_history_part ON part_price_history(part_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_compat_part ON part_compatibility(part_id, bike_type);
CREATE INDEX IF NOT EXISTS idx_saved_builds_user ON saved_bike_builds(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON device_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback_messages(status, priority, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_published ON studio_news(published, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_pathway_modules ON learning_pathway_modules(pathway_id, display_order);

-- Stunt module visibility: learning-only maintenance lessons stay out of the trick library.
