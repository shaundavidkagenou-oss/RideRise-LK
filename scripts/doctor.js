#!/usr/bin/env node
'use strict';
// RideRise LK — "is this server ready?" in one command.
//
//   node scripts/doctor.js
//
// Runs the checks you would otherwise do by hand, in order, and stops guessing:
//   1. Node version (this backend needs node:sqlite, flag-free from 22.13)
//   2. the files the server reads are actually here
//   3. .env exists and the Firebase values look real
//   4. the server boots and answers /api/health, with sign-in configured
//   5. prints the URL to open next
//
// Exit code 0 = everything passed, 1 = something to fix (each step says what).

const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const os = require('node:os');
const { spawn } = require('node:child_process');

const { parseEnv, checkApiKey, checkAppId, checkAdminPassword } = require('./setup_env.js');

const ROOT = path.join(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env');

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  const mark = ok === true ? '\u2714' : ok === 'warn' ? '\u26a0' : '\u2716';
  console.log(`  ${mark} ${name}${detail ? `: ${detail}` : ''}`);
  return ok === true;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function main() {
  console.log('\nRideRise LK — server readiness\n');
  console.log(`  folder: ${ROOT}\n`);

  let blocking = false;

  // 1. Node -----------------------------------------------------------------
  const major = Number(process.versions.node.split('.')[0]);
  const minor = Number(process.versions.node.split('.')[1]);
  const nodeOk = major > 22 || (major === 22 && minor >= 13);
  if (!record('Node.js', nodeOk, `v${process.versions.node}${nodeOk ? '' : ' — needs 22.13+ (choose Node 24)'}`)) blocking = true;

  let sqliteOk = true;
  try {
    require('node:sqlite');
  } catch {
    sqliteOk = false;
    blocking = true;
  }
  record('Built-in SQLite', sqliteOk, sqliteOk ? 'available' : 'this Node cannot load node:sqlite');

  // 2. Files ----------------------------------------------------------------
  for (const rel of ['backend/server.js', 'backend/schema.sql', 'config/brand.config.json', 'web_app/index.html']) {
    const ok = fs.existsSync(path.join(ROOT, rel));
    if (!record('File', ok, `${rel}${ok ? '' : ' is missing — is this the app folder?'}`)) blocking = true;
  }

  // 3. Settings -------------------------------------------------------------
  let env = {};
  const envText = (() => {
    try {
      return fs.readFileSync(ENV_PATH, 'utf8');
    } catch {
      return null;
    }
  })();
  if (!record('.env', Boolean(envText), envText ? ENV_PATH : 'missing — run: node scripts/setup_env.js')) {
    blocking = true;
  } else {
    env = parseEnv(envText);
    const apiKeyProblem = checkApiKey(env.FIREBASE_API_KEY || '');
    const appIdProblem = checkAppId(env.FIREBASE_APP_ID || '');
    const adminProblem = checkAdminPassword(env.ADMIN_PASSWORD || '');
    if (apiKeyProblem) {
      record('Firebase API key', false, apiKeyProblem === 'missing' ? 'empty — nobody can sign in' : apiKeyProblem);
      blocking = true;
    } else {
      record('Firebase API key', true, 'set');
    }
    if (appIdProblem) {
      record('Firebase app id', false, appIdProblem === 'missing' ? 'empty' : appIdProblem);
      blocking = true;
    } else {
      record('Firebase app id', true, env.FIREBASE_APP_ID);
    }
    const secretOk = (env.JWT_SECRET || '').length >= 32;
    if (!record('Session secret', secretOk, secretOk ? `${(env.JWT_SECRET || '').length} characters` : 'missing or under 32 characters')) blocking = true;
    record('Studio admin password', !adminProblem, env.ADMIN_PASSWORD ? 'set' : 'empty — a random one is printed once on first start');

    if (!env.FIREBASE_PROJECT_ID) {
      record('Firebase project id', false, 'empty — FIREBASE_PROJECT_ID must be set');
      blocking = true;
    } else {
      record('Firebase project id', true, env.FIREBASE_PROJECT_ID);
    }
  }

  if (blocking) {
    console.log('\n\u2716 Fix the items marked \u2716, then run this again.\n');
    return 1;
  }

  // 4. Boot it and ask -----------------------------------------------
  const port = await freePort();
  const dbPath = path.join(os.tmpdir(), `riderise-doctor-${Date.now()}.sqlite`);
  const child = spawn(process.execPath, [path.join(ROOT, 'backend', 'server.js')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DB_PATH: dbPath, NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  const collected = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`the server did not start within 20s\n${log}`)), 20000);
    const onData = (chunk) => {
      log += chunk.toString();
      if (/listening on/.test(log)) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`the server exited with code ${code}\n${log}`));
    });
  });

  let ok = false;
  try {
    await collected;
    record('Server boots', true, `listening on port ${port}`);
    const health = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json();
    record('Answers /api/health', health.status === 'ok' && /RideRise LK/.test(health.app || ''), `${health.app} \u00b7 phase ${health.phase}`);
    const auth = Boolean(health.capabilities && health.capabilities.firebaseAuth);
    record('Sign-in configured', auth, auth ? 'email/password enabled' : 'the server says Firebase is not configured');
    ok = health.status === 'ok' && auth;
    if (ok && /Firebase Auth configured/.test(log) === false) {
      record('Startup log', 'warn', 'health says configured but the log line was not seen');
    }
  } catch (err) {
    record('Server boots', false, err.message.split('\n').slice(0, 6).join('\n      '));
  } finally {
    child.kill('SIGKILL');
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        fs.rmSync(`${dbPath}${suffix}`, { force: true });
      } catch {
        /* ignore */
      }
    }
  }

  if (!ok) {
    console.log('\n\u2716 The server starts but is not ready. The message above says why.\n');
    return 1;
  }

  console.log('\n\u2714 All good. This server is ready.');
  console.log('\nNext:');
  console.log('  • create/reload the website in the panel so it runs the app (see the guide)');
  console.log('  • open  https://YOURNAME.alwaysdata.net/api/health  on your phone');
  console.log('  • then  npm run configure:apk -- --url https://YOURNAME.alwaysdata.net  on your computer\n');
  return 0;
}

if (require.main === module) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      console.error(`\n\u2716 ${err && err.message ? err.message : err}\n`);
      process.exitCode = 1;
    }
  );
}
