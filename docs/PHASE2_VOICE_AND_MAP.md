# Phase 2 — Live guild map, voice rooms and walkie-talkie setup

Everything here runs on the existing Node server; there is no separate media server for
group voice or PTT. Audio is **real WebRTC** between the devices in a room. A TURN relay is
required for reliable connections on Sri Lankan mobile carriers.

---

## 1. Live guild map

### What is stored

- `guild_share_consent` — whether a rider has agreed to share, and whether they have allowed
  the short precise option.
- `live_location_sessions` — the **current** session only: guild, rider, approximate point
  (rounded to the sharing radius), radius in metres, expiry. Rows are deleted when the
  session ends and swept when it expires.
- `live_location_audit` — events such as `session_started`, `session_stopped`,
  `manager_revoked`. No coordinates are written to the audit log.

There is deliberately **no location history** and no way to query “where was this rider
yesterday”. Administrators see sharing counts, not coordinates.

### Defaults

| Setting | Value |
|---|---|
| Off by default | yes — nothing is shared until the rider ticks consent and taps Start |
| Approximate radius | 750 m for adults |
| Riders aged 16–17 | fixed 1,500 m radius, precise option never offered |
| Precise radius | 60 m, adults only, max 10 minutes per session |
| Maximum session | 60 minutes, then auto-expiry |
| Ping cadence | 45 s from the app (battery-conscious; no continuous GPS watch) |
| Refresh | manual + 20 s auto-refresh while the screen is open |

Sharing stops immediately when the rider taps Stop, leaves the guild, signs out, or blocks
a member. The `pagehide` handler sends a keepalive stop so closing the tab/WebView ends the
share rather than waiting for expiry.

### Tile providers

Set one provider in the server environment. The API key never has to ship in the APK if you
enable the tile proxy.

```bash
# OpenStreetMap (default; no key, community usage policy applies)
MAP_PROVIDER=openstreetmap

# MapTiler (free tier then paid)
MAP_PROVIDER=maptiler MAP_API_KEY=xxxxxxxx

# Mapbox (billed per map load)
MAP_PROVIDER=mapbox MAP_API_KEY=pk.xxxx

# Thunderforest (cycle-oriented tiles; free hobby tier)
MAP_PROVIDER=thunderforest MAP_API_KEY=xxxxxxxx

# Recommended for production: proxy tiles through your server so the key stays private
MAP_PROXY_TILES=1
```

`GET /api/map/config` reports the provider, whether a key is required, whether the key is
exposed to the client, the attribution text and the provider's billing note. The guild map
screen shows a warning when the provider is misconfigured, and the map engine shows a
`map-offline` state when tiles fail — it never pretends to be live.

> OpenStreetMap's tile servers are run by volunteers and have a usage policy. For more than
> light use, choose MapTiler, Mapbox, Thunderforest or self-hosted tiles. RideRise LK does
> not scrape Google Maps or any provider that forbids it.

### Map failure states the UI covers

permission denied · GPS unavailable · timeout · no network · tile host unreachable ·
not a guild member · session expired · manager revoked the share.

---

## 2. Group voice rooms

### How it works

1. `GET /api/guilds/:id/voice` returns rooms, ICE servers and limits for an active member.
2. Joining asks the microphone permission **in context**, then exchanges SDP/ICE through
   `POST /api/voice/rooms/:id/signal` and `GET …/signal/poll`.
3. Each participant has a direct peer connection to every other participant (mesh). The
   room cap is 8 by default (2–12 configurable per room).
4. `POST /api/voice/rooms/:id/heartbeat` every 8 seconds keeps participation alive; a
   missed series marks the participant disconnected.
5. `POST …/leave` releases the microphone and deletes the peer entries.

Microphone tracks start **disabled**. The app only enables the track when the rider unmutes
(or holds PTT). There is no silent activation path and no recording: the server rejects any
recording field and the UI states “Recording: Off”.

### Rooms and access

- `voice_rooms.kind` is `group` or `walkie`; `min_role` can restrict a room to moderators.
- Only owners, moderators and studio admins can create, close or delete rooms.
- Blocked riders cannot join the same room as the blocker; guild bans are enforced
  server-side per room (`voice_room_bans`).
- Block/report controls are available on every participant tile.

### Walkie-talkie (PTT)

1. Guild → Voice & walkie-talkie → pick a `walkie` channel.
2. The press-and-hold button asks for permission first; nothing is transmitted before the
   press.
3. `POST /api/voice/rooms/:id/floor/acquire` claims the single transmission floor.
   A second transmitter gets `409 FLOOR_BUSY` with the current holder — overlapping
   transmissions are impossible.
4. Release immediately calls `floor/release` and disables the outgoing track. A server-side
   timeout (5–120 s, default 30) force-releases a stuck floor.
5. States shown: **Idle / Connecting / Listening / Transmitting / Channel busy /
   Disconnected**, plus a live input meter and the current transmitter's name.
6. Pressing the hardware/on-screen back or losing the network releases the floor.

### TURN relay (required for reliable mobile calls)

Without TURN, two phones behind carrier-grade NAT often cannot connect. Install coturn:

```bash
sudo apt install coturn
sudo sed -i 's/#TURNSERVER_ENABLED/TURNSERVER_ENABLED/' /etc/default/coturn
```

`/etc/turnserver.conf` (replace the secret and realm):

```
listening-port=3478
tls-listening-port=5349
fingerprint
lt-cred-mech
use-auth-secret
static-auth-secret=REPLACE_WITH_LONG_RANDOM_SECRET
realm=riderise.example.com
total-quota=120
bps-capacity=0
stale-nonce
no-multicast-peers
no-cli
```

Then on the app server:

```bash
TURN_URLS=turn:turn.riderise.example.com:3478?transport=udp,turn:turn.riderise.example.com:5349?transport=tcp
TURN_SECRET=REPLACE_WITH_LONG_RANDOM_SECRET
TURN_TTL_SECONDS=3600
STUN_URLS=stun:stun.l.google.com:19302
```

`GET /api/voice/ice` then returns short-lived HMAC credentials (coturn REST API style), so
the shared secret never reaches a device. `/api/health` reports `turnRelay: true`.

If you prefer static credentials, set `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL`
instead — the server supports both modes and labels which one is active.

### Android permissions

The APK requests `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`, `ACCESS_FINE_LOCATION`,
`ACCESS_COARSE_LOCATION` and (Android 12+) `BLUETOOTH_CONNECT`. The WebView only grants
microphone/location to the bundled `file://` app, never to remote pages. The shell handles
the Android runtime prompt and then answers the WebView request.

Bluetooth: the native bridge exposes `RRAndroid.routeAudioToBluetooth()` and
`RRAndroid.resetAudioRoute()`. The speaker/earpiece/Bluetooth button uses them; pure
browsers fall back to the system route because `setSinkId` is unavailable in WebView.

### Honest limits

- Mesh topology: 8 participants is the practical ceiling; beyond that use an SFU such as
  LiveKit or mediasoup (not included).
- No recording, transcription, noise suppression or echo cancellation tuning beyond the
  browser defaults.
- Calls cannot be tested in the build sandbox; two real devices on different networks were
  not available. See `docs/PHASE2_TEST_RESULTS.md`.
- If TURN is not configured, calls work on many home/mobile networks but fail on strict
  carrier NAT. The UI says so instead of faking a connected state.
