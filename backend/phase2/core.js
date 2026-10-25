// RideRise LK Phase 2 — core services: migrations, realtime hub, notifications, push.
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

/* ------------------------------- primitives ------------------------------- */
const nowIso = () => new Date().toISOString();
const nowMs = () => Date.now();
const newId = (prefix) => `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function ensureColumn(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/* -------------------------- Phase 1 -> Phase 2 upgrades ------------------- */
function migrate(db) {
  // Reports must accept guild-message and voice-session targets. SQLite cannot
  // alter a CHECK constraint, so the table is rebuilt once, preserving rows.
  const reportsSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='reports'").get();
  if (reportsSql && !reportsSql.sql.includes('guild_message')) {
    db.exec('PRAGMA foreign_keys = OFF;');
    db.exec('BEGIN;');
    try {
      db.exec('ALTER TABLE reports RENAME TO reports_phase1;');
      db.exec(`
        CREATE TABLE reports (
          id TEXT PRIMARY KEY,
          reporter_id TEXT NOT NULL REFERENCES users_private(id) ON DELETE CASCADE,
          target_type TEXT NOT NULL CHECK (target_type IN (
            'post', 'comment', 'user', 'message', 'guild', 'event',
            'guild_message', 'guild_announcement', 'voice_session', 'gallery', 'profile'
          )),
          target_id TEXT NOT NULL,
          reason_category TEXT NOT NULL CHECK (reason_category IN (
            'bullying_harassment', 'threats_violence', 'impersonation', 'unwanted_sexual_content',
            'suspicious_pii_request', 'dangerous_road_stunt', 'scam_marketplace', 'other'
          )),
          details TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'under_review', 'action_taken', 'dismissed')),
          resolution_note TEXT DEFAULT '',
          resolved_by_admin_id TEXT,
          created_at TEXT NOT NULL,
          resolved_at TEXT
        );`);
      db.exec(`INSERT INTO reports (id, reporter_id, target_type, target_id, reason_category, details, status,
                 resolution_note, resolved_by_admin_id, created_at, resolved_at)
               SELECT id, reporter_id, target_type, target_id, reason_category, details, status,
                 COALESCE(resolution_note, ''), resolved_by_admin_id, created_at, resolved_at
               FROM reports_phase1;`);
      db.exec('DROP TABLE reports_phase1;');
      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    } finally {
      db.exec('PRAGMA foreign_keys = ON;');
    }
  }
  ensureColumn(db, 'reports', 'severity', "TEXT NOT NULL DEFAULT 'normal'");
  ensureColumn(db, 'reports', 'context_json', "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn(db, 'reports', 'assigned_admin_id', 'TEXT');
  ensureColumn(db, 'reports', 'escalation_level', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn(db, 'reports', 'appeal_status', "TEXT NOT NULL DEFAULT 'none'");

  // Guilds: explicit join policy (keeps Phase 1 privacy_type values working)
  ensureColumn(db, 'guilds', 'join_policy', "TEXT NOT NULL DEFAULT 'open'");
  ensureColumn(db, 'guilds', 'rules_text', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'guilds', 'banner_color', "TEXT NOT NULL DEFAULT '#FF6B00'");
  ensureColumn(db, 'guilds', 'updated_at', 'TEXT');
  db.exec("UPDATE guilds SET join_policy = 'approval' WHERE privacy_type = 'private' AND join_policy = 'open'");

  // Messages: replies, receipts, deletion, retention
  ensureColumn(db, 'messages', 'reply_to_id', 'TEXT');
  ensureColumn(db, 'messages', 'read_at', 'TEXT');
  ensureColumn(db, 'messages', 'delivered_at', 'TEXT');
  ensureColumn(db, 'messages', 'deleted_at', 'TEXT');
  ensureColumn(db, 'messages', 'deleted_by', 'TEXT');
  ensureColumn(db, 'messages', 'edited_at', 'TEXT');
  ensureColumn(db, 'messages', 'flagged_reason', "TEXT NOT NULL DEFAULT ''");

  // Learning: richer modules + review state
  ensureColumn(db, 'stunt_modules', 'track', "TEXT NOT NULL DEFAULT 'beginner'");
  ensureColumn(db, 'stunt_modules', 'visibility', "TEXT NOT NULL DEFAULT 'public'");
  ensureColumn(db, 'stunt_modules', 'learning_objectives_json', "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, 'stunt_modules', 'why_prerequisites_json', "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, 'stunt_modules', 'requires_supervision', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'stunt_modules', 'video_url', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'stunt_modules', 'status', "TEXT NOT NULL DEFAULT 'published'");
  ensureColumn(db, 'stunt_modules', 'version', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn(db, 'stunt_modules', 'updated_at', 'TEXT');
  ensureColumn(db, 'stunt_modules', 'updated_by', 'TEXT');
  ensureColumn(db, 'user_stunt_progress', 'started_at', 'TEXT');
  ensureColumn(db, 'user_stunt_progress', 'quiz_attempts', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'user_stunt_progress', 'last_quiz_score', 'INTEGER NOT NULL DEFAULT 0');

  // Events
  ensureColumn(db, 'studio_events', 'category', "TEXT NOT NULL DEFAULT 'community'");
  ensureColumn(db, 'studio_events', 'organizer_name', "TEXT NOT NULL DEFAULT 'Shaun David Studios'");
  ensureColumn(db, 'studio_events', 'rules_text', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'studio_events', 'safety_requirements', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'studio_events', 'featured_on_home', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'studio_events', 'waitlist_enabled', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn(db, 'studio_events', 'checkin_code', 'TEXT');
  ensureColumn(db, 'studio_events', 'cancellation_deadline', 'TEXT');
  ensureColumn(db, 'studio_events', 'minor_policy', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'studio_events', 'updated_at', 'TEXT');
  ensureColumn(db, 'event_registrations', 'waitlist_position', 'INTEGER');
  ensureColumn(db, 'event_registrations', 'checked_in_at', 'TEXT');
  ensureColumn(db, 'event_registrations', 'ticket_code', 'TEXT');
  ensureColumn(db, 'event_registrations', 'attendance_note', "TEXT NOT NULL DEFAULT ''");

  // Parts catalogue
  ensureColumn(db, 'parts_catalog', 'manufacturer', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'parts_catalog', 'model', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'parts_catalog', 'spec_json', "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn(db, 'parts_catalog', 'weight_g', 'INTEGER');
  ensureColumn(db, 'parts_catalog', 'data_source_label', "TEXT NOT NULL DEFAULT 'Administrator-maintained record'");
  ensureColumn(db, 'parts_catalog', 'data_updated_at', 'TEXT');
  ensureColumn(db, 'parts_catalog', 'availability_status', "TEXT NOT NULL DEFAULT 'Unverified — Contact Retailer'");
  ensureColumn(db, 'parts_catalog', 'is_listed', 'INTEGER NOT NULL DEFAULT 1');

  // Accounts
  ensureColumn(db, 'notification_preferences', 'read_receipts', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn(db, 'admin_accounts', 'user_id', 'TEXT');
  ensureColumn(db, 'users_private', 'banned_at', 'TEXT');
  ensureColumn(db, 'users_private', 'banned_by', 'TEXT');
  ensureColumn(db, 'users_private', 'ban_reason', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'users_private', 'restriction_until', 'TEXT');
  ensureColumn(db, 'users_private', 'message_retention_days', 'INTEGER NOT NULL DEFAULT 365');

  db.exec('CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, created_at DESC);');
}

/* -------------------------------- presence -------------------------------- */
// Lightweight in-memory presence: touches on any authenticated request. This is
// deliberately ephemeral and never exposes a location by itself.
const presenceMap = new Map();

function touchPresence(userId) {
  if (userId) presenceMap.set(userId, nowMs());
}

function isOnline(userId, windowMs = 120_000) {
  const last = presenceMap.get(userId);
  return Boolean(last && nowMs() - last < windowMs);
}

function presenceSweep(maxAgeMs = 30 * 60_000) {
  const cutoff = nowMs() - maxAgeMs;
  for (const [userId, last] of presenceMap) {
    if (last < cutoff) presenceMap.delete(userId);
  }
}

/* ------------------------------- realtime hub ----------------------------- */
/**
 * Server-Sent Events hub with short-lived, single-use tickets.
 *
 * EventSource cannot send an Authorization header, so clients exchange their
 * bearer token for a 60-second ticket bound to their user id. Tickets are not
 * reusable and never carry message bodies themselves.
 */
function createStreamHub() {
  const subscribers = new Map(); // userId -> Set<res>
  const tickets = new Map(); // ticket -> { userId, expiresAt }

  function issueTicket(userId) {
    const ticket = crypto.randomBytes(24).toString('base64url');
    tickets.set(ticket, { userId, expiresAt: nowMs() + 60_000 });
    return ticket;
  }

  function consumeTicket(ticket) {
    const entry = tickets.get(ticket);
    if (!entry) return null;
    tickets.delete(ticket);
    if (entry.expiresAt < nowMs()) return null;
    return entry.userId;
  }

  function subscribe(userId, res) {
    if (!subscribers.has(userId)) subscribers.set(userId, new Set());
    const set = subscribers.get(userId);
    set.add(res);
    return () => {
      set.delete(res);
      if (!set.size) subscribers.delete(userId);
    };
  }

  function publish(userId, event, data) {
    const listeners = subscribers.get(userId);
    if (!listeners || !listeners.size) return 0;
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    let delivered = 0;
    for (const res of listeners) {
      try {
        res.write(payload);
        delivered++;
      } catch {
        listeners.delete(res);
      }
    }
    return delivered;
  }

  function sweep() {
    const cutoff = nowMs();
    for (const [ticket, entry] of tickets) {
      if (entry.expiresAt < cutoff) tickets.delete(ticket);
    }
  }

  return { issueTicket, consumeTicket, subscribe, publish, sweep, subscriberCount: () => subscribers.size };
}

/* ------------------------------ notifications ----------------------------- */
function getNotificationPrefs(db, userId) {
  let prefs = db.prepare('SELECT * FROM notification_preferences WHERE user_id = ?').get(userId);
  if (!prefs) {
    db.prepare(
      `INSERT INTO notification_preferences (user_id, messages, friend_requests, guild_invites, events, moderation,
        news, show_previews, quiet_hours_start, quiet_hours_end, updated_at)
       VALUES (?, 1, 1, 1, 1, 1, 1, 1, NULL, NULL, ?)`
    ).run(userId, nowIso());
    prefs = db.prepare('SELECT * FROM notification_preferences WHERE user_id = ?').get(userId);
  }
  return prefs;
}

const TYPE_TO_PREF = {
  message: 'messages',
  friend_request: 'friend_requests',
  friend_accept: 'friend_requests',
  guild_invite: 'guild_invites',
  guild_announcement: 'guild_invites',
  event_reminder: 'events',
  event_announcement: 'events',
  moderation: 'moderation',
  news: 'news',
  system: 'news'
};

function inQuietHours(prefs) {
  if (prefs.quiet_hours_start === null || prefs.quiet_hours_end === null) return false;
  const hour = new Date().getHours();
  const start = prefs.quiet_hours_start;
  const end = prefs.quiet_hours_end;
  return start <= end ? hour >= start && hour < end : hour >= start || hour < end;
}

/**
 * Records an in-app notification and (when configured) queues a push.
 * Message bodies are never included in push text unless the recipient has
 * explicitly enabled previews — the default is a generic, private preview.
 */
function createNotifier(db, deps) {
  const { stream, sendPush } = deps;

  function notify(options) {
    const {
      userId,
      type,
      title,
      body,
      referenceType = '',
      referenceId = '',
      deepLink = '',
      sensitive = false,
      skipPrefs = false
    } = options;

    if (!userId) return null;
    const user = db.prepare('SELECT account_status FROM users_private WHERE id = ?').get(userId);
    if (!user || user.account_status === 'deleted') return null;

    const prefs = getNotificationPrefs(db, userId);
    const prefKey = TYPE_TO_PREF[type];
    if (!skipPrefs && prefKey && prefs[prefKey] === 0) {
      db.prepare(
        'INSERT INTO push_delivery_log (id, user_id, channel, title, status, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(newId('pdl'), userId, 'in_app', title, 'suppressed_preference', type, nowIso());
      return null;
    }

    const id = newId('ntf');
    db.prepare(
      `INSERT INTO notifications (id, user_id, type, title, body, reference_type, reference_id, is_read, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`
    ).run(id, userId, type, title, body, referenceType, referenceId, nowIso());

    const payload = {
      id,
      type,
      title,
      body: sensitive && !prefs.show_previews ? 'Open RideRise LK to view this update.' : body,
      reference_type: referenceType,
      reference_id: referenceId,
      deep_link: deepLink,
      created_at: nowIso()
    };
    if (stream) stream.publish(userId, 'notification', payload);

    if (sendPush) {
      const quiet = inQuietHours(prefs);
      const tokens = db.prepare('SELECT token, platform FROM device_tokens WHERE user_id = ?').all(userId);
      if (!tokens.length) {
        db.prepare(
          'INSERT INTO push_delivery_log (id, user_id, channel, title, status, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).run(newId('pdl'), userId, 'push', title, 'no_registered_device', type, nowIso());
      } else if (quiet) {
        db.prepare(
          'INSERT INTO push_delivery_log (id, user_id, channel, title, status, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).run(newId('pdl'), userId, 'push', title, 'quiet_hours_deferred_to_inbox', type, nowIso());
      } else {
        const pushTitle = sensitive && !prefs.show_previews ? 'RideRise LK' : title;
        const pushBody = sensitive && !prefs.show_previews ? 'You have a new private update.' : body;
        sendPush(userId, tokens, { title: pushTitle, body: pushBody, deepLink, type });
      }
    }
    return id;
  }

  return { notify, getNotificationPrefs, inQuietHours };
}

/* ---------------------------------- FCM ----------------------------------- */
/**
 * Firebase Cloud Messaging HTTP v1 sender.
 *
 * Requires a service-account JSON file supplied through FCM_SERVICE_ACCOUNT_FILE
 * (path) or FCM_SERVICE_ACCOUNT_JSON (raw JSON). No credential is ever bundled
 * into the web app or the APK. When unconfigured every attempt is logged as
 * `not_configured` so the admin console can show the truth instead of a
 * fabricated delivery receipt.
 */
function createPushSender() {
  let cachedToken = null;
  let tokenExpiresAt = 0;
  let serviceAccount = null;
  let loadError = '';

  function loadServiceAccount() {
    if (serviceAccount !== null) return serviceAccount;
    const inline = process.env.FCM_SERVICE_ACCOUNT_JSON || '';
    const filePath = process.env.FCM_SERVICE_ACCOUNT_FILE || '';
    try {
      let raw = inline;
      // Relative paths are resolved from the repository root (like .env and
      // scripts/check_setup.js do), so `npm start` works from any directory.
      const resolvedPath = filePath
        ? (path.isAbsolute(filePath) ? filePath : path.resolve(__dirname, '..', '..', filePath))
        : '';
      if (!raw && resolvedPath && fs.existsSync(resolvedPath)) raw = fs.readFileSync(resolvedPath, 'utf8');
      if (!raw) {
        serviceAccount = false;
        loadError = resolvedPath
          ? `FCM_SERVICE_ACCOUNT_FILE not found: ${resolvedPath}`
          : 'FCM_SERVICE_ACCOUNT_FILE / FCM_SERVICE_ACCOUNT_JSON not set';
        return false;
      }
      serviceAccount = JSON.parse(raw);
      if (!serviceAccount.project_id || !serviceAccount.client_email || !serviceAccount.private_key) {
        serviceAccount = false;
        loadError = 'Service account JSON is missing project_id / client_email / private_key';
      }
    } catch (err) {
      serviceAccount = false;
      loadError = `Service account could not be read: ${err.message}`;
    }
    return serviceAccount;
  }

  function status() {
    const sa = loadServiceAccount();
    return {
      configured: Boolean(sa),
      project_id: sa ? sa.project_id : null,
      reason: sa ? '' : loadError
    };
  }

  async function accessToken() {
    if (cachedToken && tokenExpiresAt > nowMs() + 60_000) return cachedToken;
    const sa = loadServiceAccount();
    if (!sa) throw new Error('FCM_NOT_CONFIGURED');
    const iat = Math.floor(nowMs() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const claims = Buffer.from(
      JSON.stringify({
        iss: sa.client_email,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: 'https://oauth2.googleapis.com/token',
        iat,
        exp: iat + 3600
      })
    ).toString('base64url');
    const signature = crypto
      .createSign('RSA-SHA256')
      .update(`${header}.${claims}`)
      .sign(sa.private_key)
      .toString('base64url');
    const assertion = `${header}.${claims}.${signature}`;
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${assertion}`
    });
    if (!res.ok) throw new Error(`FCM token exchange failed (HTTP ${res.status})`);
    const data = await res.json();
    cachedToken = data.access_token;
    tokenExpiresAt = nowMs() + (data.expires_in || 3600) * 1000;
    return cachedToken;
  }

  async function send(userId, tokens, message) {
    const sa = loadServiceAccount();
    const logRow = (channel, statusText, detail) => {
      try {
        const db = global.__rideriseDb;
        if (!db) return;
        db.prepare(
          'INSERT INTO push_delivery_log (id, user_id, channel, title, status, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).run(newId('pdl'), userId, channel, message.title, statusText, detail, nowIso());
      } catch {
        /* logging must never break delivery */
      }
    };
    if (!sa) {
      logRow('push', 'not_configured', loadError);
      return { sent: 0, status: 'not_configured', reason: loadError };
    }
    let ok = 0;
    try {
      const bearer = await accessToken();
      for (const t of tokens) {
        const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: {
              token: t.token,
              notification: { title: message.title, body: message.body },
              data: { deep_link: message.deepLink || '', type: message.type || 'system' },
              android: {
                priority: 'HIGH',
                notification: { channel_id: 'riderise_default', default_sound: true }
              }
            }
          })
        });
        if (res.ok) ok++;
        else {
          const text = await res.text();
          logRow('push', 'failed', `HTTP ${res.status}: ${text.slice(0, 180)}`);
        }
      }
      logRow('push', 'sent', `${ok}/${tokens.length} delivered to FCM`);
      return { sent: ok, status: 'sent' };
    } catch (err) {
      logRow('push', 'error', err.message);
      return { sent: 0, status: 'error', reason: err.message };
    }
  }

  return { status, send };
}

/* ------------------------------- misc helpers ----------------------------- */
function readSetting(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return row.value;
  }
}

function writeSetting(db, key, value) {
  db.prepare(
    'INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
  ).run(key, JSON.stringify(value), nowIso());
}

module.exports = {
  nowIso,
  touchPresence,
  isOnline,
  presenceSweep,
  nowMs,
  newId,
  parseJson,
  clamp,
  ensureColumn,
  migrate,
  createStreamHub,
  createNotifier,
  createPushSender,
  getNotificationPrefs,
  TYPE_TO_PREF,
  readSetting,
  writeSetting
};
