# Phase 2 — Performance and accessibility audit

Scope: startup, media, weak connectivity, memory, Android permissions, layout, accessibility,
Sinhala/Tamil rendering, loading/empty/error/permission states, compression, pagination,
caching, indexes and session termination. Measurements below are **code-level and local
observations**, not device profiling.

---

## 1. Startup

- The client is plain ES2017 with no framework, no CDN and no web fonts. `index.html` loads
  local CSS + 17 local scripts, all at the end of `<body>`; asset bytes ship inside the APK.
- The native shell paints the branded splash immediately and fades it on `onPageFinished`,
  so a cold start never flashes white.
- Total client payload: ~2.3 MB uncompressed, dominated by the studio badge (1.7 MB PNG).
  Text assets are gzip-compressed by the Node server (see §7). If you need a smaller APK,
  export the badge at 512 px and update `assets/brand/riderise_logo.png`.
- First-paint screens (`#/welcome`, `#/home`) request only one API endpoint each.

## 2. Feeds, chat and media

- Feed uses pagination (`limit`/`page`) and category filters; messages use `before` cursors
  (30 per page); notifications use `limit`/`before` (50); catalogue uses `page`/`page_size`
  (20, max 60); guild hub lists are capped at 20–30 rows.
- Images are rendered with `loading="lazy"`, constrained by CSS and never fetched at full
  resolution in list views.
- Uploads: 5 MB image limit, 9 MB default request cap (24 MB for `/api/upload/media`).
  Client re-encodes images, which strips EXIF/GPS before upload.
- No autoplaying audio or video anywhere; lesson videos are `preload="metadata"` and
  require a tap.

## 3. Weak connectivity

- The realtime client reconnects with exponential backoff and stops after repeated failures;
  screens also work with plain request/response refresh (map refreshes every 20 s only while
  visible, messages reload after an SSE event).
- Every list screen has loading, empty, error and (where relevant) permission-denied states.
  Errors show an error code and a retry control.
- The map shows explicit offline/no-tile states; voice shows connecting/disconnected and
  never a fake “connected”.
- Offline detection uses `navigator.onLine` events for status only; no feature pretends to
  work offline beyond the bundled UI shell.

## 4. Battery

- Live location pings every **45 s**, not continuously; `enableHighAccuracy` is false and a
  45 s `maximumAge` is allowed. No background geolocation.
- Voice relies on WebRTC; heartbeat is 8 s and room-state refresh 4 s only while a room is
  open. Leaving the screen tears both down (`onRouteCleanup`).
- The auto-refresh intervals check `document.hidden` and do nothing while backgrounded.
- Not measured on hardware. Use Android Battery Historian for a 60-minute share before
  launch.

## 5. Memory and crashes

- Timers, observers (`ResizeObserver` in the map), interval loops and peer connections are
  closed in cleanup hooks when the route changes; the router runs cleanups before painting.
- Map tiles live in one transformed pane; marker DOM is reused per user id.
- Audio elements are removed when peers leave.
- No crash reports exist because no device testing was performed. `adb logcat` is the
  recommended first stop for field issues.

## 6. Android permissions

Declared: `INTERNET`, `ACCESS_NETWORK_STATE`, `POST_NOTIFICATIONS`, `RECORD_AUDIO`,
`MODIFY_AUDIO_SETTINGS`, `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`,
`BLUETOOTH_CONNECT`.

Runtime behaviour:

- Microphone is requested only when joining a voice room or pressing PTT.
- Location is requested only after **Start sharing**.
- Notification permission is requested from the Android shell, not on first launch.
- The WebView grants capture/geolocation only to the bundled `file://` app; remote pages are
  denied in `onPermissionRequest` / `onGeolocationPermissionsShowPrompt`.
- Denials surface a human explanation with settings instructions; nothing retries silently.

## 7. Compression, caching and indexes

Implemented in `backend/server.js`:

- **gzip** for `.html`, `.css`, `.js`, `.json`, `.svg`, `.txt`, `.md` over 1 KB (in-memory
  cache keyed by file size + mtime; cleared above 60 entries).
- **ETag** (`weak` size+mtime) with `If-None-Match` → `304`.
- **Cache-Control**: `no-cache` for the SPA shell, `max-age=300` for other client files,
  `max-age=86400` for brand assets and APK downloads.
- Verified locally: `Content-Encoding: gzip`, 304 revalidation, shell `no-cache`.

Indexes added by Phase 2 cover report status/date, live-session expiry, voice participants,
message timestamps, event dates, price history and audit timestamps. Pagination avoids
unbounded result sets; list endpoints also cap rows (`LIMIT`).

Deployment note: if you put Nginx/Cloudflare in front, let one layer do compression and
keep the Node layer as the fallback.

## 8. Accessibility

- Semantic headings, `aria-label` on icon buttons, `role="status"`/`role="alert"` for live
  messaging, `aria-pressed` on PTT, and visible focus outlines on every new control.
- Map controls are real buttons; the map container carries an application label and the
  member list duplicates every marker as text (so the feature is usable without the map).
- PTT is hold-to-talk on pointer events **and** keyboard (Space/Enter keydown/keyup).
- Colour is never the only signal: states pair colour with text (“Sharing”, “Mic closed”,
  “Channel busy”).
- `prefers-reduced-motion` disables ripples/pulses and long transitions; the existing
  high-contrast toggle overrides borders and backgrounds for the new surfaces.
- Touch targets are ≥ 36 px; the PTT circle is ≥ 160 px on small screens.
- Safe-area insets are applied to the composer, PTT panel and side rails for the Android
  WebView.
- Sinhala/Tamil: no web fonts, so rendering uses the device's Noto/system fonts; long
  strings wrap (`overflow-wrap: anywhere`) and line-height is raised on text-heavy surfaces.
  **Not verified on a real Sinhala/Tamil device.**

## 9. Session termination

- Sign-out clears the token; leaving the map stops sharing (server call + keepalive on page
  hide); leaving a voice room closes peer connections and calls `leave`; PTT releases the
  floor on pointer up, key up, route change and backgrounding.
- Server-side, guild membership, blocks, bans and suspension are re-checked per request, so
  losing authorization also terminates live participation on the next poll/heartbeat.
- Live sessions expire server-side after at most 60 minutes regardless of client behaviour.

## 10. Not measured

- Cold/warm start time on a mid-range Android phone.
- Memory footprint during a 30-minute voice call.
- Frame rate of the map while dragging.
- TalkBack navigation and focus order on a real device.
- Data usage per hour of map sharing or voice.
- Load tests beyond seeded data.

These belong in the pre-launch device test pass described in `PHASE2_APK_BUILD.md` §6.
