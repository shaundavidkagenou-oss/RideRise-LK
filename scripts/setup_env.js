#!/usr/bin/env node
'use strict';
// RideRise LK — write the .env a hosted server needs, without hand-editing a file.
//
//   node scripts/setup_env.js                 ask for the three values, write .env
//   node scripts/setup_env.js --show          print what is configured (secrets masked)
//   node scripts/setup_env.js --force         rewrite everything, including the session secret
//
// Why this exists: creating .env on a hosting panel means a file editor in a browser terminal,
// and one wrong character there shows up later as "sign-in is not configured". The three values
// that cannot be guessed are asked for one at a time, validated, and written with a generated
// 64-character session secret. Everything else comes from .env.example.
//
// The file is created with mode 600 and is git-ignored. Nothing is ever printed unmasked except
// the non-secret Firebase identifiers.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline');

const ROOT = path.join(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env');
const TEMPLATE_PATH = path.join(ROOT, '.env.example');

const DEFAULTS = {
  FIREBASE_PROJECT_ID: 'rideriselk',
  FIREBASE_AUTH_DOMAIN: 'rideriselk.firebaseapp.com',
  FIREBASE_MESSAGING_SENDER_ID: '614966302540',
  FIREBASE_STORAGE_BUCKET: 'rideriselk.firebasestorage.app',
  ADMIN_USERNAME: 'studio-admin'
};

/* ------------------------------------------------------------------ parsing ---- */

/** Minimal .env reader: KEY=value, ignores comments and surrounding quotes. */
function parseEnv(text) {
  const out = {};
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function readIfExists(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/* --------------------------------------------------------------- validation ---- */

function checkApiKey(value) {
  if (!value) return 'missing';
  if (!value.startsWith('AIza')) return 'a Firebase web API key starts with "AIza"';
  if (value.length < 30) return 'that key is too short to be a Firebase web API key';
  return null;
}

function checkAppId(value) {
  if (!value) return 'missing';
  if (!/^\d+:\d+:(web|android|ios):/.test(value)) {
    return 'it should look like 1:614966302540:web:abc123 (copy the whole line)';
  }
  return null;
}

function checkAdminPassword(value) {
  // Empty is allowed: the server then generates one and prints it once in the logs.
  if (!value) return null;
  if (value.length < 12) return 'use at least 12 characters, or leave it empty to have one generated';
  return null;
}

/** Mask a secret for the confirmation summary: keep enough to recognise, not to use. */
function mask(value) {
  const text = String(value || '');
  if (!text) return '(empty)';
  if (text.length <= 8) return '*'.repeat(text.length);
  return `${text.slice(0, 4)}${'*'.repeat(Math.min(12, text.length - 8))}${text.slice(-4)}`;
}

/* --------------------------------------------------------------------- input ---- */

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(String(answer || '').trim());
    });
  });
}

/** Ask until the value passes validation, or the user presses Enter to keep the current one. */
async function askValidated({ label, hint, current, validate, required }) {
  for (;;) {
    const suffix = current ? ` [Enter keeps ${mask(current)}]` : '';
    const answer = await ask(`  ${label}${suffix}\n  ${hint}\n  > `);
    const value = answer || current || '';
    const problem = validate(value);
    if (!problem) return value;
    if (problem === 'missing' && !required) return '';
    console.log(`  ! ${problem}\n`);
  }
}

/* -------------------------------------------------------------------- output ---- */

function buildEnvFile(values) {
  const template = readIfExists(TEMPLATE_PATH);
  const written = new Set();
  const lines = [];

  const applyLine = (rawLine) => {
    const trimmed = rawLine.trim();
    const eq = trimmed.indexOf('=');
    if (!trimmed || trimmed.startsWith('#') || eq === -1) {
      lines.push(rawLine);
      return;
    }
    const key = trimmed.slice(0, eq).trim();
    if (key === 'PORT') {
      // A panel or proxy assigns the port and passes it in the environment. A fixed value here
      // would be the classic "listening on 3000 behind a proxy pointing at another port" bug.
      if (!written.has('__port_notice')) {
        lines.push('# PORT is assigned by the host (panel/proxy) and passed in the environment.');
        lines.push('# Setting it here would override that. Leave it commented out.');
        written.add('__port_notice');
      }
      lines.push(`# PORT=${trimmed.slice(eq + 1).trim()}`);
      return;
    }
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      lines.push(`${key}=${values[key]}`);
      written.add(key);
      return;
    }
    lines.push(rawLine);
  };

  if (template) {
    for (const rawLine of template.split(/\r?\n/)) applyLine(rawLine);
  } else {
    lines.push('# RideRise LK — written by scripts/setup_env.js');
  }

  // Anything the template does not carry (e.g. HOST) goes in one tidy block at the end.
  const missing = Object.keys(values).filter((key) => !written.has(key));
  if (missing.length) {
    lines.push('');
    lines.push('# ---------- added by scripts/setup_env.js ----------');
    for (const key of missing) lines.push(`${key}=${values[key]}`);
  }

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

/* ---------------------------------------------------------------------- main ---- */

async function main(argv) {
  const args = argv.slice(2);
  const flag = (name) => {
    const hit = args.find((a) => a === name || a.startsWith(`${name}=`));
    if (!hit) return null;
    if (hit.includes('=')) return hit.slice(hit.indexOf('=') + 1);
    return true;
  };
  const nonInteractive = Boolean(flag('--non-interactive'));

  const existingText = readIfExists(ENV_PATH);
  const existing = existingText ? parseEnv(existingText) : {};

  if (flag('--show')) {
    if (!existingText) {
      console.log('No .env here. Run:  node scripts/setup_env.js');
      return 1;
    }
    console.log(`\n${ENV_PATH}\n`);
    for (const key of ['NODE_ENV', 'HOST', 'JWT_SECRET', 'FIREBASE_PROJECT_ID', 'FIREBASE_API_KEY',
      'FIREBASE_APP_ID', 'ADMIN_USERNAME', 'ADMIN_PASSWORD']) {
      const secret = ['JWT_SECRET', 'FIREBASE_API_KEY', 'ADMIN_PASSWORD'].includes(key);
      const value = existing[key];
      console.log(`  ${key.padEnd(30)} ${value === undefined ? '(not set)' : secret ? mask(value) : value || '(empty)'}`);
    }
    console.log('');
    return 0;
  }

  console.log('\nRideRise LK — server settings\n');
  console.log('Three values are needed. The Firebase ones are in the .env on your own computer');
  console.log('(Firebase console → Project settings → Your apps → Web app).\n');

  const forced = Boolean(flag('--force'));
  const values = {
    NODE_ENV: 'production',
    HOST: flag('--host') === true ? '::' : typeof flag('--host') === 'string' ? flag('--host') : existing.HOST || '::',
    JWT_SECRET: !forced && existing.JWT_SECRET && existing.JWT_SECRET.length >= 32
      ? existing.JWT_SECRET
      : crypto.randomBytes(32).toString('hex'),
    FIREBASE_PROJECT_ID: existing.FIREBASE_PROJECT_ID || DEFAULTS.FIREBASE_PROJECT_ID,
    FIREBASE_AUTH_DOMAIN: existing.FIREBASE_AUTH_DOMAIN || DEFAULTS.FIREBASE_AUTH_DOMAIN,
    FIREBASE_MESSAGING_SENDER_ID: existing.FIREBASE_MESSAGING_SENDER_ID || DEFAULTS.FIREBASE_MESSAGING_SENDER_ID,
    FIREBASE_STORAGE_BUCKET: existing.FIREBASE_STORAGE_BUCKET || DEFAULTS.FIREBASE_STORAGE_BUCKET,
    ADMIN_USERNAME: existing.ADMIN_USERNAME || DEFAULTS.ADMIN_USERNAME
  };

  const fromFlagOrAsk = async (flagName, opts) => {
    const flagged = flag(flagName);
    if (typeof flagged === 'string') {
      const problem = opts.validate(flagged);
      if (problem && problem !== 'missing') {
        console.error(`\n✖ ${flagName}: ${problem}\n`);
        process.exitCode = 1;
        return null;
      }
      return flagged;
    }
    if (nonInteractive) return opts.current || '';
    return askValidated(opts);
  };

  const apiKey = await fromFlagOrAsk('--api-key', {
    label: 'Firebase web API key',
    hint: 'starts with AIza… — from the .env on your computer (FIREBASE_API_KEY)',
    current: existing.FIREBASE_API_KEY || '',
    validate: checkApiKey,
    required: false
  });
  if (apiKey === null) return 1;
  const appId = await fromFlagOrAsk('--app-id', {
    label: 'Firebase app id',
    hint: 'looks like 1:614966302540:web:abc123 — from your .env (FIREBASE_APP_ID)',
    current: existing.FIREBASE_APP_ID || '',
    validate: checkAppId,
    required: false
  });
  if (appId === null) return 1;
  const adminPassword = await fromFlagOrAsk('--admin-password', {
    label: 'Studio admin password (12+ characters)',
    hint: 'used to sign in to the studio console — visible as you type; Enter to have one generated',
    current: existing.ADMIN_PASSWORD || '',
    validate: checkAdminPassword,
    required: false
  });
  if (adminPassword === null) return 1;

  values.FIREBASE_API_KEY = apiKey || '';
  values.FIREBASE_APP_ID = appId || '';
  values.ADMIN_PASSWORD = adminPassword || '';

  // Keep any extra keys the owner added by hand.
  const managed = new Set([...Object.keys(values), 'PORT', 'SEED_DEMO', 'NODE_ENV']);
  const extras = Object.entries(existing).filter(([key]) => !managed.has(key));

  let text = buildEnvFile(values);
  if (extras.length) {
    text += `\n# ---------- kept from the previous file ----------\n${extras.map(([k, v]) => `${k}=${v}`).join('\n')}\n`;
  }

  const dir = path.dirname(ENV_PATH);
  fs.mkdirSync(dir, { recursive: true });
  // Back up an existing file rather than silently destroying hand edits.
  if (existingText && existingText !== text) {
    fs.writeFileSync(`${ENV_PATH}.bak`, existingText, { mode: 0o600 });
  }
  fs.writeFileSync(ENV_PATH, text, { mode: 0o600 });
  try {
    fs.chmodSync(ENV_PATH, 0o600);
  } catch {
    /* some filesystems refuse; the file is still private to the account */
  }

  console.log(`\n✔ Wrote ${ENV_PATH}\n`);
  console.log(`  session secret   ${mask(values.JWT_SECRET)} (${values.JWT_SECRET.length} characters, generated)`);
  console.log(`  Firebase key     ${apiKey ? mask(apiKey) : '(empty — sign-in stays disabled)'}`);
  console.log(`  Firebase app id  ${appId || '(empty — sign-in stays disabled)'}`);
  console.log(`  admin password   ${adminPassword ? mask(adminPassword) : '(empty — the server prints a generated one once)'}`);
  if (existingText) console.log(`  previous file    saved as ${path.basename(ENV_PATH)}.bak`);

  if (!apiKey || !appId) {
    console.log('\n! Without the two Firebase values nobody can register or sign in.');
    console.log('  Run this again when you have them, or fill them in by hand.\n');
  }

  console.log('\nNext: restart the app so it reads this file.');
  console.log(`  smoke test:  cd ${ROOT} && PORT=8100 node backend/server.js`);
  console.log('  on a panel:  Web → Sites → your site → restart\n');
  return 0;
}

if (require.main === module) {
  main(process.argv).then(
    (code) => {
      if (code !== undefined) process.exitCode = code;
    },
    (err) => {
      console.error(`\n✖ ${err && err.message ? err.message : err}\n`);
      process.exitCode = 1;
    }
  );
} else {
  module.exports = { parseEnv, checkApiKey, checkAppId, checkAdminPassword, buildEnvFile, mask };
}
