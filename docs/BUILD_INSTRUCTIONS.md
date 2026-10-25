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

The repository already ships a signed APK built from this source:

| File | Size | Signing |
|---|---|---|
| `release/apk/riderise-lk-phase2-release.apk` | 2,444,624 B | release key, v2 + v3 |
| `release/apk/riderise-lk-phase2-debug.apk` | 2,440,529 B | debug key, debuggable |

```bash
cd release/apk && sha256sum -c SHA256SUMS.txt          # verify what you downloaded
adb install -r riderise-lk-phase2-release.apk
# or copy the .apk to the phone, tap it, allow "install unknown apps" for the file manager
```

`lk.shaunstudios.riderise` · versionName `2.0.0` · minSdk 24 (Android 7.0+) · targetSdk 34.

#### Two prerequisites — the app will not sign in without them

**1. The backend URL must be HTTPS.** The manifest sets
`android:usesCleartextTraffic="false"`, and the bundled UI runs on the virtual HTTPS origin
`https://appassets.androidplatform.net`, so a plain-HTTP API call is blocked as mixed content.
`http://192.168.x.x:3000` therefore cannot work — that is a deliberate security setting, not a bug.

For a quick test on a phone, expose the running server over HTTPS with a tunnel (no account needed):

```bash
cloudflared tunnel --url http://localhost:3000   # prints https://<random>.trycloudflare.com
# or: ngrok http 3000
```

Open `https://<that-host>/api/health` in the phone's browser first — it must return JSON.
For real use, deploy the backend behind HTTPS (Render/Railway/Fly/VPS + Caddy) and use that
stable URL; a quick tunnel changes address every restart and stops when your computer sleeps.

**2. Firebase must trust the APK's origin.** Console → **Authentication → Settings →
Authorized domains → Add domain →** `appassets.androidplatform.net`. This is one-time and
separate from the API URL — without it, sign-in fails with `auth/unauthorized-domain`.
See [`FIREBASE_AUTH.md`](FIREBASE_AUTH.md) §6b.

#### First run

1. Splash (bundled badge), then **Connect your ride server**.
2. Paste the HTTPS API URL → **Save & test connection** → it calls `/api/health` and reports
   `Connected to RideRise LK · Phase 2 ✓`.
3. Sign in or create an account with Firebase email + password (same accounts as the web build).
4. Change the server later in **Settings → Server connection**.

The URL is stored in Android `SharedPreferences` and mirrored into web storage, so it survives
restarts. With no URL configured the app shows the setup screen and an explicit error rather
than fake data.

#### If it does not work

| Symptom | Cause | Fix |
|---|---|---|
| `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | the installed app was signed with a different key | `adb uninstall lk.shaunstudios.riderise`, then install |
| “App not installed” / blocked | unknown-source installs disabled | allow installs for the file manager or browser you used |
| Setup screen: “Connection failed” | URL is `http://`, tunnel is down, or the phone cannot reach the host | use the `https://` URL; test `/api/health` in the phone browser |
| Blank screen after a successful connect | tunnel closed while the app was open | restart the tunnel, re-save the URL in Settings |
| Sign-in: `auth/unauthorized-domain` | prerequisite 2 not applied | add `appassets.androidplatform.net` in Firebase |
| Sign-in: `auth/network-request-failed` | phone offline, or a network blocking `googleapis.com` | retry another network |
| Sign-in: “server cannot reach Google” banner | the **server** cannot reach `www.googleapis.com` for token verification | allow outbound HTTPS on the server host |

#### Signing identity — read before rebuilding

The APKs above are signed with the release key generated during the project's build
(cert SHA-256 `9f55e66c0ec49f3ef88a58b4cbb1db5e99925e0d42492aaad5935b0f068bdd09`). That
keystore lives in `android/keystore/`, which is **git-ignored and never committed**, so it is
not in a fresh clone. Consequences:

- A rebuild in a fresh clone creates a **new** key, and that APK will not install over one
  built with the old key (uninstall first).
- From your first local `npm run apk`, you own the key: copy `android/keystore/` to a password
  manager and an offline backup. Losing it means you can never update the app under the same
  identity; leaking it lets someone else publish as the studio.
- For Play Store distribution use Play App Signing, which makes the upload key replaceable.

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
