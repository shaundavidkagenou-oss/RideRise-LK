# RideRise LK Phase 1 — APK build provenance

Built on **2026-10-25** from this repository (`scripts/build_apk.sh all`) and verified
independently with `apksigner verify` and `androguard`.

## Artifacts

| File | Size | SHA-256 |
|---|---|---|
| `apk/riderise-lk-phase1-debug.apk` | 2,300,124 B | `eaa026133e857d8156988c7351db2856eac6ccded2e0155432c15b72dc2ec77d` |
| `apk/riderise-lk-phase1-release.apk` | 2,304,219 B | `e8ffe5ca08c460e72ad6286a0dbe8eda0a0276c5f1fe9332b281c2bcb478afff` |

Both are also listed in `apk/SHA256SUMS.txt` (verify with `sha256sum -c SHA256SUMS.txt`).

## Manifest facts (verified with androguard)

| Property | Debug | Release |
|---|---|---|
| Package id | `lk.shaunstudios.riderise` | `lk.shaunstudios.riderise` |
| versionName / versionCode | `1.0.0` / `1` | `1.0.0` / `1` |
| minSdk / targetSdk | 24 (Android 7.0) / 34 | 24 / 34 |
| Launcher activity | `lk.shaunstudios.riderise.MainActivity` (exported) | same |
| Permissions | `INTERNET`, `ACCESS_NETWORK_STATE`, `POST_NOTIFICATIONS` | same |
| `android:debuggable` | `true` | absent (false) |
| `android:usesCleartextTraffic` | `false` | `false` |
| Signature schemes | v1 + v2 + v3 | v1 + v2 + v3 |
| Bundled app assets | 15 files under `assets/webapp/` | same |
| Zip alignment | all STORED entries 4-byte aligned | same |

## Signing certificates

**Debug** — `CN=Android Debug, O=Android, C=US`
SHA-256: `56f878acf8bd5d6b66c17b7d324186e0a154df7394be0774136dc5d2faf08583`
SHA-1: `435acefffb4d9ded799d107824da2b568f43dd8a`

**Release** — `CN=RideRise LK, OU=Mobile, O=Shaun David Studios, L=Colombo, ST=Western, C=LK`
RSA 4096, validity 30 years (generated 2026-10-25)
SHA-256: `39d8f574f99e2a35b40ed150ee2c1dd0035c12e2db17aa36a0e026f8fb25bec8`
SHA-1: `7c132ef28161882a5386a2d7821ec88da5b59fb6`

> Use the release **SHA-256** fingerprint when registering the Android OAuth client and the
> Firebase Android app. Registering SHA-1 is not sufficient for modern Google sign-in.

## Key custody

The release keystore lives at `android/keystore/riderise-release.keystore` and is
**excluded from Git** (`.gitignore`). Passwords are in the neighbouring
`KEYSTORE-CREDENTIALS.txt` (also excluded). **Back both up in a secrets manager and keep an
offline copy.** Losing them prevents shipping updates to the same app identity; leaking them
allows impersonation of Shaun David Studios.

## Reproduce this build

```bash
npm run apk            # provisions the toolchain on first run (~/.cache/riderise-apk-tools)
sha256sum -c release/apk/SHA256SUMS.txt
```

Builds are deterministic in entry ordering and timestamps, but the APK bytes may differ from
the hashes above if the source changes or a different signing key is used. The certificate
fingerprints above remain valid only for the key stored in `android/keystore/`.

## Install

```bash
adb install -r release/apk/riderise-lk-phase1-release.apk
```

Then open **Settings → Server connection** and enter your deployed HTTPS API URL
(`…/api/health` must return JSON). See `docs/BUILD_INSTRUCTIONS.md`.
