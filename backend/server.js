// RideRise LK by Shaun David Studios — Phase 1 Production Backend Server
// Built on Node.js HTTP + SQLite (node:sqlite) with JWT Auth, RBAC, Rate Limiting & Safety Enforcement

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { DatabaseSync } = require('node:sqlite');

// A hosting panel runs this file directly (`node backend/server.js`), which bypasses the
// `--env-file` flag that `npm start` uses. Load a local .env ourselves so both ways work.
// Variables injected by the panel/container always win: loadEnvFile does not overwrite them.
// Only when this file is the entry point: the test suite imports the server as a module and
// must never pick up a developer's real .env (it would change what the tests assert).
if (require.main === module) {
  for (const envFile of ['.env', path.join(__dirname, '..', '.env'), path.join(__dirname, '.env')]) {
    try {
      process.loadEnvFile(envFile);
    } catch {
      // No .env (normal in production where the panel supplies variables) — carry on.
    }
  }
}

const brandConfig = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'config', 'brand.config.json'), 'utf8')
);
const { calculateBikeBuildRating, recalculateUserRank, awardValidatedXp } = require('./services');
const { seedDatabase, DRAFT_SAFETY_NOTICE_VERBATIM } = require('./seed');
const { createFirebaseAuth, FirebaseAuthError } = require('./firebase_auth');
const { migrateFirebaseAuth, recordAuthEvent } = require('./auth_migrations');

// Pterodactyl/Wings hands the allocation to the container as SERVER_PORT and expects the
// process to listen there. Reading it means a panel deployment works with no extra variable;
// PORT still wins when set explicitly.
const PORT = Number(process.env.PORT || process.env.SERVER_PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'riderise_lk.sqlite');
// Ephemeral or environment-supplied HMAC secret (never hardcoded production secrets in client code)
// Session signing key. There is deliberately no built-in fallback secret: a shipped default
// would let anyone forge an admin token on any deployment that forgot to set one.
function resolveJwtSecret() {
  const configured = process.env.JWT_SECRET || '';
  if (configured.length >= 32) return configured;
  if (process.env.NODE_ENV === 'production') {
    console.error(
      '[RideRise LK] Refusing to start: JWT_SECRET is required in production and must be at least 32 characters.\n' +
        '  Generate one with:  openssl rand -hex 32'
    );
    process.exit(1);
  }
  if (configured) {
    console.warn('[RideRise LK] JWT_SECRET is shorter than 32 characters. Fine for local testing; generate a long one before deploying.');
    return configured;
  }
  console.warn(
    '[RideRise LK] No JWT_SECRET set: using a random key for this process only. Sessions end when the server restarts.\n' +
      '  Set JWT_SECRET (openssl rand -hex 32) to keep sessions across restarts.'
  );
  return crypto.randomBytes(32).toString('hex');
}
const JWT_SECRET = resolveJwtSecret();

// Initialize SQLite database
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schemaSql);

// Idempotent column migrations for databases created by earlier Phase 1 builds
function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
ensureColumn('users_private', 'suspension_until', 'TEXT');
// Firebase Authentication (email/password) columns, indexes and the auth event log.
// Additive only: existing users keep every row and gain auth_provider = 'legacy'.
migrateFirebaseAuth(db, { log: (msg) => console.log(msg) });
seedDatabase(db);

// =============================================================================
// PHASE 2 BOOTSTRAP (additive) — realtime hub, push sender, notifications and
// the Phase 2 router. Applied after the Phase 1 schema/seed so existing users,
// posts, guilds and messages are preserved untouched.
// =============================================================================
global.__rideriseDb = db;
const phase2Core = require('./phase2/core');
const streamHub = phase2Core.createStreamHub();
const pushSender = phase2Core.createPushSender();
const { notify } = phase2Core.createNotifier(db, { stream: streamHub, sendPush: pushSender.send });

function auditAdmin(adminId, action, targetType, targetId, reason, metadata = {}) {
  db.prepare(
    `INSERT INTO admin_action_log (id, admin_id, action, target_type, target_id, reason, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(phase2Core.newId('aal'), adminId, action, targetType || '', targetId || '', String(reason || '').slice(0, 1000), JSON.stringify(metadata), new Date().toISOString());
}

setInterval(() => {
  streamHub.sweep();
  phase2Core.presenceSweep();
}, 60_000).unref();

const phase2 = require('./phase2').createRouter({
  db,
  brandConfig,
  sendJson,
  readJsonBody,
  getAuthUser,
  checkRateLimit,
  stream: streamHub,
  notifier: { notify, stream: streamHub },
  signToken,
  auditAdmin,
  pushSender,
  formatPublicProfile
});

// ---------------------------------------------------------------------------
// Sign-in path
//
// There is exactly one: Firebase email + password. Google Sign-In was removed, and
// there is no demo/sandbox bridge — a session can only be minted for an identity
// whose Firebase ID token passed signature, issuer, audience and expiry checks.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Firebase Authentication (email + password). The verifier proves Firebase ID
// tokens with Google's published certificates; it fails closed when the project
// is not configured, so authentication can never "appear" to work.
// ---------------------------------------------------------------------------
const firebaseAuth = createFirebaseAuth();
// Server-side verification only needs the project id; the API key is what the browser SDK
// needs. Both are covered by the setup guide.
const ALLOW_FIREBASE_SIGNIN = Boolean(firebaseAuth.projectId);
if (firebaseAuth.configured) {
  console.log(`[RideRise LK] Firebase Auth configured for project "${firebaseAuth.projectId}" (email/password).`);
} else {
  console.log(
    '[RideRise LK] Firebase Auth is NOT configured — email/password sign-up and sign-in are disabled ' +
      'until FIREBASE_PROJECT_ID and FIREBASE_API_KEY are set (docs/FIREBASE_AUTH.md).'
  );
}

// Reachability of Google's secure-token certificate endpoint, as observed from this host.
// 'unknown' until the first probe/verification; surfaced by /api/health so an operator can
// tell a blocked egress route apart from a credential problem.
let firebaseVerifierState = { status: firebaseAuth.projectId ? 'unknown' : 'not-configured', checkedAt: null };
function markVerifierReachable(reachable, detail) {
  firebaseVerifierState = {
    status: reachable ? 'ok' : 'unreachable',
    detail: detail || null,
    checkedAt: new Date().toISOString()
  };
}
let verifierProbedAt = 0;
async function refreshVerifierState(force = false) {
  if (!firebaseAuth.projectId) return firebaseVerifierState;
  if (!force && Date.now() - verifierProbedAt < 60000) return firebaseVerifierState;
  verifierProbedAt = Date.now();
  try {
    const probe = await firebaseAuth.probeCertificates();
    markVerifierReachable(probe.reachable, probe.error || null);
  } catch (err) {
    markVerifierReachable(false, err.code || 'CERT_FETCH_FAILED');
  }
  return firebaseVerifierState;
}
if (firebaseAuth.projectId) {
  refreshVerifierState(true).catch(() => {});
}

// No demo or sandbox session exists: every token comes from a verified Firebase ID token.

// In-memory sliding window rate limiter
const rateBuckets = new Map();
function checkRateLimit(key, maxCount, windowSec = 60) {
  const now = Date.now();
  const windowMs = windowSec * 1000;
  const timestamps = (rateBuckets.get(key) || []).filter((t) => now - t < windowMs);
  if (timestamps.length >= maxCount) {
    return false;
  }
  timestamps.push(now);
  rateBuckets.set(key, timestamps);
  return true;
}

// Lightweight JWT signing and verification using HMAC-SHA256
function signToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(
    JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 86400 * 7 })
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  if (sig !== expectedSig) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function getAuthUser(req) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  if (!token) return null;
  const decoded = verifyToken(token);
  if (!decoded || !decoded.userId) return null;
  const user = db
    .prepare(
      `SELECT u.id, u.email, u.is_minor, u.age_confirmed, u.onboarding_completed,
              u.terms_accepted_version, u.role, u.account_status, u.suspension_reason, u.suspension_until,
              u.firebase_uid, u.auth_provider, u.email_verified_at,
              p.username, p.display_name, p.bio, p.avatar_url, p.district, p.preferred_riding_area,
              p.primary_bike_id, p.xp, p.rank_id, p.profile_visibility, p.hide_from_leaderboards,
              p.allow_friend_requests, p.allow_messages_from, p.notifications_enabled,
              p.reduced_motion, p.locale
       FROM users_private u
       LEFT JOIN profiles p ON p.user_id = u.id
       WHERE u.id = ?`
    )
    .get(decoded.userId);
  if (!user || user.account_status === 'deleted') return null;
  // Defence in depth: a Firebase account must have a verified email before its session can
  // reach protected endpoints, even if a token was issued before the address was confirmed.
  if (user.firebase_uid && !user.email_verified_at) return null;
  // Phase 2: suspension applies to existing tokens immediately, not only at sign-in.
  if (user.account_status === 'suspended') {
    const until = user.suspension_until ? new Date(user.suspension_until).getTime() : null;
    if (!until || until > Date.now()) return null;
  }
  try {
    phase2Core.touchPresence(user.id);
  } catch {
    /* presence is best-effort */
  }
  // Temporary suspensions expire automatically
  if (user.account_status === 'suspended' && user.suspension_until) {
    if (new Date(user.suspension_until).getTime() <= Date.now()) {
      db.prepare("UPDATE users_private SET account_status = 'active', suspension_reason = NULL, suspension_until = NULL WHERE id = ?").run(user.id);
      user.account_status = 'active';
      user.suspension_reason = null;
    }
  }
  return user;
}

/* ===========================================================================
   Firebase authentication helpers
   =========================================================================== */

const USERNAME_PATTERN = /^[a-z0-9_]{3,24}$/;
const RESERVED_USERNAMES = new Set([
  'admin',
  'administrator',
  'moderator',
  'moderators',
  'support',
  'safety',
  'staff',
  'official',
  'studio',
  'shaundavidstudios',
  'shaundavid',
  'riderise',
  'rideriselk',
  'riderise_lk',
  'system',
  'root',
  'help',
  'owner',
  'guild',
  'news'
]);

/**
 * Resolve the caller's address for rate limiting and audit logs.
 *
 * `X-Forwarded-For` is only trusted when it comes from a loopback/private peer (a reverse
 * proxy on the same host or VPC) or when TRUST_PROXY is set explicitly. Trusting it
 * unconditionally would let any direct client spoof a fresh IP per request and walk straight
 * past the sign-in and username rate limits.
 */
const TRUST_PROXY = String(process.env.TRUST_PROXY || '').trim();
function isPrivatePeer(address) {
  let addr = String(address || '');
  // Normalise IPv4-mapped IPv6 (::ffff:10.0.0.5) before checking the ranges.
  if (addr.startsWith('::ffff:')) addr = addr.slice(7);
  return (
    addr === '::1' ||
    addr === '127.0.0.1' ||
    addr.startsWith('127.') ||
    addr.startsWith('10.') ||
    addr.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(addr)
  );
}
function clientIp(req) {
  const peer = (req.socket && req.socket.remoteAddress) || 'unknown';
  const forwarded = String(req.headers['x-forwarded-for'] || '')
    .split(',')[0]
    .trim();
  if (!forwarded) return peer;
  const trusted = TRUST_PROXY === '1' ? true : TRUST_PROXY === '0' ? false : isPrivatePeer(peer);
  return trusted ? forwarded : peer;
}

/** Usernames are stored lowercase; validation is identical for the API and the UI. */
function validateUsername(raw) {
  const username = String(raw || '').trim().toLowerCase();
  if (!username) {
    return { ok: false, reason: 'USERNAME_REQUIRED', message: 'Choose a username for your rider profile.' };
  }
  if (!USERNAME_PATTERN.test(username)) {
    return {
      ok: false,
      reason: 'INVALID_USERNAME',
      message: 'Usernames are 3–24 characters using lowercase letters, numbers or underscores.'
    };
  }
  if (RESERVED_USERNAMES.has(username)) {
    return { ok: false, reason: 'USERNAME_RESERVED', message: 'That username is reserved for studio staff. Choose another.' };
  }
  return { ok: true, username };
}

function usernameTaken(username, exceptUserId = null) {
  const row = exceptUserId
    ? db.prepare('SELECT 1 FROM profiles WHERE username = ? COLLATE NOCASE AND user_id != ?').get(username, exceptUserId)
    : db.prepare('SELECT 1 FROM profiles WHERE username = ? COLLATE NOCASE').get(username);
  return Boolean(row);
}

function usernameSuggestions(base, count = 3) {
  const suggestions = [];
  const suffixes = ['_lk', '_bmx', '_ride', '01', '02', '03'];
  for (const suffix of suffixes) {
    const candidate = `${String(base).slice(0, 24 - suffix.length)}${suffix}`;
    if (!USERNAME_PATTERN.test(candidate)) continue;
    if (!usernameTaken(candidate) && !suggestions.includes(candidate)) suggestions.push(candidate);
    if (suggestions.length >= count) break;
  }
  return suggestions;
}

/**
 * Create the SQLite profile that belongs to a verified Firebase identity.
 * Runs in a transaction so a partial failure leaves nothing behind and the client can retry
 * with the same Firebase account without ever producing a duplicate profile.
 */
function createProfileForFirebaseIdentity(identity, username, displayNameInput) {
  const now = new Date().toISOString();
  const userId = 'usr_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex');
  const displayName = String(displayNameInput || username).trim().slice(0, 50) || username;
  const verifiedAt = identity.emailVerified ? now : null;

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `INSERT INTO users_private (
         id, google_sub, email, firebase_uid, auth_provider, email_verified_at, last_sign_in_at,
         is_minor, age_confirmed, onboarding_completed, role, account_status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'firebase', ?, ?, 0, 0, 0, 'rider', 'active', ?, ?)`
    ).run(userId, `firebase:${identity.uid}`, identity.email, identity.uid, verifiedAt, now, now, now);

    db.prepare(
      `INSERT INTO profiles (
         user_id, username, display_name, bio, avatar_url, district, preferred_riding_area,
         xp, rank_id, profile_visibility, hide_from_leaderboards, allow_friend_requests,
         allow_messages_from, notifications_enabled, reduced_motion, locale, created_at, updated_at
       ) VALUES (?, ?, ?, '', '/assets/brand/riderise_logo.png', 'Colombo', '', 0, 'rank_1', 'public', 0, 1, 'friends_only', 1, 0, 'en', ?, ?)`
    ).run(userId, username, displayName, now, now);

    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* already rolled back */
    }
    throw err;
  }
  return db.prepare('SELECT * FROM users_private WHERE id = ?').get(userId);
}

/**
 * Single entry point for ID-token verification: keeps the health endpoint's view of Google
 * reachability in sync with what actually happened, so an operator can see a blocked egress
 * route instead of a wall of 401s.
 */
async function verifyFirebaseToken(idToken) {
  try {
    const identity = await firebaseAuth.verifyIdToken(idToken);
    if (firebaseVerifierState.status !== 'ok') markVerifierReachable(true);
    return identity;
  } catch (err) {
    if (err && (err.code === 'CERT_FETCH_FAILED' || err.code === 'CERT_INVALID')) {
      markVerifierReachable(false, err.code);
    }
    throw err;
  }
}

function sendFirebaseAuthError(res, err) {
  const code = err && err.code ? err.code : 'AUTH_TOKEN_INVALID';
  if (code === 'FIREBASE_NOT_CONFIGURED') {
    return sendJson(res, 503, {
      error: 'FIREBASE_NOT_CONFIGURED',
      message: err.message,
      docs: 'docs/FIREBASE_AUTH.md'
    });
  }
  if (code === 'CERT_FETCH_FAILED' || code === 'CERT_INVALID') {
    markVerifierReachable(false, code);
    return sendJson(res, 503, {
      error: 'AUTH_UNAVAILABLE',
      verifier_unreachable: true,
      retryable: true,
      message:
        'This server could not reach Google to verify the Firebase session. That is a server network/egress problem (firewall, proxy or an offline host), not a problem with your email or password. Your Firebase account may already exist — retry once the server can reach Google, or sign in from a deployment that can.',
      docs: 'docs/FIREBASE_AUTH.md#troubleshooting'
    });
  }
  if (code === 'TOKEN_EXPIRED') {
    return sendJson(res, 401, {
      error: 'AUTH_TOKEN_EXPIRED',
      reauthenticate: true,
      message: 'Your sign-in session has expired. Sign in again to continue.'
    });
  }
  return sendJson(res, 401, {
    error: code.startsWith('TOKEN') ? 'AUTH_TOKEN_INVALID' : code,
    detail: code,
    message: 'Your sign-in could not be verified. Sign in again.'
  });
}

/**
 * Turn a verified Firebase identity into a RideRise session.
 * Email verification is enforced here, not by the client.
 */
function respondWithFirebaseSession(res, { userRow, identity, ip, event, newAccount = false }) {
  const now = new Date().toISOString();
  let user = db.prepare('SELECT * FROM users_private WHERE id = ?').get(userRow.id);

  if (!user || user.account_status === 'deleted') {
    recordAuthEvent(db, { firebaseUid: identity.uid, event, outcome: 'failure', detail: 'deleted account', ip });
    return sendJson(res, 410, {
      error: 'ACCOUNT_DELETED',
      message: 'This account has been deleted. Contact support@shaundavidstudios.lk if you believe this is a mistake.'
    });
  }

  if (user.account_status === 'suspended') {
    const expired = user.suspension_until && new Date(user.suspension_until).getTime() <= Date.now();
    if (!expired) {
      const until = user.suspension_until ? ` Suspension ends ${new Date(user.suspension_until).toUTCString()}.` : '';
      recordAuthEvent(db, { userId: user.id, firebaseUid: identity.uid, event, outcome: 'failure', detail: 'suspended', ip });
      return sendJson(res, 403, {
        error: 'ACCOUNT_SUSPENDED',
        message: `This account is currently suspended: ${user.suspension_reason || 'Community Guidelines violation'}.${until} You can appeal from the Safety Centre.`
      });
    }
    db.prepare("UPDATE users_private SET account_status = 'active', suspension_reason = NULL, suspension_until = NULL WHERE id = ?").run(user.id);
    user = db.prepare('SELECT * FROM users_private WHERE id = ?').get(user.id);
  }

  // The single gate that keeps unverified accounts out of community features.
  if (!identity.emailVerified) {
    recordAuthEvent(db, { userId: user.id, firebaseUid: identity.uid, event, outcome: 'blocked_unverified', ip });
    return sendJson(res, 403, {
      error: 'EMAIL_NOT_VERIFIED',
      email: identity.email,
      emailVerified: false,
      canResendEmail: true,
      profile_ready: true,
      message:
        'Your RideRise LK profile exists, but your email address is not verified yet. Open the verification link we emailed you, then continue.'
    });
  }

  db.prepare(
    'UPDATE users_private SET email_verified_at = COALESCE(email_verified_at, ?), last_sign_in_at = ?, updated_at = ? WHERE id = ?'
  ).run(now, now, now, user.id);
  user = db.prepare('SELECT * FROM users_private WHERE id = ?').get(user.id);

  const token = signToken({ userId: user.id, role: user.role, provider: 'firebase' });
  const summary = db.prepare('SELECT username, display_name FROM profiles WHERE user_id = ?').get(user.id);
  recordAuthEvent(db, { userId: user.id, firebaseUid: identity.uid, event, outcome: 'success', ip });

  return sendJson(res, 200, {
    token,
    authProvider: 'firebase',
    emailVerified: true,
    newAccount: Boolean(newAccount),
    onboardingRequired: !user.onboarding_completed,
    account: {
      id: user.id,
      email: user.email,
      role: user.role,
      auth_provider: 'firebase',
      email_verified: true,
      is_minor: Boolean(user.is_minor),
      age_confirmed: Boolean(user.age_confirmed),
      onboarding_completed: Boolean(user.onboarding_completed),
      terms_accepted_version: user.terms_accepted_version
    },
    profile: user.onboarding_completed ? formatPublicProfile(user.id, user.id) : null,
    profileSummary: summary ? { username: summary.username, display_name: summary.display_name } : null
  });
}

function isBlockedEitherWay(userA, userB) {
  if (!userA || !userB) return false;
  const row = db
    .prepare(
      'SELECT 1 FROM user_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)'
    )
    .get(userA, userB, userB, userA);
  return !!row;
}

function areAcceptedFriends(userA, userB) {
  if (!userA || !userB) return false;
  const row = db
    .prepare(
      `SELECT 1 FROM friendships
       WHERE status = 'accepted'
         AND ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?))`
    )
    .get(userA, userB, userB, userA);
  return !!row;
}

function formatPublicProfile(userId, viewerId = null) {
  const row = db
    .prepare(
      `SELECT p.user_id, p.username, p.display_name, p.bio, p.avatar_url, p.district,
              p.preferred_riding_area, p.primary_bike_id, p.xp, p.rank_id,
              p.profile_visibility, p.hide_from_leaderboards, p.allow_friend_requests,
              p.created_at,
              r.name as rank_name, r.level_order as rank_level, r.color_hex as rank_color, r.badge_icon as rank_icon,
              u.role, u.is_minor
       FROM profiles p
       JOIN users_private u ON u.id = p.user_id
       JOIN ranks r ON r.id = p.rank_id
       WHERE p.user_id = ? AND u.account_status != 'deleted'`
    )
    .get(userId);

  if (!row) return null;
  if (viewerId && isBlockedEitherWay(viewerId, userId)) {
    return null;
  }

  const isSelf = viewerId === userId;
  const isFriend = viewerId ? areAcceptedFriends(viewerId, userId) : false;

  // Enforce profile visibility settings (especially for 16-17 minors or private profiles)
  if (!isSelf) {
    if (row.profile_visibility === 'private') {
      return {
        user_id: row.user_id,
        username: row.username,
        display_name: row.display_name,
        avatar_url: row.avatar_url,
        district: row.district,
        rank_name: row.rank_name,
        rank_level: row.rank_level,
        rank_color: row.rank_color,
        profile_visibility: 'private',
        restricted_view: true,
        message: 'This rider has set their profile to Private.'
      };
    }
    if (row.profile_visibility === 'friends' && !isFriend) {
      return {
        user_id: row.user_id,
        username: row.username,
        display_name: row.display_name,
        avatar_url: row.avatar_url,
        district: row.district,
        rank_name: row.rank_name,
        rank_level: row.rank_level,
        rank_color: row.rank_color,
        profile_visibility: 'friends',
        restricted_view: true,
        allow_friend_requests: row.allow_friend_requests,
        message: 'This rider shares full profile details with accepted friends only.'
      };
    }
  }

  const achievements = db
    .prepare(
      `SELECT a.id, a.code, a.title, a.description, a.icon, a.category, ua.awarded_at
       FROM user_achievements ua
       JOIN achievements a ON a.id = ua.achievement_id
       WHERE ua.user_id = ?
       ORDER BY ua.awarded_at DESC`
    )
    .all(userId);

  const bicycles = db
    .prepare('SELECT * FROM bicycles WHERE user_id = ? ORDER BY is_primary DESC, created_at DESC')
    .all(userId)
    .map((b) => ({
      ...b,
      safety_defects: JSON.parse(b.safety_defects_json || '[]'),
      photos: JSON.parse(b.photos_json || '{}'),
      score_breakdown: JSON.parse(b.score_breakdown_json || '{}')
    }));

  const completedModulesCount = db
    .prepare("SELECT COUNT(*) as c FROM user_stunt_progress WHERE user_id = ? AND status = 'completed'")
    .get(userId).c;

  const postsCount = db
    .prepare("SELECT COUNT(*) as c FROM posts WHERE user_id = ? AND moderation_status = 'visible'")
    .get(userId).c;

  const ranks = db.prepare('SELECT * FROM ranks ORDER BY min_xp ASC').all();
  const nextRank = ranks.find((r) => r.min_xp > row.xp) || null;

  // Mutual friends (privacy-aware: only counts/names of accepted friendships the viewer shares)
  let mutualFriends = { count: 0, names: [] };
  if (viewerId && viewerId !== userId) {
    const mine = db
      .prepare(
        `SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END AS friend_id
         FROM friendships WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)`
      )
      .all(viewerId, viewerId, viewerId)
      .map((r) => r.friend_id);
    const theirs = db
      .prepare(
        `SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END AS friend_id
         FROM friendships WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)`
      )
      .all(userId, userId, userId)
      .map((r) => r.friend_id);
    const shared = mine.filter((id) => theirs.includes(id));
    mutualFriends = {
      count: shared.length,
      names: shared
        .slice(0, 3)
        .map((id) => db.prepare('SELECT username FROM profiles WHERE user_id = ?').get(id))
        .filter(Boolean)
        .map((r) => r.username)
    };
  }

  // Notice: email, dob_private, google_sub, login tokens are NEVER included here!
  return {
    user_id: row.user_id,
    username: row.username,
    display_name: row.display_name,
    bio: row.bio,
    avatar_url: row.avatar_url,
    district: row.district,
    preferred_riding_area: row.preferred_riding_area,
    primary_bike_id: row.primary_bike_id,
    xp: row.xp,
    rank_id: row.rank_id,
    rank_name: row.rank_name,
    rank_level: row.rank_level,
    rank_color: row.rank_color,
    rank_icon: row.rank_icon,
    next_rank: nextRank,
    role: row.role,
    profile_visibility: row.profile_visibility,
    hide_from_leaderboards: Boolean(row.hide_from_leaderboards),
    allow_friend_requests: Boolean(row.allow_friend_requests),
    achievements,
    bicycles,
    primary_bike: bicycles.find((b) => b.is_primary) || bicycles[0] || null,
    completed_modules_count: completedModulesCount,
    posts_count: postsCount,
    is_friend: isFriend,
    mutual_friends: mutualFriends,
    restricted_view: false
  };
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

function readJsonBody(req, maxBytes = 9 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        tooLarge = true;
        // Drain the request so the client receives a clean 413 instead of a reset socket.
        if (total > maxBytes * 3) {
          reject(new Error('PAYLOAD_TOO_LARGE'));
          req.destroy();
        }
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) return reject(new Error('PAYLOAD_TOO_LARGE'));
      if (total === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject(new Error('INVALID_JSON'));
      }
    });
    req.on('error', reject);
  });
}

function calculateAgeFromDob(dobStr) {
  if (!dobStr) return null;
  const dob = new Date(dobStr);
  if (Number.isNaN(dob.getTime())) return null;
  const today = new Date('2026-10-25T00:00:00Z');
  let age = today.getUTCFullYear() - dob.getUTCFullYear();
  const m = today.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && today.getUTCDate() < dob.getUTCDate())) {
    age--;
  }
  return age;
}

const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.json', '.svg', '.txt', '.md']);
const gzipCache = new Map();

/**
 * Serve a static file with ETag revalidation, a short cache lifetime and gzip for text
 * assets. The APK never ships a CDN, so compressing here keeps weak-connection loads small.
 */
function sendStaticFile(req, res, filePath, { cacheSeconds = 300, download = false } = {}) {
  const stat = fs.statSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  const headers = {
    'Content-Type': MIME_TYPES[ext] || 'text/plain; charset=utf-8',
    'Cache-Control': cacheSeconds > 0 ? `public, max-age=${cacheSeconds}` : 'no-cache',
    ETag: etag,
    Vary: 'Accept-Encoding'
  };
  if (download) {
    headers['Content-Disposition'] = `attachment; filename="${path.basename(filePath)}"`;
    headers['Content-Length'] = stat.size;
  }
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    return res.end();
  }
  const acceptsGzip = String(req.headers['accept-encoding'] || '').includes('gzip');
  if (acceptsGzip && COMPRESSIBLE.has(ext) && stat.size > 1024 && stat.size < 4 * 1024 * 1024) {
    const key = `${filePath}:${stat.size}:${Math.floor(stat.mtimeMs)}`;
    let compressed = gzipCache.get(key);
    if (!compressed) {
      compressed = zlib.gzipSync(fs.readFileSync(filePath), { level: 6 });
      if (gzipCache.size > 60) gzipCache.clear();
      gzipCache.set(key, compressed);
    }
    headers['Content-Encoding'] = 'gzip';
    headers['Content-Length'] = compressed.length;
    res.writeHead(200, headers);
    return res.end(compressed);
  }
  res.writeHead(200, headers);
  return fs.createReadStream(filePath).pipe(res);
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.apk': 'application/vnd.android.package-archive'
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    return res.end();
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  try {
    // Phase 2 routes are mounted first: they add new paths and must take
    // precedence over the Phase 1 catch-alls for /api/guilds/* and /api/admin/*.
    if (await phase2(req, res, pathname, parsedUrl)) return;

    // =========================================================================
    // PUBLIC CONFIG & HEALTH
    // =========================================================================
    if (pathname === '/api/health' && req.method === 'GET') {
      return sendJson(res, 200, {
        status: 'ok',
        app: brandConfig.appName,
        studio: brandConfig.studioName,
        packageId: brandConfig.packageId,
        phase: 2,
        capabilities: {
          guildLiveMap: true,
          guildVoice: true,
          walkieTalkie: true,
          firebaseAuth: firebaseAuth.configured,
          firebaseVerifier: firebaseVerifierState.status,
          emailPasswordSignIn: firebaseAuth.configured,
          push: pushSender.status().configured,
          turnRelay: Boolean(process.env.TURN_URLS || process.env.TURN_URL)
        },
        timestamp: new Date().toISOString()
      });
    }

    if (pathname === '/api/config' && req.method === 'GET') {
      const legalDocs = db.prepare('SELECT slug, title, version, content_markdown, updated_at FROM legal_documents').all();
      const ranks = db.prepare('SELECT * FROM ranks ORDER BY level_order ASC').all();
      return sendJson(res, 200, {
        brand: brandConfig,
        ranks,
        legalDocuments: legalDocs,
        draftSafetyNotice: DRAFT_SAFETY_NOTICE_VERBATIM,
        // Firebase web config (public identifiers only). No secrets.
        // `verifier` carries the cached reachability of Google's certificate endpoint so the
        // welcome screen can explain a blocked server-side egress route instead of failing
        // later as if the password were wrong.
        firebase: { ...firebaseAuth.webConfig(), verifier: firebaseVerifierState },
        capabilities: {
          emailPasswordSignIn: firebaseAuth.configured,
          push: pushSender.status().configured,
          turnRelay: Boolean(process.env.TURN_URLS || process.env.TURN_URL),
          mapProvider: process.env.MAP_PROVIDER || 'openstreetmap'
        }
      });
    }

    // =========================================================================
    // SECTION 3: AUTHENTICATION, ONBOARDING & ACCOUNT LIFECYCLE
    // =========================================================================
    // =========================================================================
    // FIREBASE AUTHENTICATION (email + password)
    //
    // The browser signs up / signs in with the Firebase client SDK, then exchanges the
    // resulting ID token here. Nothing from the request body is trusted except the username
    // the rider chooses; role, verification state and identity all come from the verified
    // token and the database.
    // =========================================================================
    if (pathname === '/api/auth/firebase/config' && req.method === 'GET') {
      const webConfig = firebaseAuth.webConfig();
      // Tell the client whether THIS server can currently reach Google's certificate endpoint.
      // A blocked egress route must not look like a wrong password.
      const verifier = await refreshVerifierState(false);
      return sendJson(res, 200, {
        ...webConfig,
        verifier: {
          status: verifier.status,
          checkedAt: verifier.checkedAt,
          detail: verifier.detail || null
        }
      });
    }

    if (pathname === '/api/auth/username-available' && req.method === 'GET') {
      const ip = clientIp(req);
      if (!checkRateLimit(`uname:${ip}`, 60, 60)) {
        return sendJson(res, 429, {
          error: 'RATE_LIMITED',
          message: 'Too many username checks. Wait a moment and try again.'
        });
      }
      const raw = (parsedUrl.searchParams.get('username') || '').trim();
      const check = validateUsername(raw);
      if (!check.ok) {
        return sendJson(res, 200, { available: false, username: raw.toLowerCase(), reason: check.reason, message: check.message });
      }
      const taken = usernameTaken(check.username);
      return sendJson(res, 200, {
        available: !taken,
        username: check.username,
        reason: taken ? 'USERNAME_TAKEN' : null,
        message: taken ? `@${check.username} is already taken. Try another handle.` : `@${check.username} is available.`,
        suggestions: taken ? usernameSuggestions(check.username) : []
      });
    }

    if (pathname === '/api/auth/firebase/session' && req.method === 'POST') {
      if (!ALLOW_FIREBASE_SIGNIN) {
        return sendJson(res, 503, {
          error: 'FIREBASE_NOT_CONFIGURED',
          message:
            'Email/password sign-in is not configured on this server yet. An administrator must set FIREBASE_PROJECT_ID and FIREBASE_API_KEY — see docs/FIREBASE_AUTH.md.'
        });
      }
      const ip = clientIp(req);
      if (!checkRateLimit(`fbsession:ip:${ip}`, 20, 300)) {
        return sendJson(res, 429, { error: 'RATE_LIMITED', message: 'Too many sign-in attempts. Wait a few minutes and try again.' });
      }
      const body = await readJsonBody(req);
      let identity;
      try {
        identity = await verifyFirebaseToken(body.idToken);
      } catch (err) {
        recordAuthEvent(db, { event: 'firebase_session', outcome: 'failure', detail: err.code || err.message, ip });
        return sendFirebaseAuthError(res, err);
      }
      if (!checkRateLimit(`fbsession:uid:${identity.uid}`, 30, 300)) {
        return sendJson(res, 429, { error: 'RATE_LIMITED', message: 'Too many sign-in attempts for this account. Wait a few minutes.' });
      }

      const existing = db.prepare('SELECT * FROM users_private WHERE firebase_uid = ?').get(identity.uid);
      if (!existing) {
        recordAuthEvent(db, { firebaseUid: identity.uid, event: 'firebase_login_no_profile', outcome: 'failure', ip });
        return sendJson(res, 409, {
          error: 'PROFILE_REQUIRED',
          signup_required: true,
          email: identity.email,
          emailVerified: identity.emailVerified,
          message:
            'Your Firebase account exists but has no RideRise LK profile yet. Finish creating your profile to continue.'
        });
      }
      return respondWithFirebaseSession(res, { userRow: existing, identity, ip, event: 'firebase_login' });
    }

    if (pathname === '/api/auth/firebase/signup' && req.method === 'POST') {
      if (!ALLOW_FIREBASE_SIGNIN) {
        return sendJson(res, 503, {
          error: 'FIREBASE_NOT_CONFIGURED',
          message:
            'Account creation is not configured on this server yet. An administrator must set FIREBASE_PROJECT_ID and FIREBASE_API_KEY — see docs/FIREBASE_AUTH.md.'
        });
      }
      const ip = clientIp(req);
      if (!checkRateLimit(`fbsignup:${ip}`, 10, 3600)) {
        return sendJson(res, 429, { error: 'RATE_LIMITED', message: 'Too many sign-up attempts from this network. Try again later.' });
      }
      const body = await readJsonBody(req);
      let identity;
      try {
        identity = await verifyFirebaseToken(body.idToken);
      } catch (err) {
        recordAuthEvent(db, { event: 'firebase_signup', outcome: 'failure', detail: err.code || err.message, ip });
        return sendFirebaseAuthError(res, err);
      }

      // Idempotent: a retry after a partial failure must never create a second profile.
      let userRow = db.prepare('SELECT * FROM users_private WHERE firebase_uid = ?').get(identity.uid);

      if (!userRow) {
        const check = validateUsername(body.username);
        if (!check.ok) return sendJson(res, 400, { error: check.reason, message: check.message });
        if (usernameTaken(check.username)) {
          return sendJson(res, 409, {
            error: 'USERNAME_TAKEN',
            username: check.username,
            suggestions: usernameSuggestions(check.username),
            message: `@${check.username} is already taken. Choose another handle and try again.`
          });
        }
        const linkedEmail = db.prepare('SELECT id, firebase_uid, auth_provider FROM users_private WHERE lower(email) = ?').get(identity.email);
        if (linkedEmail && !linkedEmail.firebase_uid) {
          // Never merge on a matching email alone: that would hand one account's data to
          // whoever can register that address elsewhere.
          return sendJson(res, 409, {
            error: 'ACCOUNT_LINK_REQUIRED',
            link_required: true,
            message:
              'An existing RideRise LK profile already uses this email address. Sign in to that profile and link your Firebase account from Settings → Sign-in & security. Accounts are never merged automatically.'
          });
        }
        try {
          userRow = createProfileForFirebaseIdentity(identity, check.username, body.displayName);
          recordAuthEvent(db, {
            userId: userRow.id,
            firebaseUid: identity.uid,
            event: 'firebase_signup',
            outcome: 'success',
            detail: identity.emailVerified ? 'email verified at creation' : 'verification email pending',
            ip
          });
        } catch (err) {
          if (String(err.message || '').includes('UNIQUE')) {
            const nowTaken = usernameTaken(check.username);
            recordAuthEvent(db, { firebaseUid: identity.uid, event: 'firebase_signup', outcome: 'failure', detail: 'unique constraint', ip });
            return sendJson(res, 409, {
              error: nowTaken ? 'USERNAME_TAKEN' : 'PROFILE_CONFLICT',
              message: 'That profile could not be created because the details collide with an existing account. Sign in again to retry.',
              retryable: true
            });
          }
          console.error('[RideRise LK] Firebase profile creation failed:', err.message);
          recordAuthEvent(db, { firebaseUid: identity.uid, event: 'firebase_signup', outcome: 'failure', detail: err.message, ip });
          return sendJson(res, 500, {
            error: 'PROFILE_CREATE_FAILED',
            retryable: true,
            message:
              'Your Firebase account was created, but the RideRise LK profile could not be saved. Nothing was duplicated — sign in again to finish setting up your profile.'
          });
        }
      }

      return respondWithFirebaseSession(res, { userRow, identity, ip, event: 'firebase_signup_session', newAccount: true });
    }

    if (pathname === '/api/auth/firebase/status' && req.method === 'GET') {
      const user = getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'UNAUTHENTICATED' });
      return sendJson(res, 200, {
        firebase_available: ALLOW_FIREBASE_SIGNIN,
        linked: Boolean(user.firebase_uid),
        provider: user.auth_provider || 'legacy',
        email: user.firebase_uid ? user.email : null,
        email_verified: Boolean(user.email_verified_at),
        message: user.firebase_uid
          ? 'This profile signs in with Firebase email/password.'
          : 'This profile has no sign-in account. Only accounts created with Firebase email/password can sign in.'
      });
    }

    if (pathname === '/api/auth/firebase/logout' && req.method === 'POST') {
      const user = getAuthUser(req);
      recordAuthEvent(db, { userId: user ? user.id : null, event: 'signout', outcome: 'success', ip: clientIp(req) });
      return sendJson(res, 200, {
        message: 'Signed out. Session tokens are held by the client and were discarded; the Firebase SDK session was cleared too.'
      });
    }

    if (pathname === '/api/auth/session' && req.method === 'GET') {
      const user = getAuthUser(req);
      if (!user) {
        const authHeader = req.headers['authorization'] || '';
        const rawToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
        const decoded = rawToken ? verifyToken(rawToken) : null;
        const maybe = decoded && decoded.userId ? db.prepare('SELECT account_status, suspension_reason, suspension_until FROM users_private WHERE id = ?').get(decoded.userId) : null;
        if (maybe && maybe.account_status === 'suspended') {
          const until = maybe.suspension_until ? ` Suspension ends ${new Date(maybe.suspension_until).toUTCString()}.` : '';
          return sendJson(res, 403, {
            error: 'ACCOUNT_SUSPENDED',
            message: `This account is suspended: ${maybe.suspension_reason || 'Community guidelines violation'}.${until} You can appeal from the Safety Centre.`
          });
        }
        return sendJson(res, 401, { error: 'UNAUTHENTICATED', message: 'No active session.' });
      }
      const profile = user.onboarding_completed ? formatPublicProfile(user.id, user.id) : null;
      const unreadNotifications = db
        .prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0')
        .get(user.id).c;
      const unreadMessages = db
        .prepare(
          `SELECT COUNT(*) as c FROM messages m
           JOIN conversations c ON c.id = m.conversation_id
           WHERE (c.user_a_id = ? OR c.user_b_id = ?)
             AND m.sender_id != ?
             AND m.delivery_status != 'read'`
        )
        .get(user.id, user.id, user.id).c;

      return sendJson(res, 200, {
        onboardingRequired: !user.onboarding_completed,
        account: {
          id: user.id,
          email: user.email,
          role: user.role,
          is_minor: Boolean(user.is_minor),
          age_confirmed: Boolean(user.age_confirmed),
          onboarding_completed: Boolean(user.onboarding_completed),
          terms_accepted_version: user.terms_accepted_version,
          notifications_enabled: Boolean(user.notifications_enabled),
          reduced_motion: Boolean(user.reduced_motion),
          locale: user.locale || 'en',
          profile_visibility: user.profile_visibility || 'public',
          hide_from_leaderboards: Boolean(user.hide_from_leaderboards),
          allow_friend_requests: Boolean(user.allow_friend_requests),
          allow_messages_from: user.allow_messages_from || 'friends_only'
        },
        profile,
        unreadNotifications,
        unreadMessages
      });
    }

    if (pathname === '/api/auth/onboarding' && req.method === 'POST') {
      const user = getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'UNAUTHENTICATED' });

      const body = await readJsonBody(req);
      if (!body.confirmAge16Plus) {
        return sendJson(res, 400, {
          error: 'AGE_ELIGIBILITY_REQUIRED',
          message: 'RideRise LK is designed for riders aged 16 and above. You must confirm you are at least 16 years old.'
        });
      }

      let isMinor = 0;
      let cleanDob = null;
      if (body.dob) {
        const age = calculateAgeFromDob(body.dob);
        if (age === null) {
          return sendJson(res, 400, { error: 'INVALID_DOB', message: 'Please provide a valid date of birth.' });
        }
        if (age < 16) {
          return sendJson(res, 403, {
            error: 'UNDER_MINIMUM_AGE',
            message: 'Sorry, you must be at least 16 years old to create a RideRise LK account.'
          });
        }
        if (age < 18) {
          isMinor = 1;
        }
        cleanDob = String(body.dob).slice(0, 10);
      } else if (body.ageBracket === '16_17') {
        isMinor = 1;
      }

      if (!body.acceptTerms || !body.acceptPrivacy || !body.acceptGuidelines || !body.acceptSafetyNotice) {
        return sendJson(res, 400, {
          error: 'LEGAL_ACCEPTANCE_REQUIRED',
          message: 'You must read and accept the Terms of Service, Privacy Policy, Community Guidelines, and Mandatory Safety Notice before accessing social features.'
        });
      }

      const username = String(body.username || '').trim().toLowerCase();
      if (!/^[a-z0-9_]{3,24}$/.test(username)) {
        return sendJson(res, 400, {
          error: 'INVALID_USERNAME',
          message: 'Username must be 3–24 characters using lowercase letters, numbers, or underscores.'
        });
      }

      const existingUsername = db
        .prepare('SELECT user_id FROM profiles WHERE username = ? AND user_id != ?')
        .get(username, user.id);
      if (existingUsername) {
        return sendJson(res, 409, {
          error: 'USERNAME_TAKEN',
          message: `The username @${username} is already taken. Please choose another unique rider handle.`
        });
      }

      const displayName = String(body.displayName || username).trim().slice(0, 50);
      const district = brandConfig.sriLankaDistricts.includes(body.district) ? body.district : 'Colombo';
      const preferredArea = String(body.preferredRidingArea || '').trim().slice(0, 100);
      const bio = String(body.bio || '').trim().slice(0, 240);
      const now = new Date().toISOString();

      // Age-appropriate privacy defaults: 16-17 minors default to 'friends' visibility and hidden from public leaderboards
      const defaultVisibility = isMinor ? 'friends' : (body.profileVisibility || 'public');
      const defaultHideLeaderboard = isMinor ? 1 : (body.hideFromLeaderboards ? 1 : 0);

      db.prepare(
        `UPDATE users_private
         SET dob_private = ?, is_minor = ?, age_confirmed = 1, age_confirmed_at = ?,
             terms_accepted_version = '1.0-draft', terms_accepted_at = ?, privacy_accepted_at = ?,
             guidelines_accepted_at = ?, safety_notice_accepted_at = ?, onboarding_completed = 1, updated_at = ?
         WHERE id = ?`
      ).run(cleanDob, isMinor, now, now, now, now, now, now, user.id);

      const existingProfile = db.prepare('SELECT user_id FROM profiles WHERE user_id = ?').get(user.id);
      if (!existingProfile) {
        db.prepare(
          `INSERT INTO profiles (
            user_id, username, display_name, bio, avatar_url, district, preferred_riding_area,
            xp, rank_id, profile_visibility, hide_from_leaderboards, allow_friend_requests,
            allow_messages_from, notifications_enabled, reduced_motion, locale, created_at, updated_at
          ) VALUES (?, ?, ?, ?, '/assets/brand/riderise_logo.png', ?, ?, 0, 'rank_1', ?, ?, 1, 'friends_only', 1, 0, 'en', ?, ?)`
        ).run(user.id, username, displayName, bio, district, preferredArea, defaultVisibility, defaultHideLeaderboard, now, now);
      } else {
        db.prepare(
          `UPDATE profiles
           SET username = ?, display_name = ?, bio = ?, district = ?, preferred_riding_area = ?,
               profile_visibility = ?, hide_from_leaderboards = ?, updated_at = ?
           WHERE user_id = ?`
        ).run(username, displayName, bio, district, preferredArea, defaultVisibility, defaultHideLeaderboard, now, user.id);
      }

      return sendJson(res, 200, {
        message: 'Onboarding completed! Welcome to RideRise LK.',
        isMinor: Boolean(isMinor),
        profile: formatPublicProfile(user.id, user.id)
      });
    }

    if (pathname === '/api/account' && req.method === 'DELETE') {
      const user = getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'UNAUTHENTICATED' });

      // Cascade delete user account and all associated profile, bikes, posts, friendships, messages
      db.prepare('DELETE FROM users_private WHERE id = ?').run(user.id);
      return sendJson(res, 200, {
        deleted: true,
        message: 'Your RideRise LK account, profile, bicycles, posts, and messages have been permanently deleted.'
      });
    }

    // =========================================================================
    // SECTION 4: USER PROFILES & MEDIA UPLOAD
    // =========================================================================
    if (pathname.startsWith('/api/profiles/') && req.method === 'GET') {
      const targetUserId = decodeURIComponent(pathname.replace('/api/profiles/', ''));
      const viewer = getAuthUser(req);
      const profile = formatPublicProfile(targetUserId, viewer ? viewer.id : null);
      if (!profile) {
        return sendJson(res, 404, { error: 'PROFILE_NOT_FOUND', message: 'Rider profile not found or unavailable.' });
      }
      return sendJson(res, 200, { profile });
    }

    if (pathname === '/api/profile' && req.method === 'PUT') {
      const user = getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'UNAUTHENTICATED' });
      const body = await readJsonBody(req);

      // SECURITY: Prevent users from editing their own rank, XP, or role via profile update!
      if (body.xp !== undefined || body.rank_id !== undefined || body.role !== undefined || body.award_achievement !== undefined) {
        return sendJson(res, 403, {
          error: 'UNAUTHORIZED_RANK_MODIFICATION',
          message: 'Security Policy: Rider Rank, XP, and Achievements are validated server-side only and cannot be modified by client requests.'
        });
      }

      const username = body.username ? String(body.username).trim().toLowerCase() : user.username;
      if (!/^[a-z0-9_]{3,24}$/.test(username)) {
        return sendJson(res, 400, {
          error: 'INVALID_USERNAME',
          message: 'Username must be 3–24 characters (lowercase letters, numbers, underscores).'
        });
      }
      const conflict = db
        .prepare('SELECT user_id FROM profiles WHERE username = ? AND user_id != ?')
        .get(username, user.id);
      if (conflict) {
        return sendJson(res, 409, { error: 'USERNAME_TAKEN', message: 'That username is already in use.' });
      }

      const displayName = body.display_name !== undefined ? String(body.display_name).trim().slice(0, 50) : user.display_name;
      const bio = body.bio !== undefined ? String(body.bio).trim().slice(0, 300) : user.bio;
      const district = body.district && brandConfig.sriLankaDistricts.includes(body.district) ? body.district : user.district;
      const preferredArea =
        body.preferred_riding_area !== undefined ? String(body.preferred_riding_area).trim().slice(0, 120) : user.preferred_riding_area;
      const avatarUrl = body.avatar_url !== undefined ? String(body.avatar_url) : user.avatar_url;
      const visibility = ['public', 'friends', 'private'].includes(body.profile_visibility)
        ? body.profile_visibility
        : user.profile_visibility;
      const hideLeaderboard = body.hide_from_leaderboards !== undefined ? (body.hide_from_leaderboards ? 1 : 0) : user.hide_from_leaderboards;
      const allowFriends = body.allow_friend_requests !== undefined ? (body.allow_friend_requests ? 1 : 0) : user.allow_friend_requests;
      const allowMessages = ['friends_only', 'nobody'].includes(body.allow_messages_from)
        ? body.allow_messages_from
        : user.allow_messages_from;
      const notificationsEnabled =
        body.notifications_enabled !== undefined ? (body.notifications_enabled ? 1 : 0) : user.notifications_enabled;
      const reducedMotion = body.reduced_motion !== undefined ? (body.reduced_motion ? 1 : 0) : user.reduced_motion;
      const locale = ['en', 'si', 'ta'].includes(body.locale) ? body.locale : user.locale;

      db.prepare(
        `UPDATE profiles
         SET username = ?, display_name = ?, bio = ?, avatar_url = ?, district = ?,
             preferred_riding_area = ?, profile_visibility = ?, hide_from_leaderboards = ?,
             allow_friend_requests = ?, allow_messages_from = ?, notifications_enabled = ?,
             reduced_motion = ?, locale = ?, updated_at = ?
         WHERE user_id = ?`
      ).run(
        username, displayName, bio, avatarUrl, district, preferredArea, visibility,
        hideLeaderboard, allowFriends, allowMessages, notificationsEnabled, reducedMotion,
        locale, new Date().toISOString(), user.id
      );

      return sendJson(res, 200, {
        message: 'Profile updated successfully.',
        profile: formatPublicProfile(user.id, user.id)
      });
    }

    if (pathname === '/api/upload/media' && req.method === 'POST') {
      const user = getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'UNAUTHENTICATED' });
      // Allow the raw request to exceed the decoded limit (base64 + JSON overhead) so the
      // precise 5 MB / 8 MB media checks below can return a descriptive 413.
      const body = await readJsonBody(req, 24 * 1024 * 1024);
      const dataUrl = String(body.dataUrl || '');
      const imageMatch = /^data:(image\/(png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
      const videoMatch = /^data:(video\/mp4);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
      const match = imageMatch || videoMatch;
      const isVideo = !!videoMatch;
      if (!match) {
        return sendJson(res, 400, {
          error: 'INVALID_MEDIA_TYPE',
          message: 'Only validated PNG, JPEG or WebP images (max 5 MB) and MP4 clips (max 8 MB) are permitted.'
        });
      }
      const base64Payload = match[isVideo ? 2 : 3].replace(/\s/g, '');
      const decodedBytes = Math.floor((base64Payload.length * 3) / 4) - (base64Payload.endsWith('==') ? 2 : base64Payload.endsWith('=') ? 1 : 0);
      const sizeLimit = isVideo ? 8 * 1024 * 1024 : brandConfig.maxUploadSizeBytes;
      if (decodedBytes > sizeLimit) {
        return sendJson(res, 413, {
          error: 'FILE_TOO_LARGE',
          message: isVideo
            ? 'Clip exceeds the 8 MB short-video limit. Trim it and try again.'
            : 'Image exceeds the 5 MB maximum upload size limit.'
        });
      }
      if (decodedBytes < 8) {
        return sendJson(res, 400, { error: 'EMPTY_MEDIA', message: 'The uploaded image appears to be empty or corrupt.' });
      }
      // Uploads are stored without EXIF/GPS metadata: the client re-encodes images before upload
      return sendJson(res, 200, {
        mediaUrl: `data:${match[1]};base64,${base64Payload}`,
        mediaType: isVideo ? 'video' : 'image',
        exifStripped: true,
        gpsCoordinatesRemoved: true,
        sizeBytes: decodedBytes,
        moderationNote: isVideo ? 'Short clips are reviewed under the same Community Guidelines as posts.' : null
      });
    }

    // =========================================================================
    // SECTION 5: RIDER RANKING, ACHIEVEMENTS, SAFETY CHECKLIST & LEADERBOARDS
    // =========================================================================
    if (pathname === '/api/ranks' && req.method === 'GET') {
      const user = getAuthUser(req);
      const ranks = db.prepare('SELECT * FROM ranks ORDER BY level_order ASC').all();
      const achievements = db.prepare('SELECT * FROM achievements ORDER BY xp_reward ASC').all();
      let activityHistory = [];
      let unlockedIds = [];
      if (user) {
        activityHistory = db
          .prepare('SELECT * FROM xp_activity_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 30')
          .all(user.id);
        unlockedIds = db
          .prepare('SELECT achievement_id FROM user_achievements WHERE user_id = ?')
          .all(user.id)
          .map((r) => r.achievement_id);
      }
      return sendJson(res, 200, { ranks, achievements, activityHistory, unlockedIds });
    }

    if (pathname === '/api/leaderboards' && req.method === 'GET') {
      const scope = parsedUrl.searchParams.get('scope') || 'overall';
      const district = parsedUrl.searchParams.get('district') || '';
      const guildId = parsedUrl.searchParams.get('guildId') || '';

      let sql = `
        SELECT p.user_id, p.username, p.display_name, p.avatar_url, p.district, p.xp,
               r.name as rank_name, r.level_order as rank_level, r.color_hex as rank_color,
               (SELECT COUNT(*) FROM user_stunt_progress usp WHERE usp.user_id = p.user_id AND usp.status = 'completed') as modules_completed
        FROM profiles p
        JOIN users_private u ON u.id = p.user_id
        JOIN ranks r ON r.id = p.rank_id
        WHERE p.hide_from_leaderboards = 0
          AND p.profile_visibility = 'public'
          AND u.account_status = 'active'
      `;
      const params = [];
      if (scope === 'district' && district) {
        sql += ' AND p.district = ?';
        params.push(district);
      } else if (scope === 'guild' && guildId) {
        sql += " AND EXISTS (SELECT 1 FROM guild_memberships gm WHERE gm.guild_id = ? AND gm.user_id = p.user_id AND gm.status = 'active')";
        params.push(guildId);
      }
      sql += ' ORDER BY p.xp DESC LIMIT 50';

      const leaders = db.prepare(sql).all(...params);
      return sendJson(res, 200, {
        scope,
        district,
        guildId,
        note: 'Leaderboards reflect verified learning modules, safety inspections, and positive community contributions. Riders who enable "Hide from Public Leaderboards" are excluded.',
        leaders
      });
    }

    if (pathname === '/api/safety/checklist' && req.method === 'POST') {
      const user = getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'UNAUTHENTICATED' });
      const body = await readJsonBody(req);
      const checkedItems = Array.isArray(body.checkedItems) ? body.checkedItems : [];
      if (checkedItems.length < 7) {
        return sendJson(res, 400, {
          error: 'INCOMPLETE_SAFETY_CHECKLIST',
          message: 'Please verify all 7 pre-ride inspection checkpoints (Helmet, Bar-Ends, Brakes, Tires, Cranks/Pedals, Frame/Fork, Controlled Area) before completing.'
        });
      }

      const dayRef = 'safety_chk_' + new Date().toISOString().slice(0, 10);
      const xpResult = awardValidatedXp(db, {
        userId: user.id,
        actionType: 'safety_checklist_completed',
        xpDelta: 25,
        description: 'Completed 7-Point Pre-Ride Bicycle & Helmet Safety Checklist',
        referenceId: dayRef
      });

      const hasBadge = db
        .prepare("SELECT id FROM user_achievements WHERE user_id = ? AND achievement_id = 'ach_safety_first'")
        .get(user.id);
      if (!hasBadge) {
        db.prepare(
          "INSERT INTO user_achievements (id, user_id, achievement_id, awarded_at, awarded_reason) VALUES (?, ?, 'ach_safety_first', ?, 'Completed 7-Point Pre-Ride Safety Checklist')"
        ).run('ua_' + Date.now(), user.id, new Date().toISOString());
      }

      return sendJson(res, 200, {
        message: 'Pre-Ride Safety Inspection verified! Ride safe in a controlled environment.',
        xpAdded: xpResult ? xpResult.xpAdded : 0,
        profile: formatPublicProfile(user.id, user.id)
      });
    }

    // =========================================================================
    // SECTION 6: BICYCLE PROFILE & 13-QUESTION BIKE BUILD RATING
    // =========================================================================
    if (pathname === '/api/bicycles/preview-score' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const result = calculateBikeBuildRating(body);
      return sendJson(res, 200, result);
    }

    if (pathname === '/api/bicycles' && req.method === 'GET') {
      const user = getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'UNAUTHENTICATED' });
      const bikes = db
        .prepare('SELECT * FROM bicycles WHERE user_id = ? ORDER BY is_primary DESC, created_at DESC')
        .all(user.id)
        .map((b) => ({
          ...b,
          safety_defects: JSON.parse(b.safety_defects_json || '[]'),
          photos: JSON.parse(b.photos_json || '{}'),
          score_breakdown: JSON.parse(b.score_breakdown_json || '{}')
        }));
      return sendJson(res, 200, { bicycles: bikes });
    }

    if (pathname === '/api/bicycles' && req.method === 'POST') {
      const user = getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'UNAUTHENTICATED' });
      const body = await readJsonBody(req);

      if (!body.name || !body.bike_type) {
        return sendJson(res, 400, { error: 'MISSING_BIKE_FIELDS', message: 'Please provide a bicycle name and bicycle type.' });
      }

      const rating = calculateBikeBuildRating(body);
      const now = new Date().toISOString();
      const bikeId = 'bike_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);

      const existingCount = db.prepare('SELECT COUNT(*) as c FROM bicycles WHERE user_id = ?').get(user.id).c;
      const isPrimary = body.is_primary || existingCount === 0 ? 1 : 0;
      if (isPrimary) {
        db.prepare('UPDATE bicycles SET is_primary = 0 WHERE user_id = ?').run(user.id);
      }

      db.prepare(
        `INSERT INTO bicycles (
          id, user_id, name, is_primary, bike_type, frame_material, frame_brand, frame_model,
          fork_spec, tire_spec, wheel_rim_spec, handlebar_grip_spec, drivetrain_spec, brake_type,
          maintenance_condition, safety_defects_json, primary_use, photos_json, cosmetic_rating,
          build_score, score_breakdown_json, has_critical_safety_defect, safety_recommendation,
          verification_status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        bikeId,
        user.id,
        String(body.name).trim(),
        isPrimary,
        String(body.bike_type || 'BMX'),
        String(body.frame_material || "I don't know"),
        String(body.frame_brand || "I don't know"),
        String(body.frame_model || 'Unspecified'),
        String(body.fork_spec || "I don't know"),
        String(body.tire_spec || "I don't know"),
        String(body.wheel_rim_spec || "I don't know"),
        String(body.handlebar_grip_spec || "I don't know"),
        String(body.drivetrain_spec || "I don't know"),
        String(body.brake_type || 'Rear U-Brake'),
        String(body.maintenance_condition || 'Good'),
        JSON.stringify(Array.isArray(body.safety_defects) ? body.safety_defects : []),
        String(body.primary_use || 'General use'),
        JSON.stringify(body.photos || {}),
        rating.cosmetic_rating,
        rating.build_score,
        JSON.stringify(rating.breakdown),
        rating.has_critical_safety_defect,
        rating.safety_recommendation,
        rating.verification_status,
        now,
        now
      );

      if (isPrimary) {
        db.prepare('UPDATE profiles SET primary_bike_id = ? WHERE user_id = ?').run(bikeId, user.id);
      }

      awardValidatedXp(db, {
        userId: user.id,
        actionType: 'bike_questionnaire_completed',
        xpDelta: 35,
        description: `Completed 13-Point Bike Build Questionnaire for ${body.name}`,
        referenceId: bikeId
      });

      const hasBadge = db
        .prepare("SELECT id FROM user_achievements WHERE user_id = ? AND achievement_id = 'ach_build_documented'")
        .get(user.id);
      if (!hasBadge) {
        db.prepare(
          "INSERT INTO user_achievements (id, user_id, achievement_id, awarded_at, awarded_reason) VALUES (?, ?, 'ach_build_documented', ?, 'Completed Guided Bike Build Questionnaire')"
        ).run('ua_' + Date.now(), user.id, now);
      }

      return sendJson(res, 201, {
        message: 'Bicycle profile saved and Bike Build Rating calculated.',
        bikeId,
        rating,
        profile: formatPublicProfile(user.id, user.id)
      });
    }

    if (pathname.startsWith('/api/bicycles/') && (req.method === 'PUT' || req.method === 'DELETE' || req.method === 'POST')) {
      const user = getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'UNAUTHENTICATED' });
      const parts = pathname.split('/').filter(Boolean);
      const bikeId = parts[2];
      const action = parts[3] || '';

      const bike = db.prepare('SELECT * FROM bicycles WHERE id = ?').get(bikeId);
      if (!bike) return sendJson(res, 404, { error: 'BIKE_NOT_FOUND' });
      if (bike.user_id !== user.id) {
        return sendJson(res, 403, {
          error: 'FORBIDDEN_OBJECT_ACCESS',
          message: 'You can only modify or delete your own bicycles.'
        });
      }

      if (req.method === 'POST' && action === 'primary') {
        db.prepare('UPDATE bicycles SET is_primary = 0 WHERE user_id = ?').run(user.id);
        db.prepare('UPDATE bicycles SET is_primary = 1 WHERE id = ?').run(bikeId);
        db.prepare('UPDATE profiles SET primary_bike_id = ? WHERE user_id = ?').run(bikeId, user.id);
        return sendJson(res, 200, { message: 'Primary profile bicycle updated.', profile: formatPublicProfile(user.id, user.id) });
      }

      if (req.method === 'DELETE') {
        db.prepare('DELETE FROM bicycles WHERE id = ?').run(bikeId);
        return sendJson(res, 200, { message: 'Bicycle removed.', profile: formatPublicProfile(user.id, user.id) });
      }

      if (req.method === 'PUT') {
        const body = await readJsonBody(req);
        const rating = calculateBikeBuildRating(body);
        const now = new Date().toISOString();
        db.prepare(
          `UPDATE bicycles
           SET name = ?, bike_type = ?, frame_material = ?, frame_brand = ?, frame_model = ?,
               fork_spec = ?, tire_spec = ?, wheel_rim_spec = ?, handlebar_grip_spec = ?,
               drivetrain_spec = ?, brake_type = ?, maintenance_condition = ?, safety_defects_json = ?,
               primary_use = ?, photos_json = ?, cosmetic_rating = ?, build_score = ?,
               score_breakdown_json = ?, has_critical_safety_defect = ?, safety_recommendation = ?, updated_at = ?
           WHERE id = ?`
        ).run(
          String(body.name || bike.name),
          String(body.bike_type || bike.bike_type),
          String(body.frame_material || bike.frame_material),
          String(body.frame_brand || bike.frame_brand),
          String(body.frame_model || bike.frame_model),
          String(body.fork_spec || bike.fork_spec),
          String(body.tire_spec || bike.tire_spec),
          String(body.wheel_rim_spec || bike.wheel_rim_spec),
          String(body.handlebar_grip_spec || bike.handlebar_grip_spec),
          String(body.drivetrain_spec || bike.drivetrain_spec),
          String(body.brake_type || bike.brake_type),
          String(body.maintenance_condition || bike.maintenance_condition),
          JSON.stringify(Array.isArray(body.safety_defects) ? body.safety_defects : JSON.parse(bike.safety_defects_json)),
          String(body.primary_use || bike.primary_use),
          JSON.stringify(body.photos || JSON.parse(bike.photos_json)),
          rating.cosmetic_rating,
          rating.build_score,
          JSON.stringify(rating.breakdown),
          rating.has_critical_safety_defect,
          rating.safety_recommendation,
          now,
          bikeId
        );
        return sendJson(res, 200, {
          message: 'Bicycle updated and score recalculated.',
          rating,
          profile: formatPublicProfile(user.id, user.id)
        });
      }
    }

    // =========================================================================
    // SECTION 7: COMMUNITY FEED, POSTS, COMMENTS, LIKES, BOOKMARKS
    // =========================================================================
    if (pathname === '/api/posts' && req.method === 'GET') {
      const viewer = getAuthUser(req);
      const category = parsedUrl.searchParams.get('category') || '';
      const tag = parsedUrl.searchParams.get('tag') || '';
      const guildId = parsedUrl.searchParams.get('guildId') || '';
      const bookmarkedOnly = parsedUrl.searchParams.get('bookmarked') === '1';
      const search = (parsedUrl.searchParams.get('search') || '').trim().toLowerCase();
      const limit = Math.min(30, Math.max(1, Number(parsedUrl.searchParams.get('limit') || 15)));
      const offset = Math.max(0, Number(parsedUrl.searchParams.get('offset') || 0));

      // If guildId is requested for a private guild, verify viewer is an active member!
      if (guildId) {
        const guild = db.prepare('SELECT privacy_type FROM guilds WHERE id = ?').get(guildId);
        if (guild && guild.privacy_type === 'private') {
          const isMember = viewer
            ? db
                .prepare("SELECT 1 FROM guild_memberships WHERE guild_id = ? AND user_id = ? AND status = 'active'")
                .get(guildId, viewer.id)
            : null;
          if (!isMember && (!viewer || viewer.role !== 'admin')) {
            return sendJson(res, 403, {
              error: 'PRIVATE_GUILD_FEED',
              message: 'Only approved members of this private guild can view its shared posts.'
            });
          }
        }
      }

      let sql = `
        SELECT p.*, prof.username, prof.display_name, prof.avatar_url, prof.district,
               r.name as rank_name, r.color_hex as rank_color,
               b.name as bike_name, b.build_score as bike_build_score,
               g.name as guild_name
        FROM posts p
        JOIN profiles prof ON prof.user_id = p.user_id
        JOIN ranks r ON r.id = prof.rank_id
        LEFT JOIN bicycles b ON b.id = p.bike_id
        LEFT JOIN guilds g ON g.id = p.guild_id
        WHERE p.moderation_status = 'visible'
      `;
      const params = [];

      if (category) {
        sql += ' AND p.category = ?';
        params.push(category);
      }
      if (guildId) {
        sql += ' AND p.guild_id = ?';
        params.push(guildId);
      } else {
        // Exclude private guild posts from the main public feed
        sql += " AND (p.guild_id IS NULL OR EXISTS (SELECT 1 FROM guilds g2 WHERE g2.id = p.guild_id AND g2.privacy_type = 'public'))";
      }
      if (tag) {
        sql += ' AND LOWER(p.tags_json) LIKE ?';
        params.push(`%${tag.toLowerCase()}%`);
      }
      if (search) {
        sql += ' AND (LOWER(p.title) LIKE ? OR LOWER(p.body) LIKE ? OR LOWER(prof.username) LIKE ?)';
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
      }
      if (bookmarkedOnly && viewer) {
        sql += ' AND EXISTS (SELECT 1 FROM post_bookmarks pb WHERE pb.post_id = p.id AND pb.user_id = ?)';
        params.push(viewer.id);
      }
      if (viewer) {
        sql += ` AND NOT EXISTS (
          SELECT 1 FROM user_blocks ub
          WHERE (ub.blocker_id = ? AND ub.blocked_id = p.user_id)
             OR (ub.blocker_id = p.user_id AND ub.blocked_id = ?)
        )`;
        params.push(viewer.id, viewer.id);
      }

      sql += ' ORDER BY p.created_at DESC LIMIT ? OFFSET ?';
      params.push(limit, offset);

      const rows = db.prepare(sql).all(...params).map((row) => {
        const likedByMe = viewer
          ? !!db.prepare('SELECT 1 FROM post_likes WHERE post_id = ? AND user_id = ?').get(row.id, viewer.id)
          : false;
        const bookmarkedByMe = viewer
          ? !!db.prepare('SELECT 1 FROM post_bookmarks WHERE post_id = ? AND user_id = ?').get(row.id, viewer.id)
          : false;
        const comments = db
          .prepare(
            `SELECT c.*, pr.username, pr.display_name, pr.avatar_url
             FROM comments c
             JOIN profiles pr ON pr.user_id = c.user_id
             WHERE c.post_id = ? AND c.moderation_status = 'visible'
             ORDER BY c.created_at ASC`
          )
          .all(row.id);

        return {
          ...row,
          tags: JSON.parse(row.tags_json || '[]'),
          media_urls: JSON.parse(row.media_urls_json || '[]'),
          liked_by_me: likedByMe,
          bookmarked_by_me: bookmarkedByMe,
          comments
        };
      });

      return sendJson(res, 200, { posts: rows, limit, offset, hasMore: rows.length === limit });
    }

    if (pathname === '/api/posts' && req.method === 'POST') {
      const user = getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'UNAUTHENTICATED' });
      if (!user.onboarding_completed) {
        return sendJson(res, 403, { error: 'ONBOARDING_REQUIRED', message: 'Complete onboarding and accept Terms before posting.' });
      }
      if (!checkRateLimit(`post:${user.id}`, brandConfig.rateLimits.postsPerWindow, brandConfig.rateLimits.windowSeconds)) {
        return sendJson(res, 429, { error: 'RATE_LIMITED', message: 'Too many posts created recently. Please wait a moment.' });
      }

      const body = await readJsonBody(req);
      const validCategories = [
        'build_showcase',
        'maintenance_upgrade',
        'riding_recap',
        'skill_progress',
        'community_qa',
        'short_clip',
        'marketplace'
      ];
      const category = validCategories.includes(body.category) ? body.category : 'build_showcase';
      const title = String(body.title || '').trim();
      const postBody = String(body.body || '').trim();

      if (title.length < 3 || postBody.length < 5) {
        return sendJson(res, 400, { error: 'INVALID_POST', message: 'Post title and description are required.' });
      }

      // Auto-flag dangerous road/traffic stunt content for moderation review
      const lowerText = `${title} ${postBody}`.toLowerCase();
      const dangerousTrafficPattern = /highway traffic|swerving cars|busy road stunt|no helmet traffic/i;
      const moderationStatus = dangerousTrafficPattern.test(lowerText) ? 'pending_review' : 'visible';

      const now = new Date().toISOString();
      const postId = 'post_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
      const tags = Array.isArray(body.tags)
        ? body.tags.map((t) => String(t).replace(/[^a-zA-Z0-9_]/g, '').slice(0, 24)).filter(Boolean).slice(0, 6)
        : [];
      const mediaUrls = Array.isArray(body.media_urls) ? body.media_urls.slice(0, 4) : [];
      const mediaType = mediaUrls.length > 0 ? (body.media_type === 'video' ? 'video' : 'image') : 'none';

      // Strip any coordinates if sent by client
      db.prepare(
        `INSERT INTO posts (
          id, user_id, category, title, body, tags_json, media_urls_json, media_type,
          bike_id, guild_id, moderation_status, likes_count, comments_count, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`
      ).run(
        postId,
        user.id,
        category,
        title,
        postBody,
        JSON.stringify(tags),
        JSON.stringify(mediaUrls),
        mediaType,
        body.bike_id || null,
        body.guild_id || null,
        moderationStatus,
        now,
        now
      );

      // Handle @username mentions in post body
      const mentions = postBody.match(/@([a-z0-9_]{3,24})/gi) || [];
      for (const m of mentions) {
        const mentionedUsername = m.slice(1).toLowerCase();
        const target = db.prepare('SELECT user_id FROM profiles WHERE username = ?').get(mentionedUsername);
        if (target && target.user_id !== user.id && !isBlockedEitherWay(user.id, target.user_id)) {
          db.prepare(
            'INSERT INTO notifications (id, user_id, type, title, body, reference_type, reference_id, is_read, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)'
          ).run(
            'notif_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            target.user_id,
            'mention',
            `@${user.username} mentioned you`,
            `Mentioned you in "${title.slice(0, 50)}"`,
            'post',
            postId,
            now
          );
        }
      }

      if (moderationStatus === 'visible' && ['maintenance_upgrade', 'community_qa', 'build_showcase', 'skill_progress'].includes(category)) {
        awardValidatedXp(db, {
          userId: user.id,
          actionType: 'constructive_post_published',
          xpDelta: 15,
          description: `Shared community post: ${title.slice(0, 40)}`,
          referenceId: postId
        });
      }

      return sendJson(res, 201, {
        postId,
        moderationStatus,
        gpsCoordinatesStripped: true,
        message:
          moderationStatus === 'pending_review'
            ? 'Your post contains road/traffic keywords and has been placed in Pending Moderation Review for safety verification.'
            : 'Post published to the community feed!'
      });
    }

    if (pathname.startsWith('/api/posts/') && ['PUT', 'DELETE', 'POST'].includes(req.method)) {
      const user = getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'UNAUTHENTICATED' });
      const parts = pathname.split('/').filter(Boolean);
      const postId = parts[2];
      const action = parts[3] || '';

      const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(postId);
      if (!post) return sendJson(res, 404, { error: 'POST_NOT_FOUND' });

      if (req.method === 'PUT' && !action) {
        if (post.user_id !== user.id) {
          return sendJson(res, 403, { error: 'FORBIDDEN', message: 'You can only edit your own posts.' });
        }
        const body = await readJsonBody(req);
        const title = String(body.title || post.title).trim();
        const postBody = String(body.body || post.body).trim();
        const tags = Array.isArray(body.tags) ? body.tags : JSON.parse(post.tags_json || '[]');
        db.prepare('UPDATE posts SET title = ?, body = ?, tags_json = ?, updated_at = ? WHERE id = ?').run(
          title,
          postBody,
          JSON.stringify(tags),
          new Date().toISOString(),
          postId
        );
        return sendJson(res, 200, { message: 'Post updated.' });
      }

      if (req.method === 'DELETE' && !action) {
        if (post.user_id !== user.id && user.role !== 'admin') {
          return sendJson(res, 403, { error: 'FORBIDDEN', message: 'You can only delete your own posts.' });
        }
        db.prepare('DELETE FROM posts WHERE id = ?').run(postId);
        return sendJson(res, 200, { message: 'Post deleted.' });
      }

      if (req.method === 'POST' && action === 'like') {
        const existing = db.prepare('SELECT 1 FROM post_likes WHERE post_id = ? AND user_id = ?').get(postId, user.id);
        if (existing) {
          db.prepare('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?').run(postId, user.id);
          db.prepare('UPDATE posts SET likes_count = MAX(0, likes_count - 1) WHERE id = ?').run(postId);
          return sendJson(res, 200, { liked: false });
        } else {
          db.prepare('INSERT INTO post_likes (post_id, user_id, created_at) VALUES (?, ?, ?)').run(
            postId,
            user.id,
            new Date().toISOString()
          );
          db.prepare('UPDATE posts SET likes_count = likes_count + 1 WHERE id = ?').run(postId);
          return sendJson(res, 200, { liked: true });
        }
      }

      if (req.method === 'POST' && action === 'bookmark') {
        const existing = db.prepare('SELECT 1 FROM post_bookmarks WHERE post_id = ? AND user_id = ?').get(postId, user.id);
        if (existing) {
          db.prepare('DELETE FROM post_bookmarks WHERE post_id = ? AND user_id = ?').run(postId, user.id);
          return sendJson(res, 200, { bookmarked: false });
        } else {
          db.prepare('INSERT INTO post_bookmarks (post_id, user_id, created_at) VALUES (?, ?, ?)').run(
            postId,
            user.id,
            new Date().toISOString()
          );
          return sendJson(res, 200, { bookmarked: true });
        }
      }

      if (req.method === 'POST' && action === 'comments') {
        const body = await readJsonBody(req);
        const commentBody = String(body.body || '').trim();
        if (!commentBody) return sendJson(res, 400, { error: 'EMPTY_COMMENT' });
        if (isBlockedEitherWay(user.id, post.user_id)) {
          return sendJson(res, 403, { error: 'BLOCKED_INTERACTION' });
        }
        const now = new Date().toISOString();
        const commentId = 'cmt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        db.prepare(
          "INSERT INTO comments (id, post_id, user_id, parent_comment_id, body, moderation_status, created_at) VALUES (?, ?, ?, ?, ?, 'visible', ?)"
        ).run(commentId, postId, user.id, body.parent_comment_id || null, commentBody, now);
        db.prepare('UPDATE posts SET comments_count = comments_count + 1 WHERE id = ?').run(postId);

        return sendJson(res, 201, { commentId, message: 'Comment added.' });
      }
    }

    // =========================================================================
    // SECTION 8: FRIENDS, BLOCKING & FRIEND-ONLY PRIVATE MESSAGING
    // =========================================================================
    if (pathname === '/api/users/search' && req.method === 'GET') {
      const user = getAuthUser(req);
      const q = (parsedUrl.searchParams.get('q') || '').trim().toLowerCase();
      let sql = `
        SELECT p.user_id, p.username, p.display_name, p.avatar_url, p.district,
               r.name as rank_name, r.color_hex as rank_color
        FROM profiles p
        JOIN users_private u ON u.id = p.user_id
        JOIN ranks r ON r.id = p.rank_id
        WHERE u.account_status = 'active'
      `;
      const params = [];
      if (q) {
        sql += ' AND (LOWER(p.username) LIKE ? OR LOWER(p.display_name) LIKE ?)';
        params.push(`%${q}%`, `%${q}%`);
      }
      if (user) {
        sql += ` AND NOT EXISTS (
          SELECT 1 FROM user_blocks ub
          WHERE (ub.blocker_id = ? AND ub.blocked_id = p.user_id)
             OR (ub.blocker_id = p.user_id AND ub.blocked_id = ?)
        )`;
        params.push(user.id, user.id);
      }
      sql += ' ORDER BY p.xp DESC LIMIT 25';
      // Notice: Never returns email or phone numbers!
      return sendJson(res, 200, { users: db.prepare(sql).all(...params) });
    }

    if (pathname === '/api/friends' && req.method === 'GET') {
      const user = getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'UNAUTHENTICATED' });

      const rows = db
        .prepare(
          `SELECT f.*,
                  pa.username as req_username, pa.display_name as req_display_name, pa.avatar_url as req_avatar, pa.district as req_district,
                  pb.username as add_username, pb.display_name as add_display_name, pb.avatar_url as add_avatar, pb.district as add_district
           FROM friendships f
           JOIN profiles pa ON pa.user_id = f.requester_id
           JOIN profiles pb ON pb.user_id = f.addressee_id
           WHERE f.requester_id = ? OR f.addressee_id = ?
           ORDER BY f.updated_at DESC`
        )
        .all(user.id, user.id);

      const accepted = [];
      const incoming = [];
      const outgoing = [];

      for (const r of rows) {
        const otherId = r.requester_id === user.id ? r.addressee_id : r.requester_id;
        if (isBlockedEitherWay(user.id, otherId)) continue;
        const otherUser =
          r.requester_id === user.id
            ? { user_id: r.addressee_id, username: r.add_username, display_name: r.add_display_name, avatar_url: r.add_avatar, district: r.add_district }
            : { user_id: r.requester_id, username: r.req_username, display_name: r.req_display_name, avatar_url: r.req_avatar, district: r.req_district };

        if (r.status === 'accepted') accepted.push({ friendship_id: r.id, ...otherUser });
        else if (r.status === 'pending' && r.addressee_id === user.id) incoming.push({ friendship_id: r.id, ...otherUser });
        else if (r.status === 'pending' && r.requester_id === user.id) outgoing.push({ friendship_id: r.id, ...otherUser });
      }

      const blocked = db
        .prepare(
          `SELECT ub.blocked_id as user_id, p.username, p.display_name, ub.created_at
           FROM user_blocks ub
           JOIN profiles p ON p.user_id = ub.blocked_id
           WHERE ub.blocker_id = ?`
        )
        .all(user.id);

      return sendJson(res, 200, { accepted, incoming, outgoing, blocked });
    }

    if (pathname === '/api/friends/request' && req.method === 'POST') {
      const user = getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'UNAUTHENTICATED' });
      if (!checkRateLimit(`freq:${user.id}`, brandConfig.rateLimits.friendRequestsPerWindow, brandConfig.rateLimits.windowSeconds)) {
        return sendJson(res, 429, { error: 'RATE_LIMITED', message: 'Too many friend requests sent recently.' });
      }

      const body = await readJsonBody(req);
      let targetUserId = body.targetUserId;
      if (!targetUserId && body.username) {
        const found = db.prepare('SELECT user_id FROM profiles WHERE username = ?').get(String(body.username).trim().toLowerCase());
        if (found) targetUserId = found.user_id;
      }

      if (!targetUserId || targetUserId === user.id) {
        return sendJson(res, 400, { error: 'INVALID_TARGET_USER', message: 'Rider not found.' });
      }
      if (isBlockedEitherWay(user.id, targetUserId)) {
        return sendJson(res, 403, { error: 'USER_BLOCKED', message: 'Cannot send a friend request to this user.' });
      }

      const targetProfile = db.prepare('SELECT allow_friend_requests, username FROM profiles WHERE user_id = ?').get(targetUserId);
      if (!targetProfile) return sendJson(res, 404, { error: 'USER_NOT_FOUND' });
      if (!targetProfile.allow_friend_requests) {
        return sendJson(res, 403, {
          error: 'FRIEND_REQUESTS_DISABLED',
          message: `@${targetProfile.username} has disabled incoming friend requests in their privacy settings.`
        });
      }

      const existing = db
        .prepare(
          'SELECT * FROM friendships WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)'
        )
        .get(user.id, targetUserId, targetUserId, user.id);

      const now = new Date().toISOString();
      if (existing) {
        if (existing.status === 'accepted') {
          return sendJson(res, 409, { error: 'ALREADY_FRIENDS', message: 'You are already friends.' });
        }
        db.prepare("UPDATE friendships SET requester_id = ?, addressee_id = ?, status = 'pending', updated_at = ? WHERE id = ?").run(
          user.id,
          targetUserId,
          now,
          existing.id
        );
      } else {
        const fid = 'fr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        db.prepare('INSERT INTO friendships (id, requester_id, addressee_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
          fid,
          user.id,
          targetUserId,
          'pending',
          now,
          now
        );
      }

      db.prepare(
        'INSERT INTO notifications (id, user_id, type, title, body, reference_type, reference_id, is_read, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)'
      ).run(
        'notif_' + Date.now(),
        targetUserId,
        'friend_request',
        'New Friend Request',
        `@${user.username} sent you a friend request.`,
        'user',
        user.id,
        now
      );

      return sendJson(res, 201, { message: `Friend request sent to @${targetProfile.username}.` });
    }

    if (pathname.startsWith('/api/friends/') && req.method === 'POST') {
      const user = getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'UNAUTHENTICATED' });
      const parts = pathname.split('/').filter(Boolean);
      const friendshipId = parts[2];
      const body = await readJsonBody(req);
      const action = body.action; // accept, decline, cancel, remove

      const row = db.prepare('SELECT * FROM friendships WHERE id = ?').get(friendshipId);
      if (!row) return sendJson(res, 404, { error: 'FRIENDSHIP_NOT_FOUND' });

      if (action === 'accept' && row.addressee_id === user.id) {
        const now = new Date().toISOString();
        db.prepare("UPDATE friendships SET status = 'accepted', updated_at = ? WHERE id = ?").run(now, friendshipId);
        // Ensure a conversation row exists for the two friends
        const [uA, uB] = [row.requester_id, row.addressee_id].sort();
        const existingConvo = db
          .prepare('SELECT id FROM conversations WHERE (user_a_id = ? AND user_b_id = ?) OR (user_a_id = ? AND user_b_id = ?)')
          .get(uA, uB, uB, uA);
        if (!existingConvo) {
          db.prepare('INSERT INTO conversations (id, user_a_id, user_b_id, muted_by_a, muted_by_b, last_message_at, created_at) VALUES (?, ?, ?, 0, 0, ?, ?)').run(
            'conv_' + Date.now(),
            uA,
            uB,
            now,
            now
          );
        }
        return sendJson(res, 200, { message: 'Friend request accepted!' });
      }

      if (['decline', 'cancel', 'remove'].includes(action) && (row.requester_id === user.id || row.addressee_id === user.id)) {
        db.prepare('DELETE FROM friendships WHERE id = ?').run(friendshipId);
        return sendJson(res, 200, { message: `Friendship ${action}ed.` });
      }

      return sendJson(res, 403, { error: 'FORBIDDEN_FRIEND_ACTION' });
    }

    if (pathname === '/api/blocks' && req.method === 'POST') {
      const user = getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'UNAUTHENTICATED' });
      const body = await readJsonBody(req);
      const blockedId = body.blockedUserId;
      if (!blockedId || blockedId === user.id) return sendJson(res, 400, { error: 'INVALID_BLOCK_TARGET' });

      const now = new Date().toISOString();
      db.prepare('INSERT OR REPLACE INTO user_blocks (blocker_id, blocked_id, reason, created_at) VALUES (?, ?, ?, ?)').run(
        user.id,
        blockedId,
        String(body.reason || 'Blocked by user'),
        now
      );
      // Remove any existing friendship or pending request
      db.prepare(
        'DELETE FROM friendships WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)'
      ).run(user.id, blockedId, blockedId, user.id);

      // Phase 2: a block ends live location sharing and live audio participation for both
      // people immediately — a blocked account must not keep seeing where someone is.
      try {
        db.prepare('DELETE FROM live_location_sessions WHERE user_id IN (?, ?)').run(user.id, blockedId);
        db.prepare('DELETE FROM voice_participants WHERE user_id IN (?, ?)').run(user.id, blockedId);
        db.prepare('DELETE FROM voice_signals WHERE from_user IN (?, ?) OR to_user IN (?, ?)').run(
          user.id,
          blockedId,
          user.id,
          blockedId
        );
      } catch (err) {
        /* Phase 2 tables absent on an un-migrated database */
      }

      return sendJson(res, 200, {
        message: 'User blocked. They can no longer view your profile, friend you, or message you. Any live location share or voice room was ended.'
      });
    }

    if (pathname.startsWith('/api/blocks/') && req.method === 'DELETE') {
      const user = getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'UNAUTHENTICATED' });
      const blockedId = decodeURIComponent(pathname.replace('/api/blocks/', ''));
      db.prepare('DELETE FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?').run(user.id, blockedId);
      return sendJson(res, 200, { message: 'User unblocked.' });
    }

    if (pathname === '/api/conversations' && req.method === 'GET') {
      const user = getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'UNAUTHENTICATED' });

      const convos = db
        .prepare(
          `SELECT c.*
           FROM conversations c
           WHERE c.user_a_id = ? OR c.user_b_id = ?
           ORDER BY c.last_message_at DESC`
        )
        .all(user.id, user.id);

      const formatted = [];
      for (const c of convos) {
        const friendId = c.user_a_id === user.id ? c.user_b_id : c.user_a_id;
        if (isBlockedEitherWay(user.id, friendId)) continue;
        const friendProf = db
          .prepare('SELECT user_id, username, display_name, avatar_url, district FROM profiles WHERE user_id = ?')
          .get(friendId);
        if (!friendProf) continue;

        const lastMsg = db
          .prepare("SELECT * FROM messages WHERE conversation_id = ? AND moderation_status = 'visible' ORDER BY created_at DESC LIMIT 1")
          .get(c.id);
        const unreadCount = db
          .prepare("SELECT COUNT(*) as cnt FROM messages WHERE conversation_id = ? AND sender_id != ? AND delivery_status != 'read'")
          .get(c.id, user.id).cnt;

        formatted.push({
          conversation_id: c.id,
          friend: friendProf,
          muted: c.user_a_id === user.id ? Boolean(c.muted_by_a) : Boolean(c.muted_by_b),
          last_message: lastMsg || null,
          unread_count: unreadCount,
          last_message_at: c.last_message_at
        });
      }

      return sendJson(res, 200, { conversations: formatted });
    }

    if (pathname.startsWith('/api/conversations/') && pathname.endsWith('/messages')) {
      const user = getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'UNAUTHENTICATED' });
      const friendId = decodeURIComponent(pathname.split('/')[3]);

      // TEEN SAFETY & PRIVACY RULE: Verify neither user blocked the other AND they are accepted friends!
      if (isBlockedEitherWay(user.id, friendId)) {
        return sendJson(res, 403, {
          error: 'CONTACT_BLOCKED',
          message: 'Messaging is unavailable because a block is active between these accounts.'
        });
      }

      if (!areAcceptedFriends(user.id, friendId)) {
        return sendJson(res, 403, {
          error: 'FRIENDS_ONLY_MESSAGING',
          message: 'Teen & Community Safety Policy: Private messages can only be sent between accepted friends. Send a friend request first.'
        });
      }

      let convo = db
        .prepare('SELECT * FROM conversations WHERE (user_a_id = ? AND user_b_id = ?) OR (user_a_id = ? AND user_b_id = ?)')
        .get(user.id, friendId, friendId, user.id);

      const now = new Date().toISOString();
      if (!convo) {
        const cid = 'conv_' + Date.now();
        db.prepare('INSERT INTO conversations (id, user_a_id, user_b_id, muted_by_a, muted_by_b, last_message_at, created_at) VALUES (?, ?, ?, 0, 0, ?, ?)').run(
          cid,
          user.id,
          friendId,
          now,
          now
        );
        convo = db.prepare('SELECT * FROM conversations WHERE id = ?').get(cid);
      }

      if (req.method === 'GET') {
        db.prepare("UPDATE messages SET delivery_status = 'read' WHERE conversation_id = ? AND sender_id != ?").run(convo.id, user.id);
        const messages = db
          .prepare("SELECT * FROM messages WHERE conversation_id = ? AND moderation_status = 'visible' ORDER BY created_at ASC")
          .all(convo.id);
        return sendJson(res, 200, { conversation_id: convo.id, messages });
      }

      if (req.method === 'POST') {
        if (!checkRateLimit(`msg:${user.id}`, brandConfig.rateLimits.messagesPerWindow, brandConfig.rateLimits.windowSeconds)) {
          return sendJson(res, 429, { error: 'RATE_LIMITED', message: 'Message rate limit reached. Slow down.' });
        }
        const body = await readJsonBody(req);
        const text = String(body.body || '').trim();
        const attachmentUrl = String(body.attachment_url || '');
        if (!text && !attachmentUrl) {
          return sendJson(res, 400, { error: 'EMPTY_MESSAGE', message: 'Cannot send an empty message.' });
        }

        const msgId = 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        db.prepare(
          "INSERT INTO messages (id, conversation_id, sender_id, body, attachment_url, delivery_status, moderation_status, created_at) VALUES (?, ?, ?, ?, ?, 'delivered', 'visible', ?)"
        ).run(msgId, convo.id, user.id, text, attachmentUrl, now);
        db.prepare('UPDATE conversations SET last_message_at = ? WHERE id = ?').run(now, convo.id);

        return sendJson(res, 201, {
          message: {
            id: msgId,
            conversation_id: convo.id,
            sender_id: user.id,
            body: text,
            attachment_url: attachmentUrl,
            delivery_status: 'delivered',
            created_at: now
          }
        });
      }
    }

    if (pathname.startsWith('/api/conversations/') && pathname.endsWith('/mute') && req.method === 'POST') {
      const user = getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'UNAUTHENTICATED' });
      const convoId = pathname.split('/')[3];
      const convo = db.prepare('SELECT * FROM conversations WHERE id = ?').get(convoId);
      if (!convo || (convo.user_a_id !== user.id && convo.user_b_id !== user.id)) {
        return sendJson(res, 404, { error: 'CONVERSATION_NOT_FOUND' });
      }
      if (convo.user_a_id === user.id) {
        const nextVal = convo.muted_by_a ? 0 : 1;
        db.prepare('UPDATE conversations SET muted_by_a = ? WHERE id = ?').run(nextVal, convoId);
        return sendJson(res, 200, { muted: Boolean(nextVal) });
      } else {
        const nextVal = convo.muted_by_b ? 0 : 1;
        db.prepare('UPDATE conversations SET muted_by_b = ? WHERE id = ?').run(nextVal, convoId);
        return sendJson(res, 200, { muted: Boolean(nextVal) });
      }
    }

    // =========================================================================
    // SECTION 9: GUILD SYSTEM (PUBLIC & APPROVAL-BASED PRIVATE GUILDS)
    // =========================================================================
    if (pathname === '/api/guilds' && req.method === 'GET') {
      const viewer = getAuthUser(req);
      const guilds = db
        .prepare(
          `SELECT g.*, p.username as owner_username, p.display_name as owner_display_name,
                  (SELECT COUNT(*) FROM guild_memberships gm WHERE gm.guild_id = g.id AND gm.status = 'active') as member_count
           FROM guilds g
           JOIN profiles p ON p.user_id = g.owner_id
           WHERE g.moderation_status = 'visible'
           ORDER BY member_count DESC`
        )
        .all()
        .map((g) => {
          const myMembership = viewer
            ? db.prepare('SELECT role, status FROM guild_memberships WHERE guild_id = ? AND user_id = ?').get(g.id, viewer.id)
            : null;
          return {
            ...g,
            my_role: myMembership ? myMembership.role : null,
            my_status: myMembership ? myMembership.status : null
          };
        });
      return sendJson(res, 200, { guilds });
    }

    if (pathname === '/api/guilds' && req.method === 'POST') {
      const user = getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'UNAUTHENTICATED' });
      const body = await readJsonBody(req);
      const name = String(body.name || '').trim();
      if (name.length < 3) {
        return sendJson(res, 400, { error: 'INVALID_GUILD_NAME', message: 'Guild name must be at least 3 characters.' });
      }
      const existing = db.prepare('SELECT id FROM guilds WHERE LOWER(name) = LOWER(?)').get(name);
      if (existing) return sendJson(res, 409, { error: 'GUILD_NAME_TAKEN', message: 'A guild with this name already exists.' });

      const now = new Date().toISOString();
      const guildId = 'gld_' + Date.now();
      const privacyType = body.privacy_type === 'private' ? 'private' : 'public';
      db.prepare(
        `INSERT INTO guilds (
          id, name, emblem, description, category, district, privacy_type,
          owner_id, member_limit, announcement, moderation_status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'visible', ?)`
      ).run(
        guildId,
        name,
        String(body.emblem || 'sprocket-crown'),
        String(body.description || 'Sri Lankan bicycle riding & build community guild.'),
        String(body.category || 'BMX & Park Flow'),
        String(body.district || user.district || 'Colombo'),
        privacyType,
        user.id,
        brandConfig.defaultGuildMemberLimit,
        String(body.announcement || 'Welcome to our guild! Always inspect your bike and wear a helmet.'),
        now
      );

      db.prepare("INSERT INTO guild_memberships (guild_id, user_id, role, status, joined_at) VALUES (?, ?, 'owner', 'active', ?)").run(
        guildId,
        user.id,
        now
      );

      return sendJson(res, 201, { guildId, message: `Guild "${name}" created!` });
    }

    if (pathname.startsWith('/api/guilds/')) {
      const viewer = getAuthUser(req);
      const parts = pathname.split('/').filter(Boolean);
      const guildId = parts[2];
      const action = parts[3] || '';
      const subId = parts[4] || '';

      const guild = db.prepare('SELECT * FROM guilds WHERE id = ?').get(guildId);
      if (!guild) return sendJson(res, 404, { error: 'GUILD_NOT_FOUND' });

      const myMembership = viewer
        ? db.prepare('SELECT * FROM guild_memberships WHERE guild_id = ? AND user_id = ?').get(guildId, viewer.id)
        : null;
      const isActiveMember = myMembership && myMembership.status === 'active';
      const isOwnerOrMod = isActiveMember && ['owner', 'moderator'].includes(myMembership.role);

      if (req.method === 'GET' && !action) {
        // Note: Guild owners/moderators ONLY see public profile fields of members — never private email, DOB, or DMs!
        const members = db
          .prepare(
            `SELECT gm.user_id, gm.role, gm.status, gm.joined_at,
                    p.username, p.display_name, p.avatar_url, p.district, r.name as rank_name, r.color_hex as rank_color
             FROM guild_memberships gm
             JOIN profiles p ON p.user_id = gm.user_id
             JOIN ranks r ON r.id = p.rank_id
             WHERE gm.guild_id = ?
             ORDER BY CASE gm.role WHEN 'owner' THEN 1 WHEN 'moderator' THEN 2 ELSE 3 END, gm.joined_at ASC`
          )
          .all(guildId);

        const canViewInternal = guild.privacy_type === 'public' || isActiveMember || (viewer && viewer.role === 'admin');
        const messages = canViewInternal
          ? db
              .prepare(
                `SELECT gm.*, p.username, p.display_name, p.avatar_url
                 FROM guild_messages gm
                 JOIN profiles p ON p.user_id = gm.sender_id
                 WHERE gm.guild_id = ? AND gm.moderation_status = 'visible'
                 ORDER BY gm.created_at ASC LIMIT 50`
              )
              .all(guildId)
          : [];

        return sendJson(res, 200, {
          guild: {
            ...guild,
            my_role: myMembership ? myMembership.role : null,
            my_status: myMembership ? myMembership.status : null
          },
          canViewInternal,
          members: canViewInternal ? members : members.filter((m) => m.role === 'owner'),
          pendingRequests: isOwnerOrMod ? members.filter((m) => m.status === 'pending_approval') : [],
          messages
        });
      }

      if (req.method === 'PUT' && !action) {
        const isPlatformAdmin = viewer && viewer.role === 'admin';
        if (!viewer || (!isOwnerOrMod && !isPlatformAdmin)) {
          return sendJson(res, 403, { error: 'FORBIDDEN', message: 'Only guild owners, moderators or studio administrators can edit guild info.' });
        }
        const body = await readJsonBody(req);
        let memberLimit = guild.member_limit;
        if (isPlatformAdmin && body.member_limit !== undefined) {
          const requested = Number(body.member_limit);
          if (Number.isFinite(requested) && requested >= 2 && requested <= 500) {
            memberLimit = Math.floor(requested);
          } else {
            return sendJson(res, 400, { error: 'INVALID_MEMBER_LIMIT', message: 'Member limit must be between 2 and 500.' });
          }
        }
        db.prepare('UPDATE guilds SET description = ?, announcement = ?, privacy_type = ?, member_limit = ? WHERE id = ?').run(
          String(body.description ?? guild.description),
          String(body.announcement ?? guild.announcement),
          body.privacy_type === 'private' ? 'private' : 'public',
          memberLimit,
          guildId
        );
        return sendJson(res, 200, { message: 'Guild updated.', member_limit: memberLimit });
      }

      if (req.method === 'POST' && action === 'invite') {
        if (!viewer || !isOwnerOrMod) {
          return sendJson(res, 403, { error: 'FORBIDDEN', message: 'Only guild owners or moderators can invite riders.' });
        }
        const body = await readJsonBody(req);
        const username = String(body.username || '').trim().toLowerCase().replace(/^@/, '');
        const target = db.prepare('SELECT user_id FROM profiles WHERE username = ?').get(username);
        if (!target) {
          return sendJson(res, 404, { error: 'USER_NOT_FOUND', message: `No rider found with username @${username}.` });
        }
        if (isBlockedEitherWay(viewer.id, target.user_id)) {
          return sendJson(res, 403, { error: 'USER_BLOCKED', message: 'That rider cannot be invited.' });
        }
        const existingMembership = db
          .prepare('SELECT status FROM guild_memberships WHERE guild_id = ? AND user_id = ?')
          .get(guildId, target.user_id);
        if (existingMembership && existingMembership.status === 'active') {
          return sendJson(res, 409, { error: 'ALREADY_MEMBER', message: `@${username} is already a member of this guild.` });
        }
        const activeCount = db
          .prepare("SELECT COUNT(*) as c FROM guild_memberships WHERE guild_id = ? AND status = 'active'")
          .get(guildId).c;
        if (activeCount >= guild.member_limit) {
          return sendJson(res, 400, { error: 'GUILD_FULL', message: 'This guild has reached its member limit.' });
        }
        const now = new Date().toISOString();
        db.prepare(
          "INSERT OR REPLACE INTO guild_memberships (guild_id, user_id, role, status, joined_at) VALUES (?, ?, 'member', 'invited', ?)"
        ).run(guildId, target.user_id, now);
        db.prepare(
          'INSERT INTO notifications (id, user_id, type, title, body, reference_type, reference_id, is_read, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)'
        ).run(
          'notif_' + Date.now() + '_inv',
          target.user_id,
          'guild_invite',
          'Guild invitation',
          `@${viewer.username} invited you to join "${guild.name}".`,
          'guild',
          guildId,
          now
        );
        return sendJson(res, 201, { message: `Invitation sent to @${username}.` });
      }

      if (req.method === 'POST' && action === 'invite-response') {
        if (!viewer || !myMembership || myMembership.status !== 'invited') {
          return sendJson(res, 400, { error: 'NO_PENDING_INVITE', message: 'There is no pending invitation for this guild.' });
        }
        const body = await readJsonBody(req);
        const decision = body.decision === 'accept' ? 'accept' : 'decline';
        if (decision === 'decline') {
          db.prepare('DELETE FROM guild_memberships WHERE guild_id = ? AND user_id = ?').run(guildId, viewer.id);
          return sendJson(res, 200, { message: `You declined the invitation to ${guild.name}.` });
        }
        const activeCount = db
          .prepare("SELECT COUNT(*) as c FROM guild_memberships WHERE guild_id = ? AND status = 'active'")
          .get(guildId).c;
        if (activeCount >= guild.member_limit) {
          return sendJson(res, 400, { error: 'GUILD_FULL', message: 'This guild is now full.' });
        }
        db.prepare("UPDATE guild_memberships SET status = 'active', joined_at = ? WHERE guild_id = ? AND user_id = ?").run(
          new Date().toISOString(),
          guildId,
          viewer.id
        );
        return sendJson(res, 200, { message: `You joined ${guild.name}.` });
      }

      if (req.method === 'POST' && action === 'join') {
        if (!viewer) return sendJson(res, 401, { error: 'UNAUTHENTICATED' });
        const activeCount = db
          .prepare("SELECT COUNT(*) as c FROM guild_memberships WHERE guild_id = ? AND status = 'active'")
          .get(guildId).c;
        if (activeCount >= guild.member_limit) {
          return sendJson(res, 400, { error: 'GUILD_FULL', message: 'This guild has reached its administrator-configured member limit.' });
        }
        const newStatus = guild.privacy_type === 'private' ? 'pending_approval' : 'active';
        db.prepare('INSERT OR REPLACE INTO guild_memberships (guild_id, user_id, role, status, joined_at) VALUES (?, ?, ?, ?, ?)').run(
          guildId,
          viewer.id,
          'member',
          newStatus,
          new Date().toISOString()
        );
        return sendJson(res, 200, {
          status: newStatus,
          message:
            newStatus === 'pending_approval'
              ? 'Join request submitted to guild moderators for approval.'
              : `You have joined ${guild.name}!`
        });
      }

      if (req.method === 'POST' && action === 'leave') {
        if (!viewer) return sendJson(res, 401, { error: 'UNAUTHENTICATED' });
        if (myMembership && myMembership.role === 'owner') {
          return sendJson(res, 400, { error: 'OWNER_CANNOT_LEAVE', message: 'Guild owner must transfer ownership before leaving.' });
        }
        db.prepare('DELETE FROM guild_memberships WHERE guild_id = ? AND user_id = ?').run(guildId, viewer.id);
        // Leaving a guild stops live location sharing and removes live audio participation.
        try {
          db.prepare('DELETE FROM live_location_sessions WHERE guild_id = ? AND user_id = ?').run(guildId, viewer.id);
          db.prepare(
            'DELETE FROM voice_participants WHERE user_id = ? AND room_id IN (SELECT id FROM voice_rooms WHERE guild_id = ?)'
          ).run(viewer.id, guildId);
        } catch (err) {
          /* Phase 2 tables absent on an un-migrated database */
        }
        return sendJson(res, 200, { message: `You left ${guild.name}. Live sharing and voice ended.` });
      }

      if (req.method === 'POST' && action === 'messages') {
        if (!viewer || !isActiveMember) {
          return sendJson(res, 403, { error: 'GUILD_MEMBERS_ONLY', message: 'Only active guild members can post in guild chat.' });
        }
        const body = await readJsonBody(req);
        const text = String(body.body || '').trim();
        if (!text) return sendJson(res, 400, { error: 'EMPTY_MESSAGE' });
        const msgId = 'gmsg_' + Date.now();
        db.prepare("INSERT INTO guild_messages (id, guild_id, sender_id, body, moderation_status, created_at) VALUES (?, ?, ?, ?, 'visible', ?)").run(
          msgId,
          guildId,
          viewer.id,
          text,
          new Date().toISOString()
        );
        return sendJson(res, 201, { messageId: msgId });
      }

      if (req.method === 'POST' && action === 'members' && subId) {
        if (!viewer || !isOwnerOrMod) {
          return sendJson(res, 403, { error: 'FORBIDDEN' });
        }
        const body = await readJsonBody(req);
        if (body.memberAction === 'approve') {
          db.prepare("UPDATE guild_memberships SET status = 'active' WHERE guild_id = ? AND user_id = ?").run(guildId, subId);
          return sendJson(res, 200, { message: 'Member approved.' });
        }
        if (body.memberAction === 'promote' && myMembership.role === 'owner') {
          db.prepare("UPDATE guild_memberships SET role = 'moderator' WHERE guild_id = ? AND user_id = ?").run(guildId, subId);
          return sendJson(res, 200, { message: 'Member promoted to Guild Moderator.' });
        }
        if (body.memberAction === 'remove' && subId !== guild.owner_id) {
          db.prepare('DELETE FROM guild_memberships WHERE guild_id = ? AND user_id = ?').run(guildId, subId);
          return sendJson(res, 200, { message: 'Member removed from guild.' });
        }
        return sendJson(res, 403, {
          error: 'INSUFFICIENT_GUILD_ROLE',
          message: 'Your guild role does not permit this action. Only the owner can promote members.'
        });
      }
      return sendJson(res, 404, { error: 'GUILD_ACTION_NOT_FOUND', message: 'Unknown guild action.' });
    }

    // =========================================================================
    // SECTION 10: STUNT-LEARNING LIBRARY & PROGRESS
    // =========================================================================
    if (pathname === '/api/stunts' && req.method === 'GET') {
      const user = getAuthUser(req);
      const modules = db
        .prepare("SELECT * FROM stunt_modules WHERE COALESCE(visibility, 'public') != 'learning_only' ORDER BY display_order ASC")
        .all();
      const progressMap = new Map();
      if (user) {
        const rows = db.prepare('SELECT * FROM user_stunt_progress WHERE user_id = ?').all(user.id);
        for (const r of rows) progressMap.set(r.module_id, r);
      }

      const enriched = modules.map((m) => {
        const prereqs = JSON.parse(m.prerequisites_json || '[]');
        const userProg = progressMap.get(m.id) || null;
        const missingPrereqs = prereqs.filter((pid) => {
          const p = progressMap.get(pid);
          return !p || p.status !== 'completed';
        });
        return {
          ...m,
          prerequisites: prereqs,
          protective_gear: JSON.parse(m.protective_gear_json || '[]'),
          inspection_checklist: JSON.parse(m.inspection_checklist_json || '[]'),
          learning_stages: JSON.parse(m.learning_stages_json || '[]'),
          common_errors: JSON.parse(m.common_errors_json || '[]'),
          stop_conditions: JSON.parse(m.stop_conditions_json || '[]'),
          quiz_questions: JSON.parse(m.quiz_questions_json || '[]'),
          requires_safety_ack: Boolean(m.requires_safety_ack),
          completed: userProg ? userProg.status === 'completed' : false,
          quiz_score: userProg ? userProg.quiz_score : null,
          locked: missingPrereqs.length > 0,
          missing_prerequisites: missingPrereqs
        };
      });

      return sendJson(res, 200, { modules: enriched });
    }

    if (pathname.startsWith('/api/stunts/') && pathname.endsWith('/complete') && req.method === 'POST') {
      const user = getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'UNAUTHENTICATED' });
      const moduleId = pathname.split('/')[3];
      const mod = db.prepare('SELECT * FROM stunt_modules WHERE id = ?').get(moduleId);
      if (!mod) return sendJson(res, 404, { error: 'MODULE_NOT_FOUND' });

      const prereqs = JSON.parse(mod.prerequisites_json || '[]');
      for (const pid of prereqs) {
        const done = db
          .prepare("SELECT 1 FROM user_stunt_progress WHERE user_id = ? AND module_id = ? AND status = 'completed'")
          .get(user.id, pid);
        if (!done) {
          return sendJson(res, 400, {
            error: 'PREREQUISITES_NOT_MET',
            message: 'You must complete all prerequisite skill modules before unlocking this progression.'
          });
        }
      }

      const body = await readJsonBody(req);
      if (!body.checklistCompleted) {
        return sendJson(res, 400, {
          error: 'CHECKLIST_REQUIRED',
          message: 'Please complete the module Preparation & Equipment Inspection Checklist first.'
        });
      }
      if (mod.requires_safety_ack && !body.safetyAcknowledged) {
        return sendJson(res, 400, {
          error: 'SAFETY_ACK_REQUIRED',
          message: 'This module requires explicit acknowledgement of the Coach Supervision & Controlled Environment Safety Notice.'
        });
      }

      const questions = JSON.parse(mod.quiz_questions_json || '[]');
      const answers = Array.isArray(body.quizAnswers) ? body.quizAnswers : [];
      let correct = 0;
      for (let i = 0; i < questions.length; i++) {
        if (Number(answers[i]) === Number(questions[i].correctIndex)) {
          correct++;
        }
      }
      const score = questions.length > 0 ? Math.round((correct / questions.length) * 100) : 100;
      if (score < 100) {
        return sendJson(res, 400, {
          error: 'QUIZ_NOT_PASSED',
          score,
          message: 'Please review the safety and technique concepts and answer all knowledge check questions correctly (100% required).'
        });
      }

      const now = new Date().toISOString();
      db.prepare(
        `INSERT OR REPLACE INTO user_stunt_progress (
          user_id, module_id, status, checklist_completed, safety_ack_at, quiz_score, completed_at
        ) VALUES (?, ?, 'completed', 1, ?, ?, ?)`
      ).run(user.id, moduleId, now, score, now);

      const xpRes = awardValidatedXp(db, {
        userId: user.id,
        actionType: 'stunt_module_completed',
        xpDelta: mod.xp_reward,
        description: `Completed Stunt Module: ${mod.title}`,
        referenceId: moduleId
      });

      return sendJson(res, 200, {
        message: `Completed "${mod.title}"! +${xpRes ? xpRes.xpAdded : 0} XP awarded.`,
        xpAdded: xpRes ? xpRes.xpAdded : 0,
        profile: formatPublicProfile(user.id, user.id)
      });
    }

    // =========================================================================
    // SECTION 12: SRI LANKAN BICYCLE-PARTS CATALOG
    // =========================================================================
    if (pathname === '/api/parts' && req.method === 'GET') {
      const user = getAuthUser(req);
      const category = parsedUrl.searchParams.get('category') || '';
      const search = (parsedUrl.searchParams.get('search') || '').trim().toLowerCase();
      const verifiedOnly = parsedUrl.searchParams.get('verifiedOnly') === '1';
      const maxPrice = Number(parsedUrl.searchParams.get('maxPrice') || 0);
      const favoritesOnly = parsedUrl.searchParams.get('favoritesOnly') === '1';

      let sql = 'SELECT * FROM parts_catalog WHERE 1=1';
      const params = [];
      if (category) {
        sql += ' AND category = ?';
        params.push(category);
      }
      if (verifiedOnly) {
        sql += ' AND price_verified = 1';
      }
      if (maxPrice > 0) {
        sql += ' AND price_verified = 1 AND price_lkr <= ?';
        params.push(maxPrice);
      }
      if (search) {
        sql += ' AND (LOWER(name) LIKE ? OR LOWER(brand) LIKE ? OR LOWER(description) LIKE ?)';
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
      }
      if (favoritesOnly && user) {
        sql += ' AND EXISTS (SELECT 1 FROM user_part_favorites upf WHERE upf.part_id = parts_catalog.id AND upf.user_id = ?)';
        params.push(user.id);
      }
      sql += ' ORDER BY category ASC, name ASC';

      const favSet = new Set(
        user
          ? db
              .prepare('SELECT part_id FROM user_part_favorites WHERE user_id = ?')
              .all(user.id)
              .map((r) => r.part_id)
          : []
      );

      const parts = db.prepare(sql).all(...params).map((p) => ({
        ...p,
        price_verified: Boolean(p.price_verified),
        price_display: p.price_verified && p.price_lkr ? `LKR ${Number(p.price_lkr).toLocaleString('en-LK')}` : 'Price not verified',
        favorited_by_me: favSet.has(p.id)
      }));

      return sendJson(res, 200, {
        catalogDisclaimer:
          'Information & Discovery Directory Only: RideRise LK Phase 1 does not process payments or delivery. Unverified prices are explicitly marked "Price not verified". Always verify part compatibility with a qualified bicycle mechanic before installation.',
        parts
      });
    }

    if (pathname.startsWith('/api/parts/') && pathname.endsWith('/favorite') && req.method === 'POST') {
      const user = getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'UNAUTHENTICATED' });
      const partId = pathname.split('/')[3];
      const existing = db
        .prepare('SELECT 1 FROM user_part_favorites WHERE user_id = ? AND part_id = ?')
        .get(user.id, partId);
      if (existing) {
        db.prepare('DELETE FROM user_part_favorites WHERE user_id = ? AND part_id = ?').run(user.id, partId);
        return sendJson(res, 200, { favorited: false });
      } else {
        db.prepare('INSERT INTO user_part_favorites (user_id, part_id, created_at) VALUES (?, ?, ?)').run(
          user.id,
          partId,
          new Date().toISOString()
        );
        return sendJson(res, 200, { favorited: true });
      }
    }

    // =========================================================================
    // SECTION 13: EVENTS HOSTED BY SHAUN DAVID STUDIOS
    // =========================================================================
    if (pathname === '/api/events' && req.method === 'GET') {
      const user = getAuthUser(req);
      const events = db
        .prepare(
          `SELECT e.*,
                  (SELECT COUNT(*) FROM event_registrations er WHERE er.event_id = e.id AND er.status = 'registered') as registered_count
           FROM studio_events e
           ORDER BY CASE e.status WHEN 'featured' THEN 1 WHEN 'upcoming' THEN 2 WHEN 'past' THEN 3 ELSE 4 END, e.event_date ASC`
        )
        .all()
        .map((e) => {
          const myReg = user
            ? db
                .prepare("SELECT status FROM event_registrations WHERE event_id = ? AND user_id = ? AND status = 'registered'")
                .get(e.id, user.id)
            : null;
          // Privacy rule: Never expose attendee private contact details or attendee lists publicly
          return {
            ...e,
            is_official_studio_event: Boolean(e.is_official_studio_event),
            announcements: JSON.parse(e.announcements_json || '[]'),
            registered_by_me: Boolean(myReg)
          };
        });
      return sendJson(res, 200, { events });
    }

    if (pathname.startsWith('/api/events/') && (pathname.endsWith('/register') || pathname.endsWith('/cancel')) && req.method === 'POST') {
      const user = getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'UNAUTHENTICATED' });
      const parts = pathname.split('/').filter(Boolean);
      const eventId = parts[2];
      const action = parts[3];

      const ev = db.prepare('SELECT * FROM studio_events WHERE id = ?').get(eventId);
      if (!ev) return sendJson(res, 404, { error: 'EVENT_NOT_FOUND' });

      if (action === 'register') {
        if (ev.status === 'cancelled' || ev.status === 'past') {
          return sendJson(res, 400, { error: 'EVENT_CLOSED', message: 'Registration is closed for this event.' });
        }
        const count = db
          .prepare("SELECT COUNT(*) as c FROM event_registrations WHERE event_id = ? AND status = 'registered'")
          .get(eventId).c;
        if (count >= ev.capacity) {
          return sendJson(res, 400, { error: 'EVENT_FULL', message: 'This event has reached full capacity.' });
        }
        const now = new Date().toISOString();
        db.prepare(
          "INSERT OR REPLACE INTO event_registrations (event_id, user_id, status, emergency_ack, registered_at) VALUES (?, ?, 'registered', 1, ?)"
        ).run(eventId, user.id, now);

        if (ev.is_official_studio_event) {
          awardValidatedXp(db, {
            userId: user.id,
            actionType: 'official_event_registered',
            xpDelta: 30,
            description: `Registered for Official Studio Event: ${ev.title}`,
            referenceId: eventId
          });
        }
        return sendJson(res, 200, { message: `Registered for "${ev.title}"! Remember your certified helmet.` });
      }

      if (action === 'cancel') {
        db.prepare("UPDATE event_registrations SET status = 'cancelled' WHERE event_id = ? AND user_id = ?").run(eventId, user.id);
        return sendJson(res, 200, { message: 'Registration cancelled.' });
      }
    }

    // =========================================================================
    // SECTION 14: REPORTS, MODERATION & ADMINISTRATION (RBAC ENFORCED)
    // =========================================================================
    if (pathname === '/api/reports' && req.method === 'POST') {
      const user = getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'UNAUTHENTICATED' });
      if (!checkRateLimit(`rep:${user.id}`, brandConfig.rateLimits.reportsPerWindow, brandConfig.rateLimits.windowSeconds)) {
        return sendJson(res, 429, { error: 'RATE_LIMITED', message: 'Too many reports submitted recently.' });
      }
      const body = await readJsonBody(req);
      const validTargets = ['post', 'comment', 'user', 'message', 'guild', 'event'];
      const validReasons = [
        'bullying_harassment',
        'threats_violence',
        'impersonation',
        'unwanted_sexual_content',
        'suspicious_pii_request',
        'dangerous_road_stunt',
        'scam_marketplace',
        'other'
      ];
      const targetType = validTargets.includes(body.target_type) ? body.target_type : 'post';
      const reasonCategory = validReasons.includes(body.reason_category) ? body.reason_category : 'other';
      const targetId = String(body.target_id || '').trim();
      const details = String(body.details || '').trim();

      if (!targetId || details.length < 4) {
        return sendJson(res, 400, { error: 'INVALID_REPORT', message: 'Please select a reason and provide brief details for our safety team.' });
      }

      const repId = 'rep_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
      db.prepare(
        "INSERT INTO reports (id, reporter_id, target_type, target_id, reason_category, details, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)"
      ).run(repId, user.id, targetType, targetId, reasonCategory, details, new Date().toISOString());

      return sendJson(res, 201, {
        reportId: repId,
        message: 'Thank you. Your report has been encrypted and queued for Shaun David Studios Safety & Moderation review.'
      });
    }

    if (pathname === '/api/notifications' && req.method === 'GET') {
      const user = getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'UNAUTHENTICATED' });
      const items = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 30').all(user.id);
      return sendJson(res, 200, { notifications: items });
    }

    if (pathname === '/api/notifications/read-all' && req.method === 'POST') {
      const user = getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'UNAUTHENTICATED' });
      db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(user.id);
      return sendJson(res, 200, { message: 'All notifications marked as read.' });
    }

    // ADMIN CONSOLE ENDPOINTS (Strictly restricted to admin / moderator roles)
    if (pathname.startsWith('/api/admin/')) {
      const user = getAuthUser(req);
      if (!user || !['admin', 'moderator'].includes(user.role)) {
        return sendJson(res, 403, {
          error: 'ADMIN_AUTHORIZATION_REQUIRED',
          message: 'Access Denied: This endpoint requires an authorized Shaun David Studios Administrator or Moderator role.'
        });
      }

      if (pathname === '/api/admin/overview' && req.method === 'GET') {
        const metrics = {
          totalRiders: db.prepare("SELECT COUNT(*) as c FROM users_private WHERE account_status = 'active'").get().c,
          minorAccountsProtected: db.prepare("SELECT COUNT(*) as c FROM users_private WHERE is_minor = 1 AND account_status = 'active'").get().c,
          totalBikes: db.prepare('SELECT COUNT(*) as c FROM bicycles').get().c,
          bikesWithSafetyWarnings: db.prepare('SELECT COUNT(*) as c FROM bicycles WHERE has_critical_safety_defect = 1').get().c,
          visiblePosts: db.prepare("SELECT COUNT(*) as c FROM posts WHERE moderation_status = 'visible'").get().c,
          pendingReviewPosts: db.prepare("SELECT COUNT(*) as c FROM posts WHERE moderation_status = 'pending_review'").get().c,
          pendingReports: db.prepare("SELECT COUNT(*) as c FROM reports WHERE status = 'pending'").get().c,
          activeGuilds: db.prepare("SELECT COUNT(*) as c FROM guilds WHERE moderation_status = 'visible'").get().c,
          verifiedPartsCount: db.prepare('SELECT COUNT(*) as c FROM parts_catalog WHERE price_verified = 1').get().c,
          unverifiedPartsCount: db.prepare('SELECT COUNT(*) as c FROM parts_catalog WHERE price_verified = 0').get().c
        };

        const reports = db
          .prepare(
            `SELECT r.*, p.username as reporter_username
             FROM reports r
             JOIN profiles p ON p.user_id = r.reporter_id
             ORDER BY CASE r.status WHEN 'pending' THEN 1 ELSE 2 END, r.created_at DESC LIMIT 50`
          )
          .all();

        const pendingPosts = db
          .prepare(
            `SELECT p.*, pr.username
             FROM posts p
             JOIN profiles pr ON pr.user_id = p.user_id
             WHERE p.moderation_status IN ('pending_review', 'hidden')
             ORDER BY p.created_at DESC`
          )
          .all();

        const auditLogs = db
          .prepare(
            `SELECT a.*, p.username as admin_username
             FROM admin_audit_logs a
             JOIN profiles p ON p.user_id = a.admin_id
             ORDER BY a.created_at DESC LIMIT 30`
          )
          .all();

        return sendJson(res, 200, { metrics, reports, pendingPosts, auditLogs });
      }

      if (pathname.startsWith('/api/admin/reports/') && pathname.endsWith('/resolve') && req.method === 'POST') {
        const repId = pathname.split('/')[4];
        const body = await readJsonBody(req);
        const rep = db.prepare('SELECT * FROM reports WHERE id = ?').get(repId);
        if (!rep) return sendJson(res, 404, { error: 'REPORT_NOT_FOUND' });

        const now = new Date().toISOString();
        const decision = body.decision || 'action_taken'; // action_taken | dismissed
        const note = String(body.resolution_note || 'Reviewed by moderation team.');
        // accountAction: 'none' | 'warn' | 'suspend'; suspensionDays 1..365 or 'permanent'
        const accountAction = ['none', 'warn', 'suspend'].includes(body.accountAction) ? body.accountAction : 'none';
        const suspensionDays = body.suspensionDays === 'permanent' ? null : Math.min(365, Math.max(1, Number(body.suspensionDays) || 7));

        if (decision === 'action_taken') {
          if (rep.target_type === 'post') {
            db.prepare("UPDATE posts SET moderation_status = 'removed' WHERE id = ?").run(rep.target_id);
          } else if (rep.target_type === 'comment') {
            db.prepare("UPDATE comments SET moderation_status = 'removed' WHERE id = ?").run(rep.target_id);
          } else if (rep.target_type === 'guild') {
            db.prepare("UPDATE guilds SET moderation_status = 'restricted' WHERE id = ?").run(rep.target_id);
          }
        }

        // Account actions may also be applied to a reported user (or the author of reported content)
        let targetUserId = null;
        if (rep.target_type === 'user') targetUserId = rep.target_id;
        if (rep.target_type === 'post') {
          const reportedPost = db.prepare('SELECT user_id FROM posts WHERE id = ?').get(rep.target_id);
          if (reportedPost) targetUserId = reportedPost.user_id;
        }
        if (accountAction !== 'none' && targetUserId) {
          if (accountAction === 'warn') {
            db.prepare("UPDATE users_private SET account_status = CASE WHEN account_status = 'active' THEN 'warned' ELSE account_status END WHERE id = ?").run(targetUserId);
          } else {
            const until = body.suspensionDays === 'permanent' || suspensionDays === null
              ? null
              : new Date(Date.now() + suspensionDays * 86400000).toISOString();
            db.prepare("UPDATE users_private SET account_status = 'suspended', suspension_reason = ?, suspension_until = ? WHERE id = ?").run(
              note,
              until,
              targetUserId
            );
          }
          db.prepare(
            'INSERT INTO notifications (id, user_id, type, title, body, reference_type, reference_id, is_read, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)'
          ).run(
            'notif_' + Date.now() + '_adm',
            targetUserId,
            'moderation_update',
            accountAction === 'warn' ? 'Community Guidelines warning' : 'Account suspended',
            `${note}${accountAction === 'suspend' ? ` Suspension length: ${body.suspensionDays === 'permanent' ? 'permanent' : suspensionDays + ' days'}.` : ''}`,
            'report',
            rep.id,
            now
          );
        }

        db.prepare('UPDATE reports SET status = ?, resolution_note = ?, resolved_by_admin_id = ?, resolved_at = ? WHERE id = ?').run(
          decision,
          note,
          user.id,
          now,
          repId
        );

        db.prepare(
          'INSERT INTO admin_audit_logs (id, admin_id, action, target_type, target_id, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).run('aud_' + Date.now(), user.id, `resolve_report_${decision}`, rep.target_type, rep.target_id, JSON.stringify({ repId, note }), now);

        // Send transparent moderation notice to reporter
        db.prepare(
          'INSERT INTO notifications (id, user_id, type, title, body, reference_type, reference_id, is_read, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)'
        ).run(
          'notif_' + Date.now(),
          rep.reporter_id,
          'moderation_update',
          'Safety Report Reviewed',
          `Your report (${rep.reason_category}) was reviewed by Shaun David Studios moderators: ${note}`,
          'report',
          repId,
          now
        );

        return sendJson(res, 200, { message: 'Report resolved and audit log recorded.' });
      }

      const postModMatch = /^\/api\/admin\/posts\/([^/]+)\/moderate$/.exec(pathname);
      if (postModMatch && req.method === 'POST') {
        const postId = decodeURIComponent(postModMatch[1]);
        const body = await readJsonBody(req);
        const nextStatus = ['visible', 'hidden', 'removed'].includes(body.status) ? body.status : null;
        if (!nextStatus) {
          return sendJson(res, 400, { error: 'INVALID_MODERATION_STATUS', message: 'Status must be visible, hidden or removed.' });
        }
        const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(postId);
        if (!post) return sendJson(res, 404, { error: 'POST_NOT_FOUND' });
        const now = new Date().toISOString();
        db.prepare('UPDATE posts SET moderation_status = ?, updated_at = ? WHERE id = ?').run(nextStatus, now, postId);
        db.prepare(
          'INSERT INTO admin_audit_logs (id, admin_id, action, target_type, target_id, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).run(
          'aud_' + Date.now(),
          user.id,
          `moderate_post_${nextStatus}`,
          'post',
          postId,
          JSON.stringify({ note: body.note || '' }),
          now
        );
        if (nextStatus !== 'visible' && post.user_id) {
          db.prepare(
            'INSERT INTO notifications (id, user_id, type, title, body, reference_type, reference_id, is_read, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)'
          ).run(
            'notif_' + Date.now() + '_m',
            post.user_id,
            'moderation_update',
            'Content moderation notice',
            `A moderator ${nextStatus === 'removed' ? 'removed' : 'hid'} your post "${String(post.title).slice(0, 60)}". ${body.note || 'See the Community Guidelines for details.'}`,
            'post',
            postId,
            now
          );
        }
        return sendJson(res, 200, { message: `Post marked ${nextStatus}.`, status: nextStatus });
      }

      if (pathname === '/api/admin/ranks' && req.method === 'POST') {
        if (user.role !== 'admin') return sendJson(res, 403, { error: 'STUDIO_ADMIN_ONLY' });
        const body = await readJsonBody(req);
        const now = new Date().toISOString();

        if (body.id) {
          db.prepare('UPDATE ranks SET name = ?, min_xp = ?, description = ? WHERE id = ?').run(
            String(body.name).trim(),
            Number(body.min_xp),
            String(body.description || ''),
            body.id
          );
          db.prepare(
            'INSERT INTO admin_audit_logs (id, admin_id, action, target_type, target_id, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
          ).run('aud_' + Date.now(), user.id, 'update_rank', 'rank', body.id, JSON.stringify(body), now);
          return sendJson(res, 200, { message: 'Rank updated.' });
        } else {
          const maxOrder = db.prepare('SELECT MAX(level_order) as m FROM ranks').get().m || 7;
          const newId = 'rank_' + (maxOrder + 1);
          db.prepare('INSERT INTO ranks (id, level_order, name, min_xp, badge_icon, color_hex, description) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
            newId,
            maxOrder + 1,
            String(body.name || 'New Rank').trim(),
            Number(body.min_xp || 3000),
            String(body.badge_icon || 'star-crank'),
            String(body.color_hex || '#FF6B00'),
            String(body.description || 'Custom administrator rank.')
          );
          db.prepare(
            'INSERT INTO admin_audit_logs (id, admin_id, action, target_type, target_id, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
          ).run('aud_' + Date.now(), user.id, 'create_rank', 'rank', newId, JSON.stringify(body), now);
          return sendJson(res, 201, { rankId: newId, message: 'New rank created.' });
        }
      }

      if (pathname === '/api/admin/parts' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const now = new Date().toISOString();
        const verified = body.price_verified && body.price_lkr ? 1 : 0;
        const priceVal = verified ? Number(body.price_lkr) : null;
        const verifiedDate = verified ? now.slice(0, 10) : (body.last_verified_date || now.slice(0, 10));

        if (body.id) {
          db.prepare(
            `UPDATE parts_catalog
             SET name = ?, brand = ?, price_lkr = ?, price_verified = ?, retailer_name = ?,
                 availability = ?, last_verified_date = ?, updated_by_admin_id = ?
             WHERE id = ?`
          ).run(
            String(body.name),
            String(body.brand),
            priceVal,
            verified,
            String(body.retailer_name || 'Sri Lanka Cycle Parts Directory'),
            String(body.availability || (verified ? 'In Stock (Verified)' : 'Price & Stock Not Verified')),
            verifiedDate,
            user.id,
            body.id
          );
          return sendJson(res, 200, { message: 'Part catalog entry updated.' });
        } else {
          const partId = 'part_' + Date.now();
          db.prepare(
            `INSERT INTO parts_catalog (
              id, name, brand, category, compatible_bike_types, description, image_url,
              price_lkr, price_verified, retailer_name, source_contact, availability,
              compatibility_warning, last_verified_date, updated_by_admin_id
            ) VALUES (?, ?, ?, ?, ?, ?, '/assets/brand/riderise_logo.png', ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            partId,
            String(body.name),
            String(body.brand),
            String(body.category || 'pegs_accessories'),
            String(body.compatible_bike_types || 'BMX / Freestyle'),
            String(body.description || ''),
            priceVal,
            verified,
            String(body.retailer_name || 'Sri Lanka Cycle Parts Directory'),
            String(body.source_contact || 'Verify with retailer'),
            String(body.availability || (verified ? 'In Stock (Verified)' : 'Price Not Verified')),
            String(body.compatibility_warning || 'Inspect compatibility with a qualified bicycle mechanic.'),
            verifiedDate,
            user.id
          );
          return sendJson(res, 201, { partId, message: 'New bicycle part added to catalog.' });
        }
      }

      if (pathname === '/api/admin/events' && req.method === 'POST') {
        if (user.role !== 'admin') {
          return sendJson(res, 403, {
            error: 'OFFICIAL_STUDIO_ADMIN_ONLY',
            message: 'Only authorized Shaun David Studios administrators can publish Official Studio Events.'
          });
        }
        const body = await readJsonBody(req);
        const now = new Date().toISOString();
        const eventId = 'evt_sds_' + Date.now();
        db.prepare(
          `INSERT INTO studio_events (
            id, title, banner_type, description, schedule_text, event_date, district, venue,
            registration_deadline, capacity, is_official_studio_event, status, eligibility_requirements,
            equipment_safety_requirements, organizer_contact, announcements_json, post_event_recap,
            created_by_admin_id, created_at
          ) VALUES (?, ?, 'sunset_jam', ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, '', ?, ?)`
        ).run(
          eventId,
          String(body.title),
          String(body.description || ''),
          String(body.schedule_text || 'TBD'),
          String(body.event_date || '2026-12-05'),
          String(body.district || 'Colombo'),
          String(body.venue || 'Designated Practice Arena'),
          String(body.registration_deadline || '2026-12-01'),
          Number(body.capacity || 50),
          String(body.status || 'upcoming'),
          String(body.eligibility_requirements || 'Riders aged 16+'),
          String(body.equipment_safety_requirements || 'Mandatory certified helmet, bar-ends, and pre-ride inspection.'),
          String(body.organizer_contact || 'safety@shaundavidstudios.lk'),
          JSON.stringify(body.announcements || ['Official Shaun David Studios Hosted Event']),
          user.id,
          now
        );
        return sendJson(res, 201, { eventId, message: 'Official Shaun David Studios event published!' });
      }
    }

    // Unknown API routes must never fall through to the SPA shell
    if (pathname.startsWith('/api/')) {
      return sendJson(res, 404, {
        error: 'API_ROUTE_NOT_FOUND',
        message: `No API route matches ${req.method} ${pathname}.`
      });
    }

    // =========================================================================
    // STATIC ASSETS & ANDROID APK DOWNLOADS
    // =========================================================================
    if (pathname.startsWith('/assets/brand/')) {
      const fileName = path.basename(pathname);
      const filePath = path.join(__dirname, '..', 'assets', 'brand', fileName);
      if (fs.existsSync(filePath)) {
        return sendStaticFile(req, res, filePath, { cacheSeconds: 86400 });
      }
    }

    if (pathname.startsWith('/release/apk/') || pathname.startsWith('/dist/apk/')) {
      const fileName = path.basename(pathname);
      const filePath = path.join(__dirname, '..', 'release', 'apk', fileName);
      if (fs.existsSync(filePath)) {
        return sendStaticFile(req, res, filePath, { cacheSeconds: 86400, download: true });
      }
    }

    // Serve Web App Frontend
    let staticPath = pathname === '/' ? '/index.html' : pathname;
    const webAppRoot = path.join(__dirname, '..', 'web_app');
    const resolvedFile = path.normalize(path.join(webAppRoot, staticPath));
    if (resolvedFile.startsWith(webAppRoot) && fs.existsSync(resolvedFile) && fs.statSync(resolvedFile).isFile()) {
      const isShell = resolvedFile.endsWith('index.html');
      return sendStaticFile(req, res, resolvedFile, { cacheSeconds: isShell ? 0 : 300 });
    }

    // SPA Fallback to index.html
    const indexFile = path.join(webAppRoot, 'index.html');
    if (fs.existsSync(indexFile)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return fs.createReadStream(indexFile).pipe(res);
    }

    return sendJson(res, 404, { error: 'NOT_FOUND', path: pathname });
  } catch (err) {
    if (err.message === 'PAYLOAD_TOO_LARGE') {
      return sendJson(res, 413, { error: 'PAYLOAD_TOO_LARGE', message: 'Upload exceeds size limit.' });
    }
    console.error('Server error:', err);
    return sendJson(res, 500, { error: 'INTERNAL_SERVER_ERROR', message: err.message });
  }
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    // Bracket an IPv6 bind (HOST=::) so the address is readable and copy-pasteable.
    const shownHost = HOST.includes(':') ? `[${HOST}]` : HOST;
    console.log(`RideRise LK by Shaun David Studios — Backend & App Server listening on http://${shownHost}:${PORT}`);
  });
}

module.exports = { server, db, firebaseAuth };
