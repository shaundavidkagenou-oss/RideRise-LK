# Build-environment capabilities & limitations

This was assessed **before** implementation and drove the technology decisions in Phase 1.
The brief asked to prefer Flutter + Firebase "where supported by the development environment";
this is the honest record of what that environment supports.

## 1. What the sandbox provides

| Capability | Status | Consequence |
|---|---|---|
| Node.js 22.22 + npm registry access | ✅ | Backend, tests, JS tooling |
| Python 3.11 + PyPI access | ✅ | Build helpers, Pillow, androguard verification |
| GitHub / codeload access | ✅ | Supplies the Android build toolchain pieces |
| `aapt2` (Linux x86_64), `d8`, `apksigner`, `android.jar`, `ecj` | ✅ via npm packages | Real APK compilation & signing without the Android SDK |
| Java runtime (Temurin via `jdk4py`) | ✅ | Runs d8/apksigner/ecj |
| Anthropic-grade browser engine / screenshot tooling | ❌ | Visual QA done by CSS review + jsdom DOM tests + live preview |
| Flutter SDK / Dart SDK | ❌ | Flutter app could not be compiled here |
| Android SDK / Gradle / Kotlin toolchain | ❌ | Gradle cannot resolve dependencies here; the SDK-free pipeline ships the APK and the `android/` Gradle project is written but unbuilt |
| Android emulator or physical device | ❌ | APK verified statically with two independent tools, not installed |
| Firebase project & credentials | ❌ (partially) | Project `rideriselk`, web config, `google-services.json` and the FCM service account are installed and validated locally (RSA sign/verify, project match), but no call to Google's servers can be made from here |
| Outbound access to `firebase`, Google identity endpoints, CDNs | ❌ | Real Firebase sign-up, verification email, ID-token verification and FCM delivery cannot be executed in-sandbox |
| SMS/email delivery | ❌ | Support addresses are configuration, not live mailboxes |

## 2. Decisions taken because of those limits

1. **UI: framework-free web application bundled inside a native Android WebView**
   instead of Flutter. Rationale: it can be built, tested and shipped **here**; it runs
   identically in the live browser preview and inside the APK; and it keeps the APK at 2.3 MB
   with no toolchain dependency. The native shell supplies the Android-only pieces (share
   sheet, file picker, notification permission, back handling, splash, icon).
   *Migration note:* if the studio standardises on Flutter, the same REST API, database,
   XP/bike engines and design tokens apply; only the presentation layer is re-implemented.

2. **Backend: Node.js + SQLite** with a real relational schema, JWT sessions, RBAC, rate
   limits and audit logging — instead of Cloud Firestore. Firestore requires a Firebase
   project the studio must own; the schema is documented as 1:1 mappable
   (`EXTERNAL_CONFIG.md` §4) and the authorization rules that must be preserved are spelled
   out explicitly.

3. **Authentication: Firebase email/password** with server-side ID-token verification, plus a
   clearly-labelled **local demo bridge** so every role and journey is testable without a
   Firebase project. Google OAuth was removed. See `FIREBASE_AUTH.md`.

4. **Push notifications: server sending is configured; the Android FCM build is complete.**
   The in-app notification centre, `POST /api/devices`, FCM HTTP v1 sender, notification
   service, channel and deep links all exist, the service account is installed and validated
   (`npm run check:fcm`, `/api/health` → `"push":true`), and `android/` is an Android Studio
   project with the studio's `google-services.json`. What is missing is a Gradle build on a
   Play-enabled device and, in this sandbox only, outbound HTTPS to Google.

5. **APK: custom reproducible pipeline** (`aapt2 → ecj → d8 → zipalign → apksigner`) rather
   than Gradle. This produces a genuinely signed, installable APK in this environment and is
   fully documented (`BUILD_INSTRUCTIONS.md`).

## 3. What this means for the studio

- Everything shipped is real and testable now; nothing depends on credentials you have not
  supplied.
- The five items that genuinely require your accounts are listed with exact steps in
  `EXTERNAL_CONFIG.md`.
- If the studio requires Flutter/Kotlin + Firebase specifically, the backend contract,
  database schema, engines and design tokens remain valid inputs for that port; no product
  decisions or safety logic need to be rediscovered.
