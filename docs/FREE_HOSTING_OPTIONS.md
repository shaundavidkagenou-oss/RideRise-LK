# Free hosting that actually works for this app

Short version: **one free option really does run this 24/7 — a free-forever VM** (Oracle Cloud
Always Free, or Google Cloud's e2-micro). Everything else that calls itself "free" either sleeps,
wipes its disk, or has closed its free tier. The reason is in §1; the walkthrough is in §2.

---

## 1. Why most "free hosting" cannot run this backend

This app is a long-running Node process with **SQLite on local disk** and **Server-Sent Events**
for live messaging. Three requirements follow:

| Requirement | Why | Rules out |
|---|---|---|
| **A real, persistent disk** | the database is a file (`riderise_lk.sqlite`); it holds every rider, post, guild and message | Render free (ephemeral, no disks on free), Vercel, Netlify, Cloudflare Workers, Replit, Hugging Face Spaces |
| **Always on** | SSE keeps a connection open; the first rider after a sleep would wait for a cold start | Render free (sleeps after 15 min), Koyeb free (scales to zero; also closed to new users since Feb 2026) |
| **Node 22.13+** | the built-in `node:sqlite` module is only flag-free from 22.13 | shared hosts stuck on Node 18/20 (Alwaysdata, some cPanel hosts) |

Serverless platforms would need the database moved (Postgres) and the realtime layer rebuilt.
That is a rewrite, not a deployment.

---

## 2. Recommended: Oracle Cloud **Always Free** VM

Free forever (not a 12-month trial), no monthly cost, and it is a real Ubuntu machine you fully
control. Verified limits as of late 2026:

| What | Always Free allowance |
|---|---|
| AMD micro VMs | **2 × VM.Standard.E2.1.Micro** (1 GB RAM each) — unaffected by the 2026 ARM cuts |
| Ampere A1 (ARM) | 2 OCPU / 12 GB total (was 4/24 before June 2026; use 1 OCPU / 6 GB for one VM) |
| Disk | 200 GB block storage total |
| Outbound traffic | 10 TB / month — this is why it beats Google's 1 GB |
| Card | required **for identity verification only** (a ~$1 hold, cancelled). Always Free resources are not billed |

**Time: ~25 minutes.** You will need a card for verification and an SSH key (the console makes
one). **Your computer is only involved in the setup** — afterwards the VM runs on its own in
Oracle's data centre, and you can turn your PC off.

> Prefer the plain-language version? **[`ORACLE_CLOUD_STEP_BY_STEP.md`](ORACLE_CLOUD_STEP_BY_STEP.md)**
> is the same thing written as ten clicks with a troubleshooting table.

### 2.1 Create the account and the VM

1. Go to **oracle.com/cloud/free** → sign up. Choose your **home region now — it is permanent**.
   From Sri Lanka: **ap-mumbai-1 (Mumbai)** or **ap-singapore-1 (Singapore)**.
2. Console → **Compute → Instances → Create instance**.
   - **Name:** `riderise`
   - **Image:** Canonical **Ubuntu 24.04** (the x86_64 build)
   - **Shape:** **AMD** → **`VM.Standard.E2.1.Micro`** (1 GB, labelled *Always Free-eligible*).
     The AMD micro is not capacity-limited and is not subject to idle reclamation; the server
     idles at ~60 MB, and the setup script adds 2 GB of swap.

     *The Ampere A1 shape (2 OCPU / 12 GB) sounds better but is usually unobtainable on free
     accounts — reports through 2026 describe weeks of retries with zero successes, and Oracle may
     reclaim A1 instances that stay under 20 % utilisation. Use it only if you get lucky.*
   - **Networking:** keep the default VCN, **assign a public IPv4 address** (ephemeral is fine).
   - **SSH keys:** *Generate a key pair* → **download the private key** (you cannot download it
     later) — or upload your own `~/.ssh/id_ed25519.pub`.
3. Create it, wait for **Running**, and copy the **Public IP address**.

> **Idle reclamation:** Oracle's published policy says they may reclaim **A1 (ARM)** instances that
> stay under 20 % CPU/memory/network for 95 % of a week. A brand-new app with no riders qualifies.
> The **AMD micro is not subject to that rule** — that is why step 2 picks it.
>
> Full walkthrough with the exact clicks: [`ORACLE_CLOUD_STEP_BY_STEP.md`](ORACLE_CLOUD_STEP_BY_STEP.md).

### 2.2 Open ports 80 and 443

Two firewalls exist on Oracle and both block by default. The console one first:

**Networking → Virtual Cloud Networks → your VCN → Security Lists → Default Security List →
Add Ingress Rules** (twice):

| Source | IP protocol | Destination port |
|---|---|---|
| `0.0.0.0/0` | TCP | `80` |
| `0.0.0.0/0` | TCP | `443` |

(The second firewall lives inside Ubuntu; the setup script below handles it.)

### 2.3 Give it a hostname — free, no domain purchase

The APK needs `https://` with a certificate, and certificates are issued to *names*, not IPs.
Two free ways:

**A. DuckDNS (recommended).** duckdns.org → sign in with Google/GitHub → type `rideriselk` →
**add domain** → set **current IP** to your VM's public IP (or press *update ip*). You now own
`rideriselk.duckdns.org`. Free forever, and the name never has to change.

**B. No-signup alternative.** `sslip.io` turns any IP into a hostname:
your IP `203.0.113.40` → **`203.0.113.40.sslip.io`**. Works with Caddy immediately, but the name
follows the IP, so it breaks if Oracle reassigns the address.

Whichever you choose, verify from your own computer:

```bash
nslookup rideriselk.duckdns.org      # must print the VM's public IP
```

### 2.4 Install everything (one command)

From your computer:

```bash
chmod 600 ~/Downloads/ssh-key-*.key
ssh -i ~/Downloads/ssh-key-*.key ubuntu@<VM-PUBLIC-IP>
```

On the VM:

```bash
sudo apt-get update && sudo apt-get install -y git
sudo git clone --depth 1 -b arena/127f733a-riderise-lk \
  https://github.com/shaundavidkagenou-oss/RideRise-LK.git /srv/riderise
sudo bash /srv/riderise/deploy/vm/setup.sh rideriselk.duckdns.org
```

That script (`deploy/vm/setup.sh`, in this repo) does the rest and is safe to re-run:

- installs **Node 24**, verifies `node:sqlite` works, adds 2 GB of swap on small VMs;
- clones/updates the app into `/srv/riderise` and runs it as a locked-down `riderise` user;
- writes `riderise.service` (systemd, restarts on crash and on reboot);
- installs **Caddy** for automatic Let's Encrypt TLS on your hostname;
- opens 80/443 in the VM's iptables as well;
- waits for `/api/health` and prints what it got.

### 2.5 Fill in the secrets, once

```bash
sudo nano /srv/riderise/.env
```

Set at least:

```ini
FIREBASE_API_KEY=<from your local .env>
FIREBASE_APP_ID=<from your local .env>
ADMIN_PASSWORD=<12+ characters, or empty to have one generated and printed once>
```

`JWT_SECRET` is generated by the script on first install; the project id, auth domain, sender id,
storage bucket and `DB_PATH` are pre-filled. Save, then:

```bash
sudo systemctl restart riderise
curl -s https://rideriselk.duckdns.org/api/health   # JSON with "firebaseAuth":true
```

Nothing to `npm install` — the server has zero runtime dependencies.

### 2.6 Compile the address into the app

On your own computer, in the repo:

```bash
npm run verify:server -- --url https://rideriselk.duckdns.org    # all six checks green
npm run configure:apk -- --url https://rideriselk.duckdns.org
npm run apk
```

Then install the APK: splash → welcome → register. No URL to type.

### 2.7 Day-to-day

| Task | Command |
|---|---|
| Logs | `sudo journalctl -u riderise -f` |
| Restart | `sudo systemctl restart riderise` |
| Update to the latest code | `sudo bash /srv/riderise/deploy/vm/setup.sh rideriselk.duckdns.org` |
| Back up the database | `sudo cp /srv/riderise/backend/riderise_lk.sqlite* ~/backup-$(date +%F)/` (or `scp` it down) |
| Change the hostname | edit `/etc/caddy/Caddyfile`, then `sudo systemctl reload caddy` |

The VM does not sleep, and the address does not change — that is the point.

---

## 3. Alternative: Google Cloud **free** e2-micro

Free forever: one `e2-micro` VM in `us-west1`, `us-central1` or `us-east1`, 30 GB disk. Same
setup script works. Two catches worth knowing before you pick it:

- **1 GB outbound traffic per month** (North America only). The web app is ~2.5 MB on first load,
  so that is roughly 400 first-time visitors a month before you start paying egress.
- The free VM only exists in **US regions** — every rider in Sri Lanka pays the latency.

Steps are the same shape: create the VM (Ubuntu 24.04, allow HTTP/HTTPS in the firewall), set a
DuckDNS name, then run `deploy/vm/setup.sh`.

---

## 4. Options that do **not** need a card

If you cannot (or will not) put a card on a cloud account:

1. **Keep retrying Enzonic.** "Insufficient node RAM capacity" is a capacity queue, not a verdict.
   Free slots open constantly; press Start a few times a day and it may simply work. Everything is
   already configured there — port 25941, variables, branch.
2. **Run it on your own computer + a tunnel** — free and immediate, but it dies when the machine
   sleeps. Good for testing, not for riders:

   ```bash
   npm start
   cloudflared tunnel --url http://localhost:3000
   ```

3. **An old laptop or mini-PC at home** with Ubuntu + the same script, kept powered and online.
   Free after the hardware, but Sri Lankan power cuts and home upload bandwidth are real limits.

---

## 5. Honest comparison

| Host | Free 24/7? | Persistent SQLite? | Card | Verdict |
|---|---|---|---|---|
| **Oracle Cloud Always Free** | yes | yes | yes (verify) | **use this** |
| Google Cloud e2-micro | yes | yes | yes | works, 1 GB egress, US-only |
| Enzonic (current) | yes, when capacity exists | yes | no | keep retrying in parallel |
| Render free | no (sleeps 15 min) | **no** — data lost | no | not usable as-is |
| Koyeb free | — | — | — | closed to new users (Feb 2026) |
| Fly.io / Railway | trial credits | yes | yes | paid in practice |
| Vercel / Netlify / Workers | n/a | **no** | no | needs a rewrite |
| Replit / Hugging Face Spaces | sleeps | **no** | no | testing only |

If the free-tier churn is costing you whole evenings, the boring answer is a €4–5/month VPS
(Hetzner, Contabo, DigitalOcean). Same script, no capacity lottery. But Oracle's free tier gives
you more machine than that for $0, so try it first.

---

## 6. What to send me

Once `https://<your-hostname>/api/health` returns JSON with `"firebaseAuth":true`, send me:

1. the hostname, and
2. the JSON from that URL (or a screenshot).

I run `verify:server` against it, compile it into `config/deployment.config.json`, rebuild the
signed APKs and hand you the file to install. If you prefer to run the commands yourself, §2.6 is
the whole thing.
