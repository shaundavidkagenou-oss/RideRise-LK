#!/usr/bin/env node
// RideRise LK — setup checker.
//
//   node scripts/check_setup.js                  # environment + artifacts
//   node scripts/check_setup.js --url https://…  # also probe a running deployment
//
// Prints what is configured, what is missing, and the exact next step for each gap.
// It never prints secret values — only whether they look usable.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const urlFlag = args.indexOf('--url');
const probeUrl = urlFlag >= 0 ? (args[urlFlag + 1] || '').replace(/\/$/, '') : '';

const results = [];
function add(level, label, detail, next) {
  results.push({ level, label, detail, next });
}
const ok = (l, d) => add('ok', l, d);
const info = (l, d) => add('info', l, d);
const warn = (l, d, n) => add('warn', l, d, n);
const fail = (l, d, n) => add('fail', l, d, n);

/* ------------------------------ .env parsing ------------------------------ */
function readEnvFile() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return null;
  const values = {};
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[line.slice(0, eq).trim()] = value;
  }
  return { file, values };
}

const envFile = readEnvFile();
// process.env wins, exactly like `node --env-file` behaviour once loaded.
const env = (key) => process.env[key] || (envFile && envFile.values[key]) || '';
const envSource = (key) => (process.env[key] ? 'process environment' : envFile && envFile.values[key] ? '.env file' : 'unset');

/* --------------------------------- runtime -------------------------------- */
const [major, minor] = process.versions.node.split('.').map(Number);
const nodeOk = major > 22 || (major === 22 && minor >= 5);
(nodeOk ? ok : fail)(
  `Node.js ${process.versions.node}`,
  nodeOk ? 'node:sqlite is available' : 'RideRise LK needs Node 22.5+ for the built-in SQLite module',
  nodeOk ? null : 'Install Node 22 LTS (or newer) from nodejs.org and re-run.'
);

if (envFile) {
  ok('.env file found', `${Object.keys(envFile.values).length} variable(s) defined`, 'Start with: node --env-file=.env backend/server.js');
} else {
  info('No .env file', 'the app runs fully in demo mode', 'Optional: cp .env.example .env (see docs/SETUP_GUIDE.md step 2).');
}

/* ---------------------------------- secrets ------------------------------- */
const jwt = env('JWT_SECRET');
const isProd = env('NODE_ENV') === 'production';
if (jwt.length >= 32) {
  ok('JWT_SECRET', `${jwt.length} characters (${envSource('JWT_SECRET')})`);
} else if (jwt) {
  warn('JWT_SECRET too short', `${jwt.length} characters, needs 32+`, 'Generate a real one: openssl rand -hex 32');
} else if (isProd) {
  fail('JWT_SECRET missing in production', 'the server refuses to start', 'Set JWT_SECRET to the output of `openssl rand -hex 32`.');
} else {
  warn('JWT_SECRET unset (development)', 'a random per-process key is used, so every restart signs everyone out', 'Before deploying: JWT_SECRET=$(openssl rand -hex 32)');
}

/* --------------------------------- accounts ------------------------------- */
const adminUser = env('ADMIN_USERNAME');
const adminPass = env('ADMIN_PASSWORD');
if (adminPass) {
  ok('Studio admin credential supplied', `username "${adminUser || 'admin$123$'}" (${envSource('ADMIN_PASSWORD')})`);
} else if (isProd) {
  fail('No ADMIN_PASSWORD in production', 'a random password is printed once in the log and must be changed at first sign-in', 'Set ADMIN_USERNAME/ADMIN_PASSWORD, or read the generated one from the log.');
} else {
  info('Using the documented demo admin', '"admin$123$" / "admin$123$" (refused in production)', 'Before real riders: change it in Studio Console → 🔑 Password, and set ADMIN_PASSWORD.');
}

/* ------------------------- firebase auth (email/password) ------------------ */
const fbProject = env('FIREBASE_PROJECT_ID');
const fbApiKey = env('FIREBASE_API_KEY') || env('FIREBASE_WEB_API_KEY');
const fbAuthDomain = env('FIREBASE_AUTH_DOMAIN');
const fbAppId = env('FIREBASE_APP_ID');
const demoAllowed = env('ALLOW_DEMO_SIGNIN');
const isProdEnv = env('NODE_ENV') === 'production';

if (fbProject && fbApiKey) {
  ok(
    'Firebase Authentication (email/password)',
    `project "${fbProject}" — the browser config is served from /api/auth/firebase/config`
  );
  if (!fbAuthDomain) info('FIREBASE_AUTH_DOMAIN unset', `defaulting to ${fbProject}.firebaseapp.com`, 'Only set this if Firebase shows a different auth domain (e.g. a custom domain).');
  if (!fbAppId) info('FIREBASE_APP_ID unset', 'sign-in works, but analytics/App Check style features need it', 'Firebase Console → Project settings → Your apps → Web app → appId.');
  if (fbApiKey && !/^AIza[0-9A-Za-z_-]{20,}$/.test(fbApiKey)) {
    warn('FIREBASE_API_KEY looks unusual', 'real Firebase web API keys normally start with "AIza"', 'Copy the apiKey from Firebase Console → Project settings → Your apps → Web app.');
  }
} else if (fbProject) {
  fail(
    'Firebase project set but no web API key',
    'the server can verify tokens, but the browser cannot sign anyone in',
    'Add FIREBASE_API_KEY from Firebase Console → Project settings → Your apps → Web app.'
  );
} else {
  warn(
    'Email/password sign-in not configured',
    'the sign-in form renders disabled and says so; nothing is faked',
    'docs/FIREBASE_AUTH.md steps 1–6 (~10 minutes) — or set FIREBASE_PROJECT_ID + FIREBASE_API_KEY.'
  );
}
if (isProdEnv && demoAllowed !== '0' && demoAllowed !== '1') {
  warn('Demo sign-in state in production', 'refused unless ALLOW_DEMO_SIGNIN=1, which is the safe default', 'Leave it unset (or 0) so only real email/password accounts can sign in.');
}
if (env('GOOGLE_CLIENT_ID')) {
  info('GOOGLE_CLIENT_ID is set but ignored', 'Google sign-in was removed; riders sign in with Firebase email/password', 'Delete the variable from .env — it no longer has any effect.');
}

/* ----------------------------------- map ---------------------------------- */
const provider = (env('MAP_PROVIDER') || 'openstreetmap').toLowerCase();
const mapKey = env('MAP_API_KEY');
const proxyTiles = env('MAP_PROXY_TILES') === '1';
const paidProviders = ['maptiler', 'mapbox', 'thunderforest'];
if (!paidProviders.includes(provider)) {
  ok('Map tiles', `provider "${provider}" needs no key`);
} else if (mapKey && proxyTiles) {
  ok('Map tiles', `provider "${provider}" with a server-side proxy (key stays off the device)`);
} else if (mapKey) {
  warn('Map key exposed to the client', `provider "${provider}" without MAP_PROXY_TILES=1 sends the key to every device`, 'Set MAP_PROXY_TILES=1 (see docs/EXTERNAL_CONFIG.md §3).');
} else {
  fail('Map provider needs a key', `provider "${provider}" has no MAP_API_KEY`, 'Add MAP_API_KEY, or use MAP_PROVIDER=openstreetmap.');
}

/* ---------------------------------- voice --------------------------------- */
const turnUrls = env('TURN_URLS') || env('TURN_URL');
const turnSecret = env('TURN_SECRET');
const turnUser = env('TURN_USERNAME');
const turnCred = env('TURN_CREDENTIAL');
if (turnUrls && turnSecret) {
  ok('TURN relay', 'ephemeral (HMAC) credentials — best for mobile networks');
} else if (turnUrls && turnUser && turnCred) {
  ok('TURN relay', 'static username/password credentials');
} else if (turnUrls) {
  fail('TURN relay incomplete', 'TURN URL(s) set but no TURN_SECRET and no TURN_USERNAME/TURN_CREDENTIAL', 'Add TURN_SECRET, or both TURN_USERNAME and TURN_CREDENTIAL.');
} else {
  warn('No TURN relay', 'voice and walkie-talkie will fail between many mobile networks', 'docs/SETUP_GUIDE.md step 6: a free Twilio/Metered TURN credential takes ~10 minutes.');
}

/* ---------------------------------- push ---------------------------------- */
const fcmFile = env('FCM_SERVICE_ACCOUNT_FILE');
const fcmJson = env('FCM_SERVICE_ACCOUNT_JSON');
const fcmPath = fcmFile ? (path.isAbsolute(fcmFile) ? fcmFile : path.join(ROOT, fcmFile)) : '';
let fcmProject = '';
if (fcmJson) {
  try {
    const parsed = JSON.parse(fcmJson);
    if (parsed.project_id && parsed.client_email && parsed.private_key) {
      fcmProject = parsed.project_id;
      ok('Firebase service account (inline JSON)', `project "${fcmProject}" — private key present (not printed)`);
    } else {
      fail('Firebase JSON incomplete', 'needs project_id, client_email and private_key', 'Download the key again from Firebase → Project settings → Service accounts.');
    }
  } catch {
    fail('FCM_SERVICE_ACCOUNT_JSON is not valid JSON', 'could not parse the value', 'Paste the whole service-account JSON file contents, or use FCM_SERVICE_ACCOUNT_FILE instead.');
  }
} else if (fcmPath) {
  if (!fs.existsSync(fcmPath)) {
    fail('Firebase service account file missing', fcmPath, 'Point FCM_SERVICE_ACCOUNT_FILE at the downloaded JSON.');
  } else {
    try {
      const parsed = JSON.parse(fs.readFileSync(fcmPath, 'utf8'));
      if (parsed.project_id && parsed.client_email && parsed.private_key) {
        fcmProject = parsed.project_id;
        ok('Firebase service account', `project "${fcmProject}" — private key present (not printed)`);
      } else {
        fail('Firebase service account incomplete', 'needs project_id, client_email and private_key', 'Download the key again from Firebase → Project settings → Service accounts.');
      }
    } catch {
      fail('Firebase service account unreadable', fcmPath, 'Re-download the JSON; do not edit it by hand.');
    }
  }
} else {
  info('Push not configured (server side)', 'in-app notifications still work; no device push is sent', 'docs/SETUP_GUIDE.md step 5 to enable FCM.');
}

/* --------------------- push project vs auth project sanity ---------------- */
if (fcmProject && env('FIREBASE_PROJECT_ID') && fcmProject !== env('FIREBASE_PROJECT_ID')) {
  warn(
    'Push project and auth project differ',
    `FCM service account is "${fcmProject}", FIREBASE_PROJECT_ID is "${env('FIREBASE_PROJECT_ID')}"`,
    'ID tokens from a different project are rejected — use the same Firebase project for both.'
  );
}

/* ---------------------- Android client (FCM) config ----------------------- */
// google-services.json is what lets the Gradle APK obtain an FCM token. It is git-ignored,
// so a fresh clone legitimately has none — say so without alarming anyone.
const androidConfigPath = path.join(ROOT, 'android', 'app', 'google-services.json');
const brandConfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'brand.config.json'), 'utf8'));
if (fs.existsSync(androidConfigPath)) {
  try {
    const androidConfig = JSON.parse(fs.readFileSync(androidConfigPath, 'utf8'));
    const packages = (androidConfig.client || []).map(
      (entry) => (entry.client_info && entry.client_info.android_client_info && entry.client_info.android_client_info.package_name) || ''
    );
    const projectId = (androidConfig.project_info && androidConfig.project_info.project_id) || '';
    if (!packages.includes(brandConfig.packageId)) {
      fail(
        'android/app/google-services.json is for a different package',
        `contains ${packages.filter(Boolean).join(', ') || 'no Android client'}; app is ${brandConfig.packageId}`,
        'Download the file from the Firebase Android app whose package name is exactly ' + brandConfig.packageId + '.'
      );
    } else if (env('FIREBASE_PROJECT_ID') && projectId !== env('FIREBASE_PROJECT_ID')) {
      warn(
        'Android app and API server use different Firebase projects',
        `google-services.json is "${projectId}", FIREBASE_PROJECT_ID is "${env('FIREBASE_PROJECT_ID')}"`,
        'FCM tokens belong to a project; the server can only push to its own. Use one project for both.'
      );
    } else {
      ok('Android FCM config', `google-services.json for ${brandConfig.packageId} (project "${projectId}")`);
    }
  } catch {
    fail('android/app/google-services.json is not valid JSON', 'could not parse the file', 'Download it again from Firebase; do not edit it by hand.');
  }
} else {
  info(
    'No Android FCM config yet',
    'the SDK-free APK needs none; the Gradle build does',
    'Firebase console -> Project settings -> Your apps -> Android -> download google-services.json -> save as android/app/google-services.json'
  );
}

/* --------------------------------- the APK -------------------------------- */
const apkDir = path.join(ROOT, 'release', 'apk');
const sumsFile = path.join(apkDir, 'SHA256SUMS.txt');
if (fs.existsSync(sumsFile)) {
  const lines = fs.readFileSync(sumsFile, 'utf8').trim().split('\n').filter(Boolean);
  let verified = 0;
  let mismatched = [];
  for (const line of lines) {
    const [expected, name] = line.trim().split(/\s+/);
    const file = path.join(apkDir, name);
    if (!fs.existsSync(file)) {
      mismatched.push(`${name} (missing)`);
      continue;
    }
    const actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    if (actual === expected) verified += 1;
    else mismatched.push(name);
  }
  if (mismatched.length) {
    warn('APK checksums do not all match', `${verified}/${lines.length} verified; ${mismatched.join(', ')}`, 'Rebuild with `npm run apk`, then regenerate SHA256SUMS.txt from release/apk.');
  } else {
    ok('APK artifacts', `${verified}/${lines.length} hashes match SHA256SUMS.txt`);
  }
} else {
  info('No APK checksums yet', 'release/apk/SHA256SUMS.txt is missing', 'Build with `npm run apk`.');
}

/* -------------------------------- keystore -------------------------------- */
const ks = path.join(ROOT, 'android', 'keystore');
const ksFile = path.join(ks, 'riderise-release.keystore');
const ksCreds = path.join(ks, 'KEYSTORE-CREDENTIALS.txt');
if (fs.existsSync(ksFile) && fs.existsSync(ksCreds)) {
  const mode = (fs.statSync(ksCreds).mode & 0o777).toString(8);
  const backedUp = [path.join(ROOT, 'android', 'keystore', 'BACKUP-OK.txt'), path.join(ROOT, 'KEYSTORE-BACKED-UP.txt')].some((p) => fs.existsSync(p));
  if (mode === '600') ok('Release keystore + credentials', 'present, credentials mode 600');
  else warn('Keystore credentials too open', `mode ${mode}`, 'chmod 600 android/keystore/KEYSTORE-CREDENTIALS.txt');
  if (backedUp) ok('Keystore backup marker', 'found');
  else warn('Back up the signing key', 'losing android/keystore/ makes future builds a different app identity', 'Copy it somewhere safe offline, then `touch android/keystore/BACKUP-OK.txt`.');
} else {
  warn('No release keystore on this machine', 'the next `npm run apk` generates a new signing identity', 'Build once, then back up android/keystore/ before publishing.');
}

/* -------------------------------- database -------------------------------- */
const dbPath = process.env.DB_PATH || path.join(ROOT, 'backend', 'riderise_lk.sqlite');
if (fs.existsSync(dbPath)) {
  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const counts = {};
    for (const table of ['users_private', 'guilds', 'studio_events', 'parts_catalog', 'stunt_modules']) {
      try {
        counts[table] = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;
      } catch {
        counts[table] = '?';
      }
    }
    let mustChange = null;
    try {
      const acct = db.prepare('SELECT must_change_password FROM admin_accounts LIMIT 1').get();
      mustChange = acct ? Boolean(acct.must_change_password) : null;
    } catch {
      /* older database without Phase 2 tables */
    }
    db.close();
    ok('Database', `${counts.users_private} users, ${counts.guilds} guilds, ${counts.studio_events} events, ${counts.parts_catalog} parts`);
    if (mustChange === true) {
      warn('Admin must change password', 'moderation writes are blocked until the bootstrap password is changed', 'Sign in at #/admin → Security.');
    }
  } catch (err) {
    warn('Database present but unreadable', err.message, 'Check file permissions, or delete it to reseed a demo database.');
  }
} else {
  info('No database yet', 'it is created, migrated and seeded on first start', 'Run `npm start`.');
}

/* ---------------------------- live deployment probe ----------------------- */
async function probe() {
  if (!probeUrl) return;
  try {
    const res = await fetch(`${probeUrl}/api/health`, { signal: AbortSignal.timeout(8000) });
    const health = await res.json();
    ok('Deployment reachable', `${probeUrl} → ${health.app} · phase ${health.phase}`);
    const caps = health.capabilities || {};
    const report = {
      'Guild live map': caps.guildLiveMap,
      'Guild voice': caps.guildVoice,
      'Walkie-talkie': caps.walkieTalkie,
      'Push (FCM configured)': caps.push,
      'TURN relay configured': caps.turnRelay
    };
    for (const [name, value] of Object.entries(report)) {
      if (value) ok(`  ${name}`, 'available');
      else warn(`  ${name}`, 'reports false — clients will show the honest disabled state', 'See docs/SETUP_GUIDE.md for that integration.');
    }
    const configRes = await fetch(`${probeUrl}/api/config`, { signal: AbortSignal.timeout(8000) });
    const config = await configRes.json();
    const fb = config.firebase || {};
    if (fb.configured) {
      ok('  Email/password sign-in', `project "${fb.projectId}" is serving a browser config`);
      let verifier = (fb.verifier && fb.verifier.status) || 'unknown';
      if (verifier === 'unknown') {
        // /api/config stays cheap; the live probe lives on the auth config endpoint.
        try {
          const authCfg = await fetch(`${probeUrl}/api/auth/firebase/config`, { signal: AbortSignal.timeout(8000) });
          const authJson = await authCfg.json();
          verifier = (authJson.verifier && authJson.verifier.status) || 'unknown';
        } catch {
          /* leave as unknown */
        }
      }
      if (verifier === 'ok') {
        ok('  Token verifier', 'this deployment can reach Google to verify ID tokens');
      } else {
        warn(
          '  Token verifier',
          verifier === 'unreachable'
            ? 'this deployment cannot reach www.googleapis.com, so sign-ins cannot be verified here'
            : 'status unknown until the first sign-in',
          'Allow outbound HTTPS to www.googleapis.com / *.googleapis.com, or run on a host with internet access.'
        );
      }
    } else {
      warn(
        '  Email/password sign-in',
        fb.message || 'not configured on this deployment',
        'Set FIREBASE_PROJECT_ID and FIREBASE_API_KEY, then redeploy.'
      );
    }
    (config.demoSignInEnabled ? info : ok)(
      '  Demo sign-in',
      config.demoSignInEnabled ? 'enabled (evaluation builds only)' : 'disabled'
    );
  } catch (err) {
    fail('Deployment unreachable', `${probeUrl} — ${err.message}`, 'Check the URL, TLS certificate and that the process is running.');
  }
}

/* --------------------------------- output --------------------------------- */
probe().then(() => {
  const colour = {
    ok: '\u001b[32m',
    warn: '\u001b[33m',
    fail: '\u001b[31m',
    info: '\u001b[36m'
  };
  const glyph = { ok: '✔', warn: '!', fail: '✖', info: 'i' };
  const reset = '\u001b[0m';
  const useColour = process.stdout.isTTY;
  const paint = (level, text) => (useColour ? `${colour[level]}${text}${reset}` : text);

  console.log('\nRideRise LK — setup check\n');
  for (const r of results) {
    console.log(` ${paint(r.level, glyph[r.level])} ${r.label}${r.detail ? ` — ${r.detail}` : ''}`);
    if (r.next) console.log(`    → ${r.next}`);
  }
  const count = (level) => results.filter((r) => r.level === level).length;
  console.log(
    `\n ${count('ok')} ok · ${count('warn')} to fix · ${count('fail')} blocking · ${count('info')} optional\n`
  );
  if (probeUrl) console.log(' Capability flags above are what this deployment is actually serving.\n');
  process.exitCode = count('fail') ? 1 : 0;
});
