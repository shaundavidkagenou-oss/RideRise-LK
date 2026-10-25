# Phase 2 — Firebase Cloud Messaging setup (step by step)

RideRise LK's notification system works **in-app out of the box** (history, unread counts,
preferences, quiet hours, deep links). Push delivery to a sleeping phone requires Firebase
Cloud Messaging (FCM) and a client that can obtain an FCM registration token.

> **Read this first — current state, stated honestly.** The backend implements FCM HTTP v1
> sending (`backend/phase2/core.js → createPushSender`), logs every attempt in
> `push_delivery_log`, and exposes `POST /api/devices` for token registration. The
> Android shell **does not yet embed the Firebase SDK**, and the web app does not request a
> token, because that requires your Firebase project's `google-services.json`, which this
> repository cannot ship. Until you complete steps 7–8, push messages remain in-app only.
> The admin console's push panel will say **Not configured**, and that is the truthful
> state. Do not claim push works before you finish and test it.

---

## 1. Create the Firebase project

1. Open <https://console.firebase.google.com/> and sign in with the studio Google account.
2. **Add project** → name it e.g. `riderise-lk` → accept the terms → create.
3. Google Analytics is optional; you do not need it for messaging.

## 2. Register the Android app

1. In the project, click the Android icon (**Add app → Android**).
2. Android package name: **`lk.shaunstudios.riderise`** (must match exactly; it is set in
   `config/brand.config.json` and the APK manifest).
3. App nickname: `RideRise LK`.
4. Debug signing certificate SHA-1 (needed for Google Sign-In/Firebase auth, not for FCM
   itself). Print it with:

   ```bash
   keytool -list -v -keystore android/keystore/riderise-release.jks \
     -alias riderise -storepass "$KEYSTORE_PASSWORD" | grep SHA1
   ```

   Add both the debug and release SHA-1 values.
5. Download **`google-services.json`** and place it at
   `android/app/google-services.json` (the build script copies `android/` into the APK
   source tree; keep this file out of Git — it is not a secret but it is project-specific).

## 3. Enable the FCM API

1. Firebase console → **Project settings → Cloud Messaging** → confirm the Cloud Messaging
   API is enabled (it is by default on new projects).
2. Note the **Project ID**.

## 4. Create a service account for the server

1. Firebase console → **Project settings → Service accounts**.
2. **Generate new private key** → download the JSON file.
3. Store it **outside the repository**, e.g. `/etc/riderise/firebase-service-account.json`,
   readable only by the service user (`chmod 600`, owned by the app user).
4. Never commit it, never paste it into chat, never bundle it in the APK.

JSON shape the server expects:

```json
{
  "type": "service_account",
  "project_id": "riderise-lk",
  "client_email": "firebase-adminsdk-xxxxx@riderise-lk.iam.gserviceaccount.com",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
}
```

## 5. Configure the server

Add to the environment (systemd `Environment=`, `.env` loaded by your process manager, or
`export` before `npm start`):

```bash
FCM_SERVICE_ACCOUNT_FILE=/etc/riderise/firebase-service-account.json
# or, for a single-line value from a secret manager:
# FCM_SERVICE_ACCOUNT_JSON={"project_id":"...","client_email":"...","private_key":"..."}
```

Then:

```bash
npm start
curl -s localhost:3000/api/health | jq '.capabilities.push'      # expect true
```

Admin console → **Audit & push** should now show **FCM configured** with the project id.

## 6. Register device tokens

The app must send a token after sign-in:

```http
POST /api/devices
Authorization: Bearer <user token>
Content-Type: application/json

{ "token": "<FCM registration token>", "platform": "android", "device_label": "Pixel 6a" }
```

`DELETE /api/devices` with the same token removes it (call this on sign-out). Tokens are
stored in `device_tokens` with the last-seen timestamp; invalid tokens are pruned when FCM
answers `UNREGISTERED`.

## 7. Get a token in the Android shell

Pick one path:

**A. Firebase JavaScript SDK inside the bundled WebView (simplest)**

1. `npm install firebase` in a small build step, then copy the modular browser build into
   `android/assets/webapp/vendor/firebase/`.
2. Add a `firebase-messaging-sw.js` service worker **only if** you also serve the web app
   over HTTPS; the bundled `file://` app cannot use a service worker.
3. In `web_app/app.js` (after session refresh), call `getToken(messaging, { vapidKey })` and
   `POST /api/devices`. Needs a Web Push VAPID key from Firebase → **Cloud Messaging → Web
   Push certificates**.

**B. Native Firebase Android SDK (recommended for a WebView shell)**

1. Add the Firebase BOM and `firebase-messaging` to `android/app/build.gradle`.
2. Add the `google-services` Gradle plugin; it reads `google-services.json`.
3. Add a `FirebaseMessagingService` subclass, override `onNewToken` and
   `onMessageReceived`, and forward the token to the WebView via a JavascriptInterface or a
   direct HTTPS call to `POST /api/devices`.
4. Request `POST_NOTIFICATIONS` at runtime (Android 13+) — the shell already exposes a
   request path for this.
5. Create a notification channel (`riderise_messages`) and build notifications with
   `NotificationCompat`, using the deep link as the `PendingIntent` data URI.

The current source tree has neither A nor B; whichever you choose, keep the server contract
above unchanged.

## 8. Test

1. Register a real device token.
2. Admin console → **Audit & push → Send test push to my device** (calls
   `POST /api/admin/push/test`).
3. Check `push_delivery_log` for the result and the device for the notification.
4. Send a direct message from a second account and confirm the preview respects the
   `show_previews` preference.

Expected failure modes and meanings:

| Symptom | Meaning |
|---|---|
| `FCM_NOT_CONFIGURED` | env var missing or JSON unreadable; the console shows the reason |
| `401` from Google | service account key rotated or wrong project |
| `UNREGISTERED` | app uninstalled or token rotated; token is pruned |
| Delivered but no banner | notification permission denied, or missing channel |

## 9. Notification privacy rules already enforced server-side

- Lock-screen/notification previews are **off by default**; `show_previews` must be enabled
  per rider.
- Blocked accounts never trigger a notification for the blocker.
- Read receipts are hidden when `read_receipts = 0`.
- Quiet hours suppress push (in-app history still records the event).
- Push payloads contain a title, short body and deep link — never full message threads.

## 10. Costs and limits (planning figures, verify before launch)

| Item | Free tier | Notes |
|---|---|---|
| FCM messaging | Free | Google may change terms; check the Firebase pricing page |
| Firebase project | Spark (free) | Blaze needed only for some Google Cloud APIs |
| Cloud Messaging legacy APIs | Disabled | Use HTTP v1 (this repo does) |

Firebase does not charge for FCM message volume today. Google Cloud quotas (e.g. API calls)
still apply. Verify current limits on the official pricing page before relying on them.
