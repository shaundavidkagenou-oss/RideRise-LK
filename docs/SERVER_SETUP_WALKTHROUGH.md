# Set up your server — click by click

Written for **your** panel, based on the Startup page you sent:

| | |
|---|---|
| Panel | `https://panel.enzonic.com/server/de0c86d1-acd2-473f-9091-97d4a1d97e5f` |
| Server | `RideRise-LK-Backend` · 512 MB RAM · 100% CPU |
| **Port** | **25941** |
| Address riders get | **`https://rideriselk.enzonic.dev`** |
| Code | `https://github.com/shaundavidkagenou-oss/RideRise-LK` (public — no token) |

Your Startup page already has the right file in **Main File**: `backend/server.js`. That means the
panel runs `node backend/server.js` directly — **not** `npm start`. Three consequences, and this
guide is built around them:

1. The **port** comes in as `SERVER_PORT=25941`, and the server now reads it automatically.
2. A **`.env` file is loaded by the server itself**, so it works either way — but the panel-native
   way is **+ Add Variable**, which is what the page in your screenshot is for.
3. The code has to end up at **`/home/container/backend/server.js`** — the main file path is
   relative to the server's root folder.

**Time:** about 10 minutes from here. Nothing to install on your computer.

---

## 1. What the panel already told us

From your Startup page:

- **SERVER_PORT = 25941** — the app must listen here. Nothing to type: the server reads it.
- **SERVER_IP = 0.0.0.0** — correct; it already listens on every interface.
- **Main File = `backend/server.js`** — correct, leave it.
- **Git Repository Address** + **Git Branch `arena/127f733a-riderise-lk`** — already filled in.
- **User Uploaded Files = On** — this is the only switch to change in step 2.
- **Additional Packages** — leave empty. This app has no npm dependencies.

---

## 2. Get the code onto the server (one switch, recommended)

**Route A — let the panel fetch it (easiest).**

1. On the Startup page, turn **User Uploaded Files → Off**.
   *The panel's own hint: "Set to 1 if uploading your application code manually." With it On,
   the panel skips the Git clone.*
2. Leave **Git Repository Address** as `https://github.com/shaundavidkagenou-oss/RideRise-LK`
   and **Git Branch** as `arena/127f733a-riderise-lk` (that branch has the latest code).
3. Save, then press **Start**. The console should show a `git clone` and then the app starting.

**Route B — upload it yourself (if the clone does not happen).**

1. On your computer, in the project folder: `npm run bundle:server`
   → `release/server/riderise-server.zip`, 3.6 MB, only what the server needs.
2. Panel → **Files** → upload that ZIP into `/home/container`.
3. Console: `cd /home/container && unzip -o riderise-server.zip && ls`
   You must see `backend  config  web_app  package.json`.

Either way, finish with a sanity check in the console:

```bash
ls /home/container/backend/server.js
```

It must print the path. If it says *No such file*, the code went to the wrong folder — the Main
File path is where the panel looks, so `backend/` has to sit at the root.

---

## 3. Add the settings (this is the page you are on)

Click **+ Add Variable** once per row. Names are case-sensitive; do not add empty ones (an empty
value counts as "set" and blanks out the real value).

| Variable name | Value | Where it comes from |
|---|---|---|
| `JWT_SECRET` | 64 random characters | generate: `openssl rand -hex 32`, or mash the keyboard — **must be 32+** |
| `FIREBASE_PROJECT_ID` | `rideriselk` | — |
| `FIREBASE_API_KEY` | your Firebase web API key | the `.env` on your computer, `FIREBASE_API_KEY=` |
| `FIREBASE_AUTH_DOMAIN` | `rideriselk.firebaseapp.com` | — |
| `FIREBASE_APP_ID` | `1:614966302540:web:…` | the `.env` on your computer, `FIREBASE_APP_ID=` |
| `FIREBASE_MESSAGING_SENDER_ID` | `614966302540` | — |
| `FIREBASE_STORAGE_BUCKET` | `rideriselk.firebasestorage.app` | — |
| `ADMIN_USERNAME` | `studio-admin` | your choice — this is the studio console login |
| `ADMIN_PASSWORD` | a password you invent, **12+ characters** | — |
| `TRUST_PROXY` | `1` | the panel's proxy sits in front of Node |

Optional, only if you want the database somewhere specific:

| `DB_PATH` | `/home/container/backend/riderise_lk.sqlite` | default is already inside the server folder, which persists and is backed up |

You do **not** need `PORT` — `SERVER_PORT` (25941) is picked up automatically.

> Prefer a file? A `.env` at `/home/container/.env` also works now (the server loads it on boot,
> and panel variables take priority). Use one or the other, not both with different values.

**Set `ADMIN_PASSWORD` before the first start.** Otherwise the server generates a random studio
password and shows it **once** in the console.

---

## 4. Start it and read the console

Press **Start**. A healthy boot ends with:

```
[RideRise LK] Studio console credential created
  username: studio-admin
  ...
[RideRise LK] Firebase Auth configured for project "rideriselk" (email/password).
RideRise LK by Shaun David Studios — Backend & App Server listening on http://0.0.0.0:25941
```

Read those three things:

1. **`listening on http://0.0.0.0:25941`** — the port must equal SERVER_PORT. If it says `:3000`,
   a `PORT` variable is overriding it; delete that variable and restart.
2. **`Firebase Auth configured for project "rideriselk"`** — otherwise riders cannot register.
3. The **username/password** block — if you did not set `ADMIN_PASSWORD`, copy that password now.
   It is never shown again.

If `git clone` failed or the file is missing, the console says
`Cannot find module '/home/container/backend/server.js'` — use Route B in step 2.

---

## 5. Check the front door

On your phone, on **mobile data** (not Wi-Fi — that proves it works from outside):

1. **`https://rideriselk.enzonic.dev/api/health`**
   → JSON starting `{"status":"ok","app":"RideRise LK",…`
   and `"capabilities":{"…","firebaseAuth":true,…}`.
2. **`https://rideriselk.enzonic.dev/`**
   → the app opens in the browser: splash, then the welcome sign-in screen.

That is the whole deployment. No certificate to install, no reverse proxy: Enzonic's proxy
terminates HTTPS for `rideriselk.enzonic.dev` and forwards to port 25941.

---

## 6. If it does not work

| What you see | Meaning | Fix |
|---|---|---|
| Console: `Cannot find module '/home/container/backend/server.js'` | code not at the root | Route B in step 2, or fix where the clone landed |
| Console: `ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite` | Node older than 22.13 | ask Enzonic to switch the server to Node 22.13+/24, or recreate it with a newer egg |
| Console: `listening on 0.0.0.0:3000` | a `PORT` variable is set | delete the `PORT` variable, restart |
| Console: `Refusing to start: JWT_SECRET is required in production` | `JWT_SECRET` missing or under 32 characters | add/fix the variable |
| Console: `Firebase Auth is NOT configured` | the six `FIREBASE_*` variables are missing or misspelled | re-add them exactly as in step 3, restart |
| `/api/health` → **502 Bad Gateway** | the panel's proxy is up, Node is not | read the console; press Start again |
| `/api/health` → a web page, not JSON | the subdomain points somewhere else | tell me; we move to a Cloudflare tunnel |
| `/api/health` → `"firebaseAuth":false` | Firebase variables not in the container | re-add them, restart, re-check |
| Sign-in later: "server cannot reach Google" | outbound HTTPS to Google blocked | ask Enzonic support to allow `www.googleapis.com` |
| Data gone after a restart | database outside the persistent folder | keep `DB_PATH` under `/home/container` |
| First start takes 1–3 minutes | the egg runs `npm install` when it sees `package.json` | harmless: it fetches test tooling the server never uses. The app itself has zero runtime dependencies |

---

## 7. If Start says **Insufficient node RAM capacity**

This one is not your configuration, and nothing in the app can cause or fix it. The message comes
from the host's scheduler *before* the container is created: the physical machine your server
sits on has no free memory to reserve the 512 MB the plan promises. Enzonic's own site says
provisioning "depends on available capacity", and the free runtime tier is exactly the one that
fills up first.

In order, what actually works:

1. **Press Start again in a few minutes.** Other free servers stop and capacity frees up. This is
   the most common fix.
2. **Ask support to start it on a node with capacity — or to lower the memory limit.** The app is
   not what needs 512 MB: measured on Node 22.22 with an empty database it sits at **60 MB RSS**
   (61 MB after a request), so 256 MB is plenty. Paste this into a ticket:
   > Server: RideRise-LK-Backend · UUID de0c86d1-acd2-473f-9091-97d4a1d97e5f · region …
   >
   > Clicking Start returns "Insufficient node RAM capacity". The plan allocates 512 MB
   > (SERVER_MEMORY=512). The workload is a Node.js API that idles at ~60 MB RSS. Could you start
   > it on a node with free capacity, or lower the memory limit to 256 MB and retry?
3. **Recreate the server in another region** (Spain ↔ United States, or Bengaluru/Singapore if
   listed). A new server is scheduled onto a different node; the free tier allows this.
4. **Do not buy extra RAM for this.** The bottleneck is the host's free capacity, not the app.
5. **Move to a free-forever VM instead.** Oracle Cloud Always Free gives you a real Ubuntu machine
   (2 × 1 GB AMD micro VMs, or 1 OCPU / 6 GB ARM) with 200 GB of disk and 10 TB of traffic, free
   with no capacity lottery. One script installs Node 24, the app, systemd and HTTPS:
   → [`FREE_HOSTING_OPTIONS.md`](FREE_HOSTING_OPTIONS.md) §2. It takes about 20 minutes and the
   address stops being shared with anyone else's free tier.

### Meanwhile: see the zero-setup app today

You already run the backend on your own computer, so you can put a temporary HTTPS address in
front of it and build a test APK, without waiting for the panel:

```bash
# terminal 1 - your server, exactly as now
npm start

# terminal 2 - a throwaway HTTPS address, no account needed
cloudflared tunnel --url http://localhost:3000     # prints https://<random>.trycloudflare.com
```

Then:

```bash
npm run verify:server -- --url https://<that-host>
npm run configure:apk -- --url https://<that-host>
npm run apk
```

The APK installs and goes straight to the sign-in screen. Two honest caveats: the address dies
when your computer sleeps or the tunnel restarts, and the next start gives a **new** random
address — so that build is for testing on your own phone, not for riders. Riders need an
always-on host with a stable address, which is the panel (or any small VPS) once it has capacity.

---

## 8. Then I make the app zero-setup

Send me:

1. a screenshot of the console after **Start** (the last ~20 lines), and
2. what `https://rideriselk.enzonic.dev/api/health` shows in the browser.

I run the readiness check against that address, compile it into
`config/deployment.config.json`, rebuild the signed APKs, and hand you the file to install.
After that: install → open → welcome screen → register. No URL to type.

You can also do it yourself, on your computer, in the project folder:

```bash
npm run verify:server -- --url https://rideriselk.enzonic.dev
npm run verify:server -- --url https://rideriselk.enzonic.dev --bake
npm run apk
```

---

## 9. Living with it

- **Restarts are safe.** `backend/riderise_lk.sqlite` lives inside the server folder; turn on the
  panel's **Backups**.
- **Updating the code:** with Route A, the panel re-clones/pulls on restart. With Route B,
  upload a new bundle, or `cd /home/container && git pull` if it is a git checkout. Variables are
  untouched either way.
- **The `.env` (if you used one) is never in Git.** The repo is public; your keys are not in it.
- **Riders install the APK**, not the web address — the address is baked into the build.
