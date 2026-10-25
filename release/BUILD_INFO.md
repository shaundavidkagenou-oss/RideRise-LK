# RideRise LK — APK build provenance

Rebuilt on **2026-10-25 09:20 UTC** after adding the Android push (FCM) build: a complete
Gradle project under `android/` (AGP 8.7.3, Google services plugin 4.5.0, Firebase BoM
35.1.0, `firebase-messaging`), the native token bridge, notification service, channel and
deep-link routing, plus `scripts/verify_android_push.js`. The bundled `assets/webapp/` was
refreshed from the current source so the shell and the web build match. Built with
`scripts/build_apk.sh all` (no Android SDK or Gradle; the toolchain provisions a Java runtime,
aapt2, d8, ecj and apksigner). Verified with `apksigner verify` and `aapt2 dump badging /
permissions`. **The APK has not been installed or launched** — this environment has no device
and no emulator.

> This SDK-free APK still contains **no Play Services and no Firebase SDK**, so it cannot
> receive push. The Firebase build lives in `android/` and must be opened in Android Studio;
> it has never been compiled by Gradle here. See `android/firebase/README.md`.

## Phase 2 artifacts

| File | Size | SHA-256 |
|---|---|---|
| `apk/riderise-lk-phase2-debug.apk` | 2,440,529 B | `709a3719fdc309e3a120d2ad3f255997ae7ecd55cd156808d74fe6c2a89649a4` |
| `apk/riderise-lk-phase2-release.apk` | 2,444,624 B | `32fce39f31d2cc413f3b81eecc19e9878d6aab5dc62ea88ba09af3f898856412` |

Both are listed in `apk/SHA256SUMS.txt`; verify with `cd release/apk && sha256sum -c
SHA256SUMS.txt`. The `.idsig` files are v4 signature sidecars.

Signature verification actually observed on these files:

```
Verified using v1 scheme (JAR signing): false
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
