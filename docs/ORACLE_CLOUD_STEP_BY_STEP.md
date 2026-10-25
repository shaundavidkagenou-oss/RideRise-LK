# Oracle Cloud, step by step (no PC left running)

## The answer to your question first

**Your computer does not stay on.** The server lives in Oracle's data centre in Mumbai or
Singapore, next to the internet. Once it is set up, you can shut your laptop, put it in a drawer,
and riders still connect. Your PC is needed only for the setup itself, and later for two minutes
if we rebuild the app.

| | Needs your PC? |
|---|---|
| Running the server, 24/7 | **No** — it runs in Oracle's data centre |
| Riders signing in, posting, messaging | **No** |
| Keeping the address and HTTPS certificate alive | **No** — Caddy renews automatically |
| Creating the VM and installing the app (once, ~25 min) | Yes |
| Rebuilding the APK (2 min, and I can do it for you) | Only if you do it yourself |

Nothing runs on your computer. No tunnel, no terminal left open, no "keep this window running".

---

## What you will have at the end

- A real Ubuntu machine at, say, `152.x.x.x`, always on, free forever.
- A free name: **`rideriselk.duckdns.org`** (no domain to buy).
- **`https://rideriselk.duckdns.org/api/health`** answering JSON.
- An APK that opens straight on the sign-in screen.

Total time: about 25 minutes. You need: a card (verification only), your phone, and this repo.

---

## Step 1 — Make the account (10 min)

1. Go to **oracle.com/cloud/free** → **Start for free**.
2. Enter your **real name, real address, real email**. They must match the card; anything else
   gets rejected automatically.
3. **Do not use a VPN.** Oracle blocks signups coming through proxies and VPNs.
4. Account type: **Individual**.
5. **Home region: pick `ap-mumbai-1 (Mumbai)` or `ap-singapore-1 (Singapore)`.**
   This is the one choice you cannot change later. Closest to Sri Lanka = fastest app.
6. Verify your phone by SMS, then add the card. Oracle places a ~$1 hold and cancels it. Always
   Free resources are not billed; you would only pay if you deliberately upgraded later.
7. Wait for the "your account is ready" email or the console to load.

**If the signup is rejected:** wait a day, use the same real details, try again from your normal
home/mobile connection. Repeat attempts in one session make it worse.

---

## Step 2 — Create the machine (7 min)

In the Oracle console: **menu (☰) → Compute → Instances → Create instance**.

| Field | What to choose |
|---|---|
| **Name** | `riderise` |
| **Image** | **Canonical Ubuntu 24.04** (the x86_64 one — *not* aarch64) |
| **Shape** | **AMD** tab → **`VM.Standard.E2.1.Micro`** — check it says **Always Free-eligible** |
| **Boot volume** | leave the default (50 GB; the free allowance is 200 GB) |
| **Primary VNIC** | leave the default VCN/subnet |
| **Public IPv4 address** | **Assign a public IPv4 address** — make sure this is ticked |
| **SSH keys** | **Generate a key pair** → **download the private key** (you cannot get it later) |

> **Why AMD and not the bigger ARM machine?** The ARM shape (Ampere A1) sounds better — 2 cores,
> 12 GB — but Oracle's free ARM capacity has been effectively unavailable for years; people run
> scripts for weeks and never get one. The AMD micro is *not* capacity-limited, and it is also
> exempt from the "idle instance reclamation" rule that applies to ARM. 1 GB of RAM is plenty
> here: the server uses about 60 MB, and the setup script adds 2 GB of swap for safety.

Press **Create**. Wait until the state is **Running** (1–2 minutes), then copy the
**Public IP address** from the instance page. Write it down — you need it twice.

---

## Step 3 — Open two doors (2 min)

Oracle blocks all incoming traffic by default. Two places, but the first one is the blocker:

1. **☰ → Networking → Virtual Cloud Networks →** your VCN → **Security Lists** →
   **Default Security List** → **Add Ingress Rules**, twice:

   | Source Type | Source CIDR | IP Protocol | Destination Port |
   |---|---|---|---|
   | CIDR | `0.0.0.0/0` | TCP | `80` |
   | CIDR | `0.0.0.0/0` | TCP | `443` |

2. The machine's own firewall (Ubuntu ships locked down on Oracle). **You do not do this by
   hand** — the install script in step 6 fixes it.

---

## Step 4 — Get a free name (3 min)

Your app needs `https://` with a certificate, and certificates go to names, not IP addresses.

1. Go to **duckdns.org** → sign in with Google or GitHub (no new password).
2. In the box type `rideriselk` → **add domain**.
3. In the `current ip` box, paste your VM's **public IP** → **update ip**.
4. You now own **`rideriselk.duckdns.org`**.

Check it from your PC (PowerShell or Terminal):

```powershell
nslookup rideriselk.duckdns.org
```

It must print your VM's IP. If it prints something else, wait a minute and try again.

> If DuckDNS is ever slow, `https://<your-ip>.sslip.io` works instantly with no account — but the
> name changes if Oracle ever reassigns your IP. Stick with DuckDNS.
>
> **If the VM's IP ever changes** (only after you stop and restart the instance), DuckDNS has one
> click: sign in, paste the new IP, update. Nothing else to change.

---

## Step 5 — Connect to the machine (2 min)

On **Windows**: press Start, type `powershell`, open **Windows PowerShell**.
On **Mac**: open **Terminal**. Both already have `ssh`.

Assume the key downloaded as `C:\Users\<you>\Downloads\ssh-key-2026-10-25.key` (Windows) or
`~/Downloads/ssh-key-2026-10-25.key` (Mac).

**Mac/Linux:**

```bash
chmod 600 ~/Downloads/ssh-key-*.key
ssh -i ~/Downloads/ssh-key-*.key ubuntu@<YOUR-PUBLIC-IP>
```

**Windows PowerShell:**

```powershell
icacls "$env:USERPROFILE\Downloads\ssh-key-2026-10-25.key" /inheritance:r /grant:r "$($env:USERNAME):(R)"
ssh -i "$env:USERPROFILE\Downloads\ssh-key-2026-10-25.key" ubuntu@<YOUR-PUBLIC-IP>
```

First time it asks *"Are you sure you want to continue connecting?"* → type `yes`, Enter.
You are in when the prompt becomes `ubuntu@riderise:~$`.

---

## Step 6 — Install everything (5 min, one command block)

Type these three commands on the VM (copy-paste, one at a time):

```bash
sudo apt-get update && sudo apt-get install -y git
```

```bash
sudo git clone --depth 1 -b arena/127f733a-riderise-lk https://github.com/shaundavidkagenou-oss/RideRise-LK.git /srv/riderise
```

```bash
sudo bash /srv/riderise/deploy/vm/setup.sh rideriselk.duckdns.org
```

The third one takes a few minutes and prints its progress. It installs Node 24, runs the app as a
locked-down service, installs Caddy for HTTPS, opens the machine's firewall (and saves those rules
so they survive reboots), generates your session secret, and finishes with a health check. You
should end with:

```
Done.
2. Certificate: Caddy issues it on first request. Check:
     curl -s https://rideriselk.duckdns.org/api/health
```

A yellow `!` line about `FIREBASE_API_KEY` is expected at this stage — that is step 7.

---

## Step 7 — Add the two Firebase values (3 min)

The install script already generated your `JWT_SECRET` and pre-filled everything except two
values. You only need these, copied from the `.env` on your own computer:

```bash
sudo nano /srv/riderise/.env
```

```ini
FIREBASE_API_KEY=<copy from your local .env>
FIREBASE_APP_ID=<copy from your local .env, looks like 1:614966302540:web:...>
```

Optional: `ADMIN_PASSWORD=` — the studio console password. Leave it empty and the server prints a
random one **once** in the logs (`sudo journalctl -u riderise -n 30`); set it now to choose your own
(12+ characters).

Everything else (`JWT_SECRET`, `FIREBASE_PROJECT_ID`, `FIREBASE_AUTH_DOMAIN`,
`FIREBASE_MESSAGING_SENDER_ID`, `FIREBASE_STORAGE_BUCKET`, `DB_PATH`) is already filled in.

Save in nano: **Ctrl+O**, then **Enter**, then **Ctrl+X**. Then:

```bash
sudo systemctl restart riderise
```

---

## Step 8 — Test it (1 min)

In your phone's browser, on **mobile data** (not Wi-Fi):

**`https://rideriselk.duckdns.org/api/health`**

You want JSON that includes `"firebaseAuth":true`. And
**`https://rideriselk.duckdns.org/`** should show RideRise LK with the welcome screen.

If the first visit says *"Connection is not private"* for a few seconds: Caddy is still getting the
certificate. Reload once. If it persists, see the table below.

**That's it — you can close the SSH window and turn your PC off.** The machine keeps running.

---

## Step 9 — Put the address inside the app

Two options, both fine:

**A. I do it (recommended).** Send me: the hostname (`rideriselk.duckdns.org`) and the JSON your
health check returned. I write it into `config/deployment.config.json`, rebuild the signed APKs in
the project, and hand you the file. Your PC does not need to be on for this — but I cannot reach
your server from my environment, so the working proof comes from your phone/PC step 8.

**B. You do it.** On your own computer, in the project folder:

```powershell
npm run verify:server -- --url https://rideriselk.duckdns.org
npm run configure:apk -- --url https://rideriselk.duckdns.org
npm run apk
```

Then install `release/apk/riderise-lk-phase2-release.apk`. It opens on the welcome screen; no URL
to type.

---

## Step 10 — Living with it

| Task | Where | Command / click |
|---|---|---|
| Is it running? | browser | `https://rideriselk.duckdns.org/api/health` |
| See the logs | SSH | `sudo journalctl -u riderise -f` |
| Restart the app | SSH | `sudo systemctl restart riderise` |
| Update to the latest code | SSH | `sudo bash /srv/riderise/deploy/vm/setup.sh rideriselk.duckdns.org` |
| Back up the database | SSH | `sudo cp /srv/riderise/backend/riderise_lk.sqlite* ~/` then `scp` it to your PC |
| Stop / start the machine | Oracle console | Instance → **Stop** / **Start** (public IP stays) |
| Change the name | DuckDNS + SSH | new name in DuckDNS, then edit `/etc/caddy/Caddyfile` and `sudo systemctl reload caddy` |

The VM restarts the app by itself if it ever crashes, and both the app and Caddy start again after
a reboot. You do not have to log in.

---

## If something goes wrong

| What you see | Cause | Fix |
|---|---|---|
| Signup rejected | details don't match card, or VPN | same real details, no VPN, try next day |
| "Out of host capacity" | you picked the **ARM** shape | go back and pick **AMD → VM.Standard.E2.1.Micro** |
| No public IP shown | "Assign public IPv4" was unticked | Instance → Attached VNICs → edit, assign one (or rebuild the instance) |
| `Permissions are too open` / `unprotected private key` | the key file is readable by others | run the `chmod` / `icacls` line in step 5 |
| Browser says the site can't be reached | ports 80/443 not open in the **VCN security list** | step 3 (the OS side is handled by the script) |
| `curl` works on the VM but not from outside | same as above | same |
| Certificate error that does not clear | DNS not pointing at the VM yet | `nslookup` must show your IP before Caddy can issue a certificate |
| Health JSON has `"firebaseAuth":false` | `.env` blank or not saved | step 7, then `sudo systemctl restart riderise` |
| `Refusing to start: JWT_SECRET is required` | `JWT_SECRET` under 32 characters or empty | set a 64-character one, restart |
| Everything works, then dies after a month | you upgraded the account and exceeded a limit | Always Free resources themselves do not expire; check Billing → Cost Analysis |

---

## Honest notes

- Oracle's free tier is the most generous one that exists, but it is **not a contract**: they cut
  the ARM allowance in half in June 2026 with no announcement. The AMD micro allowance (2 × 1 GB)
  was not touched, which is another reason step 2 uses it.
- Oracle may reclaim **ARM** instances that stay idle. The AMD micro is not subject to that rule.
- I could not test this exact script on Oracle's infrastructure from here — the sandbox has no
  access to their network. The script has been checked for syntax and its logic is covered by the
  project's tests, but expect to read one or two error lines and match them to the table above. If
  something fails, paste the last 20 lines to me and I will fix the script.
