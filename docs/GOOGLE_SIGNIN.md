# Google Sign-In — removed

**Google sign-in and Google OAuth no longer exist in RideRise LK.** This file is kept only so
older links and bookmarks land somewhere truthful.

## What changed

| Before | Now |
|---|---|
| “Sign in with Google” button + Google Identity Services script | Removed. The welcome screen offers **email + password** (Firebase Authentication) |
| `GOOGLE_CLIENT_ID` environment variable | No longer read. Safe to delete |
| Server-side Google ID-token verifier (`googleapis.com/oauth2/v3/certs`) | Deleted from `backend/server.js` |
| `/api/config` → `googleClientId`, `capabilities.googleSignIn` | Removed (`capabilities.emailPasswordSignIn` replaces it) |
| `POST /api/auth/google` | Deleted. The route returns `404` |
| Android SHA-1 / OAuth client registration | Not required |

## Why

Google blocks OAuth inside embedded WebViews (`disallowed_useragent`), the flow needs an OAuth
consent screen and authorised JavaScript origins per domain, and it forced an extra Google
Cloud project on top of the Firebase project. Email/password authentication is simpler for
riders in Sri Lanka (no Google account required), works identically in Chrome and inside the
APK's WebView, and is the flow the app now tests end-to-end.

## What to do instead

Follow **[`FIREBASE_AUTH.md`](FIREBASE_AUTH.md)**. In short:

1. Create a Firebase project.
2. Register a Web app and copy the public config.
3. Enable **Authentication → Sign-in method → Email/Password**.
4. Set `FIREBASE_PROJECT_ID` and `FIREBASE_API_KEY` on the server and restart.

Until then the email/password form renders **disabled** with an explanation. There is no demo
or sandbox sign-in to fall back on.

## If you have an older client

An older APK that still calls `POST /api/auth/google` receives `404` and must be rebuilt
(`npm run apk`) to get the current sign-in screen.
