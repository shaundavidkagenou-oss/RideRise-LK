// RideRise LK — Android/FCM wiring tests (node:test)
//
// These are static, hermetic checks: they read the Gradle project, the Java sources, the
// manifest, the web client and the server routes and assert that they agree with each other.
// They do NOT prove that Gradle resolves dependencies, that Firebase issues a token, or that
// a notification appears — that needs Android Studio and a device (see docs/BUILD_INSTRUCTIONS.md).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { runChecks } = require('../scripts/verify_android_push.js');

const ROOT = path.join(__dirname, '..');
const checks = runChecks();
const byId = (id) => checks.find((check) => check.id === id);

test('every required Android push check passes', () => {
  const failed = checks.filter((check) => check.required && !check.ok);
  assert.deepEqual(
    failed.map((check) => `${check.id}: ${check.label} (${check.detail})`),
    [],
    'Android push wiring is incomplete'
  );
});

test('the verifier covers Gradle, manifest, Java, web, server and secrets', () => {
  const prefixes = new Set(checks.map((check) => check.id.split('-')[0]));
  for (const area of ['GRADLE', 'MANIFEST', 'JAVA', 'WEB', 'SERVER', 'SECRET', 'FCM']) {
    assert.ok(prefixes.has(area), `expected checks for ${area}`);
  }
  assert.ok(checks.length >= 30, `expected a broad check list, got ${checks.length}`);
});

test('Firebase Messaging is the only Firebase SDK (no analytics, no auth SDK)', () => {
  const gradle = fs.readFileSync(path.join(ROOT, 'android/app/build.gradle.kts'), 'utf8');
  const dependencyLines = gradle
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '').trim())
    .filter((line) => line.startsWith('implementation('));
  assert.deepEqual(dependencyLines, [
    'implementation(platform("com.google.firebase:firebase-bom:35.1.0"))',
    'implementation("com.google.firebase:firebase-messaging")'
  ]);
});

test('notification deep links are restricted to in-app hash routes', () => {
  const activity = fs.readFileSync(
    path.join(ROOT, 'android/app/src/main/java/lk/shaunstudios/riderise/MainActivity.java'),
    'utf8'
  );
  assert.match(activity, /if \(!hash\.startsWith\("\/"\)\)/);
  assert.match(activity, /location\.hash = /);
});

test('channel id is identical in the server, manifest, native code and service', () => {
  assert.ok(byId('MANIFEST-2').ok, byId('MANIFEST-2').detail);
  assert.equal(byId('MANIFEST-2').detail, 'server=riderise_default manifest=riderise_default native=riderise_default');
});

test('the real google-services.json, when present, belongs to this app and this server project', () => {
  const configPath = path.join(ROOT, 'android/app/google-services.json');
  if (!fs.existsSync(configPath)) {
    assert.ok(byId('FCM-0').ok, 'missing config is allowed only when it is not required');
    return;
  }
  for (const id of ['FCM-0', 'FCM-1', 'FCM-2', 'FCM-3', 'FCM-4', 'FCM-5']) {
    assert.ok(byId(id).ok, `${id} failed: ${byId(id).detail}`);
  }
});

test('google-services.json is never tracked by git', () => {
  assert.ok(byId('SECRET-1').ok, byId('SECRET-1').detail);
});
