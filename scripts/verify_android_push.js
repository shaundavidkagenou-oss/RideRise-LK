#!/usr/bin/env node
// RideRise LK — Android push (FCM) wiring verifier.
//
//   node scripts/verify_android_push.js
//   npm run check:android-push
//
// What it proves, without Gradle or an Android device:
//   * the Gradle project is complete and consistent (plugin, BoM, messaging, manifest, resources)
//   * the JS bridge -> native bridge -> Firebase path is connected end to end in source
//   * the channel id used by the server exists in the manifest, MainActivity and the service
//   * google-services.json (when present locally) parses and matches the app + server project
//   * the config file is git-ignored and not tracked
//
// What it cannot prove: that Gradle resolves the dependencies, that Firebase issues a token,
// or that a notification is displayed. Those need Android Studio and a real device.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

function read(rel) {
  try {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
  } catch {
    return null;
  }
}
function fileExists(rel) {
  try {
    return fs.statSync(path.join(ROOT, rel)).isFile();
  } catch {
    return false;
  }
}
function json(rel) {
  const text = read(rel);
  if (text == null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
function gitLines(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' })
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return []; // no match, or not a git checkout
  }
}
function trackedByGit(rel) {
  try {
    const out = execFileSync('git', ['ls-files', '--', rel], { cwd: ROOT, encoding: 'utf8' });
    return out.trim().length > 0;
  } catch {
    return false; // not a git checkout: cannot check, do not fail the run
  }
}
function firstMatch(text, regex) {
  const match = regex.exec(text || '');
  return match ? match[1] : null;
}

/**
 * @param {{requireGoogleServices?: boolean}} [options]
 * @returns {{id: string, label: string, ok: boolean, detail: string, required: boolean}[]}
 */
function runChecks(options = {}) {
  const checks = [];
  const add = (id, label, ok, detail, required = true) => {
    checks.push({ id, label, ok: Boolean(ok), detail: detail || '', required });
  };

  /* ------------------------------- inputs -------------------------------- */
  const brand = json('config/brand.config.json') || {};
  const packageId = brand.packageId || 'lk.shaunstudios.riderise';

  const rootGradle = read('android/build.gradle.kts') || '';
  const appGradle = read('android/app/build.gradle.kts') || '';
  const settingsGradle = read('android/settings.gradle.kts') || '';
  const wrapperProps = read('android/gradle/wrapper/gradle-wrapper.properties') || '';
  const manifest = read('android/app/src/main/AndroidManifest.xml') || '';
  const mainActivity = read('android/app/src/main/java/lk/shaunstudios/riderise/MainActivity.java') || '';
  const pushBridge = read('android/app/src/main/java/lk/shaunstudios/riderise/PushBridge.java') || '';
  const service = read('android/app/src/main/java/lk/shaunstudios/riderise/RideRiseMessagingService.java') || '';
  const appJs = read('web_app/app.js') || '';
  const coreJs = read('backend/phase2/core.js') || '';
  const gitignore = read('.gitignore') || '';
  const colors = read('android/res/values/colors.xml') || '';

  /* ----------------------------- gradle project -------------------------- */
  add(
    'GRADLE-1',
    'Gradle wrapper is complete (gradlew, wrapper jar, Gradle 8.9)',
    fileExists('android/gradlew') && fileExists('android/gradle/wrapper/gradle-wrapper.jar') &&
      /distributionUrl=.*gradle-8\.9-bin\.zip/.test(wrapperProps),
    'android/gradlew + gradle/wrapper/gradle-wrapper.jar + gradle-8.9-bin.zip'
  );

  add(
    'GRADLE-2',
    'Root build declares AGP 8.7.3 and google-services 4.5.0 (apply false)',
    /id\("com\.android\.application"\)\s+version\s+"8\.7\.3"\s+apply\s+false/.test(rootGradle) &&
      /id\("com\.google\.gms\.google-services"\)\s+version\s+"4\.5\.0"\s+apply\s+false/.test(rootGradle),
    'android/build.gradle.kts'
  );

  add(
    'GRADLE-3',
    'settings.gradle.kts includes :app and resolves Google Maven',
    /include\(":app"\)/.test(settingsGradle) && /google\(\)/.test(settingsGradle),
    'android/settings.gradle.kts'
  );

  add(
    'GRADLE-4',
    'app module applies the google-services plugin',
    /id\("com\.google\.gms\.google-services"\)/.test(appGradle),
    'android/app/build.gradle.kts'
  );

  add(
    'GRADLE-5',
    'Firebase BoM 35.1.0 + firebase-messaging, no Analytics',
    /platform\("com\.google\.firebase:firebase-bom:35\.1\.0"\)/.test(appGradle) &&
      /implementation\("com\.google\.firebase:firebase-messaging"\)/.test(appGradle) &&
      !/firebase-analytics/.test(appGradle.replace(/\/\/.*$/gm, '')),
    'Messaging only — analytics is intentionally excluded (privacy/scope)'
  );

  add(
    'GRADLE-6',
    'applicationId / versionCode / versionName come from config/brand.config.json',
    /applicationId = packageId/.test(appGradle) &&
      /versionCode = appVersionCode/.test(appGradle) &&
      /versionName = appVersionName/.test(appGradle) &&
      /brand\.config\.json/.test(appGradle),
    packageId
  );

  add(
    'GRADLE-7',
    'minSdk 24+ and compileSdk 35 (required by Firebase BoM 35 and Play Services)',
    /minSdk = 24/.test(appGradle) && /compileSdk = 35/.test(appGradle),
    'compileSdk 35, minSdk 24, targetSdk 34'
  );

  add(
    'GRADLE-8',
    'Resources and web assets are shared with the SDK-free pipeline',
    /res\.srcDirs\("src\/main\/res", "\.\.\/res"\)/.test(appGradle) &&
      /rrSyncWebAssets/.test(appGradle) &&
      fileExists('android/res/values/colors.xml'),
    'android/res + web_app/ -> assets/webapp'
  );

  add(
    'VERIFY-1',
    'google-services.json check task runs before every build',
    /checkGoogleServices/.test(appGradle) && /it\.name == "preBuild"/.test(appGradle),
    'Validates project id and package name, fails with the exact fix'
  );

  /* ------------------------------- manifest ------------------------------ */
  const backendChannel = firstMatch(coreJs, /channel_id:\s*'([^']+)'/);
  const manifestChannel = firstMatch(
    manifest,
    /com\.google\.firebase\.messaging\.default_notification_channel_id"\s+android:value="([^"]+)"/
  );
  const activityChannel = firstMatch(mainActivity, /NOTIFICATION_CHANNEL_ID\s*=\s+"([^"]+)"/);

  add(
    'MANIFEST-1',
    'Messaging service declared with the MESSAGING_EVENT filter',
    /<service\s+android:name="\.RideRiseMessagingService"\s+android:exported="false">/.test(manifest) &&
      /com\.google\.firebase\.MESSAGING_EVENT/.test(manifest),
    'android/app/src/main/AndroidManifest.xml'
  );

  add(
    'MANIFEST-2',
    'Channel id matches the server, the manifest and MainActivity',
    Boolean(backendChannel) && backendChannel === manifestChannel && backendChannel === activityChannel,
    `server=${backendChannel} manifest=${manifestChannel} native=${activityChannel}`
  );

  add(
    'MANIFEST-3',
    'Notification icon and accent colour exist as resources',
    /@drawable\/ic_notification/.test(manifest) &&
      fileExists('android/res/drawable/ic_notification.xml') &&
      /@color\/rr_accent/.test(manifest) &&
      /<color name="rr_accent">/.test(colors),
    'drawable/ic_notification.xml + values/colors.xml#rr_accent'
  );

  add(
    'MANIFEST-4',
    'POST_NOTIFICATIONS and singleTop activity (Android 13+ and notification taps)',
    /android\.permission\.POST_NOTIFICATIONS/.test(manifest) &&
      /android:launchMode="singleTop"/.test(manifest),
    'Runtime prompt + onNewIntent deep link'
  );

  add(
    'MANIFEST-5',
    'Launcher activity and package name are intact',
    /android:name="\.MainActivity"/.test(manifest) && /android:name="android\.intent\.category\.LAUNCHER"/.test(manifest),
    packageId
  );

  /* --------------------------- native Java wiring ------------------------ */
  add(
    'JAVA-1',
    'MainActivity exposes requestPushToken()/getPushToken() to JavaScript',
    /@JavascriptInterface\s+public void requestPushToken\(\)/.test(mainActivity) &&
      /@JavascriptInterface\s+public String getPushToken\(\)/.test(mainActivity),
    'window.RRAndroid.requestPushToken / getPushToken'
  );

  add(
    'JAVA-2',
    'MainActivity reaches PushBridge reflectively (one source for both build pipelines)',
    /Class\.forName\("lk\.shaunstudios\.riderise\.PushBridge"\)/.test(mainActivity) &&
      /getMethod\("requestToken", WebView\.class, Context\.class\)/.test(mainActivity),
    'SDK-free APK has no Play Services class; the call degrades to a no-op'
  );

  add(
    'JAVA-3',
    'PushBridge implements requestToken(WebView, Context) with FirebaseMessaging',
    /public static void requestToken\(final WebView webView, Context context\)/.test(pushBridge) &&
      /FirebaseMessaging\.getInstance\(\)\.getToken\(\)/.test(pushBridge),
    'android/app/src/main/java/.../PushBridge.java'
  );

  add(
    'JAVA-4',
    'PushBridge prefs file/keys match MainActivity.getPushToken()',
    /PREFS = "riderise_push"/.test(pushBridge) &&
      /KEY_TOKEN = "fcm_token"/.test(pushBridge) &&
      /getSharedPreferences\("riderise_push"/.test(mainActivity) &&
      /getString\("fcm_token"/.test(mainActivity),
    'riderise_push / fcm_token'
  );

  add(
    'JAVA-5',
    'Token is delivered to window.RR.onPushToken()',
    /onPushToken/.test(pushBridge) && /window\.RR && window\.RR\.onPushToken/.test(pushBridge),
    'The web layer owns the authenticated POST, never the OS token cache'
  );

  add(
    'JAVA-6',
    'MessagingService handles new tokens and foreground messages without AndroidX',
    /extends FirebaseMessagingService/.test(service) &&
      /onNewToken\(String token\)/.test(service) &&
      /onMessageReceived\(RemoteMessage message\)/.test(service) &&
      !/androidx\./.test(service),
    'Notification.Builder + channel, no androidx.core dependency'
  );

  add(
    'JAVA-7',
    'Deep link extra is shared: service writes it, MainActivity reads it, WebView routes it',
    firstMatch(mainActivity, /EXTRA_DEEP_LINK = "([^"]+)"/) === 'deep_link' &&
      /putExtra\(MainActivity\.EXTRA_DEEP_LINK/.test(service) &&
      /location\.hash/.test(mainActivity) &&
      /getStringExtra\(EXTRA_DEEP_LINK\)/.test(mainActivity),
    'Intent extra "deep_link" ("#/notifications", "#/events", ...)'
  );

  add(
    'JAVA-8',
    'Notification channel is created by plain android.app code (works in both builds)',
    /public static void ensureNotificationChannel\(Context context\)/.test(mainActivity) &&
      /createNotificationChannel/.test(mainActivity) &&
      /MainActivity\.ensureNotificationChannel\(this\)/.test(service),
    'IMPORTANCE_HIGH, description from strings.xml'
  );

  /* ------------------------------- web client --------------------------- */
  add(
    'WEB-1',
    'Web client registers the token with POST /api/devices',
    /window\.RR\.onPushToken = async function/.test(appJs) &&
      /RR\.api\('\/api\/devices'/.test(appJs) &&
      /platform: 'android'/.test(appJs),
    'web_app/app.js'
  );

  add(
    'WEB-2',
    'Web client calls the native bridge and asks for notification permission',
    /RRAndroid\.requestPushToken/.test(appJs) && /RRAndroid\.requestNotificationPermission/.test(appJs),
    'After sign-in, never before a session exists'
  );

  /* --------------------------------- server ----------------------------- */
  const social2 = read('backend/phase2/social2.js') || '';
  add(
    'SERVER-1',
    'Server can send FCM HTTP v1 messages and logs each attempt',
    /messages:send/.test(coreJs) &&
      /INSERT INTO push_delivery_log/.test(coreJs) &&
      /createPushSender/.test(coreJs),
    'createPushSender → fcm.googleapis.com/v1/projects/{id}/messages:send'
  );

  add(
    'SERVER-2',
    'POST and DELETE /api/devices store and remove the token',
    /pathname === '\/api\/devices' && req\.method === 'POST'/.test(social2) &&
      /INSERT INTO device_tokens/.test(social2) &&
      /pathname === '\/api\/devices' && req\.method === 'DELETE'/.test(social2) &&
      /DELETE FROM device_tokens/.test(social2),
    'backend/phase2/social2.js'
  );

  add(
    'SERVER-3',
    'Push delivery status is visible to studio admins',
    /\/api\/admin\/push\/status/.test(read('backend/phase2/admin.js') || '') ||
      /\/api\/admin\/push\/status/.test(coreJs),
    'GET /api/admin/push/status'
  );

  /* --------------------------- secrets hygiene --------------------------- */
  add(
    'SECRET-1',
    'google-services.json is git-ignored and untracked',
    /(^|\n)google-services\.json\s*($|\n)/.test(gitignore) &&
      /android\/app\/google-services\.json/.test(gitignore) &&
      !trackedByGit('android/app/google-services.json'),
    'Firebase Android client config stays out of version control'
  );

  const template = json('android/app/google-services.json.example');
  add(
    'SECRET-2',
    'Template config is valid JSON and documents the placeholder',
    Boolean(template) &&
      JSON.stringify(template).includes('000000000000') &&
      template.client?.[0]?.client_info?.android_client_info?.package_name === packageId,
    'android/app/google-services.json.example'
  );

  /* --------------------- server-side FCM credentials --------------------- */
  // The service account is a real secret: only structural/project checks, never its content.
  const localEnvText = read('.env') || '';
  const envValue = (key) => firstMatch(localEnvText, new RegExp(`^${key}=(.*)$`, 'm'))?.trim() || '';
  const serviceAccountPath =
    envValue('FCM_SERVICE_ACCOUNT_FILE') ||
    (fileExists('secrets/firebase-service-account.json') ? 'secrets/firebase-service-account.json' : '');
  const serviceAccountFile = serviceAccountPath
    ? path.resolve(ROOT, serviceAccountPath)
    : '';
  const serviceAccount = serviceAccountFile && fs.existsSync(serviceAccountFile)
    ? (() => {
        try {
          return JSON.parse(fs.readFileSync(serviceAccountFile, 'utf8'));
        } catch {
          return null;
        }
      })()
    : null;
  const googleServices = json('android/app/google-services.json');

  add(
    'SERVER-4',
    'Server FCM service account is present and uses the same project as the Android app',
    serviceAccount
      ? Boolean(serviceAccount.project_id) &&
          (!googleServices || googleServices.project_info?.project_id === serviceAccount.project_id)
      : true,
    serviceAccount
      ? `project ${serviceAccount.project_id} (private key not read)`
      : 'No service account in this checkout — the server reports push:false until one is configured',
    false
  );

  add(
    'SERVER-5',
    'git-ignored secrets directory is not tracked',
    !trackedByGit('secrets') && gitLines(['ls-files', 'secrets']).length === 0,
    'secrets/firebase-service-account.json'
  );

  // Compare a short slice of the *real* key (never printed) against tracked files. Placeholder
  // "BEGIN PRIVATE KEY" text in documentation is not a leak and must not fail the check.
  // Take the probe from the middle of the key: every 2048-bit RSA PEM starts with the same
  // ~40 base64 characters, so a prefix would match unrelated test fixtures (and prove nothing).
  const keyBody = serviceAccount && serviceAccount.private_key
    ? serviceAccount.private_key.split('\n').map((line) => line.trim()).filter((line) => line && !line.includes('-----')).join('')
    : '';
  const keyProbe = keyBody ? keyBody.slice(Math.floor(keyBody.length / 2), Math.floor(keyBody.length / 2) + 40) : '';
  add(
    'SECRET-3',
    'The service-account private key is not committed to the repository',
    keyProbe ? gitLines(['grep', '-l', '-F', '-e', keyProbe, '--', '.']).length === 0 : true,
    keyProbe
      ? 'A 40-character slice of the key was searched for in every tracked file'
      : 'No local service account in this checkout — nothing to leak'
  );

  /* ------------------------- the real config file ------------------------ */
  const configPath = 'android/app/google-services.json';
  const hasConfig = fileExists(configPath);
  const config = hasConfig ? json(configPath) : null;
  const expectedRequirement = options.requireGoogleServices === true;

  if (!hasConfig) {
    add(
      'FCM-0',
      'Real google-services.json installed',
      !expectedRequirement,
      expectedRequirement
        ? `Missing ${configPath} — download it from Firebase console → Project settings → Your apps.`
        : 'Not present in this checkout (expected on a fresh clone; add it to build the Firebase APK)',
      expectedRequirement
    );
  } else {
    add(
      'FCM-0',
      'Real google-services.json parses',
      config !== null && config !== undefined,
      config === undefined ? 'File is not valid JSON' : configPath
    );
  }

  if (config) {
    const projectNumber = config.project_info?.project_number || '';
    const projectId = config.project_info?.project_id || '';
    const clients = Array.isArray(config.client) ? config.client : [];
    const androidClient = clients.find(
      (entry) => entry?.client_info?.android_client_info?.package_name === packageId
    );
    const appId = androidClient?.client_info?.mobilesdk_app_id || '';
    const apiKey = androidClient?.api_key?.[0]?.current_key || '';
    const envText = read('.env') || '';
    const env = (key) => firstMatch(envText, new RegExp(`^${key}=(.*)$`, 'm'))?.trim() || '';
    const envProject = env('FIREBASE_PROJECT_ID');
    const envSender = env('FIREBASE_MESSAGING_SENDER_ID');

    add('FCM-1', 'Android client exists for the app package', Boolean(androidClient), packageId);
    add(
      'FCM-2',
      'mobilesdk_app_id matches project number and package',
      new RegExp(`^1:${projectNumber}:android:[0-9a-f]+$`).test(appId),
      appId || '(none)'
    );
    add('FCM-3', 'Client API key present (public identifier, not a secret)', apiKey.length > 20, `${apiKey.slice(0, 8)}…`);
    add(
      'FCM-4',
      'Firebase project matches FIREBASE_PROJECT_ID in .env',
      !envProject || envProject === projectId,
      envProject ? `android=${projectId} server=${envProject}` : `android=${projectId}; .env has no FIREBASE_PROJECT_ID`
    );
    add(
      'FCM-5',
      'Sender id matches FIREBASE_MESSAGING_SENDER_ID in .env',
      !envSender || envSender === projectNumber,
      envSender ? `android=${projectNumber} server=${envSender}` : `android=${projectNumber}; .env has no FIREBASE_MESSAGING_SENDER_ID`
    );
    add(
      'FCM-6',
      'No OAuth clients required (email/password sign-in only)',
      Array.isArray(androidClient?.oauth_client) && androidClient.oauth_client.length === 0,
      'Google Sign-In is removed; an empty oauth_client list is correct',
      false
    );
  }

  return checks;
}

function render(checks) {
  const glyph = (ok) => (ok ? '\u2714' : '\u2716');
  const width = Math.max(...checks.map((c) => c.id.length));
  for (const check of checks) {
    const tag = check.ok ? '' : check.required ? '  FAIL' : '  WARN';
    console.log(`${glyph(check.ok)} ${check.id.padEnd(width)}  ${check.label}${tag}`);
    if (check.detail) console.log(`  ${' '.repeat(width)}  ${check.detail}`);
  }
  const required = checks.filter((c) => c.required);
  const failed = required.filter((c) => !c.ok);
  const warnings = checks.filter((c) => !c.required && !c.ok);
  console.log('');
  console.log(
    `${required.length - failed.length}/${required.length} required checks passed` +
      (warnings.length ? `, ${warnings.length} warning(s)` : '')
  );
  if (failed.length) {
    console.log('');
    console.log('Next step:');
    for (const check of failed) console.log(`  ${check.id}: ${check.detail}`);
  }
  return failed.length === 0;
}

if (require.main === module) {
  const checks = runChecks({ requireGoogleServices: process.argv.includes('--require-config') });
  const ok = render(checks);
  process.exit(ok ? 0 : 1);
}

module.exports = { runChecks, render };
