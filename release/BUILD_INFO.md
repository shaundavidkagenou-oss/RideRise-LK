# RideRise LK — APK build provenance

Rebuilt on **2026-10-25 08:08 UTC** after the final code changes (Safety Centre appeals and
community rules, TURN honesty fix, JWT secret handling), so the bundled `assets/webapp/`
matches the current source. Originally produced the same day with
`scripts/build_apk.sh all` (no Android SDK or Gradle; toolchain provisions a Java runtime,
aapt2, d8, ecj and apksigner). Verified with `apksigner verify` and `aapt2 dump badging /
permissions`.

## Phase 2 artifacts

| File | Size | SHA-256 |
|---|---|---|
| `apk/riderise-lk-phase2-debug.apk` | 2,374,740 B | `ab4da04f824ca6f3430fb06fd1a7559e3965b7e89e500bfc9056ad4ea40f9099` |
| `apk/riderise-lk-phase2-release.apk` | 2,378,836 B | `b4d1841dbe2728503452840e4f82a969f74fd3e608d1e415c7f97a38974a4cd0` |

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
  launch, Google sign-in, microphone and location prompts, and two-device voice must be
  verified on real hardware.
- Push delivery is not active because no Firebase project or client token exists yet
  (`docs/PHASE2_FIREBASE_PUSH.md`).
- Google OAuth requires your real `GOOGLE_CLIENT_ID` and the release SHA-1/SHA-256 registered
  in Google Cloud Console (`docs/GOOGLE_SIGNIN.md`).

## Play Store notes

- The current pipeline produces an **APK**. Google Play has required **AAB** for new apps and
  updates since August 2021; an AAB must be produced with Gradle/Android Studio (or `bundletool`
  from Gradle output). This SDK-free pipeline cannot emit a valid AAB.
- Play also requires: a privacy policy URL, data-safety form (location, audio, messages),
  content rating, target API level within the current window (34 is acceptable at the time of
  writing — check the current requirement), and a signed AAB with an upload key.
- Sideloading the release APK is fine for studio testing; it is not a Play submission.
