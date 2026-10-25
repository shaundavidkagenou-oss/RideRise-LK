# Firebase Cloud Messaging — the Android push build

`android/` is now a **complete Android Studio project** with Firebase Cloud Messaging wired
end to end. You do not copy files anywhere: open the `android/` folder, add your
`google-services.json` (already installed here, git-ignored), press Run.

```
web_app/app.js  ──RRAndroid.requestPushToken()──►  MainActivity.NativeBridge
      ▲                                                    │ reflection
      │                                              PushBridge.requestToken()
      │                                                    │ FirebaseMessaging.getToken()
      └────── window.RR.onPushToken(token) ◄───────────────┘
                    │ POST /api/devices (bearer token)
                    ▼
            backend  →  device_tokens  →  FCM HTTP v1  →  RideRiseMessagingService
```

The web layer owns the authenticated call: the native code never stores a session token, and
the OS token cache never becomes a credential.

---

## 1. What is verified, and what is not

Verified in this repository (`npm test`, `npm run check:android-push`):

- the Gradle project is complete and self-consistent — wrapper 8.9, AGP 8.7.3, Google
  services plugin 4.5.0, Firebase BoM 35.1.0, `firebase-messaging`, no Analytics;
- the manifest declares the service, channel (`riderise_default`), icon and colour, and the
  ids match the server *and* the native constant;
- the Java bridge, the deep-link hand-off and the web client agree on names
  (`requestPushToken`, `onPushToken`, `deep_link`, `riderise_push`/`fcm_token`);
- `google-services.json` parses, belongs to `lk.shaunstudios.riderise`, and matches the
  `FIREBASE_PROJECT_ID` / sender id in `.env`;
- the file is git-ignored and untracked.

**Not verified — do not assume it works:**

- Gradle has **not** been run here (no Android SDK/Maven access in the development sandbox),
  so dependency resolution, AAPT2, D8 and signing are unproven for this module;
- no device or emulator, so no FCM token was ever issued and no notification was displayed;
- the SDK-free APK (`npm run apk`) still has **no** Play Services and can never receive push.

## 2. Project layout

| Path | Role |
|---|---|
| `android/settings.gradle.kts`, `build.gradle.kts` | project + plugin versions (AGP 8.7.3, google-services 4.5.0) |
| `android/gradle.properties`, `gradlew`, `gradle/wrapper/` | Gradle 8.9 wrapper, AndroidX enabled |
| `android/app/build.gradle.kts` | app module: brand config, signing, FCM dependency, asset sync, `checkGoogleServices` |
| `android/app/google-services.json` | **your file** — git-ignored, mode 600, never commit |
| `android/app/google-services.json.example` | template for other developers |
| `android/app/src/main/AndroidManifest.xml` | permissions, `MainActivity`, FCM service + meta-data |
| `…/MainActivity.java` | WebView shell; JS bridge `requestPushToken()` / `getPushToken()`, deep-link routing, notification channel |
| `…/PushBridge.java` | Firebase token fetch + delivery to `window.RR.onPushToken` (Gradle build only) |
| `…/RideRiseMessagingService.java` | `onNewToken`, `onMessageReceived`, notification builder |
| `android/res/` | shared with the SDK-free pipeline (icons, theme, `ic_notification`, `rr_accent`) |
| `scripts/verify_android_push.js` | 35 static checks (also run by `npm test`) |

`MainActivity` reaches `PushBridge` by reflection. That is deliberate: the same source file
compiles in the SDK-free pipeline, where Play Services does not exist, and the JS call simply
becomes a no-op.

## 3. Build it

Requirements: Android Studio with **JDK 17** and **Android SDK Platform 35** (AGP 8.7.3
compiles up to API 35; `compileSdk = 35`, `minSdk = 24`, `targetSdk = 34`).

```bash
# Android Studio: File → Open → select the `android` folder (not the repo root)
# or from a terminal with the SDK installed:
cd android
./gradlew :app:assembleDebug        # app/build/outputs/apk/debug/app-debug.apk
./gradlew :app:assembleRelease      # signed with android/keystore/riderise-release.keystore
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

`checkGoogleServices` runs before every build and fails with the exact fix if
`google-services.json` is missing or belongs to a different package name.

Two build types share one package id (no `applicationIdSuffix`): FCM issues a client for the
exact package name, so a `.debug` suffix would break token registration.

Release signing reuses `android/keystore/riderise-release.keystore` (created by
`npm run apk`), reading the password from `android/keystore.properties` or the pipeline's
`KEYSTORE-CREDENTIALS.txt`. Both are git-ignored. Without them the release variant falls back
to the debug key and prints a warning — never publish that.

The build also copies `web_app/` into `assets/webapp/` (`rrSyncWebAssets`), so the Gradle APK
ships exactly the same UI bundle as the SDK-free APK.

## 4. Prove it on a device

1. Set the API base URL in the app (**Settings → Server connection**) to a reachable HTTPS
   server, then sign in with a Firebase email/password account.
2. Watch the token hand-off:

   ```bash
   adb logcat -s RideRisePush RideRiseFCM RideRiseLK
   # RideRisePush: FCM token request failed …  → see §7
   ```

3. Confirm the device row (as the same rider):

   ```bash
   curl -s -H "Authorization: Bearer $TOKEN" localhost:3000/api/admin/push/status
   sqlite3 backend/riderise_lk.sqlite "select user_id, platform, created_at from device_tokens;"
   ```

4. Send a push: **Studio Console → Broadcast**, or
   `POST /api/admin/push/test` with an admin bearer token. The notification shows the
   `riderise_default` channel; tapping it opens the route carried in `deep_link`
   (`#/notifications`, `#/events`, `#/safety`, …).

The server still needs its own credentials — see §5. Without them `push/status` reports
`configured: false` and the app stores a token that nothing can deliver to.

## 5. Server half (required for delivery)

1. Firebase → **Project settings → Service accounts → Generate new private key**; store the
   JSON outside the repo, `chmod 600`.
2. Enable **Firebase Cloud Messaging API** in Google Cloud for project `rideriselk`
   (otherwise FCM answers `HTTP 403`).
3. On the server:

   ```bash
   FCM_SERVICE_ACCOUNT_FILE=/etc/riderise/firebase-service-account.json
   FIREBASE_PROJECT_ID=rideriselk        # must be the same project as google-services.json
   ```

4. `curl -s localhost:3000/api/health | grep -o '"push":[a-z]*'` → `"push":true`.

## 6. Behaviour already guaranteed by the server

- Blocked accounts are never notified about the person who blocked them.
- `show_previews = 0` (the default) sends “You have a new private update.” with no body.
- Quiet hours and muted conversations are applied before anything is sent.
- Every attempt lands in `push_delivery_log` with the FCM HTTP status.
- Deep links are constrained to in-app hash routes before the WebView navigates.

## 7. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Build fails: `Missing android/app/google-services.json` | Download it from Firebase → Project settings → Your apps → `lk.shaunstudios.riderise`; save it there (git-ignored). |
| Build fails: `No matching client found for package name …` | The JSON has no Android app with this package name. Register the app in Firebase with **exactly** `lk.shaunstudios.riderise`. |
| `Plugin [id: 'com.google.gms.google-services'] was not found` | Gradle cannot reach Google Maven, or the plugin line is in the wrong file. It belongs in `android/build.gradle.kts` (`apply false`) and `android/app/build.gradle.kts`. |
| `Dependency requires compileSdk 3x` | Raise `compileSdk` in `android/app/build.gradle.kts` and install that SDK Platform; AGP 8.7.3 caps at 35. |
| `Default FirebaseApp is not initialized` | `google-services.json` is not being processed: check the plugin is applied in the **app** module and the file sits in `android/app/`. |
| `RideRisePush: Firebase Messaging unavailable` in logcat | No Google Play services on the device/emulator (use a Play-enabled image), or the APK was built by `npm run apk` (SDK-free). |
| `RideRisePush: FCM token request failed` | Token service unreachable, or the API key in `google-services.json` is restricted to other apps. |
| `push/status` → `configured: false` | Server has no `FCM_SERVICE_ACCOUNT_FILE`/`_JSON`, or the key lacks `private_key`. |
| Server log: `HTTP 403` | Firebase Cloud Messaging API not enabled for the project. |
| Server log: `HTTP 404` | Service account belongs to another project than the token. |
| `HTTP 400 UNREGISTERED` | App reinstalled / token rotated — it re-registers on next sign-in. |
| Notification never appears on Android 13+ | `POST_NOTIFICATIONS` denied. The app asks after the first successful token registration; enable it in Settings → Apps → RideRise LK → Notifications. |
| No notification while the app is open | Expected in general — but this build handles it: `onMessageReceived` shows the notification itself. If it does not, check `RideRiseFCM` in logcat. |
| Tapping opens the app but not the screen | The server sent no `deep_link`; the app falls back to `#/notifications`. Check the payload in `push_delivery_log`. |

## 8. Scope decisions

- **No Firebase Analytics, no Crashlytics, no Auth SDK in the APK.** The web layer already
  signs in with the Firebase JS SDK; the native side only needs Messaging. Analytics is
  deliberately excluded (see `docs/SETUP_GUIDE.md`).
- **No background service or polling.** Push is delivered by Play Services; there is no
  custom socket that would keep the app awake.
- **No OAuth clients needed.** `google-services.json` ships with an empty `oauth_client`
  list, which is correct now that Google Sign-In is removed.

## 9. Still required from you

| Step | Why it cannot be done here |
|---|---|
| `./gradlew :app:assembleDebug` in Android Studio | No Android SDK / Maven access in the development sandbox |
| Run on a Play-enabled phone | No device or emulator |
| Firebase service-account JSON + FCM API enabled | Google-side credentials the studio must generate |
| Play Store upload (AAB) | Needs your Play Console account and a Play-signed key |
