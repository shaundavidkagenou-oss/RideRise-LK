# alwaysdata — you are signed in, now do this

Written for the point you are at: the account exists, you are looking at the panel. Every command
below is copy-paste. **Substitute `YOURNAME` with your alwaysdata account name** — the one you chose
at signup. Your site address will be `https://YOURNAME.alwaysdata.net`.

> **Your account is `riseriselk`, so your address is `https://riseriselk.alwaysdata.net`.**
> (Spelled r-i-s-e-r-i-s-e-l-k, exactly as in your SSH prompt. Fine as it is — the app does not care
> what the address is called, and changing it later is a rebuild, not a rename.)

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

> **The error you got** (`Cannot find module '/home/riseriselk/backend/server.js'`) means one thing:
> the command was run in your home folder instead of the folder the code is in. Node looked for
> `/home/riseriselk/backend/server.js`, and there is nothing there. It is not a bug in the app.

Every command from here starts with the same two words, so this cannot happen again:

```bash
cd ~/riderise
```

- If it answers `No such file or directory`, the code was never downloaded — run the clone below.
- If it works, your prompt changes to `~/riderise` (or you can check with `pwd`, which prints
  `/home/riseriselk/riderise`).

Copy-paste this **one line** to get the code:

```bash
git clone --depth 1 -b arena/127f733a-riderise-lk https://github.com/shaundavidkagenou-oss/RideRise-LK.git riderise
```

You should see `Cloning into 'riderise'...`, then the prompt returns.

**If `git` is not installed** (you get `git: command not found`), use this instead — it downloads the
same code as a 13 MB archive:

```bash
curl -L https://codeload.github.com/shaundavidkagenou-oss/RideRise-LK/tar.gz/refs/heads/arena/127f733a-riderise-lk -o rr.tar.gz && mkdir riderise && tar xzf rr.tar.gz -C riderise --strip-components=1 && rm rr.tar.gz
```

Check it landed (this exact command, from anywhere):

```bash
cd ~/riderise && pwd && ls
```

You must see `/home/riseriselk/riderise` and then `backend  config  web_app  deploy  docs
package.json  README.md`. If `pwd` prints something else, the `cd` failed and you are in the wrong
folder — do not continue until it prints `/home/riseriselk/riderise`.

```bash
node -v
```

Must print `v24.…`. If it prints v18 or v20, go back to Step 1 — and **log out and back in**, because
an open SSH session keeps the old version.

---

## Step 4 — Create the settings file (2 min, three questions)

No file editor, no typing of secrets. There is a helper in the repo that asks for the three values
it cannot know and writes everything else:

```bash
cd ~/riderise && node scripts/setup_env.js
```

It asks three things. Have the `.env` from **your own computer** open so you can copy two of them:

1. **Firebase web API key** — starts with `AIza…`. This is `FIREBASE_API_KEY` from your PC's `.env`
   (or Firebase console → Project settings → Your apps → Web app).
   It checks the format and asks again if it looks wrong.
2. **Firebase app id** — looks like `1:614966302540:web:abc123…`. This is `FIREBASE_APP_ID` from
   your PC's `.env`.
3. **Studio admin password** — 12+ characters, for the studio console. Press **Enter** to skip and
   the server will generate one and print it once in the logs.

It then writes `.env` with a **randomly generated 64-character session secret**, the project id,
auth domain, sender id and storage bucket already filled in, `NODE_ENV=production`, and `HOST=::`
(alwaysdata's proxy connects over IPv6). The file is created private (mode 600) and is never
committed to Git.

What you should see at the end:

```
✔ Wrote /home/riseriselk/riderise/.env

  session secret   a1b2************9f0e (64 characters, generated)
  Firebase key     AIza************Qm7k
  Firebase app id  1:614966302540:web:abc123
  admin password   (empty — the server prints a generated one once)
```

Run it again later to change a value — it keeps the existing session secret (so riders stay signed
in) and saves the previous file as `.env.bak`. Check what is configured without exposing secrets:

```bash
cd ~/riderise && node scripts/setup_env.js --show
```

> Prefer to edit by hand? The file is plain `KEY=value` (`nano ~/riderise/.env`). The only rules:
> `JWT_SECRET` must be 32+ characters, and **do not set `PORT`** — the host assigns it.

---

## Step 5 — Prove it works (1 min)

One command checks everything and then actually starts the server and asks it for `/api/health`:

```bash
cd ~/riderise && node scripts/doctor.js
```

You want every line ticked and the last line to say **All good**:

```
  ✔ Node.js: v24.22.1
  ✔ Built-in SQLite: available
  ✔ File: backend/server.js
  ✔ File: backend/schema.sql
  ✔ File: config/brand.config.json
  ✔ File: web_app/index.html
  ✔ .env: /home/riseriselk/riderise/.env
  ✔ Firebase API key: set
  ✔ Firebase app id: 1:614966302540:web:abc123
  ✔ Session secret: 64 characters
  ✔ Firebase project id: rideriselk
  ✔ Server boots: listening on port 41231
  ✔ Answers /api/health: RideRise LK · phase 2
  ✔ Sign-in configured: email/password enabled

✔ All good. This server is ready.
```

Anything marked ✖ prints the fix next to it — for example `✖ .env: missing — run: node
scripts/setup_env.js`. Fix that one thing and run it again.

(This also proves the app starts on the server's own copy of Node, not just on your PC.)

The database file `~/riderise/backend/riderise_lk.sqlite` has now been created. That folder is the
**persistent** part of your account (1 GB), so riders, posts and messages survive restarts,
redeploys and the panel's daily backups. Do not move it outside `/home/riseriselk`.

> Want to watch it run by hand instead? `cd ~/riderise && PORT=8100 node backend/server.js`, look
> for `listening on http://[::]:8100`, then press Ctrl+C.

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
| **Command** | `node /home/riseriselk/riderise/backend/server.js` |
| **Working directory** | `/home/riseriselk/riderise` |
| **Addresses** | `riseriselk.alwaysdata.net` (add it if the field is empty) |
| **Node.js version** | **24** |
| **Environment** | leave empty |

Save. Then press the **restart** icon next to the site (circular arrow) so it picks up the new
configuration.

> If **Type** cannot be changed on the existing site, delete that site and add a new one of type
> **Node.js**. The address field must contain your `riseriselk.alwaysdata.net` — if it says the address
> is taken, the old site still holds it.

Their proxy hands the app a `PORT` and forwards the public HTTPS traffic to it, so there is nothing
else to configure — no certificate, no ports, no firewall.

---

## Step 7 — Check it from outside (1 min)

On your **phone, on mobile data** (not Wi-Fi):

1. **`https://riseriselk.alwaysdata.net/api/health`**
   → JSON starting `{"status":"ok","app":"RideRise LK",…`
   and containing `"firebaseAuth":true`.
2. **`https://riseriselk.alwaysdata.net/`**
   → the app opens: splash, then the welcome screen.

That is the whole deployment. **You can turn your PC off now.**

---

## Step 8 — Put the address inside the APK

From your own computer, in the project folder:

```bash
npm run verify:server -- --url https://riseriselk.alwaysdata.net
npm run configure:apk -- --url https://riseriselk.alwaysdata.net
npm run apk
```

Install `release/apk/riderise-lk-phase2-release.apk` → welcome screen → register. No URL to type.

**Or just send me** the address and the JSON from `/api/health`, and I will do
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
| `Cannot find module '/home/riseriselk/backend/server.js'` | the command ran in the home folder, not the app folder | `cd ~/riderise` first — every command starts there |
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
