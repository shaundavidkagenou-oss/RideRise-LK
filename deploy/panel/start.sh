#!/usr/bin/env bash
# RideRise LK — startup script for a Pterodactyl-family panel (Enzonic, Ptero, Pelican…).
#
# Why this file exists: a game/app panel runs ONE command per server, from a container you
# cannot log into as root. We need two things running — the Node API and (optionally) the
# Cloudflare tunnel that gives it a real https:// address — plus a PORT taken from the panel
# instead of a hard-coded 3000.
#
# Usage on the panel
#   1. Upload the repo (or clone it) into the server's file area — usually /home/container.
#   2. Panel → your server → Startup → Startup Command:
#        bash deploy/panel/start.sh
#   3. Start the server and watch the console. You want:
#        RideRise LK listening on 0.0.0.0:<port>
#      followed by the tunnel URL (if a tunnel is configured).
#
# Environment (put these in .env next to package.json — see docs/DEPLOY_AND_BAKE.md §3):
#   PORT / SERVER_PORT           the port the panel allocated (SERVER_PORT is set by the panel)
#   JWT_SECRET                   long random string
#   FIREBASE_PROJECT_ID          Firebase project id (rideriselk)
#   FIREBASE_API_KEY             Firebase web API key
#   ADMIN_USERNAME/ADMIN_PASSWORD studio admin, password 12+ characters
#   DB_PATH                      optional; defaults to backend/riderise_lk.sqlite (persists here)
#   CLOUDFLARE_TUNNEL_TOKEN      optional; named Cloudflare tunnel token -> stable https:// address
#   CLOUDFLARE_QUICK_TUNNEL=1    optional; throwaway https://xxxx.trycloudflare.com (testing only)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

log() { printf '[riderise] %s\n' "$*"; }
fail() { printf '[riderise] ERROR: %s\n' "$*" >&2; exit 1; }

# Read one KEY from .env without sourcing it: a JWT secret may contain characters that a
# naive `source .env` would execute or mangle.
read_env() {
  local key="$1" value=""
  if [ -f .env ]; then
    value="$(sed -n "s/^[[:space:]]*${key}[[:space:]]*=[[:space:]]*//p" .env | tail -n 1)"
    value="${value%\"}"; value="${value#\"}"
    value="${value%\'}"; value="${value#\'}"
  fi
  printf '%s' "$value"
}

# The panel tells us the allocation through SERVER_PORT; .env wins if it sets PORT explicitly.
PORT="${PORT:-$(read_env PORT)}"
PORT="${PORT:-${SERVER_PORT:-3000}}"
export PORT

log "repo ${ROOT}"
log "node $(node --version 2>/dev/null || echo 'not installed')"

node -e "require('node:sqlite')" 2>/dev/null || fail "this Node cannot load node:sqlite. Recreate the server with Node 22.13+ (24 preferred), or start it with: node --experimental-sqlite backend/server.js"

if [ ! -f backend/server.js ]; then
  fail "backend/server.js is missing — upload the repository, not just part of it."
fi

TUNNEL_PID=""
cleanup() {
  if [ -n "$TUNNEL_PID" ] && kill -0 "$TUNNEL_PID" 2>/dev/null; then
    kill "$TUNNEL_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

start_tunnel() {
  local token quick
  token="$(read_env CLOUDFLARE_TUNNEL_TOKEN)"
  quick="$(read_env CLOUDFLARE_QUICK_TUNNEL)"

  if [ -z "$token" ] && [ -z "$quick" ]; then
    log "no tunnel configured — serving on the panel port only."
    log "riders can only reach this if the panel gives you an https:// address for port ${PORT}."
    return 0
  fi

  [ -x ./cloudflared ] || fail "CLOUDFLARE_TUNNEL_TOKEN/CLOUDFLARE_QUICK_TUNNEL is set but ./cloudflared is missing. Download it: curl -fsSL -o cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 && chmod +x cloudflared"

  if [ -n "$token" ]; then
    log "starting Cloudflare named tunnel (stable address from your Cloudflare dashboard)"
    ./cloudflared tunnel --no-autoupdate run --token "$token" &
  else
    log "starting Cloudflare QUICK tunnel — the https:// address changes every restart, do not ship it to riders"
    ./cloudflared tunnel --no-autoupdate --url "http://127.0.0.1:${PORT}" &
  fi
  TUNNEL_PID=$!
}

start_tunnel

log "listening on 0.0.0.0:${PORT}"
node --env-file-if-exists=.env backend/server.js &
NODE_PID=$!
trap 'cleanup; kill "$NODE_PID" 2>/dev/null || true; exit 0' TERM INT
wait "$NODE_PID"
