# Firebase push — the Android-side pieces

The repository's SDK-free APK pipeline (`scripts/build_apk.sh`) deliberately ships **no
Google Play Services and no Firebase SDK**, so the APK built here cannot obtain an FCM
registration token. Everything else for push already exists and is tested:

- the server signs a service-account JWT and calls **FCM HTTP v1**
  (`backend/phase2/core.js → createPushSender`),
- `POST /api/devices` stores a device token, `DELETE /api/devices` removes it,
- `push_delivery_log` records every attempt, `GET /api/admin/push/status` reports the truth,
- notification preferences, quiet hours and "no previews by default" are enforced server-side.

To get real push on a phone you add these files to a **Gradle build** (Android Studio
project). Nothing in this folder is compiled by `npm run apk`, and none of it has been
compiled or run in the development sandbox — treat it as a reviewed starting point.

---

## 1. Files here

| File | Goes to (Android Studio project) |
|---|---|
| `app-build.gradle.additions.kts` | append to `app/build.gradle.kts` |
| `AndroidManifest.additions.xml` | merge into `app/src/main/AndroidManifest.xml` |
| `RideRiseMessagingService.java` | `app/src/main/java/lk/shaunstudios/riderise/` |
| `PushBridge.java` | `app/src/main/java/lk/shaunstudios/riderise/` |
| `google-services.json.example` | copy your real file to `app/google-services.json` |

`google-services.json` is git-ignored. Never commit it; it identifies your Firebase project.

## 2. Build it in Android Studio

1. **New Project → No Activity →** package name exactly `lk.shaunstudios.riderise`.
2. Copy the existing sources in:
   - `android/app/src/main/java/lk/shaunstudios/riderise/MainActivity.java`
   - `android/app/src/main/AndroidManifest.xml` (then merge the additions file)
   - the bundled client assets: add a Gradle task that copies `web_app/` and `assets/` into
     `app/src/main/assets/webapp/` (the SDK-free script does the same with `package_apk.py`).
3. In the Firebase console: **Project settings → Your apps → Add app → Android**,
   package `lk.shaunstudios.riderise`, then download `google-services.json` into
   `app/google-services.json`.
4. Apply the additions from this folder, sync Gradle, and run:

   ```bash
   ./gradlew :app:assembleDebug
   adb install -r app/build/outputs/apk/debug/app-debug.apk
   ```

5. Sign in inside the app. `MainActivity` passes the FCM token to the web layer through
   `window.RR.onPushToken(...)`, which the shipped `web_app/app.js` already handles by
   calling `POST /api/devices`. Verify:

   ```bash
   # after signing in on the device, as the same rider:
   curl -s -H "Authorization: Bearer $TOKEN" localhost:3000/api/admin/push/status
   # Studio Console → Security/Audit shows the device row; or check the table:
   sqlite3 backend/riderise_lk.sqlite "select user_id, platform, created_at from device_tokens;"
   ```

6. Send a test push from **Studio Console → Broadcast** (pick one account) — the device
   should show a notification. Tap it: the deep link opens the right screen.

## 3. Behaviour the server already guarantees

- Blocked accounts never receive notifications for the person who blocked them.
- `show_previews = 0` (the default) sends "You have a new private update." and no body text —
  lock-screen previews cannot leak a message.
- Quiet hours are honoured before anything is sent.
- Muted conversations are skipped.
- Every attempt is written to `push_delivery_log` with the FCM HTTP status.

## 4. If the notification does not arrive

| Symptom | Likely cause |
|---|---|
| `push/status` says `configured: false` | `FCM_SERVICE_ACCOUNT_FILE`/`_JSON` not set, or the service account is missing `private_key` |
| Server log: `HTTP 403` from FCM | The **Firebase Cloud Messaging API** is not enabled in the Google Cloud project |
| Server log: `HTTP 404` | Wrong `project_id` in the service account, or the token belongs to another project |
| `HTTP 400 UNREGISTERED` | The app was reinstalled or the token rotated — `POST /api/devices` again |
| Nothing in the log at all | No `device_tokens` row: the app never registered, or it registered before sign-in |
| Notification appears without a title/body | Android 13+ notification permission not granted |
| No notification while the app is open | That is correct — foreground messages go to `onMessageReceived`; wire it to an in-app banner if you want one |
