# alwaysdata — you are signed in, now do this

Written for the point you are at: the account exists, you are looking at the panel. Every command
below is copy-paste. **Substitute `YOURNAME` with your alwaysdata account name** — the one you chose
at signup. Your site address will be `https://YOURNAME.alwaysdata.net`.

Two things to know before we start:

- **The panel is at `admin.alwaysdata.com`**, not the marketing site you signed up on.
- **Your PC is only needed for these 10 minutes.** After step 8 the site runs on their servers and
  you can switch it off.

---

## Step 1 — Set Node.js to 24 (1 min)

In the panel's left menu: **Environment** → **Node.js** → pick **24** → **Save**.

This matters: the backend uses Node's built-in SQLite, which only works fully from Node **22.13**.
Node 24 is what the app is tested on.

> If your menu shows **Languages** instead of **Environment**, it is the same page.

---

## Step 2 — Open a terminal on their server (1 min)

**Easiest — no terminal software:** go to **`https://ssh-YOURNAME.alwaysdata.net`** in your browser
and log in with your alwaysdata password. You get a shell in the browser.

**Or from your own PC:**

```bash
ssh YOURNAME@ssh-YOURNAME.alwaysdata.net
```

Type `yes` at the fingerprint question, then your password (the panel's password, not a new one).

Either way you should end up with a prompt like `YOURNAME@ssh1:~$`. You are now in
`/home/YOURNAME/`.

> Password rejected? The account password is set in the panel under **Profile / Settings**. Your
> SSH user is your account name, **without** a domain.

---

## Step 3 — Put the code there (2 min)

Copy-paste this **one line**:

```bash
git clone --depth 1 -b arena/127f733a-riderise-lk https://github.com/shaundavidkagenou-oss/RideRise-LK.git riderise
```

You should see `Cloning into 'riderise'...`, then the prompt returns.

**If `git` is not installed** (you get `git: command not found`), use this instead — it downloads the
same code as a 13 MB archive:

```bash
curl -L https://codeload.github.com/shaundavidkagenou-oss/RideRise-LK/tar.gz/refs/heads/arena/127f733a-riderise-lk -o rr.tar.gz && mkdir riderise && tar xzf rr.tar.gz -C riderise --strip-components=1 && rm rr.tar.gz
```

Check it landed:

```bash
cd riderise && ls
```

You should see `backend  config  web_app  deploy  docs  package.json  README.md`.

```bash
node -v
```

Must print `v24.…`. If it prints v18 or v20, go back to Step 1 — and **log out and back in**, because
an open SSH session keeps the old version.

---

## Step 4 — Create the settings file (3 min)

Still in `~/riderise`, paste this block exactly:

```bash
cat > .env <<'EOF'
JWT_SECRET=REPLACE_ME
FIREBASE_PROJECT_ID=rideriselk
FIREBASE_API_KEY=REPLACE_ME
FIREBASE_AUTH_DOMAIN=rideriselk.firebaseapp.com
FIREBASE_APP_ID=REPLACE_ME
FIREBASE_MESSAGING_SENDER_ID=614966302540
FIREBASE_STORAGE_BUCKET=rideriselk.firebasestorage.app
ADMIN_USERNAME=studio-admin
ADMIN_PASSWORD=REPLACE_ME
NODE_ENV=production
HOST=::
EOF
```

Now generate the session secret and put it in place (one command, no typing of random characters):

```bash
sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 32)|" .env && grep JWT_SECRET .env
```

The last line prints `JWT_SECRET=` followed by 64 characters. If it prints `REPLACE_ME`, `openssl` is
missing — use `head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'` and paste the result after
`JWT_SECRET=`.

Two values still say `REPLACE_ME` and you must fill them from the `.env` on **your own computer**:

| Line | Copy from your PC's `.env` |
|---|---|
| `FIREBASE_API_KEY=` | the `FIREBASE_API_KEY=` value |
| `FIREBASE_APP_ID=` | the `FIREBASE_APP_ID=` value (`1:614966302540:web:…`) |
| `ADMIN_PASSWORD=` | a password **you invent**, 12+ characters — the studio console login |

Edit with nano:

```bash
nano .env
```

Arrow to each line, delete `REPLACE_ME`, paste the value. **Ctrl+O**, **Enter**, **Ctrl+X** to save.

> **`HOST=::`** tells the app to accept connections from alwaysdata's proxy over IPv6. If the site
> later refuses to start with `EADDRNOTAVAIL`, delete that line and restart.

---

## Step 5 — Run it once by hand (1 min)

This catches every mistake (wrong Node, missing key, bad path) in the terminal instead of on the
website:

```bash
PORT=8100 node backend/server.js
```

You want to see, near the end:

```
[RideRise LK] Firebase Auth configured for project "rideriselk" (email/password).
RideRise LK by Shaun David Studios — Backend & App Server listening on http://[::]:8100
```

If **"Firebase Auth is NOT configured"** appears, `.env` was not read — check you are inside
`~/riderise` and that the file is named exactly `.env` (`ls -a`).

Press **Ctrl+C** to stop it. The database (`backend/riderise_lk.sqlite`) has now been created inside
that folder, which is the persistent part of your account.

---

## Step 6 — Create the website (3 min)

Panel → **Web** → **Sites**.

- **If a site already exists** for `YOURNAME.alwaysdata.net` (usually a *Static files* site pointing
  at `www/`), click its **gear / edit** icon — you will reuse it.
- **If there is none**, click **Add a site**.

Fill it in exactly like this:

| Field | Value |
|---|---|
| **Name** | `RideRise LK` |
| **Type** | **Node.js** |
| **Command** | `node /home/YOURNAME/riderise/backend/server.js` |
| **Working directory** | `/home/YOURNAME/riderise` |
| **Addresses** | `YOURNAME.alwaysdata.net` (add it if the field is empty) |
| **Node.js version** | **24** |
| **Environment** | leave empty |

Save. Then press the **restart** icon next to the site (circular arrow) so it picks up the new
configuration.

> If **Type** cannot be changed on the existing site, delete that site and add a new one of type
> **Node.js**. The address field must contain your `YOURNAME.alwaysdata.net` — if it says the address
> is taken, the old site still holds it.

Their proxy hands the app a `PORT` and forwards the public HTTPS traffic to it, so there is nothing
else to configure — no certificate, no ports, no firewall.

---

## Step 7 — Check it from outside (1 min)

On your **phone, on mobile data** (not Wi-Fi):

1. **`https://YOURNAME.alwaysdata.net/api/health`**
   → JSON starting `{"status":"ok","app":"RideRise LK",…`
   and containing `"firebaseAuth":true`.
2. **`https://YOURNAME.alwaysdata.net/`**
   → the app opens: splash, then the welcome screen.

That is the whole deployment. **You can turn your PC off now.**

---

## Step 8 — Put the address inside the APK

From your own computer, in the project folder:

```bash
npm run verify:server -- --url https://YOURNAME.alwaysdata.net
npm run configure:apk -- --url https://YOURNAME.alwaysdata.net
npm run apk
```

Install `release/apk/riderise-lk-phase2-release.apk` → welcome screen → register. No URL to type.

**Or just send me** `YOURNAME` (so the full address) and the JSON from `/api/health`, and I will do
these three steps and rebuild the signed APK for you.

---

## If it does not work

| What you see | Meaning | Fix |
|---|---|---|
| Site shows **502** / "Service unavailable" | the Node process is not running | **Web → Sites → your site → Logs**. The first lines name the cause — usually a missing `.env` or a path typo |
| Logs: `ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite` | Node older than 22.13 | Step 1 → Node 24 → **restart the site** |
| Logs: `Refusing to start: JWT_SECRET is required` | the secret line is empty or under 32 characters | re-run the `sed` line in Step 4, restart |
| Logs: `EADDRNOTAVAIL` | IPv6 not available on their proxy for your account | delete `HOST=::` from `.env`, restart |
| Logs: `Cannot find module '/home/…/backend/server.js'` | the code is not at that path | `ls ~/riderise/backend/server.js`; fix the Command and Working directory in Step 6 |
| `git: command not found` | no git on the server | use the tarball line in Step 3 |
| SSH password rejected | SSH user is the account name, not your email | user `YOURNAME`, host `ssh-YOURNAME.alwaysdata.net` |
| `node -v` still shows 20 in SSH | the session kept the old version | `exit`, reconnect |
| `/api/health` → `"firebaseAuth":false` | `.env` missing, misnamed, or not saved | `ls -a ~/riderise` must list `.env`; restart the site |
| Works, then 502 after a while | the process crashed | the Logs show why; the site restarts on save — send me the tail |
| Sign-in says "server cannot reach Google" | outbound HTTPS blocked from their network | rare; check Logs for `CERT_FETCH_FAILED` and tell me |

---

## Honest notes about the free plan

- 256 MB RAM / 1 GB disk / ¼ CPU — the app idles at ~60 MB, so this is comfortable. Do not host a
  second copy there.
- **"For personal needs"**: if a community actually depends on it and it grows, their Small plan
  (€5–6/month) removes the doubt and raises the disk. The app does not change.
- **Realtime messaging (SSE)** is the one thing to watch: if new messages only appear after a
  refresh, their front proxy is buffering the stream. Tell me and I will switch that one feature to
  polling — a small, contained change.
- Your address is `YOURNAME.alwaysdata.net`, not `rideriselk.lk`. That is fine: whatever address you
  end up with gets compiled into the APK, and changing it later is a rebuild, not a rewrite.
