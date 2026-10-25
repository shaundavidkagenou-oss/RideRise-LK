# Phase 2 — Build, sign and install the Android APK (step by step)

The project builds without Android Studio, Gradle or the Android SDK. A shell script
provisions a Java runtime (jdk4py wheel), `aapt2` (aaptjs3), `d8`, `ecj` and `apksigner`
(@drxiaozhi/minapk) on first run, then compiles resources, Java, DEX, packages and signs.

Artifacts produced by this run are already in `release/apk/` (see `release/BUILD_INFO.md`).

---

## 1. Prerequisites

- Linux x86_64 with Python 3.11+, Node 22.13+ (`node:sqlite` is flag-free from 22.13) and
  network access to PyPI + npm (first run).
- About 300 MB free for the toolchain cache (`~/.cache/riderise-apk-tools`).
- Pillow (optional but recommended) so launcher icons are generated at correct sizes
  instead of a full-resolution copy: `python3 -m pip install --break-system-packages Pillow`.

## 2. Choose the server address that ships with the app (optional but recommended)

Empty `config/deployment.config.json` = the app asks each rider for an HTTPS URL on first launch.
Setting it = a fresh install opens straight on the welcome/sign-in screen.

```bash
npm run verify:server -- --url https://api.yourdomain.lk   # must print "Ready"
npm run configure:apk -- --url https://api.yourdomain.lk
```

Both build pipelines inject the value independently (`scripts/inject_api_base.py` for this
toolchain, `resValue` in `android/app/build.gradle.kts` for Gradle) and both refuse a non-HTTPS
address. See [`DEPLOY_AND_BAKE.md`](DEPLOY_AND_BAKE.md) for hosting and TLS.

## 3. Build

```bash
cd /home/user/RideRise-LK
npm run apk           # debug + signed release
npm run apk:debug     # debug only
npm run apk:release   # signed release only
```

What happens, in order:

1. **Toolchain** — downloads and extracts the JDK; installs `aaptjs3` + `@drxiaozhi/minapk`;
   copies `aapt2`, `d8.jar`, `ecj.jar`, `apksigner.jar`, `android.jar` into the cache and
   makes the JDK binaries executable.
2. **Icons** — `scripts/make_icons.py` renders launcher icons, the adaptive icon and the
   splash drawable from `assets/brand/riderise_logo.png` (aspect ratio preserved; the badge is
   never stretched).
3. **Assets** — copies `web_app/` into `.build/assets/webapp/` so the APK runs offline.
4. **Resources** — `aapt2 compile` + `aapt2 link` with the manifest template, substituting
   `versionCode`, `versionName` and `debuggable` from `config/brand.config.json`.
5. **Java** — `ecj` compiles `MainActivity.java` against `android.jar` (Java 8 target; no
   lambdas or streams are used because ecj in this pipeline rejects them).
6. **DEX** — `d8 --min-api 24` (release mode for the release variant).
7. **Package** — `scripts/package_apk.py` merges `classes.dex`, zipaligns STORED entries and
   writes the unsigned APK.
8. **Sign** — `apksigner` produces **v2 + v3** signatures (this toolchain does not emit v1,
   which is unnecessary at `minSdk 24`). Check with
   `java -jar apksigner.jar verify --verbose --print-certs <apk>`. The release keystore is created on first build at
   `android/keystore/riderise-release.keystore` with a random 32-character password stored in
   the neighbouring `KEYSTORE-CREDENTIALS.txt` (both git-ignored, mode 600).
9. **Report** — prints the SHA-256 and compiles certificate digests.

Output:

```
release/apk/riderise-lk-phase2-debug.apk
release/apk/riderise-lk-phase2-release.apk
release/apk/*.idsig                 (v4 signature sidecars)
release/apk/SHA256SUMS.txt
```

## 4. Verify the build

```bash
cd release/apk
sha256sum -c SHA256SUMS.txt

JAVA=~/.cache/riderise-apk-tools/java/bin/java
$JAVA -jar ~/.cache/riderise-apk-tools/apksigner.jar verify --print-certs --min-sdk-version 24 \
  riderise-lk-phase2-release.apk

~/.cache/riderise-apk-tools/aapt2 dump badging riderise-lk-phase2-release.apk | head -5
~/.cache/riderise-apk-tools/aapt2 dump permissions riderise-lk-phase2-release.apk
```

Expected: package `lk.shaunstudios.riderise`, versionCode `2`, versionName `2.0.0`,
minSdk 24, targetSdk 34, and the eight permissions listed in `release/BUILD_INFO.md`.

## 5. Install on a device

1. Enable **Developer options → USB debugging** on the phone.
2. Connect by USB and accept the RSA prompt.
3. Install:

   ```bash
   adb install -r release/apk/riderise-lk-phase2-debug.apk
   # release build (recommended for realistic audio/location testing):
   adb install -r release/apk/riderise-lk-phase2-release.apk
   ```

   Or copy the APK to the phone and open it (allow “Install unknown apps” for the file
   manager).

4. Point it at your backend. If the APK was built with a server address (§2) it is already
   done — a fresh install opens on the welcome/sign-in screen. Otherwise, with no server saved,
   the app opens **Connect your ride server**: paste the API base URL and press **Save & test
   connection** (it calls `/api/health`). The value is kept in Android `SharedPreferences`, and
   **Settings → Server connection** changes it later (**Use the built-in server** restores a
   compiled-in address).

   The URL **must be HTTPS**. `android:usesCleartextTraffic="false"` plus mixed-content
   blocking from the virtual `https://appassets.androidplatform.net` origin means
   `http://192.168.x.x:3000` is refused. For a phone test, tunnel the local server:

   ```bash
   cloudflared tunnel --url http://localhost:3000   # or: ngrok http 3000
   ```

   and use the printed `https://…` host. For real use, deploy behind HTTPS.

## 6. On-device checks that matter

| Check | Expected |
|---|---|
| Launch | Branded splash, then feed; no white flash |
| Email/password sign-in | Real Firebase account completes; verification email gate appears for a new account |
| Guild map | Permission prompt appears only after **Start sharing**; approximate circle visible; Stop removes you immediately |
| 16–17 account | No precise option anywhere; circle is 1.5 km |
| Voice room | Permission prompt on join; join listen-only works; mic indicator closed until unmute |
| PTT | Press-and-hold only; release stops within ~1 s; second phone hears silence when not transmitting |
| Two devices | Join from both; audio both directions; check with Wi-Fi and mobile data (TURN required for some carriers) |
| Bluetooth | Pair headset, tap the route button until 🎧; audio routes to headset |
| Backgrounding | Lock the screen during PTT and confirm transmission stops and the floor releases |
| Messaging | Typing indicator, read receipt, reaction, delete; preview hidden by default |
| Rotation/keyboard | Layout stays usable; composer not hidden by keyboard |
| Sinhala/Tamil | Switch system language; no tofu boxes; text wraps |

Anything you cannot test must stay on the “not verified” list in
`docs/PHASE2_TEST_RESULTS.md`.

## 7. Update the version

Edit `config/brand.config.json`:

```json
{ "versionName": "2.0.1", "versionCode": 3 }
```

Play requires a strictly increasing `versionCode`. Rebuild, re-verify and keep the same
signing keystore.

## 8. Firebase project settings for the installed app

1. **Authentication → Settings → Authorized domains → Add domain →**
   `appassets.androidplatform.net`. The bundled UI is served from that virtual HTTPS origin,
   so Firebase treats the APK as a web client at that domain. Skipping this gives
   `auth/unauthorized-domain` on the first sign-in attempt.
2. The APK reads its Firebase web config from `/api/config` at runtime, so the same project
   serves the web build and the app — no rebuild when the config changes.
3. Google OAuth was removed from the product; no Android OAuth client or SHA-1 registration
   is needed for sign-in. The release **SHA-1** (`98ec4c24…`) is only relevant if you later add
   Play App Signing, Android App Links or another Google service.

## 9. Publishing notes (APK vs AAB)

- This pipeline emits an **APK** only. Google Play has required **Android App Bundles (AAB)**
  for new apps and updates since August 2021.
- To ship on Play you need Android Studio/Gradle (or `bundletool` with Gradle output) to
  produce the AAB, signed with the same upload key. Reuse the Java source and `web_app/`
  assets; only the packaging changes.
- Play additionally requires a privacy policy URL, the Data Safety form (location, audio,
  messages, device ids), content rating, and target API compliance. Review the current
  requirement page before submitting; requirements change annually.

## 10. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `exit=126` right after “Generating release signing key” | JDK binaries lost the executable bit after wheel extraction; the script now runs `chmod +x`, or run it manually: `chmod +x ~/.cache/riderise-apk-tools/java/bin/*` |
| `invalid source release: 17` | ecj version mismatch; keep `-source 1.8 -target 1.8` |
| App shows a blank screen | Check `adb logcat | grep RideRiseLK`; usually a missing asset or an API base pointing at an unreachable host |
| Microphone prompt never appears | Capture is only granted to the bundled `https://appassets.androidplatform.net` origin; confirm the app is not navigating to a remote page |
| `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | The installed copy was signed with a different key. `adb uninstall lk.shaunstudios.riderise`, then install |
| Sign-in: `auth/unauthorized-domain` | Step 7.1 was skipped — add `appassets.androidplatform.net` in Firebase |
| Setup screen: “Connection failed” | URL is `http://`, the tunnel is closed, or the phone cannot reach the host. Open `<url>/api/health` in the phone browser |
| Location stays “unavailable” | Device location off, or permission denied; the app shows the exact reason |
| Voice connects but is silent | No TURN relay on strict carrier NAT; set `TURN_URLS` + `TURN_SECRET` |
