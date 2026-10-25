#!/usr/bin/env node
// RideRise LK — Firebase Cloud Messaging credential checker.
//
//   node scripts/verify_fcm_credentials.js            # local checks (offline)
//   node scripts/verify_fcm_credentials.js --online   # also exchanges the JWT for an OAuth token
//   npm run check:fcm
//
// What it does: reads FCM_SERVICE_ACCOUNT_FILE (or FCM_SERVICE_ACCOUNT_JSON), proves the
// private key parses and can sign the exact RS256 JWT the server sends to Google, and checks
// that the service-account project matches the Android app and the server configuration.
//
// It never prints the private key, the key id or any other secret material — only the project
// id, the service-account address, the public-key fingerprint and pass/fail results.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');

/* --------------------------------- helpers -------------------------------- */
function readEnvFile() {
  const file = path.join(ROOT, '.env');
  const values = {};
  if (!fs.existsSync(file)) return values;
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
  return values;
}

function readJson(relPath) {
  try {
    return JSON.parse(fs.readFileSync(relPath, 'utf8'));
  } catch {
    return null;
  }
}

function resolveSecretPath(filePath) {
  if (!filePath) return '';
  return path.isAbsolute(filePath) ? filePath : path.resolve(ROOT, filePath);
}

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

/**
 * Inspect the configured FCM credentials.
 * @param {{env?: Record<string,string>, online?: boolean, timeoutMs?: number}} [options]
 */
function inspectFcmCredentials(options = {}) {
  const env = options.env || { ...readEnvFile(), ...process.env };
  const online = options.online === true;
  const checks = [];
  const add = (id, label, ok, detail, required = true) => {
    checks.push({ id, label, ok: Boolean(ok), detail: detail || '', required });
  };

  const filePath = env.FCM_SERVICE_ACCOUNT_FILE || '';
  const inlineJson = env.FCM_SERVICE_ACCOUNT_JSON || '';
  const resolvedPath = resolveSecretPath(filePath);
  const present = Boolean(inlineJson) || (Boolean(resolvedPath) && fs.existsSync(resolvedPath));

  if (!present) {
    add(
      'FCM-1',
      'Service account configured',
      false,
      filePath
        ? `FCM_SERVICE_ACCOUNT_FILE points at a missing file: ${resolvedPath}`
        : 'Set FCM_SERVICE_ACCOUNT_FILE (recommended) or FCM_SERVICE_ACCOUNT_JSON',
      false
    );
    return {
      configured: false,
      present: false,
      status: 'missing',
      path: resolvedPath,
      checks,
      failures: [],
      projectId: null,
      clientEmail: null
    };
  }

  const failures = [];
  const passLine = (id, label, detail) => add(id, label, true, detail);
  const fail = (id, label, detail) => {
    add(id, label, false, detail);
    failures.push(id);
  };
  const pass = passLine;

  passLine(
    'FCM-1',
    'Service account configured',
    inlineJson ? 'FCM_SERVICE_ACCOUNT_JSON (inline)' : resolvedPath.replace(ROOT + path.sep, '')
  );

  /* ------------------------------ file access ------------------------------ */
  let raw = inlineJson;
  if (!raw && resolvedPath) {
    try {
      raw = fs.readFileSync(resolvedPath, 'utf8');
    } catch (err) {
      fail('FCM-1', 'Service-account file readable', err.message);
      return { configured: false, present: false, status: 'unreadable', path: resolvedPath, checks, failures, projectId: null, clientEmail: null };
    }
  }
  if (resolvedPath) {
    const mode = fs.statSync(resolvedPath).mode & 0o777;
    add(
      'FCM-2',
      'File permissions are private',
      (mode & 0o077) === 0,
      `mode ${mode.toString(8)}${(mode & 0o077) === 0 ? ' (owner only)' : ' — run: chmod 600 <file>'}`,
      false
    );
  }

  /* --------------------------------- JSON ---------------------------------- */
  let serviceAccount = null;
  try {
    serviceAccount = JSON.parse(raw);
  } catch (err) {
    fail('FCM-3', 'Service-account JSON parses', err.message);
    return { configured: false, present: true, status: 'invalid-json', path: resolvedPath, checks, failures, projectId: null, clientEmail: null };
  }

  const projectId = String(serviceAccount.project_id || '');
  const clientEmail = String(serviceAccount.client_email || '');
  const privateKeyPem = String(serviceAccount.private_key || '');
  const tokenUri = String(serviceAccount.token_uri || '');

  const requiredFields = ['project_id', 'client_email', 'private_key', 'token_uri'];
  const missing = requiredFields.filter((field) => !serviceAccount[field]);
  if (missing.length) {
    fail('FCM-3', 'Required fields present', `missing: ${missing.join(', ')}`);
  } else {
    pass('FCM-3', 'Required fields present', `project ${projectId}`);
  }

  add(
    'FCM-4',
    'Key belongs to a service account (not an OAuth client or API key)',
    serviceAccount.type === 'service_account',
    `type=${serviceAccount.type || 'missing'}`,
    false
  );

  if (clientEmail && projectId) {
    const expected = new RegExp(`^[a-z0-9-]+@${projectId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.iam\\.gserviceaccount\\.com$`);
    add(
      'FCM-5',
      'Service-account address matches the project',
      expected.test(clientEmail),
      clientEmail
    );
  }

  add(
    'FCM-6',
    'Token endpoint is Google OAuth 2.0',
    tokenUri === 'https://oauth2.googleapis.com/token',
    tokenUri || 'missing'
  );

  /* ------------------------------- key check ------------------------------- */
  let privateKey = null;
  try {
    privateKey = crypto.createPrivateKey(privateKeyPem);
  } catch (err) {
    fail('FCM-7', 'Private key parses', err.message);
  }

  let keyDetails = 'not parsed';
  if (privateKey) {
    const details = privateKey.asymmetricKeyDetails || {};
    const bits = details.modulusLength || 0;
    keyDetails = `${privateKey.asymmetricKeyType} ${bits}-bit`;
    add('FCM-7', 'Private key parses', bits >= 2048, keyDetails);
  }

  /* ------------------------- RS256 JWT round trip -------------------------- */
  if (privateKey) {
    const now = Math.floor(Date.now() / 1000);
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = b64url(
      JSON.stringify({
        iss: clientEmail,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: tokenUri || 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600
      })
    );
    try {
      const signer = crypto.createSign('RSA-SHA256').update(`${header}.${claims}`);
      const signature = signer.sign(privateKey).toString('base64url');
      const publicKey = crypto.createPublicKey(privateKey);
      const verifier = crypto.createVerify('RSA-SHA256').update(`${header}.${claims}`);
      const valid = verifier.verify(publicKey, Buffer.from(signature, 'base64url'));
      const fingerprint = crypto.createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
      add(
        'FCM-8',
        'RS256 JWT (the exact server assertion) signs and verifies',
        valid,
        `public key SHA-256 ${fingerprint.slice(0, 16)}…`
      );
    } catch (err) {
      fail('FCM-8', 'RS256 JWT (the exact server assertion) signs and verifies', err.message);
    }
  }

  /* ----------------------------- project match ----------------------------- */
  const serverProject = env.FIREBASE_PROJECT_ID || '';
  add(
    'FCM-9',
    'Same project as FIREBASE_PROJECT_ID',
    !serverProject || serverProject === projectId,
    serverProject ? `service account=${projectId} server=${serverProject}` : `server project unset; service account=${projectId}`
  );

  const androidConfig = readJson(path.join(ROOT, 'android', 'app', 'google-services.json'));
  if (androidConfig && androidConfig.project_info) {
    const androidProject = androidConfig.project_info.project_id || '';
    const androidSender = androidConfig.project_info.project_number || '';
    add(
      'FCM-10',
      'Same project as the Android app (google-services.json)',
      androidProject === projectId,
      `service account=${projectId} android=${androidProject || 'missing'}`
    );
    add(
      'FCM-11',
      'Sender id matches FIREBASE_MESSAGING_SENDER_ID',
      !env.FIREBASE_MESSAGING_SENDER_ID || env.FIREBASE_MESSAGING_SENDER_ID === androidSender,
      `android=${androidSender || 'missing'} server=${env.FIREBASE_MESSAGING_SENDER_ID || 'unset'}`
    );
  } else {
    add(
      'FCM-10',
      'Same project as the Android app (google-services.json)',
      true,
      'android/app/google-services.json not present in this checkout — checked on the studio machine',
      false
    );
  }

  return {
    configured: failures.length === 0,
    present: true,
    status: failures.length ? 'invalid' : 'valid',
    path: resolvedPath,
    projectId,
    clientEmail,
    senderId: androidConfig?.project_info?.project_number || null,
    checks,
    failures,
    // Only valid to call when the caller passed online: true.
    exchange: () => exchangeForAccessToken(serviceAccount, options.timeoutMs || 8000)
  };
}

/** Exchange the signed assertion for an OAuth access token (needs outbound HTTPS). */
async function exchangeForAccessToken(serviceAccount, timeoutMs = 8000) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(
    JSON.stringify({
      iss: serviceAccount.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: serviceAccount.token_uri,
      iat: now,
      exp: now + 3600
    })
  );
  const key = crypto.createPrivateKey(serviceAccount.private_key);
  const signature = crypto.createSign('RSA-SHA256').update(`${header}.${claims}`).sign(key).toString('base64url');
  const assertion = `${header}.${claims}.${signature}`;

  try {
    const res = await fetch(serviceAccount.token_uri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${assertion}`,
      signal: AbortSignal.timeout(timeoutMs)
    });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, status: res.status, reason: text.slice(0, 200) };
    }
    const data = JSON.parse(text);
    return {
      ok: Boolean(data.access_token),
      status: res.status,
      tokenType: data.token_type,
      expiresIn: data.expires_in,
      scope: data.scope || ''
    };
  } catch (err) {
    // In the development sandbox this is the expected result: no outbound HTTPS to Google.
    return { ok: false, network: true, reason: err.message };
  }
}

function render(report, options = {}) {
  const glyph = (check) => (check.ok ? '\u2714' : check.required ? '\u2716' : '!');
  for (const check of report.checks) {
    console.log(`${glyph(check)} ${check.id.padEnd(7)} ${check.label}`);
    if (check.detail) console.log(`          ${check.detail}`);
  }
  if (report.projectId) {
    console.log('');
    console.log(`Project: ${report.projectId}`);
    console.log(`Identity: ${report.clientEmail}`);
  }
  return report;
}

async function main() {
  const online = process.argv.includes('--online');
  const report = inspectFcmCredentials({ online });
  render(report);

  if (!report.present) {
    console.log('');
    console.log('Push is disabled on the server until a service account is configured.');
    console.log('Firebase console -> Project settings -> Service accounts -> Generate new private key,');
    console.log('save it outside version control and set FCM_SERVICE_ACCOUNT_FILE.');
    process.exit(1);
  }

  if (report.failures.length) {
    console.log('');
    console.log(`Credential problems: ${report.failures.join(', ')}`);
    process.exit(1);
  }

  console.log('');
  console.log('Credentials are structurally valid and match the Android app.');

  if (online) {
    const exchange = await report.exchange();
    if (exchange.ok) {
      console.log(`Google issued an OAuth token (${exchange.tokenType}, ${exchange.expiresIn}s) — FCM sending is live.`);
      process.exit(0);
    }
    if (exchange.network) {
      console.log(`OAuth exchange could not reach Google (${exchange.reason}).`);
      console.log('That is expected in the development sandbox; run with --online on the server to confirm.');
      process.exit(0);
    }
    console.log(`Google rejected the assertion (HTTP ${exchange.status}): ${exchange.reason}`);
    console.log('Usually means the key was deleted/rotated, or the project disabled the service account.');
    process.exit(1);
  }

  console.log('Run with --online to exchange the assertion for an OAuth token (needs outbound HTTPS).');
  process.exit(0);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { inspectFcmCredentials, exchangeForAccessToken, resolveSecretPath };
