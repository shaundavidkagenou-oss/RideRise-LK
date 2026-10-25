# Phase 2 — Firebase Cloud Messaging (FCM) setup and status

RideRise LK's notification centre works in-app out of the box (history, unread counts,
preferences, quiet hours, deep links, `push_delivery_log`). Push to a sleeping phone needs
three things: a Firebase project, an Android client that can obtain an FCM token, and a
server-side service account. All three are now wired; only the last one still needs a
credential from you.

> **Current state, stated honestly**
>
> | Piece | State |
> |---|---|
> | Firebase project `rideriselk` | exists (created in the studio's console) |
> | Android app registered for `lk.shaunstudios.riderise` | yes — `android/app/google-services.json` installed, mode 600, **git-ignored** |
> | Gradle project with `google-services` 4.5.0 + Firebase BoM 35.1.0 + `firebase-messaging` | written in `android/`, **never compiled by Gradle here** (no Android SDK/Maven in the sandbox) |
> | Native token bridge, notification service, channel, deep links | written and statically verified (`npm run check:android-push`, `npm test`) |
> | Client registration → `POST /api/devices` | wired in `web_app/app.js`, exercised by the API tests with a fake token |
> | Server sending (FCM HTTP v1) | **configured**: service account installed (`secrets/`, mode 600, git-ignored), FCM v1 API enabled, `/api/health` → `"push":true` |
> | Credential validity | verified: RSA-2048 key signs the exact RS256 assertion; project + sender id match the Android app (`npm run check:fcm`) |
> | Real brand-name delivery | not reachable from the sandbox: a test send logged `fetch failed` (egress blocked), so no message has reached Google |
> | Real token / real notification on a phone | **not tested** — no device or emulator here |
>
> Do not claim push works before steps 1–3 succeed on your hardware.

---

## 1. What already exists in the repository

| Area | File |
|---|---|
| FCM HTTP v1 sender (service-account JWT) | `backend/phase2/core.js` → `createPushSender` |
| Device registration / removal | `backend/phase2/social2.js` → `POST` / `DELETE /api/devices` |
| Delivery log + admin status | `push_delivery_log`, `GET /api/admin/push/status` |
| Gradle project (AGP 8.7.3, Gradle 8.9) | `android/build.gradle.kts`, `android/app/build.gradle.kts` |
| Firebase config (yours, untracked) | `android/app/google-services.json` |
| Manifest: service, channel `riderise_default`, icon, colour | `android/app/src/main/AndroidManifest.xml` |
| Token bridge | `android/app/src/main/java/…/PushBridge.java` |
| Notification service | `android/app/src/main/java/…/RideRiseMessagingService.java` |
| JS bridge + registration | `…/MainActivity.java`, `web_app/app.js` (`RR.onPushToken`) |
| Static verifier (35 checks) | `scripts/verify_android_push.js` |
| Device walkthrough + troubleshooting | [`android/firebase/README.md`](../android/firebase/README.md) |

## 2. Server half (already configured here)

1. **Done:** the studio's service account is at `secrets/firebase-service-account.json`
   (mode 600, git-ignored) and `.env` points at it with a path relative to the repository root
   (the server resolves it from any working directory).
2. **Done:** Firebase Cloud Messaging API (v1) is enabled in the Google Cloud project; the
   legacy API is disabled, which is correct for this server.
3. Environment:

   ```bash
   FCM_SERVICE_ACCOUNT_FILE=secrets/firebase-service-account.json
   FIREBASE_PROJECT_ID=rideriselk          # equals project_info.project_id in google-services.json
   ```

   On a production host prefer an absolute path outside the repo
   (`/etc/riderise/firebase-service-account.json`). `FCM_SERVICE_ACCOUNT_JSON` accepts the JSON
   inline for secret managers.
4. Verify:

   ```bash
   npm run check:fcm                # structure, RSA key, RS256 round trip, project match
   npm run check:fcm -- --online    # real OAuth token exchange (needs outbound HTTPS)
   curl -s localhost:3000/api/health | grep -o '"push":[a-z]*'   # → "push":true
   npm run check:setup                                            # Firebase service account ✔
   ```

   Observed in this workspace: `push:true`, `GET /api/admin/push/status` →
   `{"configured":true,"project_id":"rideriselk","reason":""}`, and a test send to a
   registered (fake) token returned `{"sent":0,"status":"error","reason":"fetch failed"}`
   with a matching `push_delivery_log` row — the credential loaded and the assertion signed,
   then the sandbox blocked the HTTPS call to Google.
5. **Rotate the key** if it has been shared outside the server (including this chat upload):
   Google Cloud IAM → Service accounts → delete the key, generate a new one, replace the file.
   Nothing in the repository or the APK embeds it.

## 3. Android half (Android Studio, ~30 minutes)

1. Open the **`android`** folder in Android Studio with **JDK 17** and **SDK Platform 35**.
2. `./gradlew :app:assembleDebug` (or press Run). `checkGoogleServices` validates
   `google-services.json` first and fails with the exact fix if it is missing or belongs to a
   different package name.
3. Install on a **Play-enabled** device or emulator (AOSP images have no Play services and can
   never receive FCM messages).
4. Set the API base URL in the app (**Settings → Server connection**), then sign in with
   Firebase email/password.
5. `web_app/app.js` calls `RRAndroid.requestPushToken()`; `PushBridge` fetches the token and
   hands it back through `window.RR.onPushToken(token)`, which registers it with the rider's
   session. Logs: `adb logcat -s RideRisePush RideRiseFCM RideRiseLK`.
6. Send a test push: **Studio Console → Broadcast**, or
   `POST /api/admin/push/test` with an admin bearer token. Background notifications use the
   channel, icon and accent colour from the manifest; tapping one opens the `deep_link` route.

## 4. Token API contract (unchanged)

```http
POST /api/devices
Authorization: Bearer <rider session token>
Content-Type: application/json

{ "token": "<FCM registration token>", "platform": "android", "app_version": "2.0.0" }
```

Returns `201`. Re-registering the same token refreshes `last_seen_at`. `DELETE /api/devices`
with the same body removes it (call on sign-out). Tokens are stored in `device_tokens`; FCM
answers `UNREGISTERED` when a token is stale, and the row is pruned.

The web layer always makes this call — the native code never holds a session credential.

## 5. Testing and failure modes

```bash
npm run check:android-push     # 37 static checks: Gradle, manifest, Java, web, server, secrets
npm run check:fcm              # service-account validity + project match (add --online to call Google)
npm test                       # 93 tests, including 7 Android-push + 5 FCM credential tests
```

| Symptom | Meaning |
|---|---|
| `push/status` → `configured: false` | `FCM_SERVICE_ACCOUNT_FILE`/`_JSON` unset or unreadable |
| `HTTP 403` from FCM | Cloud Messaging API not enabled for the project |
| `HTTP 404` | Service account belongs to a different project than the token |
| `400 UNREGISTERED` | App reinstalled / token rotated — it re-registers on next sign-in |
| No `device_tokens` row | The app never registered (not signed in, no Play services, or bridge error in logcat) |
| `RideRisePush: Firebase Messaging unavailable` | The APK was built by `npm run apk` (SDK-free) or the device has no Play services |
| Notification silent/missing on Android 13+ | `POST_NOTIFICATIONS` denied — enable it in Android settings |
| Tapped notification opens the app but not the screen | Payload had no `deep_link`; the app falls back to `#/notifications` |

## 6. Privacy rules already enforced server-side

- Lock-screen previews are **off by default**; `show_previews` must be enabled per rider.
- Blocked accounts never trigger a notification for the blocker.
- Read receipts are hidden when `read_receipts = 0`.
- Quiet hours and muted conversations suppress push (in-app history still records the event).
- Push payloads carry a title, a short body and a deep link — never a full message thread.
- Deep links are restricted to in-app hash routes before the WebView navigates.
- **No Firebase Analytics** is initialised, on any platform.

## 7. Costs and limits (planning figures — verify before launch)

| Item | Free tier | Notes |
|---|---|---|
| FCM messaging | Free | Google may change terms; check the Firebase pricing page |
| Firebase project | Spark (free) | Blaze needed only for some Google Cloud APIs |
| Legacy Cloud Messaging APIs | Disabled | This repo uses HTTP v1 only |

## 8. What is still unproven

- Gradle dependency resolution, AAPT2, D8 and signing for the `android/` module (no SDK here).
- Firebase issuing a registration token on a device.
- Notification display, channel behaviour and deep-link taps.
- FCM delivery end to end (needs the service account from step 2).

Each is a normal Android Studio task; the exact steps are in
[`android/firebase/README.md`](../android/firebase/README.md).
