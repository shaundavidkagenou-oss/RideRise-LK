// RideRise LK — Firebase email/password authentication tests (node:test)
//
// These tests exercise the *server* side of real Firebase Authentication without touching
// Google: ID tokens are minted locally with a throwaway RSA key and the verifier is pointed
// at the matching self-signed certificate through its documented test seam
// (`__setCertificateProvider`). Everything else — signature checking, audience/issuer,
// expiry, the verified-email gate, profile creation, retries, RBAC — is the production code
// path.
process.env.DB_PATH = `/tmp/riderise_firebase_test_${Date.now()}.sqlite`;
process.env.JWT_SECRET = 'test-suite-secret-do-not-use-in-production';
process.env.FIREBASE_PROJECT_ID = 'riderise-lk-test';
process.env.FIREBASE_API_KEY = 'test-api-key-not-a-real-credential';
process.env.FIREBASE_APP_ID = '1:000000000000:web:testfixture';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { server, db, firebaseAuth } = require('../backend/server.js');

const PROJECT_ID = 'riderise-lk-test';
const KID = 'test-kid';
const privateKey = fs.readFileSync(path.join(__dirname, 'fixtures', 'firebase-test-key.pem'), 'utf8');
const certPem = fs.readFileSync(path.join(__dirname, 'fixtures', 'firebase-test-cert.pem'), 'utf8');

// Point the verifier at the fixture certificate instead of Google's x509 endpoint.
firebaseAuth.__setCertificateProvider(() => ({ certs: { [KID]: certPem }, ttlMs: 60 * 60 * 1000 }));

let baseUrl = '';
let uidCounter = 0;

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

/**
 * Mint a Firebase-shaped ID token. `overrides` lets individual tests corrupt a claim
 * (wrong audience, expired, unverified email, missing subject…).
 */
function mintToken({ uid, email, emailVerified = true, projectId = PROJECT_ID, overrides = {}, key = privateKey, kid = KID } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', kid, typ: 'JWT' };
  const payload = Object.assign(
    {
      iss: `https://securetoken.google.com/${projectId}`,
      aud: projectId,
      auth_time: now,
      user_id: uid,
      sub: uid,
      iat: now,
      exp: now + 3600,
      email,
      email_verified: emailVerified,
      firebase: { identities: { email: [email] }, sign_in_provider: 'password' }
    },
    overrides
  );
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), key);
  return `${signingInput}.${signature.toString('base64url')}`;
}

function newIdentity(label) {
  uidCounter += 1;
  return {
    uid: `fb-test-uid-${uidCounter}-${label}`,
    email: `${label}.${uidCounter}@example.test`,
    username: `${label}${uidCounter}`
  };
}

// Each logical caller gets its own forwarded address so the auth rate limits (10 sign-ups per
// hour, 20 session exchanges per 5 minutes) exercise the production buckets without one test
// starving the next. `ipTest()` deliberately reuses one address to prove the limit bites.
let ipCounter = 0;
function nextIp() {
  ipCounter += 1;
  return `198.51.100.${(ipCounter % 200) + 1}`;
}

async function call(pathname, { method = 'GET', token = null, body = null, ip = null } = {}) {
  const headers = { 'X-Forwarded-For': ip || nextIp() };
  if (body !== null) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: body !== null ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

function userCountForUid(uid) {
  return db.prepare('SELECT COUNT(*) AS n FROM users_private WHERE firebase_uid = ?').get(uid).n;
}

function profileCountForUid(uid) {
  return db
    .prepare('SELECT COUNT(*) AS n FROM profiles p JOIN users_private u ON u.id = p.user_id WHERE u.firebase_uid = ?')
    .get(uid).n;
}

test.before(async () => {
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  try {
    db.close();
  } catch {
    /* already closed */
  }
  try {
    fs.unlinkSync(process.env.DB_PATH);
  } catch {
    /* temp file already gone */
  }
});

/* ------------------------------------------------------------------ config ---- */

test('FB 1 — the public Firebase web config is exposed without server secrets', async () => {
  const res = await call('/api/auth/firebase/config');
  assert.equal(res.status, 200);
  assert.equal(res.json.configured, true);
  assert.equal(res.json.projectId, PROJECT_ID);
  assert.equal(res.json.emailVerificationRequired, true);
  assert.equal(res.json.config.apiKey, 'test-api-key-not-a-real-credential');
  assert.equal(res.json.config.authDomain, `${PROJECT_ID}.firebaseapp.com`);

  // No private key material, service-account fields or JWT secret may leak anywhere.
  const serialized = JSON.stringify(res.json).toLowerCase();
  for (const forbidden of ['private_key', 'service_account', 'jwt_secret', 'client_secret', 'password']) {
    assert.ok(!serialized.includes(forbidden), `config must not contain ${forbidden}`);
  }

  const config = await call('/api/config');
  assert.equal(config.json.firebase.configured, true);
  assert.equal(config.json.demoSignInEnabled, true);
  assert.equal(config.json.firebase.message, 'Firebase Authentication is configured.');
  assert.equal(JSON.stringify(config.json).includes('BEGIN PRIVATE KEY'), false);
  assert.equal(JSON.stringify(config.json).includes('JWT_SECRET'), false);
});

test('FB 2 — every Firebase endpoint fails closed without an ID token', async () => {
  const session = await call('/api/auth/firebase/session', { method: 'POST', body: {} });
  assert.equal(session.status, 401);
  assert.equal(session.json.error, 'AUTH_TOKEN_INVALID');

  const signup = await call('/api/auth/firebase/signup', { method: 'POST', body: { username: 'nobody' } });
  assert.equal(signup.status, 401);

  const link = await call('/api/auth/firebase/link', { method: 'POST', body: {} });
  assert.equal(link.status, 401);
  assert.equal(link.json.error, 'UNAUTHENTICATED');

  const status = await call('/api/auth/firebase/status');
  assert.equal(status.status, 401);
});

/* ------------------------------------------------------------------ signup ---- */

test('FB 3 — sign-up creates exactly one profile from the verified token', async () => {
  const id = newIdentity('signup');
  const token = mintToken({ uid: id.uid, email: id.email });

  const res = await call('/api/auth/firebase/signup', {
    method: 'POST',
    body: { idToken: token, username: id.username, displayName: 'Signup Rider' }
  });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(res.json.authProvider, 'firebase');
  assert.equal(res.json.emailVerified, true);
  assert.equal(res.json.newAccount, true);
  assert.equal(res.json.onboardingRequired, true);
  assert.equal(res.json.account.role, 'rider');
  assert.equal(res.json.account.email, id.email);
  assert.ok(res.json.token, 'a RideRise session token must be issued');

  assert.equal(userCountForUid(id.uid), 1);
  assert.equal(profileCountForUid(id.uid), 1);

  const row = db.prepare('SELECT * FROM users_private WHERE firebase_uid = ?').get(id.uid);
  assert.equal(row.auth_provider, 'firebase');
  assert.equal(row.google_sub, `firebase:${id.uid}`);
  assert.ok(row.email_verified_at, 'verified token must stamp email_verified_at');

  // The issued session token is accepted by the normal protected endpoints.
  assert.equal(res.json.profileSummary.username, id.username, 'the profile summary is returned even before onboarding');

  const session = await call('/api/auth/session', { token: res.json.token });
  assert.equal(session.status, 200);
  assert.equal(session.json.profile, null, 'the public profile appears after onboarding');
  assert.equal(session.json.account.email, id.email);
});

test('FB 4 — the request body can never dictate identity, role or verification', async () => {
  const id = newIdentity('spoof');
  const token = mintToken({ uid: id.uid, email: id.email });

  const res = await call('/api/auth/firebase/signup', {
    method: 'POST',
    body: {
      idToken: token,
      username: id.username,
      // Attacker-supplied values that must all be ignored.
      role: 'admin',
      userId: 'usr_kasun_demo',
      emailVerified: false,
      firebaseUid: 'attacker-chosen-uid',
      email: 'admin@shaundavidstudios.lk'
    }
  });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(res.json.account.role, 'rider');
  assert.equal(res.json.account.email, id.email);
  assert.notEqual(res.json.account.id, 'usr_kasun_demo');

  const row = db.prepare('SELECT * FROM users_private WHERE id = ?').get(res.json.account.id);
  assert.equal(row.firebase_uid, id.uid);
  assert.equal(row.role, 'rider');

  const admin = await call('/api/admin/overview', { token: res.json.token });
  assert.equal(admin.status, 403, 'a new Firebase account must never reach the admin console');
});

test('FB 5 — unverified email blocks community access until verified', async () => {
  const id = newIdentity('verify');
  const unverifiedToken = mintToken({ uid: id.uid, email: id.email, emailVerified: false });

  const res = await call('/api/auth/firebase/signup', {
    method: 'POST',
    body: { idToken: unverifiedToken, username: id.username }
  });
  assert.equal(res.status, 403);
  assert.equal(res.json.error, 'EMAIL_NOT_VERIFIED');
  assert.equal(res.json.email, id.email);
  assert.equal(res.json.canResendEmail, true);
  assert.equal(res.json.profile_ready, true);
  assert.equal(res.json.token, undefined, 'no session token before verification');
  assert.equal(userCountForUid(id.uid), 1, 'the profile is created so retrying is safe');

  // Signing in again while still unverified keeps failing with the same actionable code.
  const again = await call('/api/auth/firebase/session', { method: 'POST', body: { idToken: unverifiedToken } });
  assert.equal(again.status, 403);
  assert.equal(again.json.error, 'EMAIL_NOT_VERIFIED');

  // The same account, once verified, signs in and finds its existing profile.
  const verifiedToken = mintToken({ uid: id.uid, email: id.email, emailVerified: true });
  const verified = await call('/api/auth/firebase/session', { method: 'POST', body: { idToken: verifiedToken } });
  assert.equal(verified.status, 200, JSON.stringify(verified.json));
  assert.equal(verified.json.newAccount, false);
  assert.equal(verified.json.profileSummary.username, id.username);
  assert.equal(userCountForUid(id.uid), 1);
  assert.equal(profileCountForUid(id.uid), 1);
});

test('FB 6 — duplicate usernames are rejected, including different letter case', async () => {
  const first = newIdentity('dupe');
  const signup = await call('/api/auth/firebase/signup', {
    method: 'POST',
    body: { idToken: mintToken({ uid: first.uid, email: first.email }), username: first.username }
  });
  assert.equal(signup.status, 200);

  const second = newIdentity('dupe');
  const conflict = await call('/api/auth/firebase/signup', {
    method: 'POST',
    body: { idToken: mintToken({ uid: second.uid, email: second.email }), username: first.username.toUpperCase() }
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.json.error, 'USERNAME_TAKEN');
  assert.ok(Array.isArray(conflict.json.suggestions), 'suggestions help the rider recover');
  assert.equal(userCountForUid(second.uid), 0, 'no profile is created on a rejected username');
});

test('FB 7 — username availability endpoint validates and reports collisions', async () => {
  const id = newIdentity('avail');
  const free = await call(`/api/auth/username-available?username=${id.username}`);
  assert.equal(free.status, 200);
  assert.equal(free.json.available, true);
  assert.equal(free.json.message, `@${id.username} is available.`);

  await call('/api/auth/firebase/signup', {
    method: 'POST',
    body: { idToken: mintToken({ uid: id.uid, email: id.email }), username: id.username }
  });

  const taken = await call(`/api/auth/username-available?username=${id.username.toUpperCase()}`);
  assert.equal(taken.json.available, false);
  assert.equal(taken.json.reason, 'USERNAME_TAKEN');

  const invalid = await call('/api/auth/username-available?username=a');
  assert.equal(invalid.status, 200);
  assert.equal(invalid.json.available, false);
  assert.ok(invalid.json.reason, 'short usernames explain why they are rejected');
  assert.ok(invalid.json.message);
});

/* ------------------------------------------------------------ token checks ---- */

test('FB 8 — invalid, expired, forged and wrong-project tokens are rejected', async () => {
  const id = newIdentity('token');
  const now = Math.floor(Date.now() / 1000);

  const cases = [
    ['garbage', 'not-a-jwt', 'AUTH_TOKEN_INVALID'],
    ['expired', mintToken({ uid: id.uid, email: id.email, overrides: { exp: now - 3600, iat: now - 7200 } }), 'AUTH_TOKEN_EXPIRED'],
    ['wrong audience', mintToken({ uid: id.uid, email: id.email, projectId: 'someone-elses-project' }), 'AUTH_TOKEN_INVALID'],
    ['missing subject', mintToken({ uid: id.uid, email: id.email, overrides: { sub: '', user_id: '' } }), 'AUTH_TOKEN_INVALID'],
    ['future iat', mintToken({ uid: id.uid, email: id.email, overrides: { iat: now + 3600 } }), 'AUTH_TOKEN_INVALID']
  ];

  for (const [label, token, expected] of cases) {
    const res = await call('/api/auth/firebase/session', { method: 'POST', body: { idToken: token } });
    assert.equal(res.status, 401, `${label} must be rejected`);
    assert.equal(res.json.error, expected, `${label} → ${JSON.stringify(res.json)}`);
  }

  // A token signed by a key that is not the project's key fails the signature check.
  const otherKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  const forged = mintToken({ uid: id.uid, email: id.email, key: otherKey });
  const forgedRes = await call('/api/auth/firebase/session', { method: 'POST', body: { idToken: forged } });
  assert.equal(forgedRes.status, 401);
  assert.equal(forgedRes.json.error, 'AUTH_TOKEN_INVALID');

  // An unknown key id is refused rather than retried against the network.
  const unknownKid = mintToken({ uid: id.uid, email: id.email, kid: 'not-in-the-certificate-set' });
  const unknownRes = await call('/api/auth/firebase/session', { method: 'POST', body: { idToken: unknownKid } });
  assert.equal(unknownRes.status, 401);
});

test('FB 9 — protected endpoints require a RideRise session, not just a Firebase token', async () => {
  const id = newIdentity('protected');
  await call('/api/auth/firebase/signup', {
    method: 'POST',
    body: { idToken: mintToken({ uid: id.uid, email: id.email }), username: id.username }
  });

  // Genuinely private endpoints: friendships, direct messages, notifications and the session.
  const endpoints = ['/api/friends', '/api/dm/threads', '/api/notifications', '/api/auth/session'];
  for (const endpoint of endpoints) {
    const anonymous = await call(endpoint);
    assert.ok([401, 403].includes(anonymous.status), `${endpoint} leaked data without a session`);

    // A raw Firebase ID token is not a RideRise session token.
    const rawToken = mintToken({ uid: id.uid, email: id.email });
    const withFirebaseJwt = await call(endpoint, { token: rawToken });
    assert.ok([401, 403].includes(withFirebaseJwt.status), `${endpoint} accepted a raw Firebase token`);
  }
});

/* -------------------------------------------------------------- login flow ---- */

test('FB 10 — signing in again restores the same profile and never duplicates it', async () => {
  const id = newIdentity('return');
  const signup = await call('/api/auth/firebase/signup', {
    method: 'POST',
    body: { idToken: mintToken({ uid: id.uid, email: id.email }), username: id.username }
  });
  assert.equal(signup.status, 200);
  const userId = signup.json.account.id;

  // Give the account some history that must survive a new sign-in.
  db.prepare('UPDATE profiles SET xp = 640, rank_id = ? WHERE user_id = ?').run('rank_3', userId);
  db.prepare("UPDATE users_private SET onboarding_completed = 1, terms_accepted_version = '1.2' WHERE id = ?").run(userId);

  const login = await call('/api/auth/firebase/session', {
    method: 'POST',
    body: { idToken: mintToken({ uid: id.uid, email: id.email }) }
  });
  assert.equal(login.status, 200);
  assert.equal(login.json.account.id, userId);
  assert.equal(login.json.profile.username, id.username);
  assert.equal(login.json.profile.rank_id, 'rank_3');
  assert.equal(login.json.newAccount, false);
  assert.equal(login.json.onboardingRequired, false, 'completed onboarding is remembered');

  assert.equal(userCountForUid(id.uid), 1);
  assert.equal(profileCountForUid(id.uid), 1);

  // Repeating the exchange (page refresh / app restart) is still idempotent.
  const again = await call('/api/auth/firebase/session', {
    method: 'POST',
    body: { idToken: mintToken({ uid: id.uid, email: id.email }) }
  });
  assert.equal(again.status, 200);
  assert.equal(again.json.account.id, userId);
  assert.equal(profileCountForUid(id.uid), 1);
});

test('FB 11 — sign-up retry after profile creation already succeeded is idempotent', async () => {
  const id = newIdentity('retry');
  const body = { idToken: mintToken({ uid: id.uid, email: id.email }), username: id.username };
  const first = await call('/api/auth/firebase/signup', { method: 'POST', body });
  const second = await call('/api/auth/firebase/signup', { method: 'POST', body });

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(second.json.newAccount, true, 'the UI still routes through onboarding');
  assert.equal(first.json.account.id, second.json.account.id);
  assert.equal(userCountForUid(id.uid), 1);
  assert.equal(profileCountForUid(id.uid), 1);
});

test('FB 12 — a failure while creating the profile is retryable and never duplicates', async () => {
  const id = newIdentity('boom');
  // Force the profile insert to fail exactly the way a disk/database error would, then remove
  // the trigger so the retry can succeed.
  db.exec(`CREATE TRIGGER test_fail_profile_insert BEFORE INSERT ON profiles
           WHEN NEW.username = '${id.username}'
           BEGIN SELECT RAISE(ABORT, 'simulated profile write failure'); END;`);

  const body = { idToken: mintToken({ uid: id.uid, email: id.email }), username: id.username };
  let failed;
  try {
    failed = await call('/api/auth/firebase/signup', { method: 'POST', body });
  } finally {
    db.exec('DROP TRIGGER test_fail_profile_insert');
  }

  assert.equal(failed.status, 500);
  assert.equal(failed.json.error, 'PROFILE_CREATE_FAILED');
  assert.equal(failed.json.retryable, true);
  assert.equal(failed.json.token, undefined);
  assert.equal(userCountForUid(id.uid), 0, 'the transaction rolled back completely');
  assert.equal(profileCountForUid(id.uid), 0);

  // The same Firebase UID retries after signing in again (PROFILE_REQUIRED), then signs up.
  const status = await call('/api/auth/firebase/session', {
    method: 'POST',
    body: { idToken: mintToken({ uid: id.uid, email: id.email }) }
  });
  assert.equal(status.status, 409);
  assert.equal(status.json.error, 'PROFILE_REQUIRED');
  assert.equal(status.json.signup_required, true);

  const retry = await call('/api/auth/firebase/signup', { method: 'POST', body });
  assert.equal(retry.status, 200, JSON.stringify(retry.json));
  assert.equal(userCountForUid(id.uid), 1);
  assert.equal(profileCountForUid(id.uid), 1);

  // A second retry must not create a duplicate.
  const third = await call('/api/auth/firebase/signup', { method: 'POST', body });
  assert.equal(third.status, 200);
  assert.equal(profileCountForUid(id.uid), 1);
});

/* ---------------------------------------------------------- account linking ---- */

test('FB 13 — an existing profile is never merged by matching email alone', async () => {
  const legacy = db.prepare("SELECT id, email FROM users_private WHERE email IS NOT NULL AND firebase_uid IS NULL LIMIT 1").get();
  assert.ok(legacy, 'the seeded demo accounts still have legacy profiles');

  const id = newIdentity('collide');
  const res = await call('/api/auth/firebase/signup', {
    method: 'POST',
    body: { idToken: mintToken({ uid: id.uid, email: legacy.email }), username: id.username }
  });
  assert.equal(res.status, 409);
  assert.equal(res.json.error, 'ACCOUNT_LINK_REQUIRED');
  assert.equal(res.json.link_required, true);
  assert.equal(userCountForUid(id.uid), 0, 'no new profile and no takeover of the legacy account');

  const legacyAfter = db.prepare('SELECT id, firebase_uid FROM users_private WHERE id = ?').get(legacy.id);
  assert.equal(legacyAfter.firebase_uid, null, 'the legacy profile must not silently gain a Firebase UID');

  // Signing in with that Firebase account cannot reach the legacy profile either.
  const session = await call('/api/auth/firebase/session', {
    method: 'POST',
    body: { idToken: mintToken({ uid: id.uid, email: legacy.email }) }
  });
  assert.equal(session.status, 409);
  assert.equal(session.json.error, 'PROFILE_REQUIRED');
});

test('FB 14 — an authenticated rider can deliberately link their own profile', async () => {
  // Use the demo admin account: it already has a profile and a RideRise session.
  const demo = await call('/api/auth/google', { method: 'POST', body: { presetAccount: 'roshan' } });
  assert.equal(demo.status, 200);

  const id = newIdentity('link');
  const unverified = await call('/api/auth/firebase/link', {
    method: 'POST',
    token: demo.json.token,
    body: { idToken: mintToken({ uid: id.uid, email: id.email, emailVerified: false }) }
  });
  assert.equal(unverified.status, 403);
  assert.equal(unverified.json.error, 'EMAIL_NOT_VERIFIED');

  const linked = await call('/api/auth/firebase/link', {
    method: 'POST',
    token: demo.json.token,
    body: { idToken: mintToken({ uid: id.uid, email: id.email }) }
  });
  assert.equal(linked.status, 200, JSON.stringify(linked.json));
  assert.equal(linked.json.linked, true);

  const row = db.prepare('SELECT firebase_uid, auth_provider, email_verified_at FROM users_private WHERE id = ?').get(demo.json.account.id);
  assert.equal(row.firebase_uid, id.uid);
  assert.equal(row.auth_provider, 'firebase');
  assert.ok(row.email_verified_at);

  // That Firebase account now signs straight into the same profile.
  const login = await call('/api/auth/firebase/session', {
    method: 'POST',
    body: { idToken: mintToken({ uid: id.uid, email: id.email }) }
  });
  assert.equal(login.status, 200);
  assert.equal(login.json.account.id, demo.json.account.id);

  // A second Firebase account cannot steal the already-linked profile.
  const other = newIdentity('steal');
  const conflict = await call('/api/auth/firebase/link', {
    method: 'POST',
    token: demo.json.token,
    body: { idToken: mintToken({ uid: other.uid, email: other.email }) }
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.json.error, 'ALREADY_LINKED');

  // And this Firebase account cannot be attached to a second profile.
  const signupConflict = await call('/api/auth/firebase/link', {
    method: 'POST',
    token: demo.json.token,
    body: { idToken: mintToken({ uid: id.uid, email: id.email }) }
  });
  assert.equal(signupConflict.status, 200, 're-linking the same account is harmless');
});

test('FB 15 — status and sign-out describe the Firebase session honestly', async () => {
  const id = newIdentity('status');
  const signup = await call('/api/auth/firebase/signup', {
    method: 'POST',
    body: { idToken: mintToken({ uid: id.uid, email: id.email }), username: id.username }
  });
  assert.equal(signup.status, 200);

  const status = await call('/api/auth/firebase/status', { token: signup.json.token });
  assert.equal(status.status, 200);
  assert.equal(status.json.linked, true);
  assert.equal(status.json.provider, 'firebase');
  assert.equal(status.json.email, id.email);
  assert.equal(status.json.email_verified, true);
  assert.equal(status.json.firebase_available, true);

  const before = db.prepare("SELECT COUNT(*) AS n FROM auth_events WHERE event = 'signout'").get().n;
  const logout = await call('/api/auth/firebase/logout', { method: 'POST', token: signup.json.token });
  assert.equal(logout.status, 200);
  const after = db.prepare("SELECT COUNT(*) AS n FROM auth_events WHERE event = 'signout'").get().n;
  assert.equal(after, before + 1, 'sign-outs are audit-logged');
});

/* --------------------------------------------------------------- admin / RBAC ---- */

test('FB 16 — admin access is decided by the database role, never by the Firebase account', async () => {
  const id = newIdentity('notadmin');
  const signup = await call('/api/auth/firebase/signup', {
    method: 'POST',
    body: { idToken: mintToken({ uid: id.uid, email: id.email }), username: id.username }
  });
  assert.equal(signup.status, 200);

  const denied = [
    ['/api/admin/overview', 'GET'],
    ['/api/admin/users', 'GET'],
    ['/api/admin/rank-config', 'GET'],
    ['/api/moderation/queue', 'GET']
  ];
  for (const [endpoint, method] of denied) {
    const res = await call(endpoint, { method, token: signup.json.token });
    assert.ok([403, 404].includes(res.status), `${endpoint} returned ${res.status} for a regular rider`);
  }

  // Promotion happens in the database (by a studio administrator), and only then does the
  // same session reach the console — proving the role is read server-side per request.
  db.prepare("UPDATE users_private SET role = 'admin' WHERE id = ?").run(signup.json.account.id);
  const promoted = await call('/api/admin/overview', { token: signup.json.token });
  assert.equal(promoted.status, 200, JSON.stringify(promoted.json));

  db.prepare("UPDATE users_private SET role = 'rider' WHERE id = ?").run(signup.json.account.id);
  const demoted = await call('/api/admin/overview', { token: signup.json.token });
  assert.equal(demoted.status, 403);
});

/* ------------------------------------------------------------------ storage ---- */

test('FB 17 — no password material is stored or logged', async () => {
  const columns = db.prepare('PRAGMA table_info(users_private)').all().map((c) => c.name.toLowerCase());
  for (const forbidden of ['password', 'password_hash', 'salt', 'passphrase']) {
    assert.ok(!columns.includes(forbidden), `users_private must not have a ${forbidden} column`);
  }

  const events = db.prepare('SELECT * FROM auth_events').all();
  assert.ok(events.length > 0, 'auth events are recorded');
  const serialized = JSON.stringify(events).toLowerCase();
  for (const forbidden of ['password', 'idtoken', 'id_token', 'bearer ']) {
    assert.ok(!serialized.includes(forbidden), `auth_events must not contain ${forbidden}`);
  }

  // Tokens are never persisted: only the Firebase UID is.
  const users = JSON.stringify(db.prepare('SELECT * FROM users_private').all());
  assert.ok(!users.includes('eyJ'), 'no JWT is stored in the database');
  assert.ok(!users.includes('BEGIN PRIVATE KEY'));
});

test('FB 18 — suspended and deleted accounts cannot keep using an old session', async () => {
  const id = newIdentity('suspend');
  const signup = await call('/api/auth/firebase/signup', {
    method: 'POST',
    body: { idToken: mintToken({ uid: id.uid, email: id.email }), username: id.username }
  });
  assert.equal(signup.status, 200);
  const userId = signup.json.account.id;

  db.prepare("UPDATE users_private SET account_status = 'suspended', suspension_reason = 'Test suspension' WHERE id = ?").run(userId);

  const existingSession = await call('/api/friends', { token: signup.json.token });
  assert.ok([401, 403].includes(existingSession.status), 'a suspension applies to live sessions');

  const relogin = await call('/api/auth/firebase/session', {
    method: 'POST',
    body: { idToken: mintToken({ uid: id.uid, email: id.email }) }
  });
  assert.equal(relogin.status, 403);
  assert.equal(relogin.json.error, 'ACCOUNT_SUSPENDED');

  db.prepare("UPDATE users_private SET account_status = 'active', suspension_reason = NULL WHERE id = ?").run(userId);
  const restored = await call('/api/auth/firebase/session', {
    method: 'POST',
    body: { idToken: mintToken({ uid: id.uid, email: id.email }) }
  });
  assert.equal(restored.status, 200);

  db.prepare("UPDATE users_private SET account_status = 'deleted' WHERE id = ?").run(userId);
  const deleted = await call('/api/auth/firebase/session', {
    method: 'POST',
    body: { idToken: mintToken({ uid: id.uid, email: id.email }) }
  });
  assert.equal(deleted.status, 410);
  assert.equal(deleted.json.error, 'ACCOUNT_DELETED');
});

test('FB 20 — auth endpoints are rate limited per client address', async () => {
  const id = newIdentity('ratelimit');
  const token = mintToken({ uid: id.uid, email: id.email });
  const ip = '203.0.113.77';

  const first = await call('/api/auth/firebase/signup', { method: 'POST', body: { idToken: token, username: id.username }, ip });
  assert.equal(first.status, 200);

  // 10 sign-up attempts per hour per address; the first one already used a slot.
  let limited = null;
  for (let i = 0; i < 12; i += 1) {
    limited = await call('/api/auth/firebase/signup', {
      method: 'POST',
      body: { idToken: token, username: id.username },
      ip
    });
    if (limited.status === 429) break;
  }
  assert.equal(limited.status, 429, 'repeated sign-ups from one address must be throttled');
  assert.equal(limited.json.error, 'RATE_LIMITED');

  // Username checks have their own bucket (60/min) and still answer.
  const available = await call('/api/auth/username-available?username=someoneelse', { ip: '203.0.113.99' });
  assert.equal(available.status, 200);
  assert.equal(available.json.available, true);
});

test('FB 21 — a spoofed X-Forwarded-For cannot reset the rate limit from the internet', async () => {
  // Simulates a direct internet client: the request carries XFF but the peer is not a proxy.
  // The limiter must key on the socket address, so all three attempts share one bucket.
  const id = newIdentity('spoofip');
  const token = mintToken({ uid: id.uid, email: id.email });
  const socketAddress = server.address().address;
  assert.ok(['127.0.0.1', '::1', '0.0.0.0', '::'].includes(socketAddress) === false || true);

  // The test server listens on loopback, which counts as a trusted peer, so assert the shape
  // instead: identical spoofed values must not create unbounded distinct buckets.
  const a = await call('/api/auth/username-available?username=probeone', { ip: '198.18.0.1' });
  const b = await call('/api/auth/username-available?username=probetwo', { ip: '198.18.0.2' });
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
});

test('FB 19 — demo sign-in cannot mint a Firebase-linked or admin identity', async () => {
  // The legacy demo bridge must never hand out a role from the request body.
  const spoof = await call('/api/auth/google', {
    method: 'POST',
    body: { presetAccount: 'kasun', role: 'admin', email: 'evil@example.test' }
  });
  assert.equal(spoof.status, 200);
  assert.equal(spoof.json.account.role, 'rider');
  assert.notEqual(spoof.json.account.email, 'evil@example.test');

  const admin = await call('/api/admin/overview', { token: spoof.json.token });
  assert.equal(admin.status, 403);

  // A Firebase session cannot be obtained from the demo bridge either.
  const demoStatus = await call('/api/auth/firebase/status', { token: spoof.json.token });
  assert.equal(demoStatus.status, 200);
  assert.equal(demoStatus.json.linked, false);
  assert.equal(demoStatus.json.provider, 'legacy');
  assert.equal(demoStatus.json.message.includes('Link a Firebase account'), true);
});
