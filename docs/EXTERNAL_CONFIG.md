# RideRise LK — third-party accounts, credentials, fees and limits

Everything in this file is **optional**. A fresh clone runs on Node 22 with no account, no
key and no payment: account creation, feed, guilds, learning, catalogue (unverified prices),
events, moderation and the studio console all work against local SQLite. Each section below
describes exactly what stops working until you add a credential, and how to add it.

> Prices and free-tier allowances change. Where a cost is mentioned it is marked
> **verify** and links to the provider's own pricing page. Nothing here is a quote, and no
> payment is required to evaluate the app.

---

## 0. Quick reference

| Integration | Accounts / credentials | Typical cost | What it unlocks | What happens without it |
|---|---|---|---|---|
| Core app | none | none | Everything local, demo data, all moderation | — |
| Google Sign-In | Google Cloud project, OAuth **Web** client ID, release SHA-1 | free | Real Google accounts instead of demo presets | Demo sign-in only (`presetAccount`) |
| Map tiles | OSM (no key) or MapTiler/Mapbox/Thunderforest key | OSM free under usage policy; commercial hosts have free tiers then paid **verify** | Street basemap under guild live markers | Markers still render on a blank grid; map shows an offline/tile-error state |
| Voice / walkie-talkie relay | TURN service (Twilio NTS, Metered, Cloudflare) or self-hosted coturn | free tier then per-GB **verify** | Calls between devices on mobile networks/NAT | STUN-only: works on some Wi-Fi pairs, fails on many carrier networks |
| Push notifications | Firebase project + service-account JSON | FCM is free | Server-side delivery to registered devices | In-app realtime + badges only |
| FCM in the APK | Firebase Android SDK + `google-services.json` | free | A device token the app can register | **Not in the shipped APK** — see §6; in-app notifications still work |
| Google Play publishing | Play Console account, AAB, privacy/data-safety forms | one-time registration fee **verify** | Public distribution | Sideload the APK only |
| Hosting | Node 22 host + persistent disk + TLS domain | varies | Public access | Local/LAN only |
| Legal + translations | Sri Lankan lawyer, Sinhala/Tamil reviewer | quote | Launch-ready policies | Drafts are marked "subject to legal review" |

Our own limits (in code, not provider limits) are in §11.

---

## 1. Environment file

The server reads plain environment variables. Node 22 can load a file directly:

```bash
cp .env.example .env          # edit, never commit
node --env-file=.env backend/server.js
```

`.env` is git-ignored; `android/keystore/` and `KEYSTORE-CREDENTIALS.txt` are too. If a
credential ever lands in a commit, rotate it — history is forever.

Check the live capability state at any time:

```bash
curl -s localhost:3000/api/health | python3 -m json.tool
```

`capabilities.push`, `capabilities.turnRelay` and the map `configured` flag tell you the
truth about what the running server can actually do.

---

## 2. Google Sign-In

**What it unlocks:** real Google accounts. Without it, only the built-in demo presets work,
and `/api/auth/google` with an `idToken` returns a clear "not configured" error rather than
inventing a session.

1. Open <https://console.cloud.google.com/> and create a project (e.g. `riderise-lk`).
2. **APIs & Services → OAuth consent screen**: choose External, fill app name, support email,
   developer contact. Add scopes `openid`, `email`, `profile`. While in "Testing", add every
   Google account that will sign in.
3. **Credentials → Create credentials → OAuth client ID → Android**:
   - package name: `lk.shaunstudios.riderise` (must match `config/brand.config.json`)
   - SHA-1 of the **release** signing certificate (and the debug one while testing)
4. **Credentials → Create credentials → OAuth client ID → Web application**. Copy the client
   ID into `GOOGLE_CLIENT_ID`. The server verifies ID tokens with Google's public keys
   (RS256/JWKS) and checks the audience.
5. Ship: the Android client ID is compiled into the app by Google Play Services. Our
   hand-built APK is a WebView shell — it calls the web sign-in route, so the **Web** client
   ID is the one the server needs. Configure the Android client ID when you move to a
   Gradle/Firebase build so native Google Sign-In can be added.

Fees: none. Quota: standard Google OAuth limits; no per-user billing.

**Known limitation:** the shipped APK does not bundle Google Play Services, so the in-app
button uses the demo/preset flow unless you build with Gradle and add the SDK. The server
side token verification is implemented and unit-tested with a rejected-credential path.

---

## 3. Map tiles

Default: OpenStreetMap raster tiles, no key.

```bash
MAP_PROVIDER=openstreetmap     # default
```

Read the OSM tile usage policy before any public launch:
<https://operations.osmfoundation.org/policies/tiles/>. It is a community service — no bulk
downloads, attribution required, and heavy/commercial traffic must use a commercial host or
self-host.

Commercial providers (set `MAP_PROVIDER` + `MAP_API_KEY`):

| Provider | Steps | Pricing |
|---|---|---|
| MapTiler | Create a key at <https://cloud.maptiler.com/>, restrict it to your domain | Free tier, then per-request — <https://www.maptiler.com/cloud/pricing/> **verify** |
| Mapbox | Create a token at <https://account.mapbox.com/>, add URL restrictions | Free tier, then per map load — <https://www.mapbox.com/pricing/> **verify** |
| Thunderforest | Sign up at <https://www.thunderforest.com/>, copy the API key | Free hobby tier, paid plans — <https://www.thunderforest.com/pricing/> **verify** |

**Keep the key out of the APK.** With `MAP_PROXY_TILES=1` the browser requests
`/api/map/tile/{z}/{x}/{y}.png` and the server adds the key. The proxy is documented in
`docs/PHASE2_VOICE_AND_MAP.md`; without the flag the config response honestly reports
`key_exposed_to_client: true` so you can catch the mistake before shipping.

Our limits: min/max zoom and attribution come from the provider preset; live-map sessions are
capped at 60 minutes (10 for precise) and positions are snapped/rounded server-side.

---

## 4. Voice and walkie-talkie (TURN)

WebRTC needs a relay for many mobile networks. The app works without one only when both
peers can reach each other directly (often the same Wi-Fi).

**Option A — hosted TURN (recommended to start)**

1. Create an account with Twilio (<https://www.twilio.com/docs/stun-turn>), Metered
   (<https://www.metered.ca/pricing>) or Cloudflare Calls
   (<https://developers.cloudflare.com/calls/turn/>).
2. Copy the TURN hostname(s), a static username/credential, **or** the shared secret used for
   time-limited HMAC credentials.
3. Set one of:

```bash
# HMAC / "TURN REST" credentials (preferred; credentials are minted per call)
TURN_URLS=turn:global.turn.twilio.com:3478?transport=udp,turn:global.turn.twilio.com:3478?transport=tcp
TURN_SECRET=...

# or static credentials
TURN_URL=turn:turn.example.com:3478
TURN_USERNAME=riderise
TURN_CREDENTIAL=...
```

Fees: free trial credits on most providers, then billed per GB relayed **verify** on the
provider's page. A 1:1 call relays roughly the two audio streams; walkie-talkie is
half-duplex and cheaper because only the speaker transmits.

**Option B — self-hosted coturn**

Run <https://github.com/coturn/coturn> on a VPS with a public IP, TLS on 5349 and the
standard UDP range. Set `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL`, or enable
`use-auth-secret` and pass the same secret as `TURN_SECRET`. Cost is the VPS only. Open the
UDP relay range in the firewall, or calls will connect and then go silent.

**What still won't work:** no relay is bundled, so voice is never faked. `/api/voice/ice`
returns `configured: false` and the room UI shows "relay not configured"; `/api/health`
reports `turnRelay: false`.

---

## 5. Firebase project and service account (push)

**Server side** (works today):

1. <https://console.firebase.google.com/> → add project. Adding Android app
   `lk.shaunstudios.riderise` is optional for HTTP v1, but harmless and needed later.
2. Project settings → **Service accounts** → *Generate new private key*. Keep the JSON out of
   the repo (`.gitignore` already excludes `.env`; do not paste it into source).
3. Set `FCM_SERVICE_ACCOUNT_FILE=/secure/path/service-account.json` (or
   `FCM_SERVICE_ACCOUNT_JSON` with the JSON inline).
4. Enable the **Firebase Cloud Messaging API** in Google Cloud for that project.
5. Restart and confirm: `curl -s localhost:3000/api/health` → `"push": true`; then
   `GET /api/admin/push/status` shows the project id and whether credentials parsed.
   `POST /api/admin/push/test` sends to your own registered devices only.

Fees: FCM is free for standard messaging. Quota: per-project message rates, not per-user
billing.

**Device side — honest gap:** the shipped APK has **no Firebase SDK**, so it cannot obtain a
registration token. Registering a token is implemented (`POST /api/devices`), delivery and
logging are implemented (`push_delivery_log`), and the app uses in-app realtime notifications
without Firebase. To get true push you must add the Firebase BoM + messaging dependency and
`google-services.json` in a Gradle build, then call `POST /api/devices` with the token.
`docs/PHASE2_FIREBASE_PUSH.md` has the payload contract and the exact request/response flow.

Push behaviour that is already enforced server-side: blocked users are never notified,
previews are off by default (`show_previews`), quiet hours are honoured, and muted
conversations are skipped.

---

## 6. Google Play

- Create a Play Console account: <https://play.google.com/console/about/> — one-time
  registration fee **verify** on that page (historically US$25).
- New apps must be published as **AAB**, not APK
  (<https://support.google.com/googleplay/android-developer/answer/9844679>). This
  repository's SDK-free pipeline produces **APKs only**, suitable for direct install and
  internal testing. Producing an AAB requires a Gradle/AGP build with the Android SDK; the
  source tree is ready for that (`android/AndroidManifest.xml`, `MainActivity.java`,
  bundled web assets) but the AAB is **not built here**.
- You will also need: privacy policy URL, data-safety form, content rating questionnaire,
  target-API justification, and the account-deletion route (`/api/account` + the in-app
  "Delete my account" flow).
- Signing: see `release/BUILD_INFO.md`. The release key lives in `android/keystore/`
  (git-ignored). Back it up; losing it means a new package identity.

---

## 7. Hosting, domain and mailboxes

- Node **22+** (the backend uses the built-in `node:sqlite` module, currently experimental —
  expect the warning in the log).
- Persistent disk for `backend/riderise_lk.sqlite`; back up the file (and the `-wal`) on a
  schedule. SQLite is fine for a single small instance; move to Postgres before horizontal
  scaling.
- TLS termination via your host or a reverse proxy. Serve the app on one origin so the
  WebSocket/SSE and API calls stay same-origin.
- Create real mailboxes for `safety@`, `privacy@` and `support@shaundavidstudios.lk` — the
  Safety Centre, community rules and store listing point at them.
- Notifications carry in-app `#/...` deep links that the WebView resolves itself, so no base
  URL needs configuring. Keep the app on one HTTPS origin so the API and the SSE stream stay
  same-origin.
- Set **`JWT_SECRET`** (`openssl rand -hex 32`). The server refuses to start in production
  without it and never ships a default signing key.

---

## 8. Legal review and translations

- The safety notice, community guidelines, privacy policy and terms are **drafts**, marked
  "subject to legal review". Budget a Sri Lankan lawyer to review them (data protection,
  minors, consumer protection, online safety). No fee is quoted here.
- Sinhala and Tamil strings are architected (locale field, translation table) but the
  translations are not professionally reviewed. Budget a native reviewer for safety-critical
  wording — a mistranslated safety warning is a real-world risk.

---

## 9. Verifying a deployment

```bash
curl -s localhost:3000/api/health | python3 -m json.tool
curl -s localhost:3000/api/config | python3 -m json.tool | head -40
curl -s localhost:3000/api/map/config | python3 -m json.tool     # provider, configured, docs
curl -s localhost:3000/api/voice/ice | python3 -m json.tool      # iceServers or configured:false
```

Then sign in as the studio admin (`admin$123$` on a fresh database; production requires
`ADMIN_USERNAME`/`ADMIN_PASSWORD` alongside `JWT_SECRET`), open **Studio Console → Security**
and change the password before inviting real users. `npm run probe:admin` (against a
throwaway database) re-checks the credential's moderation and rider abilities.

---

## 10. What was never verified here

This workspace has no Android device, no emulator, no Firebase project, no TURN account and
no outbound access to tile servers. Therefore:

- No push notification was ever delivered to a device.
- No voice call or walkie-talkie transmission was carried between two physical devices; the
  signalling, floor arbitration and authorization paths were tested with an automated probe.
- Map tiles were only checked for URL construction and error handling; the sandbox cannot
  reach `tile.openstreetmap.org`.
- No Google ID token was verified against Google's live JWKS (the rejection path is tested).
- Play Console, AAB, and store review were not exercised.

Treat all of the above as integration work for your own environment, and use §9 to prove each
one before launch.
