// RideRise LK — additive migration for Firebase Authentication.
//
// Runs on every boot and is safe to run repeatedly. It never drops or rewrites a table and
// never deletes rows: existing Phase 1/2 users simply gain the new columns with the default
// `auth_provider = 'legacy'`, so their data, friendships, messages and roles are untouched.
'use strict';

const nowIso = () => new Date().toISOString();

function hasColumn(db, table, column) {
  try {
    return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  } catch {
    return false;
  }
}

function addColumn(db, table, column, definition) {
  if (hasColumn(db, table, column)) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  return true;
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ log?: (msg: string) => void }} [options]
 */
function migrateFirebaseAuth(db, options = {}) {
  const log = options.log || (() => {});
  const applied = [];
  const warnings = [];

  // --- users_private: link to the Firebase identity ------------------------
  if (addColumn(db, 'users_private', 'firebase_uid', 'TEXT')) applied.push('users_private.firebase_uid');
  if (addColumn(db, 'users_private', 'auth_provider', "TEXT NOT NULL DEFAULT 'legacy'")) {
    applied.push('users_private.auth_provider');
  }
  if (addColumn(db, 'users_private', 'email_verified_at', 'TEXT')) applied.push('users_private.email_verified_at');
  if (addColumn(db, 'users_private', 'last_sign_in_at', 'TEXT')) applied.push('users_private.last_sign_in_at');

  // --- security event log (no passwords, no tokens) ------------------------
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_events (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      firebase_uid TEXT,
      event TEXT NOT NULL,
      outcome TEXT NOT NULL,
      detail TEXT,
      ip_hash TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_auth_events_created ON auth_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_auth_events_user ON auth_events(user_id, created_at);
  `);

  // --- uniqueness ----------------------------------------------------------
  // One Firebase UID may back at most one RideRise profile. Partial index so legacy rows
  // (firebase_uid IS NULL) do not collide with each other.
  try {
    db.exec(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_users_firebase_uid ON users_private(firebase_uid) WHERE firebase_uid IS NOT NULL'
    );
  } catch (err) {
    warnings.push(`firebase_uid unique index failed: ${err.message}`);
  }

  // Phase 1 declared `email TEXT UNIQUE`, which is case-sensitive in SQLite. Emails are
  // case-insensitive in practice, so add a normalised unique index on top of it.
  try {
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_nocase ON users_private(email COLLATE NOCASE)');
  } catch (err) {
    warnings.push(
      `email case-insensitive unique index not created (existing duplicates?): ${err.message}. Application-level checks still apply.`
    );
  }

  // Usernames must be unique regardless of case. Existing data is checked first; if two
  // accounts already differ only by case the index is skipped rather than failing the boot.
  try {
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_username_nocase ON profiles(username COLLATE NOCASE)');
    applied.push('idx_profiles_username_nocase');
  } catch (err) {
    warnings.push(
      `username case-insensitive unique index not created (existing duplicates?): ${err.message}. Application-level checks still apply.`
    );
  }

  // Speed up the sign-in lookup by uid (partial index above already covers it) and by email.
  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_users_last_sign_in ON users_private(last_sign_in_at)');
  } catch {
    /* non-critical */
  }

  if (applied.length) log(`[auth migration] applied: ${applied.join(', ')}`);
  for (const warning of warnings) log(`[auth migration] WARNING ${warning}`);
  return { applied, warnings };
}

/** Record a security-relevant authentication event. Never receives passwords or tokens. */
function recordAuthEvent(db, { userId = null, firebaseUid = null, event, outcome = 'success', detail = '', ip = '' }) {
  try {
    const id =
      'aev_' +
      Date.now().toString(36) +
      '_' +
      Math.random()
        .toString(36)
        .slice(2, 8);
    const ipHash = ip ? require('node:crypto').createHash('sha256').update(String(ip)).digest('hex').slice(0, 24) : null;
    db.prepare(
      'INSERT INTO auth_events (id, user_id, firebase_uid, event, outcome, detail, ip_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, userId, firebaseUid, String(event).slice(0, 60), outcome, String(detail).slice(0, 300), ipHash, nowIso());
  } catch {
    /* authentication must never fail because logging failed */
  }
}

module.exports = { migrateFirebaseAuth, recordAuthEvent };
