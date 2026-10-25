#!/usr/bin/env bash
# RideRise LK — one-shot server setup for a fresh Ubuntu 22.04/24.04 VM.
#
# Built for a free-forever VM (Oracle Cloud Always Free, Google Cloud e2-micro, or any small VPS).
# Run it once as root; it installs Node 24, the app, a systemd service and Caddy for HTTPS:
#
#   sudo bash deploy/vm/setup.sh rideriselk.duckdns.org
#
# Before you run it, the VM must already have:
#   * ports 80 and 443 open in the provider's firewall (and in the OS, handled here)
#   * a hostname whose A record points at this machine (see docs/FREE_HOSTING_OPTIONS.md)
#
# Afterwards:
#   sudo nano /srv/riderise/.env      # fill the blanks the first run prints
#   sudo systemctl restart riderise
#
# Safe to re-run: it updates the code, rewrites the unit files and restarts the services.

set -euo pipefail

DOMAIN="${1:-}"
REPO_URL="${REPO_URL:-https://github.com/shaundavidkagenou-oss/RideRise-LK.git}"
BRANCH="${BRANCH:-arena/127f733a-riderise-lk}"
APP_DIR="${APP_DIR:-/srv/riderise}"
APP_USER="${APP_USER:-riderise}"
PORT="${PORT:-3000}"

step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[33m!  %s\033[0m\n' "$*"; }
die() { printf '\033[31mx  %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run this with sudo: sudo bash deploy/vm/setup.sh <your-hostname>"
[ -n "$DOMAIN" ] || die "usage: sudo bash deploy/vm/setup.sh <your-hostname>   (e.g. rideriselk.duckdns.org)"
printf '%s' "$DOMAIN" | grep -Eq '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$' || die "\"$DOMAIN\" does not look like a hostname"
case "$DOMAIN" in *.*) ;; *) die "give a full hostname, not a bare word: e.g. rideriselk.duckdns.org" ;; esac

if ! grep -qi ubuntu /etc/os-release 2>/dev/null; then
  warn "this script targets Ubuntu — continuing, but package names may differ on other distributions"
fi

# ---------------------------------------------------------------- base packages
step "Installing system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates git gnupg ufw >/dev/null

# ----------------------------------------------------------------------- Node.js
# The backend uses node:sqlite, which is only flag-free from Node 22.13. Node 24 is the target.
node_major() { node -v 2>/dev/null | sed 's/^v\([0-9]*\).*/\1/'; }
need_node=1
if command -v node >/dev/null 2>&1; then
  major="$(node_major)"
  minor="$(node -v | cut -d. -f2)"
  if [ "$major" -gt 22 ] || { [ "$major" -eq 22 ] && [ "$minor" -ge 13 ]; }; then
    need_node=0
  fi
fi
if [ "$need_node" -eq 1 ]; then
  step "Installing Node.js 24 (NodeSource)"
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
node -e "require('node:sqlite')" 2>/dev/null || die "this Node cannot load node:sqlite — install Node 24 and re-run"
step "Node $(node -v) — node:sqlite OK"

# ------------------------------------------------------------------- swap (1 GB VMs)
if [ ! -f /swapfile ] && [ "$(free -m | awk '/^Mem:/{print $2}')" -lt 1800 ]; then
  step "Adding a 2 GB swap file (small-RAM VMs)"
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# ------------------------------------------------------------------------- user
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  step "Creating the service user $APP_USER"
  # No --create-home: the clone below creates the directory, and the service user needs no login.
  useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
fi

# ------------------------------------------------------------------------- code
step "Fetching the application"
# The repo ends up owned by $APP_USER, but this script runs as root. Without this, a re-run
# fails with "detected dubious ownership in repository".
git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch --quiet origin "$BRANCH"
  git -C "$APP_DIR" checkout --quiet "$BRANCH"
  git -C "$APP_DIR" pull --quiet --ff-only origin "$BRANCH"
else
  mkdir -p "$(dirname "$APP_DIR")"
  git clone --quiet --depth 1 --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi
[ -f "$APP_DIR/backend/server.js" ] || die "backend/server.js is missing — check the branch name"
# No npm install: the server has zero runtime dependencies. Keeping this line documents that.

# ------------------------------------------------------------------------- .env
step "Checking .env"
NEW_ENV=0
if [ ! -f "$APP_DIR/.env" ]; then
  NEW_ENV=1
  cat > "$APP_DIR/.env" <<'ENVEOF'
# Fill these in, then: sudo systemctl restart riderise
# JWT_SECRET must be 32+ characters:  openssl rand -hex 32
JWT_SECRET=
# Firebase console -> Project settings -> Your apps -> Web app
FIREBASE_PROJECT_ID=rideriselk
FIREBASE_API_KEY=
FIREBASE_AUTH_DOMAIN=rideriselk.firebaseapp.com
FIREBASE_APP_ID=
FIREBASE_MESSAGING_SENDER_ID=614966302540
FIREBASE_STORAGE_BUCKET=rideriselk.firebasestorage.app
# Studio console login (12+ characters; generated once if you leave it empty)
ADMIN_USERNAME=studio-admin
ADMIN_PASSWORD=
ENVEOF
fi
chown "$APP_USER":"$APP_USER" "$APP_DIR/.env"
chmod 600 "$APP_DIR/.env"
# The database lives inside the app folder so it survives restarts AND the file is owned by the service user.
DB_DEFAULT="$APP_DIR/backend/riderise_lk.sqlite"
grep -q '^DB_PATH=' "$APP_DIR/.env" || printf 'DB_PATH=%s\n' "$DB_DEFAULT" >> "$APP_DIR/.env"

jwt_len=$(sed -n 's/^JWT_SECRET=//p' "$APP_DIR/.env" | tail -n 1 | wc -c)
jwt_len=$((jwt_len > 0 ? jwt_len - 1 : 0))
[ "$jwt_len" -ge 32 ] || warn "JWT_SECRET is ${jwt_len} characters — set 32+ or the service will refuse to start in production mode"
grep -q '^FIREBASE_API_KEY=.\+' "$APP_DIR/.env" || warn "FIREBASE_API_KEY is empty — riders will not be able to sign in until you set it"

chown -R "$APP_USER":"$APP_USER" "$APP_DIR"

# ----------------------------------------------------------------------- systemd
step "Installing the systemd service"
cat > /etc/systemd/system/riderise.service <<EOF
[Unit]
Description=RideRise LK backend
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
Environment=PORT=$PORT
Environment=TRUST_PROXY=1
ExecStart=$(command -v node) backend/server.js
Restart=always
RestartSec=3
# The server writes its SQLite database inside the app folder.
ReadWritePaths=$APP_DIR

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable riderise >/dev/null
systemctl restart riderise

# ------------------------------------------------------------------------- Caddy
step "Installing Caddy and issuing the TLS certificate for $DOMAIN"
if ! command -v caddy >/dev/null 2>&1; then
  apt-get install -y -qq caddy >/dev/null 2>&1 || {
    apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https >/dev/null
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -qq
    apt-get install -y -qq caddy >/dev/null
  }
fi

cat > /etc/caddy/Caddyfile <<EOF
# RideRise LK — HTTPS in front of the Node server.
$DOMAIN {
	encode gzip
	reverse_proxy 127.0.0.1:$PORT
	log {
		output file /var/log/caddy/riderise-access.log
	}
}
EOF
mkdir -p /var/log/caddy
chown -R caddy:caddy /var/log/caddy 2>/dev/null || true
systemctl enable caddy >/dev/null
systemctl restart caddy

# ---------------------------------------------------------------------- firewall
step "Opening 80 and 443 in the OS firewall"
if command -v ufw >/dev/null 2>&1; then
  ufw allow 22/tcp >/dev/null 2>&1 || true
  ufw allow 80/tcp >/dev/null 2>&1 || true
  ufw allow 443/tcp >/dev/null 2>&1 || true
fi
# Ubuntu images on Oracle Cloud ship iptables rules that block everything but SSH.
if command -v iptables >/dev/null 2>&1 && iptables -L INPUT -n 2>/dev/null | grep -q REJECT; then
  iptables -I INPUT 1 -p tcp --dport 80 -j ACCEPT
  iptables -I INPUT 1 -p tcp --dport 443 -j ACCEPT
  if command -v netfilter-persistent >/dev/null 2>&1; then
    netfilter-persistent save >/dev/null 2>&1 || true
  elif [ -d /etc/iptables ]; then
    iptables-save > /etc/iptables/rules.v4 2>/dev/null || true
  fi
fi

# ------------------------------------------------------------------- health check
step "Waiting for the app to answer on 127.0.0.1:$PORT"
ok=0
for _ in $(seq 1 30); do
  if curl -fsS --max-time 3 "http://127.0.0.1:$PORT/api/health" >/tmp/riderise-health.json 2>/dev/null; then
    ok=1
    break
  fi
  sleep 1
done
if [ "$ok" -eq 1 ]; then
  printf '   %s\n' "$(head -c 200 /tmp/riderise-health.json)"
else
  warn "the app did not answer yet. Check:  sudo journalctl -u riderise -n 40 --no-pager"
fi

printf '\n\033[1mDone.\033[0m\n\n'
if [ "$NEW_ENV" -eq 1 ]; then
  cat <<EOF
1. Fill in the blanks, then restart:
     sudo nano $APP_DIR/.env
     sudo systemctl restart riderise

EOF
fi
cat <<EOF
2. Certificate: Caddy issues it on first request. Check:
     curl -s https://$DOMAIN/api/health
3. From your computer, prove it end to end and compile it into the app:
     npm run verify:server -- --url https://$DOMAIN
     npm run configure:apk -- --url https://$DOMAIN
     npm run apk

Logs:   sudo journalctl -u riderise -f     (app)
        sudo journalctl -u caddy -f        (TLS)
Update: sudo bash $APP_DIR/deploy/vm/setup.sh $DOMAIN
EOF
