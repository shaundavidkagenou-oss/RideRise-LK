# Build & installation instructions

RideRise LK Phase 1 has three build targets:

1. the **backend + web app** (Node.js),
2. the **Android APK** (built in this repository without Gradle or the Android SDK),
3. optional **studio-pipeline builds** (Gradle/Firebase migration notes at the end).

---

## 1. Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | **22.5+** | Backend uses the built-in `node:sqlite` module (experimental flag warning is expected) |
| Python | 3.9+ | Only for the APK helper scripts (stdlib); Pillow optional for icon generation |
| Linux x86_64 | — | APK toolchain (aapt2 binary) is provisioned automatically |
| Android device | API 24+ (Android 7.0) | To install the APK |

No Android SDK, Gradle, JDK or Firebase account is required for the Phase 1 APK. The
build script provisions: Java runtime (`jdk4py` wheel), `aapt2` (`aaptjs3`), `d8`,
`android.jar`, `ecj` and `apksigner` (`@drxiaozhi/minapk`) into
`~/.cache/riderise-apk-tools` on first run (override with `RIDERISE_TOOLS`).

---

## 2. Backend + web app

```bash
npm start
# → RideRise LK by Shaun David Studios — Backend & App Server listening on http://0.0.0.0:3000
```

On first run the SQLite database `backend/riderise_lk.sqlite` is created from
`backend/schema.sql` and seeded by `backend/seed.js` (ranks, achievements, 21 stunt modules,
learning pathways, legal documents and one studio account). Real riders, posts, guilds,
events and catalog prices are created in the app by real accounts.

Environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `DB_PATH` | `backend/riderise_lk.sqlite` | SQLite file location |
| `JWT_SECRET` | derived dev value | **Set this in production.** Signs session tokens (HMAC-SHA256) |
| `FIREBASE_PROJECT_ID` / `FIREBASE_API_KEY` | *unset* | Enables real email/password sign-in (`docs/FIREBASE_AUTH.md`) |
| `GOOGLE_CLIENT_ID` | *ignored* | Google Sign-In was removed; the variable is no longer read |

Add optional sample content to a throwaway database (development only):

```bash
npm run seed:reset && npm run start:sample
```

Reset to a clean product database: `npm run seed:reset && npm start`.

Deploying: any container/host that runs Node 22 and can persist a file volume for the
SQLite database. Mount the DB file on durable storage, terminate TLS at the proxy, and set
`JWT_SECRET` from your secret manager. The server sends `Access-Control-Allow-Origin: *`
for API responses; tighten this to your app origins before public launch (search
`Access-Control-Allow-Origin` in `backend/server.js`).

---

## 3. Android APK

```bash
npm run apk            # debug + signed release
npm run apk:debug      # debug only
npm run apk:release    # signed release only
```

Outputs:

```
release/apk/riderise-lk-phase2-debug.apk      signed with the debug key (debuggable=true)
release/apk/riderise-lk-phase2-release.apk    signed with the release key (v2+v3)
release/apk/SHA256SUMS.txt
release/BUILD_INFO.md
```

### What the build script does

1. `scripts/make_icons.py` — derives launcher icons (mdpi→xxxhdpi), adaptive icon and the
   splash drawable from `assets/brand/riderise_logo.png` without distorting the badge.
2. Bundles `web_app/` into `assets/webapp/` so the app shell is available offline.
3. `aapt2 compile` + `aapt2 link` — resources, manifest and assets into a resource APK.
4. `ecj` compiles `MainActivity.java` + generated `R.java` against `android.jar`.
5. `d8` converts class files to `classes.dex` (`--release` for the release variant).
6. `scripts/package_apk.py` repackages with `classes.dex` and **zip-aligns** stored
   entries to 4 bytes (a local re-implementation of `zipalign`).
7. `apksigner` signs with APK Signature Scheme v2 + v3 and prints the certificate. (v1 is not generated at minSdk 24; Android 7.0+ verifies v2, and Android 11+ prefers v3.)

### Signing keys

- Generated on first build into `android/keystore/` and **git-ignored**:
  - `riderise-release.keystore` (RSA 4096, alias `riderise`, 30-year validity)
  - `riderise-debug.keystore`
  - `KEYSTORE-CREDENTIALS.txt` (passwords)
- **Move these into a secrets manager and keep an offline backup.** Losing the release key
  means future updates cannot be installed over the existing app; leaking it lets someone
  publish as Shaun David Studios.
- Certificate fingerprints of the delivered APKs are in `release/BUILD_INFO.md`.

### Install on a device

```bash
adb install -r release/apk/riderise-lk-phase2-release.apk
# or copy the APK to the phone, tap it, and allow "install unknown apps" for your file manager
```

First launch shows the animated badge splash, then the welcome screen. Because the APK
bundles the UI, the app opens instantly even without a network. To connect it to your
backend:

**Settings → Server connection → API base URL →** `https://your-riderise-api.example` →
**Save & test connection**. The URL is stored in Android `SharedPreferences` and is
validated over HTTPS (`android:usesCleartextTraffic="false"`).

If no API is configured, the app shows a clear error with the exact next step instead of
fake data.

### Upgrading the package identifier

Edit `config/brand.config.json` → `packageId`, then also update
`android/AndroidManifest.xml` (`package=`), the Java package directory
(`android/app/src/main/java/...`), and rebuild. Keep the same signing key.

---

## 4. Running the automated tests

```bash
npm test                    # 92 tests: API, Firebase auth, UI journeys, Android push + FCM credentials
npm run test:api
npm run test:ui
npm run check:android-push  # 37 static FCM/Gradle checks (also inside `npm test`)
npm run check:fcm           # service-account validity and project match (--online: talk to Google)
```

The UI tests use `jsdom` to load the real `web_app/` against the real backend, sign in,
walk every route and execute the user journeys (see [`TEST_RESULTS.md`](TEST_RESULTS.md) and
[`PHASE2_TEST_RESULTS.md`](PHASE2_TEST_RESULTS.md)). The Android push suite is static: it reads
the Gradle files, manifest, Java sources and `google-services.json` and asserts they agree —
it cannot substitute for running Gradle on a device.

---

## 5. Studio pipeline: Gradle project with Firebase Cloud Messaging

`android/` **is** a complete Android Studio project (not a folder of instructions). Open the
`android` folder — not the repository root — and let Studio sync.

| Piece | File |
|---|---|
| Plugin + toolchain versions | `android/build.gradle.kts`, `settings.gradle.kts` (AGP 8.7.3, google-services 4.5.0) |
| Gradle wrapper | `android/gradlew`, `gradle/wrapper/` (Gradle 8.9) |
| App module | `android/app/build.gradle.kts` (compileSdk 35, minSdk 24, targetSdk 34, Firebase BoM 35.1.0, `firebase-messaging`) |
| App code | `android/app/src/main/java/lk/shaunstudios/riderise/` (`MainActivity`, `PushBridge`, `RideRiseMessagingService`) |
| Manifest | `android/app/src/main/AndroidManifest.xml` (service, channel `riderise_default`, icon/colour) |
| Firebase config | `android/app/google-services.json` — **git-ignored**, never commit |
| Shared resources | `android/res/` (also used by the SDK-free pipeline) |

Requirements: **JDK 17**, Android SDK Platform 35, and Google Play services on the device
(an emulator image with Play, or a real phone).

```bash
cd android
./gradlew :app:assembleDebug      # app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

What the module does beyond the SDK-free pipeline:

1. `applicationId`, `versionCode` and `versionName` are read from `config/brand.config.json`,
   so both APK pipelines stay identical.
2. `rrSyncWebAssets` copies `web_app/` into `assets/webapp/` — the same bundle the SDK-free
   build ships.
3. `checkGoogleServices` runs before every build: it fails with the exact fix when
   `google-services.json` is missing or registered for another package name, and warns when
   the Android app and `FIREBASE_PROJECT_ID` point at different Firebase projects.
4. Release signing reuses `android/keystore/riderise-release.keystore` (credentials from
   `android/keystore.properties` or the pipeline's `KEYSTORE-CREDENTIALS.txt`, both
   git-ignored), so a Gradle build installs over the existing APK. Without them the release
   variant falls back to the debug key and prints a warning.
5. Firebase Cloud Messaging only — no Analytics, no Crashlytics. The web layer keeps the
   authenticated call: `window.RR.onPushToken(token)` → `POST /api/devices`.

```bash
npm run check:android-push        # 37 static checks; also part of `npm test`
```

Push needs the server half too (`FCM_SERVICE_ACCOUNT_FILE`, FCM API enabled) — step 5 of
`docs/SETUP_GUIDE.md`. Full device walkthrough and troubleshooting table:
[`android/firebase/README.md`](../android/firebase/README.md).

> **Not verified here:** this container has no Android SDK or Maven access, so Gradle has
> never resolved these dependencies, signed this module, or produced this APK. Nothing in the
> FCM path (token, delivery, notification tap) has been exercised on a device.

For a Play Store release, build an **AAB** with the same project
(`./gradlew :app:bundleRelease`), enrol in Play App Signing, and keep the release keystore
backed up. Play requires a target API level inside the current window — raise `targetSdk`
(and `compileSdk`, AGP permitting) when Play announces the next cutoff.

---

## 6. Troubleshooting

| Symptom | Fix |
|---|---|
| `node:sqlite` experimental warning | Expected on Node 22; silence with `NODE_NO_WARNINGS=1` |
| APK installs but shows "backend server configured" error | Set the API URL in Settings, verify HTTPS and that `/api/health` returns 200 in a browser |
| `aapt2: command not found` | Delete `~/.cache/riderise-apk-tools` and re-run `npm run apk` (it re-provisions) |
| Release APK rejected as "not signed" | Ensure `apksigner` printed both the certificate and the SHA-256 digest; re-run `npm run apk:release` |
| Port 3000 already in use | `PORT=3100 npm start` |
| Tests fail with `EADDRINUSE` | Stop the dev server first — tests bind an ephemeral port but share the DB file path pattern |
