# Yes — run it free with no credit card (alwaysdata)

**alwaysdata** is a French host with a free plan that has what this app needs: Node.js **24**,
a **real persistent disk** for the SQLite database, **free HTTPS**, SSH access, and **no credit
card, no time limit**. Your PC stays off. Everything runs on their servers.

You get an address like **`https://yourname.alwaysdata.net`** — free Let's Encrypt certificate
included. Nothing to buy, nothing to install on a machine of your own, no VM to patch.

| | alwaysdata Free |
|---|---|
| Cost | 0 €, no card |
| RAM / CPU | 256 MB / ¼ core — the app uses ~60 MB |
| Disk | 1 GB — the app is 5 MB + the database |
| Node | **24.x** (we need 22.13+) |
| HTTPS | free, automatic |
| Address | `yourname.alwaysdata.net` |
| Sleeps? | no |
| Time limit | none ("for personal needs, ad-free offer available for life") |

---

## Before you start (1 min)

Have the `.env` from your own computer open in a text editor. You need two values from it:
`FIREBASE_API_KEY` and `FIREBASE_APP_ID`.

---

## Step 1 — Create the account (3 min)

1. Go to **alwaysdata.com** → **Sign up** / *Create an account*.
2. Product: **Free Public Cloud** (0 €).
3. **Account name: `rideriselk`** — this becomes your address: `rideriselk.alwaysdata.net`.
   Choose carefully: it is the name riders' phones will talk to.
4. Your real email and country, accept the terms, submit.
5. Confirm your email, then sign in at **admin.alwaysdata.com**.

> Name already taken? Pick another, e.g. `rideriselk-lk` — that becomes
> `rideriselk-lk.alwaysdata.net`. Everything below works the same.

---

## Step 2 — Set the Node version to 24 (1 min)

In the admin panel: **Environment** (left sidebar) → **Node.js** → choose **24** → *Save*.

That is the whole "server configuration" step. This app needs 22.13 or newer because it uses the
built-in `node:sqlite` module.

---

## Step 3 — Put the code on their server (5 min)

The admin panel gives you SSH at `ssh rideriselk@ssh-rideriselk.alwaysdata.net`.

**Open a terminal** (Windows: PowerShell; Mac: Terminal) and paste:

```bash
ssh rideriselk@ssh-rideriselk.alwaysdata.net
```

Accept the fingerprint (`yes`), enter your panel password. You are now on their server, inside
your home directory. Then:

```bash
git clone --depth 1 -b arena/127f733a-riderise-lk \
  https://github.com/shaundavidkagenou-oss/RideRise-LK.git riderise
```

```bash
cd riderise && ls
```

You must see `backend  config  web_app  deploy  docs  package.json`.

*No SSH access on your plan, or `git` not available?* On your own computer run
`npm run bundle:server` (creates a 3.6 MB ZIP), upload it with the panel's **SFTP / WebDAV**
credentials, then over SSH: `unzip -o riderise-server.zip -d riderise`.

---

## Step 4 — Write the settings (3 min)

Still in SSH, inside the `riderise` folder:

```bash
cat > .env <<'EOF'
JWT_SECRET=REPLACE_WITH_64_RANDOM_CHARACTERS
FIREBASE_PROJECT_ID=rideriselk
FIREBASE_API_KEY=REPLACE_ME
FIREBASE_AUTH_DOMAIN=rideriselk.firebaseapp.com
FIREBASE_APP_ID=REPLACE_ME
FIREBASE_MESSAGING_SENDER_ID=614966302540
FIREBASE_STORAGE_BUCKET=rideriselk.firebasestorage.app
ADMIN_USERNAME=studio-admin
ADMIN_PASSWORD=REPLACE_WITH_12_PLUS_CHARACTERS
DB_PATH=/home/rideriselk/riderise/backend/riderise_lk.sqlite
NODE_ENV=production
EOF
```

Now fill in the three `REPLACE_…` values with `nano .env` (Ctrl+O, Enter, Ctrl+X to save):

- `JWT_SECRET` — generate one: type `openssl rand -hex 32` at the prompt, copy the 64 characters.
- `FIREBASE_API_KEY` and `FIREBASE_APP_ID` — from the `.env` on your own computer.
- `ADMIN_PASSWORD` — the studio console password you choose.

---

## Step 5 — Create the website (3 min)

In the admin panel: **Web → Sites → Add a site**.

| Field | Value |
|---|---|
| **Name** | `RideRise LK` |
| **Type** | **Node.js** |
| **Command** | `node backend/server.js` |
| **Working directory** | `/home/rideriselk/riderise` |
| **Addresses** | `rideriselk.alwaysdata.net` |
| **Node.js version** | 24 |
| **Environment** | leave empty — the app reads `.env` itself |

Save. Then press the **restart** icon next to the site (the circular arrow).

Their proxy gives the process a `PORT` and forwards the public HTTPS traffic to it — this is
exactly what the app expects, so nothing else to configure.

---

## Step 6 — Check it (1 min)

Open in a browser, **on your phone's mobile data**:

1. **`https://rideriselk.alwaysdata.net/api/health`**
   → JSON with `"app":"RideRise LK"` and `"firebaseAuth":true`.
2. **`https://rideriselk.alwaysdata.net/`**
   → the app itself, splash then the welcome screen.

If the JSON says `"firebaseAuth":false`, the `.env` was not read: check it sits inside
`riderise/` and that you restarted the site.

**Your PC can now be switched off.** The site runs in their data centre.

---

## Step 7 — Put that address in the app

From your own computer, in the repo:

```bash
npm run verify:server -- --url https://rideriselk.alwaysdata.net
npm run configure:apk -- --url https://rideriselk.alwaysdata.net
npm run apk
```

Install `release/apk/riderise-lk-phase2-release.apk` → welcome screen → register. No URL to type.
(Or send me the hostname and the health JSON and I do this part.)

---

## If something does not work

| What you see | Meaning | Fix |
|---|---|---|
| Site shows "502" / "Service unavailable" | the Node process is not running | Web → Sites → your site → **Logs**; usually a missing `.env` or a crash on start |
| Logs: `ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite` | Node version too old | Environment → Node.js → **24**, then restart the site |
| Logs: `Refusing to start: JWT_SECRET…` | secret missing or under 32 characters | fix `.env`, restart |
| Logs: `EACCES` on the database file | `DB_PATH` outside your home | use the path in step 4 (`/home/<account>/…`) |
| `/api/health` works, app blank | cached old page | hard-refresh, or check **Logs** for a 404 on a JS file |
| `firebaseAuth:false` | `.env` not found | it must be inside the `riderise` folder; restart |
| Sign-in says "server cannot reach Google" | outbound HTTPS blocked | rare on alwaysdata; check **Logs** for `CERT_FETCH_FAILED` |
| Live messaging lags or does not update | their front proxy may buffer the realtime stream | everything else still works; report it and I will switch the client to polling |

---

## Honest limits of this option

- **Free plan is for personal use.** For a community you run, that is a grey area — read their
  terms. If riders depend on it and it grows, €5–6/month for their Small plan removes the doubt
  and the 1 GB disk.
- **256 MB RAM / 1 GB disk.** Fine for this app (60 MB, 5 MB + database), but do not also run a
  second copy there.
- **Realtime (SSE) is the one thing to test.** The app falls back gracefully, but if messages feel
  slow through their proxy, tell me — a polling switch is a small change.
- **The free address is `.alwaysdata.net`**, not `rideriselk.lk`. A custom domain needs their paid
  plan (or any other host). The APK does not care: whatever address you end up with gets compiled
  in, and changing it later is one rebuild.

---

## Other no-card options, ranked

1. **alwaysdata free** — the one to try first: no card, Node 24, persistent disk, HTTPS.
2. **Retry Enzonic** — still configured, still free, still no card. Capacity returns.
3. **Azure for Students** — real VM, $100 credit, **no card**, 18+ with a school email. Expires
   after 12 months; `deploy/vm/setup.sh` works there unchanged.
4. **Oracle Cloud** — the best free tier long-term, but wants a card for identity checks.
5. **Cloudflare quick tunnel from your PC** — free, instant, but the PC must stay on: testing only.

What is **not** available: a free host with no card that also gives you a full VM, a custom
domain, and no personal-use caveat.
