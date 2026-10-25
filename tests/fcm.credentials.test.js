// RideRise LK — FCM server credentials (node:test)
//
// Validates the service account that lets the backend talk to Firebase Cloud Messaging:
// structure, RSA key, and a real RS256 sign/verify round trip using the same assertion the
// push sender builds. It never prints key material and it passes on a fresh clone that has no
// credentials (in which case it asserts the "push disabled" state instead).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { inspectFcmCredentials } = require('../scripts/verify_fcm_credentials.js');

const ROOT = path.join(__dirname, '..');
const report = inspectFcmCredentials();
const check = (id) => report.checks.find((entry) => entry.id === id);

function gitLines(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' })
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

test('service account, when configured, is structurally valid and signs the server assertion', () => {
  if (!report.present) {
    assert.equal(report.status, 'missing');
    assert.equal(report.configured, false);
    return;
  }
  assert.deepEqual(report.failures, [], `credential checks failed: ${report.failures.join(', ')}`);
  assert.equal(report.configured, true);
  assert.ok(check('FCM-3').ok, 'required fields');
  assert.ok(check('FCM-7').ok, 'private key parses');
  assert.ok(check('FCM-8').ok, 'RS256 JWT signs and verifies');
});

test('service account belongs to the same Firebase project as the Android app', () => {
  if (!report.present) return;
  const androidPath = path.join(ROOT, 'android/app/google-services.json');
  if (!fs.existsSync(androidPath)) return; // fresh clone without the Android config
  const android = JSON.parse(fs.readFileSync(androidPath, 'utf8'));
  assert.equal(report.projectId, android.project_info.project_id);
  assert.ok(check('FCM-10').ok, 'project ids match');
  assert.ok(check('FCM-11').ok, 'sender id matches FIREBASE_MESSAGING_SENDER_ID');
});

test('the credential file is private and never tracked by git', () => {
  if (!report.present) return;
  assert.ok(check('FCM-2').ok, 'file permissions are owner-only');
  assert.deepEqual(gitLines(['ls-files', 'secrets']), []);
  assert.deepEqual(gitLines(['ls-files', path.relative(ROOT, report.path)]), []);
});

test('no tracked file contains the private key', () => {
  if (!report.present) return;
  const serviceAccount = JSON.parse(fs.readFileSync(report.path, 'utf8'));
  const body = serviceAccount.private_key
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.includes('-----'))
    .join('');
  const probe = body.slice(Math.floor(body.length / 2), Math.floor(body.length / 2) + 40);
  assert.deepEqual(gitLines(['grep', '-l', '-F', '-e', probe, '--', '.']), []);
});

test('push sender reports the configured project from the same credential file', () => {
  // `npm start` loads .env; the test runner does not, so hand the sender the same path the
  // verifier resolved (never the key itself).
  if (report.present && !process.env.FCM_SERVICE_ACCOUNT_FILE) {
    process.env.FCM_SERVICE_ACCOUNT_FILE = report.path;
  }
  const { createPushSender } = require('../backend/phase2/core.js');
  const sender = createPushSender();
  const status = sender.status();
  if (!report.present) {
    assert.equal(status.configured, false);
    return;
  }
  assert.equal(status.configured, true);
  assert.equal(status.project_id, report.projectId);
});
