-- RideRise LK by Shaun David Studios — Phase 1 Database Schema
-- Strict separation of private user credentials/PII (users_private) from public rider profiles (profiles)

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users_private (
  id TEXT PRIMARY KEY,
  google_sub TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  dob_private TEXT, -- Stored privately for age eligibility; NEVER returned in public API responses
  is_minor INTEGER NOT NULL DEFAULT 0, -- 1 if aged 16-17
  age_confirmed INTEGER NOT NULL DEFAULT 0,
  age_confirmed_at TEXT,
  terms_accepted_version TEXT,
  terms_accepted_at TEXT,
  privacy_accepted_at TEXT,
  guidelines_accepted_at TEXT,
  safety_notice_accepted_at TEXT,
  onboarding_completed INTEGER NOT NULL DEFAULT 0,
  role TEXT NOT NULL DEFAULT 'rider' CHECK (role IN ('rider', 'moderator', 'admin')),
  account_status TEXT NOT NULL DEFAULT 'active' CHECK (account_status IN ('active', 'warned', 'suspended', 'deleted')),
  suspension_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ranks (
  id TEXT PRIMARY KEY,
  level_order INTEGER NOT NULL UNIQUE,
  name TEXT NOT NULL,
  min_xp INTEGER NOT NULL,
  badge_icon TEXT NOT NULL,
  color_hex TEXT NOT NULL,
  description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY REFERENCES users_private(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  bio TEXT DEFAULT '',
  avatar_url TEXT DEFAULT '',
  district TEXT NOT NULL DEFAULT 'Colombo',
  preferred_riding_area TEXT DEFAULT '',
  primary_bike_id TEXT,
  xp INTEGER NOT NULL DEFAULT 0,
  rank_id TEXT NOT NULL DEFAULT 'rank_1' REFERENCES ranks(id),
  profile_visibility TEXT NOT NULL DEFAULT 'public' CHECK (profile_visibility IN ('public', 'friends', 'private')),
  hide_from_leaderboards INTEGER NOT NULL DEFAULT 0,
  allow_friend_requests INTEGER NOT NULL DEFAULT 1,
  allow_messages_from TEXT NOT NULL DEFAULT 'friends_only' CHECK (allow_messages_from IN ('friends_only', 'nobody')),
  notifications_enabled INTEGER NOT NULL DEFAULT 1,
  reduced_motion INTEGER NOT NULL DEFAULT 0,
  locale TEXT NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'si', 'ta')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS achievements (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  xp_reward INTEGER NOT NULL DEFAULT 25,
  icon TEXT NOT NULL,
  category TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_achievements (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users_private(id) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
  awarded_at TEXT NOT NULL,
  awarded_reason TEXT NOT NULL,
  UNIQUE(user_id, achievement_id)
);

CREATE TABLE IF NOT EXISTS xp_activity_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users_private(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  xp_delta INTEGER NOT NULL,
  description TEXT NOT NULL,
  reference_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bicycles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users_private(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0,
  bike_type TEXT NOT NULL,
  frame_material TEXT NOT NULL,
  frame_brand TEXT NOT NULL,
  frame_model TEXT NOT NULL,
  fork_spec TEXT NOT NULL,
  tire_spec TEXT NOT NULL,
  wheel_rim_spec TEXT NOT NULL,
  handlebar_grip_spec TEXT NOT NULL,
  drivetrain_spec TEXT NOT NULL,
  brake_type TEXT NOT NULL,
  maintenance_condition TEXT NOT NULL,
  safety_defects_json TEXT NOT NULL DEFAULT '[]',
  primary_use TEXT NOT NULL,
  photos_json TEXT NOT NULL DEFAULT '{}',
  cosmetic_rating INTEGER,
  build_score INTEGER NOT NULL DEFAULT 0,
  score_breakdown_json TEXT NOT NULL DEFAULT '{}',
  has_critical_safety_defect INTEGER NOT NULL DEFAULT 0,
  safety_recommendation TEXT NOT NULL DEFAULT '',
  verification_status TEXT NOT NULL DEFAULT 'unverified_user_reported',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS guilds (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  emblem TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  district TEXT NOT NULL,
  privacy_type TEXT NOT NULL DEFAULT 'public' CHECK (privacy_type IN ('public', 'private')),
  owner_id TEXT NOT NULL REFERENCES users_private(id) ON DELETE CASCADE,
  member_limit INTEGER NOT NULL DEFAULT 50,
  announcement TEXT DEFAULT '',
  moderation_status TEXT NOT NULL DEFAULT 'visible' CHECK (moderation_status IN ('visible', 'restricted', 'removed')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS guild_memberships (
  guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users_private(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'moderator', 'member')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending_approval', 'invited')),
  joined_at TEXT NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS guild_messages (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES users_private(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  moderation_status TEXT NOT NULL DEFAULT 'visible',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users_private(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN (
    'build_showcase',
    'maintenance_upgrade',
    'riding_recap',
    'skill_progress',
    'community_qa',
    'short_clip',
    'marketplace'
  )),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  media_urls_json TEXT NOT NULL DEFAULT '[]',
  media_type TEXT NOT NULL DEFAULT 'image' CHECK (media_type IN ('none', 'image', 'video')),
  bike_id TEXT REFERENCES bicycles(id) ON DELETE SET NULL,
  guild_id TEXT REFERENCES guilds(id) ON DELETE CASCADE,
  moderation_status TEXT NOT NULL DEFAULT 'visible' CHECK (moderation_status IN ('pending_review', 'visible', 'hidden', 'removed')),
  likes_count INTEGER NOT NULL DEFAULT 0,
  comments_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS post_likes (
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users_private(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS post_bookmarks (
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users_private(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users_private(id) ON DELETE CASCADE,
  parent_comment_id TEXT REFERENCES comments(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  moderation_status TEXT NOT NULL DEFAULT 'visible' CHECK (moderation_status IN ('visible', 'hidden', 'removed')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS friendships (
  id TEXT PRIMARY KEY,
  requester_id TEXT NOT NULL REFERENCES users_private(id) ON DELETE CASCADE,
  addressee_id TEXT NOT NULL REFERENCES users_private(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(requester_id, addressee_id)
);

CREATE TABLE IF NOT EXISTS user_blocks (
  blocker_id TEXT NOT NULL REFERENCES users_private(id) ON DELETE CASCADE,
  blocked_id TEXT NOT NULL REFERENCES users_private(id) ON DELETE CASCADE,
  reason TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  user_a_id TEXT NOT NULL REFERENCES users_private(id) ON DELETE CASCADE,
  user_b_id TEXT NOT NULL REFERENCES users_private(id) ON DELETE CASCADE,
  muted_by_a INTEGER NOT NULL DEFAULT 0,
  muted_by_b INTEGER NOT NULL DEFAULT 0,
  last_message_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(user_a_id, user_b_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES users_private(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  attachment_url TEXT DEFAULT '',
  delivery_status TEXT NOT NULL DEFAULT 'sent' CHECK (delivery_status IN ('sent', 'delivered', 'read')),
  moderation_status TEXT NOT NULL DEFAULT 'visible' CHECK (moderation_status IN ('visible', 'hidden', 'removed')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stunt_modules (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('fundamentals', 'beginner_freestyle', 'intermediate', 'advanced')),
  title TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  xp_reward INTEGER NOT NULL DEFAULT 40,
  prerequisites_json TEXT NOT NULL DEFAULT '[]',
  bike_suitability TEXT NOT NULL,
  protective_gear_json TEXT NOT NULL DEFAULT '[]',
  safe_environment TEXT NOT NULL,
  inspection_checklist_json TEXT NOT NULL DEFAULT '[]',
  learning_stages_json TEXT NOT NULL DEFAULT '[]',
  common_errors_json TEXT NOT NULL DEFAULT '[]',
  stop_conditions_json TEXT NOT NULL DEFAULT '[]',
  coaching_reminder TEXT NOT NULL,
  diagram_type TEXT NOT NULL DEFAULT 'bunny_hop',
  quiz_questions_json TEXT NOT NULL DEFAULT '[]',
  requires_safety_ack INTEGER NOT NULL DEFAULT 0,
  display_order INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS user_stunt_progress (
  user_id TEXT NOT NULL REFERENCES users_private(id) ON DELETE CASCADE,
  module_id TEXT NOT NULL REFERENCES stunt_modules(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed')),
  checklist_completed INTEGER NOT NULL DEFAULT 0,
  safety_ack_at TEXT,
  quiz_score INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  PRIMARY KEY (user_id, module_id)
);

CREATE TABLE IF NOT EXISTS parts_catalog (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  brand TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN (
    'frames_forks',
    'handlebars_stems_grips',
    'tires_wheels_hubs',
    'drivetrain_cranks_pedals',
    'brakes_cables_levers',
    'headsets_seats',
    'pegs_accessories',
    'protective_gear',
    'tools_maintenance'
  )),
  compatible_bike_types TEXT NOT NULL,
  description TEXT NOT NULL,
  image_url TEXT DEFAULT '',
  price_lkr INTEGER, -- NULL when price is not verified
  price_verified INTEGER NOT NULL DEFAULT 0,
  retailer_name TEXT NOT NULL,
  source_contact TEXT NOT NULL,
  availability TEXT NOT NULL DEFAULT 'Unverified — Contact Retailer',
  compatibility_warning TEXT NOT NULL,
  last_verified_date TEXT,
  updated_by_admin_id TEXT
);

CREATE TABLE IF NOT EXISTS user_part_favorites (
  user_id TEXT NOT NULL REFERENCES users_private(id) ON DELETE CASCADE,
  part_id TEXT NOT NULL REFERENCES parts_catalog(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, part_id)
);

CREATE TABLE IF NOT EXISTS studio_events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  banner_type TEXT NOT NULL DEFAULT 'sunset_jam',
  description TEXT NOT NULL,
  schedule_text TEXT NOT NULL,
  event_date TEXT NOT NULL,
  district TEXT NOT NULL,
  venue TEXT NOT NULL,
  registration_deadline TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 100,
  is_official_studio_event INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'featured', 'past', 'cancelled')),
  cancellation_notice TEXT DEFAULT '',
  eligibility_requirements TEXT NOT NULL,
  equipment_safety_requirements TEXT NOT NULL,
  organizer_contact TEXT NOT NULL,
  announcements_json TEXT NOT NULL DEFAULT '[]',
  post_event_recap TEXT DEFAULT '',
  created_by_admin_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS event_registrations (
  event_id TEXT NOT NULL REFERENCES studio_events(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users_private(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'registered' CHECK (status IN ('registered', 'cancelled')),
  emergency_ack INTEGER NOT NULL DEFAULT 1,
  registered_at TEXT NOT NULL,
  PRIMARY KEY (event_id, user_id)
);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL REFERENCES users_private(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('post', 'comment', 'user', 'message', 'guild', 'event')),
  target_id TEXT NOT NULL,
  reason_category TEXT NOT NULL CHECK (reason_category IN (
    'bullying_harassment',
    'threats_violence',
    'impersonation',
    'unwanted_sexual_content',
    'suspicious_pii_request',
    'dangerous_road_stunt',
    'scam_marketplace',
    'other'
  )),
  details TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'under_review', 'action_taken', 'dismissed')),
  resolution_note TEXT DEFAULT '',
  resolved_by_admin_id TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users_private(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  reference_type TEXT DEFAULT '',
  reference_id TEXT DEFAULT '',
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS legal_documents (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  version TEXT NOT NULL,
  content_markdown TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by_admin_id TEXT
);

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES users_private(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

-- Indexes for actual query patterns
CREATE INDEX IF NOT EXISTS idx_profiles_district_xp ON profiles(district, xp DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_xp ON profiles(xp DESC);
CREATE INDEX IF NOT EXISTS idx_bicycles_user ON bicycles(user_id, is_primary DESC);
CREATE INDEX IF NOT EXISTS idx_posts_feed ON posts(moderation_status, guild_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_category ON posts(category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_friendships_users ON friendships(requester_id, addressee_id, status);
CREATE INDEX IF NOT EXISTS idx_messages_convo ON messages(conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_guild_members_user ON guild_memberships(user_id, status);
CREATE INDEX IF NOT EXISTS idx_parts_category ON parts_catalog(category, price_verified);
CREATE INDEX IF NOT EXISTS idx_events_status_date ON studio_events(status, event_date ASC);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, created_at DESC);
