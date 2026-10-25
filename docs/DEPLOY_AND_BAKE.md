# Deploy the server, then compile its address into the app

This is the end-to-end guide for your Enzonic panel
(`panel.enzonic.com/server/de0c86d1-…`), with your address `https://rideriselk.enzonic.dev`.
Follow it in order. Every step has a "you should see" line so you can tell it worked before
moving on.

> **Cannot get the panel to start?** `Insufficient node RAM capacity` is a host-capacity problem.
> [`FREE_HOSTING_OPTIONS.md`](FREE_HOSTING_OPTIONS.md) lists what actually runs this 24/7 for free
> (a free-forever VM + one setup script) and the options that silently lose data.

> **First time deploying anything?** Use
> [`SERVER_SETUP_WALKTHROUGH.md`](SERVER_SETUP_WALKTHROUGH.md) instead — same result, written as
> literal clicks and console commands for your panel.

The goal at the end:

- the backend runs on your panel, 24/7;
- it has a real `https://` address that a phone can reach;
- that address is **compiled into the APK**, so a rider installs, opens, lands on the welcome
  screen and registers — no URL to type.

---

## 0. The three addresses people mix up

The single most common delay is using the wrong one. They are not interchangeable.

| Address | Example | What it is | Used for |
|---|---|---|---|
| **Panel URL** | `https://panel.enzonic.com/server/de0c86d1-…` | the control panel page where you press Start, edit files, read the console | **you**, in a browser |
| **Server IP + port** | `203.0.113.40:25566` | the raw allocation the panel gave your server | debugging from a laptop only |
| **API address** | `https://api.riderise.lk` | a hostname that resolves to your server, with a valid certificate | **the app**, compiled in at build time |

The panel URL is never the API address, and a raw `IP:port` cannot be used either: the APK sets
`android:usesCleartextTraffic="false"` and runs its UI on the virtual origin
`https://appassets.androidplatform.net`, so a plain-HTTP call is blocked as mixed content.
That is a deliberate security setting. HTTPS is therefore not optional — §5 gives you three ways
to get it.

---

## 1. What to send me (the short answer sheet)

Copy this and fill in what is still blank:

```
1. Panel address/log in            : panel.enzonic.com/server/de0c86d1-…   (known)
2. Server's allocated IP + port    : ______ : ______      (panel → server → Network/Allocation)
3. Does the panel give an https://
   address/subdomain for that port? : yes → https://rideriselk.enzonic.dev   (known)
4. Do you own a domain (e.g.
   riderise.lk) and can you edit
   its DNS?                         : only needed if answer 3 stops working
5. Which Node version does the
   server run (panel → Startup)?    : 20 / 22 / 24  (must be 22.13 or newer)
```

Because answer 3 is a hostname Enzonic already routes, **Route A in §5 applies**: there is no
domain to buy and no tunnel to run. Everything else in this document still applies.

Answer 3 or 4 decides the route in §5. If you are not sure about 2 and 5, screenshot the
**Console** tab (first 20 lines after Start) and the **Startup** tab — both answers are visible
there.

---

## 2. Create the server (if you have not already)

1. Panel → **Deploy / New server** → pick the **`node.js generic`** egg (not Node.js *bot*,
   not a Minecraft egg).
2. **Region:** closest to Sri Lanka — take Bengaluru or Singapore if offered, otherwise Spain.
3. **Plan:** the free runtime tier is advertised as 512 MB RAM / 10 GB SSD and always-on; that
   is enough for this backend. A paid tier only matters if you outgrow it.
4. Create it and open **Console**. Note the line the panel prints with the allocation
   (an IP and a port) — this is your `SERVER_PORT`. The panel also sets `SERVER_PORT` as an
   environment variable, so you normally do not have to type it anywhere.
5. **Startup → Startup Command.** This repo has no `index.js`, so a default `node index.js`
   command will crash. Set it to:

   ```
   bash deploy/panel/start.sh
   ```

   `start.sh` (in this repo) reads the panel's port, loads `.env`, and optionally runs the
   Cloudflare tunnel alongside the API. If the field is not editable on your plan, set it from
   **Settings → Startup** or open a ticket with the host; you must be able to change the start
   command.

   The studio's Enzonic server uses a different egg layout — **Main File** (`backend/server.js`),
   **User Uploaded Files**, **Git Repository Address** and **Git Branch** instead of a free-form
   command. For that layout: keep Main File as `backend/server.js`, set **User Uploaded Files →
   Off** so the panel clones the repository, and put secrets in **+ Add Variable**. Full
   click-by-click: [`SERVER_SETUP_WALKTHROUGH.md`](SERVER_SETUP_WALKTHROUGH.md).

   Whichever layout you have, the server now reads the panel's `SERVER_PORT` when `PORT` is not
   set, and loads `.env` itself when the entry file is run directly — so neither a missing `PORT`
   variable nor a missing `--env-file` flag can leave it listening on the wrong port.

> **Node version matters.** `backend/server.js` uses the built-in `node:sqlite` module, which is
> only flag-free from **Node 22.13.0** (or 24). On Node 20 the server dies instantly with
> `ERR_UNKNOWN_BUILTIN_MODULE: No such built-in module: node:sqlite`. If the egg offers a Node
> version variable, choose **24** (or 22.13+). `start.sh` checks this before starting and tells
> you the same thing.

---

## 3. Put the code on the server

Two ways — either is fine.

**A. Git (fastest, easiest to update).** In the panel **Console**:

```bash
cd /home/container
git clone --depth 1 https://github.com/shaundavidkagenou-oss/RideRise-LK.git app
```

The repository is public, so no GitHub token is needed. Cloning into `app/` keeps the panel's own
files untouched; every path in this guide then becomes `/home/container/app/…`. To update later:
`cd /home/container/app && git pull`, then restart.

**B. Upload (no git).** On your computer, in the repo folder:

```bash
npm run bundle:server        # -> release/server/riderise-server.zip, about 3.6 MB
```

Then **Files → Upload** that ZIP into `/home/container` and, in the console:
`cd /home/container && unzip -o riderise-server.zip -d app`.
The bundle contains only what the server reads at runtime — no `tests/`, no `android/`, no
secrets (the script refuses to include `.env`, databases and keystores).

You do **not** need `npm install`: this app has zero runtime dependencies (everything is
Node built-ins). `android/`, `tests/` and `release/` are not needed on the server, but harmless.

---

## 4. Write `.env`

Create `/home/container/.env` with **Files → New file → `.env`**. Minimum viable file:

```ini
# --- server -------------------------------------------------------------
# Leave PORT unset. start.sh passes the panel's own allocation (SERVER_PORT) through;
# a hard-coded 3000 is a port nothing outside the container can reach.
#
# JWT_SECRET: 32+ characters. With NODE_ENV=production the server refuses to start
# without one. Generate it with:  openssl rand -hex 32
JWT_SECRET=
# optional; keeps the database inside the persistent server folder
DB_PATH=backend/riderise_lk.sqlite

# --- Firebase (the same project the app uses: rideriselk) ----------------
# Firebase console -> Project settings -> Your apps -> Web app
FIREBASE_PROJECT_ID=rideriselk
FIREBASE_API_KEY=
FIREBASE_AUTH_DOMAIN=rideriselk.firebaseapp.com
FIREBASE_APP_ID=
FIREBASE_MESSAGING_SENDER_ID=614966302540
FIREBASE_STORAGE_BUCKET=rideriselk.firebasestorage.app

# --- studio admin (12+ characters; there is no default password) ---------
ADMIN_USERNAME=studio-admin
ADMIN_PASSWORD=

# --- optional -----------------------------------------------------------
# behind the Cloudflare tunnel (5B); use 0 if you expose the port directly
TRUST_PROXY=1
# only if you bought a TURN relay for voice
# TURN_URLS=
```

Notes that save time later:

- `FIREBASE_PROJECT_ID` + `FIREBASE_API_KEY` are what enable **register/sign-in**. Without them
  every auth call fails closed with `FIREBASE_NOT_CONFIGURED`.
- `JWT_SECRET` must be set and stable — changing it signs every rider out. Set
  `NODE_ENV=production` once riders are on it: the server then refuses to start with a secret
  shorter than 32 characters instead of quietly accepting a weak one.
- Leave `PORT` out: the panel assigns the port and passes it as `SERVER_PORT`. A hard-coded
  `PORT=3000` produces a server the tunnel cannot reach (console: `listening on 0.0.0.0:3000`
  while your allocation is a different number).
- No secrets in the repo: `.env` stays in `/home/container` only (it is git-ignored already).
- If your panel has a **Variables/Environment** tab instead, you can put the same keys there —
  the server loads a `.env` only when it finds one, and **panel variables always win** over the
  file when both exist. Do not define a variable with an empty value: an empty string counts as
  "set" and suppresses the value from `.env`.

---

## 5. Give it an HTTPS address

Pick **one** route. Route B is the one I recommend for this panel, because a Pterodactyl-style
panel normally gives you an IP and a high port and nothing else — you cannot open 443 and you
cannot get a certificate for a bare IP.

### Route A — the panel already gives you a hostname (this is your case)

You have `https://rideriselk.enzonic.dev`, and the panel allocates **port 25941**
(`SERVER_PORT`). As long as Enzonic routes that subdomain to that port and terminates TLS (their
panel advertises automatic SSL), there is nothing to buy and nothing to configure — skip to §6
and use that address.

Verify it before trusting it: open `https://rideriselk.enzonic.dev/api/health` from the phone's
**mobile data** once the server is running (§4–§6). JSON back = Route A works. A 502 means the
proxy is fine but Node is not running. A page instead of JSON means the subdomain points
somewhere else — then use Route B.

### Route B — your own domain + Cloudflare Tunnel (recommended, free, no ports opened)

Requires: a domain you control (buying one is the only cost) and a free Cloudflare account.
Cloudflare terminates TLS at its edge, so the phone sees a real, trusted certificate; the
container only needs outbound internet.

1. **Cloudflare → Add a site** → your domain → Free plan → change the domain's **nameservers**
   at your registrar to the two Cloudflare gives you. Wait for "Active" (minutes to a few hours).
2. **Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared** → name it `riderise` →
   **Save**. It shows an install command containing a long token. Copy the token only.
3. **Public hostname → Add**:
   - Subdomain: `api`
   - Domain: `yourdomain.lk`
   - Service: `HTTP` → `localhost:<the panel port>` (e.g. `localhost:25566`)
   - Save. `https://api.yourdomain.lk` is now live and will point at your container.
4. Put the token in `.env` on the panel:

   ```ini
   CLOUDFLARE_TUNNEL_TOKEN=paste-the-token
   ```

5. Download the connector once, from the panel **Console**:

   ```bash
   curl -fsSL -o cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
   chmod +x cloudflared
   ```

6. Restart the server. `start.sh` runs the tunnel and the API together; the console shows the
   tunnel registering and `listening on 0.0.0.0:<port>`.
7. Set `TRUST_PROXY=1` so rate limiting sees the rider's real IP through the tunnel.

### Route C — a throwaway tunnel for a same-day test

Use this only to prove the app works end to end before your domain is ready:

```ini
CLOUDFLARE_QUICK_TUNNEL=1
```

with `cloudflared` downloaded as in B5. The console prints an
`https://something-random.trycloudflare.com` address. It is genuine HTTPS and works with the
APK — but **the address changes on every restart**, so do not ship an APK built with it. When
the app stops connecting, that is why.

### What does not work

| Attempt | Why it fails |
|---|---|
| `http://IP:PORT` | cleartext blocked by the APK + mixed content from `https://appassets.androidplatform.net` |
| `https://IP` | no certificate authority issues certificates for a bare IP |
| self-signed certificate | Android refuses the chain; the app reports a connection error |
| the panel URL | it is the control panel, not your server |
| a URL with a path (`…/api` or `…/server/…`) | the app appends `/api/...` to the host root |

---

## 6. Verify before you bake anything in

On your own computer, in the repo:

```bash
npm run verify:server -- --url https://api.yourdomain.lk
```

It calls the live server and checks the six things the first launch depends on:

```
✔ Address: https://api.yourdomain.lk (HTTPS, bare host)
✔ Certificate: issued by Let's Encrypt · valid until 2026-01-20 · 88 days left
✔ Server health: RideRise LK · phase 2 · lk.shaunstudios.riderise
✔ App origin allowed: https://appassets.androidplatform.net → *
✔ Accounts: email/password enabled · token verifier ok
✔ Web app: https://api.yourdomain.lk/ serves the app in a browser
```

Anything marked ✖ must be fixed before continuing. If it says "not ready", the app would still
install — it would simply land on a sign-in screen that can never connect, which is exactly what
we are trying to avoid.

While you are there, open `https://api.yourdomain.lk/api/health` on your phone's browser. If the
phone cannot load it, the app will not either (that rules out mobile-network DNS/firewall issues
early).

---

## 7. Compile the address into the app

```bash
npm run configure:apk -- --url https://api.yourdomain.lk   # writes config/deployment.config.json
npm run apk                                                # rebuilds the signed APKs
```

(`--bake` does the first step for you: `npm run verify:server -- --url … --bake`.)

What happens behind the scenes: the address becomes the Android string resource
`default_api_base`; the native bridge reports it through `RRAndroid.getApiBase()`; the web layer
only shows the "Connect your ride server" screen when there is no address at all. Result: a
fresh install opens on the welcome/sign-in screen and never asks a rider for a URL.

Riders can still override it later in **Settings → Server connection**, and **Use the built-in
server** there resets back to the compiled-in address.

Then check what you are shipping:

```bash
cd release/apk && sha256sum -c SHA256SUMS.txt && cd -
```

---

## 8. First run on a phone

1. Copy the APK to the phone (or `adb install -r release/apk/riderise-lk-phase2-release.apk`).
   If an older build with a different signing key is installed, uninstall it first
   (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`).
2. Open the app → you should see the splash badge, then **welcome + sign in**, no setup screen.
3. Register with an email and password. If you get `auth/unauthorized-domain`, add
   `appassets.androidplatform.net` in **Firebase → Authentication → Settings → Authorized
   domains** and retry. This is one-time and applies to every build.
4. Create a rider profile, then check Settings → Server connection: it shows the built-in
   address, not an empty field.

---

## 9. If something fails

| Symptom | Likely cause | Fix |
|---|---|---|
| Server stops instantly, console shows `ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite` | Node 20 / 22.5–22.12 | pick Node 24 (or 22.13+) in Startup, restart |
| Console: `listening on 0.0.0.0:3000` but the panel port is 25566 | `.env` sets `PORT` to the wrong value, or the server was started with `npm start` instead of `start.sh` | delete the `PORT` line; run `bash deploy/panel/start.sh` |
| `verify:server` → "answered HTTP 502" | Node is not running, or the tunnel points at the wrong port | check the console; fix the tunnel's public hostname port |
| `verify:server` → "served text/html, not JSON" | the tunnel/domain points at a web page, not the container | re-check the public hostname target |
| `verify:server` → "no Firebase credentials" | `.env` missing `FIREBASE_PROJECT_ID`/`FIREBASE_API_KEY`, or the file is not in `/home/container` | fix `.env`, restart |
| `verify:server` → "cannot reach Google" | outbound HTTPS blocked on the host | ask the host to allow `www.googleapis.com` |
| App opens but sign-in says "server cannot reach Google" | same as above | same |
| App shows "Connect your ride server" | the APK was built before the address was configured | `configure:apk` again, then `npm run apk` |
| Data disappears after a restart | SQLite written outside the persistent folder | keep `DB_PATH` inside `/home/container` |

---

## 10. What I will do once you send the answers

1. Run `verify:server` against the address and fix whatever it flags.
2. Write the address into `config/deployment.config.json`.
3. Rebuild both APKs, refresh `release/apk/SHA256SUMS.txt` and `release/BUILD_INFO.md`.
4. Hand you the exact file to install plus the size and checksum.

Until then the shipped APKs are the previous build (no built-in address) — they work, but a
rider has to paste a server URL once. That step disappears with the next build.
