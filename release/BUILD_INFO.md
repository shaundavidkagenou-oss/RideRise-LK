# RideRise LK — APK build provenance

Rebuilt on **2026-10-25 12:58 UTC** as the **zero-setup build**: the live server address
`https://riseriselk.alwaysdata.net` is compiled into the app as the Android string resource
`default_api_base`, so a fresh install goes straight to the welcome/sign-in screen instead of
asking a rider for a server URL.

What changed against the previous artifacts:

- `config/deployment.config.json` carries the address; `scripts/inject_api_base.py` wrote it into
  `resources.arsc` during the build (verified below) and the Gradle pipeline reads the same file.
- `MainActivity.getApiBase()` returns the saved preference when a rider set one, otherwise the
  built-in address; `getDefaultApiBase()` / `resetApiBase()` back the "Use the built-in server"
  button in Settings.
- `versionName` is **2.1.0**, `versionCode` **3** (was 2.0.0 / 2), so Settings and the installer show
  which build is on a phone.
- Launcher icons were generated at the correct densities with Pillow 13 (previous builds copied a
  full-size source image because Pillow was missing), which is why the files are the same size as
  before despite the extra resource.

> **New signing key.** The release keystore (`android/keystore/`) is git-ignored and did not exist
> in this environment, so a fresh key was generated: certificate SHA-256
> `da197bc60af1d9cc7b5f345cc23541f9995bb5a39a6873d467f629956b1354fe` (previously `9f55e66c…`).
> An older build therefore cannot be updated in place — uninstall it first. **Back up
> `android/keystore/` now**: losing it means the next build is again a different app.

Built with `scripts/build_apk.sh all` (no Android SDK or Gradle; the toolchain provisions a Java
runtime, aapt2, d8, ecj and apksigner). Verified with `apksigner verify` and by reading the built
APK's resource table. **The APK has not been installed or launched** — this environment has no
device and no emulator.

## Phase 2 artifacts

| File | Size | SHA-256 |
|---|---|---|
| `apk/riderise-lk-phase2-debug.apk` | 2,440,526 B | `c7f623f0bbb449b541ee782588deb23d5c1ca56307fe6e8bbcbd13aa8f45ee4a` |
| `apk/riderise-lk-phase2-release.apk` | 2,444,624 B | `f26ece09acb3212f16864c905ec4914246fde47a54c95508c555f780d6486c53` |

Both are listed in `apk/SHA256SUMS.txt`; verify with `cd release/apk && sha256sum -c
SHA256SUMS.txt`. The `.idsig` files are v4 signature sidecars.

Signature verification actually observed on these files:

```
Verified using v1 scheme (JAR signing): false
Verified using v2 scheme (APK Signature Scheme v2): true
Verified using v3 scheme (APK Signature Scheme v3): true
Signer #1 certificate SHA-256 digest: da197bc60af1d9cc7b5f345cc23541f9995bb5a39a6873d467f629956b1354fe
Verified using v2 scheme (APK Signature Scheme v2): true
Verified using v3 scheme (APK Signature Scheme v3): true
Signer #1 certificate DN: CN=RideRise LK, OU=Mobile, O=Shaun David Studios, L=Colombo, ST=Western, C=LK
```

v1 is not produced by this apksigner build and is not needed at `minSdk 24` — Android 7.0+
verifies v2/v3. Any older device (Android 6 and below) cannot install this APK, which the
manifest already prevents.

## Manifest facts (verified)

| Property | Debug | Release |
|---|---|---|
| Package id | `lk.shaunstudios.riderise` | `lk.shaunstudios.riderise` |
| versionName / versionCode | `2.0.0` / `2` | `2.0.0` / `2` |
| minSdk / targetSdk | 24 (Android 7.0) / 34 | 24 / 34 |
| Launcher activity | `lk.shaunstudios.riderise.MainActivity` (exported) | same |
| `android:debuggable` | `true` | absent |
| `android:usesCleartextTraffic` | `false` | `false` |
| Signature schemes | v2 + v3 (verified) | v2 + v3 (verified) |
| Bundled assets | `assets/webapp/` (the whole client) | same |
| Zip alignment | 4-byte aligned STORED entries | same |

### Declared permissions

```
android.permission.INTERNET
android.permission.ACCESS_NETWORK_STATE
android.permission.POST_NOTIFICATIONS
android.permission.RECORD_AUDIO
android.permission.MODIFY_AUDIO_SETTINGS
android.permission.ACCESS_FINE_LOCATION
android.permission.ACCESS_COARSE_LOCATION
android.permission.BLUETOOTH_CONNECT
```

`RECORD_AUDIO` is requested only when a rider joins a voice room or presses PTT; location is
requested only when they press **Start sharing** on a guild map. The WebView grants these
capabilities only to the bundled `file://` application, never to remote pages.

## Signing certificates

**Debug** — `CN=Android Debug, O=Android, C=US`
SHA-256 `7f4f9774d06992f1715e0ad0550a5252b6c64a2d9eca49efea0b993acbc716a9`
SHA-1 `00d797fb1512cc3b479fe7360f41831cc1bd5d69`

**Release** — `CN=RideRise LK, OU=Mobile, O=Shaun David Studios, L=Colombo, ST=Western, C=LK`
RSA 4096, validity 30 years, generated 2026-10-25
SHA-256 `9f55e66c0ec49f3ef88a58b4cbb1db5e99925e0d42492aaad5935b0f068bdd09`
SHA-1 `98ec4c24bc0d867984691e7d0e93b7f8b8715fd4`

> The Phase 1 APKs kept in this folder were signed with an earlier key whose keystore was
> lost when the build sandbox was recycled. The Phase 2 release therefore has a **new signing
> identity**. Back up the current keystore immediately: Play Store updates require the same
> identity forever, and it cannot be recreated.

## Key custody

`android/keystore/riderise-release.keystore` and `KEYSTORE-CREDENTIALS.txt` are git-ignored,
mode 600. Copy them to a secrets manager and an offline backup. They are **not** in this
repository, not in the APK and not in any chat log.

## Reproduce

```bash
npm run apk            # debug + signed release, provisions toolchain on first run
cd release/apk && sha256sum -c SHA256SUMS.txt
```

## What this build does *not* prove

- It was **not installed on a physical device or emulator** in this environment. Installation,
  launch, Firebase email/password sign-in, microphone and location prompts, and two-device
  voice must be verified on real hardware.
- Push is **not** active in this APK: it bundles no Play Services, so no FCM token can be
  issued. The Gradle/FCM project in `android/` has never been compiled by Gradle here (no
  Android SDK or Maven access), so token retrieval, notification display and deep-link taps
  remain unverified until you run it in Android Studio on a Play-enabled device.
- Delivery also needs the server-side Firebase service account in
  `FCM_SERVICE_ACCOUNT_FILE` (`docs/PHASE2_FIREBASE_PUSH.md`); without it `/api/health`
  reports `"push":false` and no push is sent.

## Play Store notes

- The current pipeline produces an **APK**. Google Play has required **AAB** for new apps and
  updates since August 2021; an AAB must be produced with Gradle/Android Studio (or `bundletool`
  from Gradle output). This SDK-free pipeline cannot emit a valid AAB.
- Play also requires: a privacy policy URL, data-safety form (location, audio, messages),
  content rating, target API level within the current window (34 is acceptable at the time of
  writing — check the current requirement), and a signed AAB with an upload key.
- Sideloading the release APK is fine for studio testing; it is not a Play submission.
