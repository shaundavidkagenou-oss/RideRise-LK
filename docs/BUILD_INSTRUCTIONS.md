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
`backend/schema.sql` and seeded by `backend/seed.js` (ranks, achievements, 21 stunt
modules, 9 catalog categories, 4 official events, legal documents, demo riders).

Environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `DB_PATH` | `backend/riderise_lk.sqlite` | SQLite file location |
| `JWT_SECRET` | derived dev value | **Set this in production.** Signs session tokens (HMAC-SHA256) |
| `GOOGLE_CLIENT_ID` | *unset* | Enables real Google Identity Services verification |

Reset the demo data:

```bash
npm run seed:reset && npm start
```

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
release/apk/riderise-lk-phase1-debug.apk      signed with the debug key (debuggable=true)
release/apk/riderise-lk-phase1-release.apk    signed with the release key (v1+v2+v3)
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
7. `apksigner` signs with APK Signature Scheme v1 + v2 + v3 and prints the certificate.

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
adb install -r release/apk/riderise-lk-phase1-release.apk
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
npm test           # 40 tests: 29 API + 11 end-to-end UI
npm run test:api
npm run test:ui
```

The UI tests use `jsdom` to load the real `web_app/` against the real backend, sign in,
walk every route and execute seven complete user journeys (see
[`TEST_RESULTS.md`](TEST_RESULTS.md)).

---

## 5. Optional: studio pipeline (Gradle / Play Store)

The Phase 1 APK is intentionally SDK-free so it can be produced in any Linux container.
For a Play Store release pipeline the studio may prefer Gradle:

1. Create a Gradle Android project with `applicationId "lk.shaunstudios.riderise"`,
   `minSdk 24`, `targetSdk 34`.
2. Copy `android/app/src/main/java/.../MainActivity.java`, `android/res/` and
   `android/AndroidManifest.xml` (substituting the `${…}` placeholders) into it.
3. Copy `web_app/` into `app/src/main/assets/webapp/`.
4. Reuse the existing `android/keystore/riderise-release.keystore` for signing
   (`signingConfigs.release`) so installed Phase 1 builds can be updated.
5. Add the AndroidX `WebViewAssetLoader` (instead of
   `setAllowUniversalAccessFromFileURLs`) if the studio prefers `https://appassets…`
   origins. This is a security hardening step, not a functional requirement.

Firebase migration (Auth/Firestore/Storage/FCM) is described in
[`EXTERNAL_CONFIG.md`](EXTERNAL_CONFIG.md); the REST API and SQLite schema are designed to
map 1:1 onto Firestore collections if the studio chooses that route.

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
