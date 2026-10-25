# RideRise LK — setup guide (start here)

This is the one document to follow, in order. Each step ends with **how to prove it worked**,
and every step is optional until you need it: the app runs end-to-end locally with no account,
no key and no payment.

If you only read one line: **run step 1, then decide how far down the list you need to go.**

| Your goal | Do these steps | Time |
|---|---|---|
| Try it on this computer | 1 | 5 min |
| Use it on your phone, same Wi-Fi | 1, 2 (tunnel), 8 | 30 min |
| A real deployment riders can sign into | 1–4 (Firebase auth), 6–9 | an afternoon |
| Voice + walkie-talkie between phones | + 6 (TURN) | + 20 min |
| Push notifications on the phone | + 5 + the Gradle build | + 2 h |
| Google Play listing | + 10 | + 1–2 days of review |

Run this at any point to see exactly what is configured:

```bash
npm run check:setup -- --url https://your-domain.example
```

It prints ✔ / ! / ✖ for every integration, never prints secret values, and tells you the next
action for each gap.

---

## 1. Run it locally

```bash
git clone <your repo> && cd RideRise-LK
npm install
npm start                     # http://localhost:3000
```

First start creates `backend/riderise_lk.sqlite`, applies the Phase 1 schema plus the Phase 2
migration, and seeds demo riders, three guilds, four events, nine catalogue parts, 21 stunt
modules and five learning pathways.

Open <http://localhost:3000>. Real sign-in is Firebase email/password (step 4) and stays
disabled — with an explanation — until you configure it. To look around immediately, press
**Use a demo account** and pick one:

| Account | Use it for |
|---|---|
| `kasun.perera.demo@gmail.com` | normal rider, guild owner |
| `roshan.fernando.demo@gmail.com` | guild moderator |
| `dilshan.student.demo@gmail.com` | the 16–17 defaults (approximate-only location) |
| `nethmi.admin@shaundavidstudios.lk` | studio admin with the full console |

Admin console: open `#/admin` and sign in with **`admin$123$` / `admin$123$`** (the credential
from the brief; it also works from Studio Console → Sign in).

**Prove it worked**

```bash
curl -s localhost:3000/api/health | python3 -m json.tool     # "phase": 2
npm test                                                     # 79 tests, 79 pass
```

---

## 2. Put the backend on HTTPS

Two facts force this:

- the APK sets `usesCleartextTraffic=false` and `MIXED_CONTENT_NEVER_ALLOW`, so it refuses a
  plain `http://` API;
- microphone, geolocation and WebRTC need a secure context.

### Option A — testing only: a free tunnel

```bash
cloudflared tunnel --url http://localhost:3000
# or: ngrok http 3000
```

Copy the `https://…` address it prints; that is the URL you type into the APK in step 8.

### Option B — a small VPS (recommended for real use)

```bash
# on the server, as a non-root user
git clone <your repo> /srv/riderise && cd /srv/riderise
npm install --omit=dev

cat > /srv/riderise/.env <<'EOF'
NODE_ENV=production
PORT=3000
DB_PATH=/var/lib/riderise/riderise_lk.sqlite
JWT_SECRET=PASTE_THE_OUTPUT_OF_openssl_rand_hex_32
ADMIN_USERNAME=studio-admin
ADMIN_PASSWORD=PASTE_A_LONG_RANDOM_PASSWORD
EOF
chmod 600 /srv/riderise/.env
sudo mkdir -p /var/lib/riderise && sudo chown $USER /var/lib/riderise

node --env-file=/srv/riderise/.env backend/server.js     # smoke test, then Ctrl-C
```

Keep it running with systemd:

```ini
# /etc/systemd/system/riderise.service
[Unit]
Description=RideRise LK
After=network.target

[Service]
WorkingDirectory=/srv/riderise
ExecStart=/usr/bin/node --env-file=/srv/riderise/.env backend/server.js
Restart=always
User=YOUR_USER

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now riderise
sudo journalctl -u riderise -n 50 --no-pager
```

TLS with Caddy is two lines (`/etc/caddy/Caddyfile`):

```
riderise.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Back up `riderise_lk.sqlite` (plus `-wal`/`-shm`) on a schedule — it is the whole database.

**Prove it worked**

```bash
curl -s https://riderise.example.com/api/health | python3 -m json.tool
```

`JWT_SECRET` is mandatory in production: the server exits with a clear message rather than
shipping a default signing key.

---

## 3. Take ownership of the admin account

1. Sign in at `https://your-domain/#/admin` with `admin$123$` / `admin$123$`
   (or the `ADMIN_USERNAME`/`ADMIN_PASSWORD` you set).
2. **Studio Console → 🔑 Password → Change password.** The demo credential is public in the
   project brief — change it before a single real rider registers.
3. Optional: create named moderator accounts (role `moderator`) so staff actions are
   attributable in the audit log.

From the console you can: ban/suspend/restore accounts, delete posts, comments, guild
messages and private messages, resolve reports and appeals, read the feedback inbox, publish
news, create **Official Shaun David Studios Events**, and broadcast.

**Prove it worked**

```bash
npm run probe:admin      # 36 checks; run against a THROWAWAY database, see the script header
```

---

## 4. Rider accounts — Firebase email/password

This is the real sign-in system: no homemade passwords, no Google OAuth requirement, no
passwordless links. The full engineering notes, API contract, error codes and verification
checklist live in **`docs/FIREBASE_AUTH.md`**; this is the short version.

**What the pieces are**

| Piece | Used by | Needs |
|---|---|---|
| Firebase project + **Email/Password** provider | browser, installed PWA, APK | an enabled provider (free) |
| Web app config (`apiKey`, `authDomain`, `appId`…) | the client SDK in every build | public identifiers — not secrets |
| `FIREBASE_PROJECT_ID` | the server's ID-token verifier | nothing else; Google's public certificates are fetched automatically |

**Steps**

1. <https://console.firebase.google.com/> → **Add project** (Analytics optional).
2. **Project settings → Your apps → Add app → Web** (`</>`). Copy the `firebaseConfig` values.
3. **Authentication → Get started → Sign-in method → Email/Password → Enable → Save.**
   Leave “Email link (passwordless)” off.
4. Add to `.env` (or your platform's environment) and restart:

   ```bash
   FIREBASE_PROJECT_ID=riderise-lk
   FIREBASE_API_KEY=AIzaSy…                       # public web API key
   FIREBASE_AUTH_DOMAIN=riderise-lk.firebaseapp.com
   FIREBASE_APP_ID=1:123456789012:web:abcdef0123456789
   FIREBASE_MESSAGING_SENDER_ID=123456789012
   ```

   `FIREBASE_PROJECT_ID` is also picked up from `FCM_SERVICE_ACCOUNT_FILE`/`_JSON` if you
   already set up push, so one project covers both.

5. **Authentication → Settings → Authorized domains**: add your production domain (and any
   tunnel host you test with). `localhost` is already there.
6. Serve the site over **HTTPS** (step 2). Firebase refuses insecure origins other than
   localhost.
7. Prove it works:

   ```bash
   curl -s localhost:3000/api/auth/firebase/config | python3 -m json.tool   # "configured": true
   npm run check:setup                                                     # sign-in ✔
   ```

   Then in the browser: create an account, open the verification email, press
   **I’ve verified my email**, sign out, sign in again — and check that closing the browser and
   reopening keeps you signed in (“remember me” is the SDK's LOCAL persistence).

**Stated plainly**

- Until `FIREBASE_PROJECT_ID` + `FIREBASE_API_KEY` are set, the email/password form renders
  **disabled** and says which variable is missing. Nothing is faked and no account is created.
- Passwords live only in Firebase. RideRise LK stores no password, hash or salt.
- The demo-account sheet is only for evaluating the build. It is refused in production unless
  you set `ALLOW_DEMO_SIGNIN=1`, and it can never grant an administrator role.
- Existing demo profiles are **never** merged into a Firebase account by matching email. A
  rider signs in to the old profile and links it from **Settings → Sign-in & security**.
- The APK uses the same web config. Session persistence inside the WebView is implemented but
  **not verified on a real device** — see `docs/FIREBASE_AUTH.md` §8.

### 4b. Google Sign-In was removed

RideRise LK no longer offers Google sign-in, and the server no longer reads
`GOOGLE_CLIENT_ID`. There is **no Google OAuth consent screen, no popup, no client ID and no
redirect URI** to configure. Any older instructions you find about a Google button are
historical: the only sign-in paths are **Firebase email/password** (above) and the
clearly-labelled demo accounts used to evaluate the build.

If a `GOOGLE_CLIENT_ID` is still present in your environment it is ignored — delete it when
convenient.

---

## 5. Firebase + push notifications

Push has two independent halves. The server half works today; the device half needs the
Gradle build.

### 5a. Server half (15 minutes)

1. <https://console.firebase.google.com/> → **Add project** (analytics optional).
2. **Project settings → Your apps → Add app → Android**: package `lk.shaunstudios.riderise`.
   Download `google-services.json` — you will need it in 5b. Do **not** commit it
   (`.gitignore` already excludes it).
3. **Project settings → Service accounts → Generate new private key.** Save the JSON outside
   the repo, e.g. `/etc/riderise/firebase-service-account.json`, `chmod 600`.
4. Enable the API: <https://console.cloud.google.com/> → APIs & Services → enable
   **Firebase Cloud Messaging API** for the same project.
5. Add to the server environment and restart:

   ```bash
   FCM_SERVICE_ACCOUNT_FILE=/etc/riderise/firebase-service-account.json
   ```

6. Verify:

   ```bash
   curl -s localhost:3000/api/health | grep -o '"push":[a-z]*'      # "push":true
   npm run check:setup                                              # Firebase ✔
   ```

   In the console, **Studio Console → Audit/Push diagnostics** shows the project id and the
   last 40 delivery attempts. A configured project with zero devices is the normal state
   until a phone registers.

### 5b. Device half (Android Studio, ~1–2 hours)

The SDK-free APK has no Play Services, so it cannot obtain a token. In a Gradle build:

1. Follow `android/firebase/README.md`: dependencies, manifest additions, two Java classes,
   `app/google-services.json`.
2. Run the app, sign in. `web_app/app.js` calls `RRAndroid.requestPushToken()`, receives the
   token via `RR.onPushToken`, and `POST /api/devices` registers it with the rider's session.
3. Send yourself a push:
   **Studio Console → Broadcast**, or

   ```bash
   curl -X POST localhost:3000/api/admin/push/test -H "Authorization: Bearer $ADMIN_TOKEN"
   ```

**Prove it worked:** the phone shows "RideRise LK test push"; `push_delivery_log` has a `sent`
row; tapping the notification opens `#/notifications`.

**Privacy defaults already enforced server-side:** previews are off by default (the push body
becomes "You have a new private update."), quiet hours are honoured, muted conversations are
skipped, and blocked accounts are never notified.

---

## 6. Voice and walkie-talkie (TURN)

Without a relay, two phones on mobile data usually fail to connect. Ten minutes fixes it.

1. Pick a provider — Twilio (<https://www.twilio.com/docs/stun-turn>), Metered
   (<https://www.metered.ca/pricing>), Cloudflare Calls, or your own coturn.
2. Copy either the shared secret or a username/credential pair.
3. Environment:

   ```bash
   # preferred: time-limited credentials minted per call
   TURN_URLS=turn:global.turn.twilio.com:3478?transport=udp,turn:global.turn.twilio.com:3478?transport=tcp
   TURN_SECRET=your-shared-secret

   # or static credentials
   TURN_URL=turn:turn.example.com:3478
   TURN_USERNAME=riderise
   TURN_CREDENTIAL=…
   ```

4. Restart and verify:

   ```bash
   curl -s -H "Authorization: Bearer $TOKEN" localhost:3000/api/voice/ice | python3 -m json.tool
   # turn_available: true, turn_mode: "ephemeral"|"static", note starts "TURN relay configured"
   ```

   `turn_available: false` with a "No TURN relay configured" note is the honest disabled state.

5. Firewall (self-hosted coturn): open 3478/UDP+TCP, 5349/TCP (TLS) and the relay range
   (default 49152–65535/UDP). If calls connect and then go silent, this is almost always the
   cause.

**Two-phone test:** both riders join the same guild → **Voice & walkie-talkie** → one opens a
room, the other joins → microphone permission is requested in context (never before) → the
mic-active indicator appears with the state text. Then try walkie-talkie: hold to talk, release
to stop, watch the transmitter name and the "channel busy" state when both press at once.

---

## 7. Map tiles

Default: OpenStreetMap raster tiles, no key. Read
<https://operations.osmfoundation.org/policies/tiles/> before public traffic.

```bash
MAP_PROVIDER=maptiler        # or mapbox / thunderforest
MAP_API_KEY=…
MAP_PROXY_TILES=1            # keep the key on the server
```

With `MAP_PROXY_TILES=1` the client requests `/api/map/tile/{z}/{x}/{y}.png` and the server
adds the key, so it never ships in the APK. Verify with
`curl -s -H "Authorization: Bearer $TOKEN" localhost:3000/api/map/config`:
`configured: true`, `key_exposed_to_client: false`.

---

## 8. Build and install the APK

```bash
npm run apk            # debug + release, signed, in release/apk/
cd release/apk && sha256sum -c SHA256SUMS.txt
```

Install on a phone:

```bash
adb install -r release/apk/riderise-lk-phase2-debug.apk
```

Or copy the file to the phone and tap it (allow "install unknown apps" for your file manager).
The release APK is signed with `android/keystore/riderise-release.keystore`; **back that
folder up offline** — lose it and the next build is a different app that cannot update the
installed one.

First run in the APK:

1. It asks for the server address — paste the **HTTPS** URL from step 2. It is stored on the
   device (Settings → Server Connection to change it).
2. Sign in. In the demo build the Google sheet appears with the four demo accounts.
3. Grant microphone when you join a voice room, location only when you press **Start sharing**,
   notifications when the app asks (Android 13+).

Do not disable the splash, permissions or WebView settings to "make it faster" — the splash is
the branded asset and the permission gates are what keep location/mic off until asked.

---

## 9. Make it yours

Everything brand- and content-shaped lives in data, not code:

| What | Where |
|---|---|
| App name, tagline, studio, package id, version, logo settings | `config/brand.config.json` |
| Ranks and XP thresholds | Studio Console → **Classic console → Rider ranks** (or the `ranks` table) |
| Riders, guilds, events, catalogue entries, stunts, pathways | Studio Console + the CMS screens |
| Safety notice, privacy policy, terms, community guidelines | `legal_documents` table — drafts, marked subject to legal review. There is no legal editor in the console yet; update rows directly and keep the `version` accurate. |
| Rate limits | `config/brand.config.json → rateLimits` |

The supplied logo is used unmodified at `assets/brand/riderise_logo.png`. Replace it only if
you own the replacement; keep the aspect ratio.

---

## 10. Google Play (when you are ready)

1. Play Console account, then **Create app**. New apps publish as **AAB**, not APK — that
   requires the Gradle build (`./gradlew bundleRelease`). The SDK-free pipeline produces APKs
   only; that is fine for direct installs and internal testing.
2. Required before review: privacy policy URL, data-safety form, content rating, target-API
   declaration, account-deletion route (implemented: `DELETE /api/account`, plus the in-app
   "Delete my account" flow), and a demo account for reviewers.
3. Because riders can be 16–17, fill the data-safety form for **location (approximate by
   default, never shared without an explicit session)** and **audio (voice chat, not recorded)**.
4. Signing: use Play App Signing. Upload-key SHA-1s and the Firebase Android app must match
   the Play app-signing certificate.

---

## 11. What to verify after any change

| Feature | Check | Expected |
|---|---|---|
| Health | `curl /api/health` | `phase: 2`, capability flags match reality |
| Tests | `npm test` | 79 / 79 pass |
| Admin | `npm run probe:admin` (throwaway DB) | 36 checks pass |
| Setup | `npm run check:setup -- --url …` | 0 blocking |
| Sign-in | browser at your domain | email/password form enabled when the Firebase vars are set; verification gate before the app opens |
| Map | guild → Live map | "Who can see me" consent screen first; nothing shared before Start |
| Voice | two phones, same guild | mic indicator, participant list, honest "relay not configured" text when TURN is absent |
| Push | console → Broadcast | notification arrives only with the Gradle build |
| Moderation | report a post, resolve in console | reporter notified, audit row written |

---

## 12. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Refusing to start: JWT_SECRET is required in production` | `NODE_ENV=production` without a secret | `JWT_SECRET=$(openssl rand -hex 32)`, restart |
| APK: "Connection failed" to an `http://` URL | cleartext blocked by design | use HTTPS (step 2) |
| Sign-in form disabled with “not configured on this server” | `FIREBASE_PROJECT_ID` / `FIREBASE_API_KEY` unset | step 4 (5 minutes in the Firebase console) |
| `auth/unauthorized-domain` after sign-in attempt | origin not listed in Firebase | Authentication → Settings → Authorized domains (step 4.5) |
| Voice connects then goes silent | TURN relay UDP range blocked | open 49152–65535/UDP (step 6) |
| `voice/ice` says relay configured but `turn_available:false` | stale server process | restart after changing env |
| Map is blank | provider key missing / offline | `/api/map/config` → `configured` |
| "Price not verified" everywhere | by design — no invented LKR prices | verify prices in the catalogue admin |
| Admin console write blocked with `PASSWORD_CHANGE_REQUIRED` | `must_change_password` is set | Studio Console → 🔑 Password |
| `npm test` killed / OOM | suites run serially for this reason | don't parallelise; 2 GB RAM is enough as configured |
| Push log shows `HTTP 403` | FCM API not enabled | enable it in Google Cloud (step 5a.4) |
| `403 DEMO_SIGNIN_DISABLED` on a demo account | production without `ALLOW_DEMO_SIGNIN=1` | expected — sign in with a real email/password account |
| Verification email never arrives | wrong address, or spam | press **Resend verification email** on the gate; check Authentication → Templates |

---

## 13. Costs and quotas at a glance

| Service | Free tier | What breaks when you exceed it |
|---|---|---|
| OSM tiles | free under usage policy | tile host blocks you — move to a commercial provider |
| Firebase Authentication | free (Email/Password provider) | abuse quotas only — verify current limits |
| FCM | free | rate limits only |
| TURN | provider trial credit, then per GB | calls fall back to direct/STUN and start failing on mobile data |
| Hosting | — | pay for the VPS / platform plan |
| Play Console | one-time registration fee | — |

Full detail, including links to each provider's live pricing: `docs/EXTERNAL_CONFIG.md`.

---

## 14. What this workspace could not test

No Android device, no emulator, no Firebase project, no TURN account, and no outbound access to
Firebase or tile endpoints. So: no APK was ever installed or launched, no push was delivered,
no call was carried between two phones, and no real Firebase account, verification email or
password reset has been exercised against Google's servers. The Firebase ID-token verifier *is*
tested — with locally-signed tokens that follow Google's claim contract
(`tests/auth.firebase.test.js`, 22 tests; 6 more UI flows in `tests/ui.auth.test.js`) — but live
x509 fetching and mail delivery require your project. Every step above ends with a verification
you can run in your own environment — use them, and treat anything unverified as unverified.
