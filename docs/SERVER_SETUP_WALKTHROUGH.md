# Set up your server — click by click

For this exact setup:

- Panel: `https://panel.enzonic.com/server/de0c86d1-acd2-473f-9091-97d4a1d97e5f`
- Address riders will use: **`https://rideriselk.enzonic.dev`**
- Code: `https://github.com/shaundavidkagenou-oss/RideRise-LK` (public — no GitHub token needed)

`rideriselk.enzonic.dev` is not an IP address and it is not the panel link: it is the **front door**
of your server. It is the address that gets compiled into the APK. Today it probably shows an
error or a holding page — that is expected until step 6.

**Time:** about 15 minutes. **What you need:** the panel open in one tab, and your own computer's
`.env` file (the one that already makes the app work locally) in another, because you will copy
four values out of it.

> Nothing here needs a credit card, a domain purchase, or a terminal on your computer. All the
> commands below are typed into the panel's **Console** tab.

---

## 1. Look at what the panel already gave you (2 minutes)

Open the panel link and you land on your server's page. Along the top or side you should see tabs
like **Console · Files · Startup · Network (or Allocation) · Backups · Schedules**.

Write down two things:

1. **The port.** In **Network** (sometimes called *Allocation* or *Ports*) there is a line like
   `203.0.113.40:25566`. The number after the colon is your port. If there is no Network tab,
   press **Start** once and the console prints it.
2. **A Domains / Subdomain tab, if one exists.** `rideriselk.enzonic.dev` has to point at that
   port somewhere. If the panel has a **Domains**, **Subdomain**, **Web address** or **SSL**
   section, check that `rideriselk` → `enzonic.dev` is listed there and attached to this server.
   − If it is → you are lucky, TLS is handled for you; continue.
   − If the tab exists but is empty → create the subdomain there (name: `rideriselk`).
   − If no such tab exists anywhere → do steps 2–7 anyway, then tell me; we will put a Cloudflare
     tunnel in front instead (free, one extra line in `.env`).

Also open **`https://rideriselk.enzonic.dev`** in a browser right now and note what you see:
an Enzonic "server offline" page, a 502/Bad Gateway, or something else. Any of those is fine —
it just tells us the subdomain is routed and waiting for your app.

---

## 2. Create the server (skip if you already have one)

1. Panel home → **New server** (or **Deploy**).
2. Software/egg: **`node.js generic`**. Not Minecraft, not "Node.js bot", not a database egg.
3. Plan: the free runtime tier (advertised as 512 MB RAM / 10 GB SSD, always-on) is enough.
   Region: the closest to Sri Lanka — **Bengaluru** or **Singapore** if offered, else Spain.
4. Create it and open its page. This is the server the rest of the steps happen on.

> **Node version.** This backend needs **Node 22.13 or newer** (Node 24 is ideal). If the
> **Startup** tab has a *Node.js version* variable, set it to 24. If it is stuck on Node 20 the
> server stops immediately with `ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite` — the fix is a new
> server with a newer egg, not a code change.

---

## 3. Put the code on the server (3 minutes)

Open the **Console** tab. Type this and press Enter:

```bash
cd /home/container
git clone --depth 1 https://github.com/shaundavidkagenou-oss/RideRise-LK.git app
```

You should see `Cloning into 'app'...` and then it returns to the prompt. Check it:

```bash
ls /home/container/app
```

You should see `backend  config  web_app  deploy  docs  package.json  README.md`.
There is **nothing to install** — this app has zero runtime dependencies.

*If `git` is not available or the clone fails*, use the ZIP route instead:

1. On your computer, in the repo folder: `npm run bundle:server`
   → creates `release/server/riderise-server.zip` (about 3.6 MB, only what the server needs).
2. Panel → **Files** → drag that file into `/home/container`.
3. Back in the **Console**: `cd /home/container && unzip -o riderise-server.zip -d app`
4. `ls /home/container/app` must show the same folders as above.

> Every path below uses `/home/container/app`. If you used a different folder name, substitute it.

---

## 4. Write the `.env` file (3 minutes)

Panel → **Files** → open the `app` folder → **New file** → name it `.env` → paste this and fill the
four blanks:

```ini
# --- server -------------------------------------------------------------
# Do not add PORT: start.sh passes the panel's own port through.
JWT_SECRET=PASTE_64_RANDOM_CHARACTERS
DB_PATH=/home/container/data/riderise.sqlite

# --- Firebase (project rideriselk) --------------------------------------
FIREBASE_PROJECT_ID=rideriselk
FIREBASE_API_KEY=
FIREBASE_AUTH_DOMAIN=rideriselk.firebaseapp.com
FIREBASE_APP_ID=
FIREBASE_MESSAGING_SENDER_ID=614966302540
FIREBASE_STORAGE_BUCKET=rideriselk.firebasestorage.app

# --- studio admin -------------------------------------------------------
ADMIN_USERNAME=studio-admin
ADMIN_PASSWORD=

# --- optional -----------------------------------------------------------
TRUST_PROXY=1
```

Where each blank comes from:

| Blank | Where to get it |
|---|---|
| `JWT_SECRET` | a long random string. Easiest: `openssl rand -hex 32` in the console, or mash the keyboard for 64 characters. Must be 32+ characters. |
| `FIREBASE_API_KEY` | the **same value** in the `.env` on your own computer (`FIREBASE_API_KEY=` there) |
| `FIREBASE_APP_ID` | the same `.env`, `FIREBASE_APP_ID=` (looks like `1:614966302540:web:abc…`) |
| `ADMIN_PASSWORD` | a password you invent, **12+ characters**, for the studio admin console |

Two things that save you a headache:

- **Write `.env` before the first start.** On first boot the server creates the studio admin
  account and prints a random password **once**. If you set `ADMIN_PASSWORD` first, it uses yours.
- **Keep `.env` out of Git.** It is already git-ignored; never paste it into chat or a screenshot.

Then open the **Files** tab, press **New folder**, and create `data` next to `app`
(`/home/container/data`) so the SQLite file has somewhere permanent to live.

---

## 5. Tell the panel *how* to start the app (1 minute)

Panel → **Startup** → the **Startup Command** field → replace whatever is there with:

```
bash /home/container/app/deploy/panel/start.sh
```

Save. (If the field is read-only on the free tier, open a ticket or look for a *Docker image /
command* setting — the panel must be able to run that command. Without it, the panel will keep
trying to run a file that does not exist.)

Why not just `npm start`? `start.sh` does three extra things: it uses the panel's own port,
loads `.env` even on older Node, and refuses to start on a Node version that cannot load the
database.

---

## 6. Start it and read the console (2 minutes)

Press **Start** and watch the **Console**. A healthy first boot looks like this (yours will differ
in the port number and the random password):

```
[auth migration] applied: users_private.firebase_uid, ...

======================================================================
[RideRise LK] Studio console credential created
  username: studio-admin
  password: -Str0ng-Random-One-Off-
  Printed once only. Store it in a password manager — it is not stored in plain text.
======================================================================

RideRise LK by Shaun David Studios — Backend & App Server listening on http://0.0.0.0:25566
```

**The last line is the one that matters.** `0.0.0.0` means it is listening on every interface;
the number must be the port from step 1.

- If it says `Firebase Auth is NOT configured`, `.env` was not found — check it is at
  `/home/container/app/.env` (not `/home/container/.env`) and that you pressed **Restart**.
- If the last line never appears, scroll up: the error above it is the cause (see §8).

Copy the printed password into a password manager if you did not set `ADMIN_PASSWORD`.

---

## 7. Check the front door (1 minute)

In a browser, on your phone's mobile data (not your Wi-Fi — that proves it works from outside):

1. **`https://rideriselk.enzonic.dev/api/health`** → must be JSON that starts like
   `{"status":"ok","app":"RideRise LK",…"capabilities":{"firebaseAuth":true,…}}`
   `"firebaseAuth":true` means riders can register. `false` means step 4 is incomplete.
2. **`https://rideriselk.enzonic.dev/`** → the app itself, in the browser, with the splash and the
   welcome screen. Same code the APK runs.

That is the whole deployment. Nothing else to install, no reverse proxy, no certificate.

---

## 8. If it does not work

| What you see | What it means | Do this |
|---|---|---|
| Console: `ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite` | Node is older than 22.13 | set Node 24 in **Startup**, restart; if the egg has no such option, create the server with a newer egg |
| Console: `listening on 0.0.0.0:3000` but your port is different | `.env` contains `PORT=`, or the panel ran `npm start` | remove the `PORT` line; make sure the startup command is `bash /home/container/app/deploy/panel/start.sh` |
| Console: `Cannot find module '/home/container/app/backend/server.js'` | the code is not where the command expects | `ls /home/container/app` and fix the path in the startup command |
| `/api/health` → **502 Bad Gateway** | the panel's proxy is up, the Node process is not | press Start, read the console (§6) |
| `/api/health` → a page, not JSON | the subdomain points at the wrong place | check the Domains tab (§1); if there is none, tell me and we use a tunnel |
| `/api/health` → works, `"firebaseAuth":false` | `.env` missing or misnamed | it must be `/home/container/app/.env`; restart after saving |
| `/api/health` → works but sign-in in the app says "server cannot reach Google" | the host blocks outbound HTTPS to Google | ask Enzonic support to allow `www.googleapis.com` outbound |
| Everything works, then dies after a restart | the database was written outside the persistent folder | keep `DB_PATH` under `/home/container` (step 4) |

---

## 9. Then it becomes a zero-setup app (what I do)

Once `/api/health` returns the JSON above, send me:

1. a screenshot of the console after **Start** (last 20 lines), and
2. the text that `https://rideriselk.enzonic.dev/api/health` shows in your browser.

I run the readiness check against `https://rideriselk.enzonic.dev`, compile it into
`config/deployment.config.json`, rebuild the signed APKs, and hand you the file to install.
From then on: install → open → welcome screen → register. No URL to type, ever.

If you want to see the check yourself first, on your own computer in the repo:

```bash
npm run verify:server -- --url https://rideriselk.enzonic.dev
npm run verify:server -- --url https://rideriselk.enzonic.dev --bake   # writes it in
npm run apk                                                             # rebuilds the APKs
```

---

## 10. Living with it

- **Restarts are safe.** The database lives in `/home/container/data` and survives restarts and
  the panel's backup system. Turn **Backups** on in the panel.
- **Updating the app** — in the console:

  ```bash
  cd /home/container/app && git pull
  ```

  then press **Restart**. `.env` is untouched because it is not in Git.
- **Riders install the APK you send them**, not the web address — the address is baked in, so it
  can change later only by shipping a new APK (or via *Settings → Server connection*).
- **Keep the panel password and `.env` private.** The repo is public; your secrets are not in it.
