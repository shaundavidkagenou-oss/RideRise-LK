// RideRise LK Phase 2 — Real-time guild map with consent-first, ephemeral location sharing.
'use strict';

const {
  nowIso,
  nowMs,
  newId,
  clamp,
  isOnline
} = require('./core');

/**
 * Round coordinates onto a grid so the stored/served point represents an area
 * rather than a precise household location. Default radius is ~750 m; younger
 * riders always use the wider 1.5 km grid.
 */
function snapToGrid(lat, lng, radiusM) {
  const step = Math.max(radiusM, 50) / 111_000;
  return {
    lat: Math.round(lat / step) * step,
    lng: Math.round(lng / step) * step
  };
}

function validateCoords(lat, lng) {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  if (la < -90 || la > 90 || ln < -180 || ln > 180) return null;
  if (la === 0 && ln === 0) return null; // Null Island = missing GPS fix
  return { lat: la, lng: ln };
}

module.exports = function registerLive(ctx) {
  const { db, sendJson, readJsonBody, getAuthUser, checkRateLimit, brandConfig, notifier } = ctx;

  const MAX_SESSION_MINUTES = 60;
  const PRECISE_SESSION_MINUTES = 10;
  const APPROX_RADIUS_M = 750;
  const MINOR_RADIUS_M = 1500;
  const PRECISE_RADIUS_M = 60;

  function guildSettings(guildId) {
    let row = db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guildId);
    if (!row) {
      db.prepare(
        `INSERT INTO guild_settings (guild_id, location_sharing_enabled, voice_enabled, walkie_enabled,
          activity_visible, rules_text, welcome_message, updated_at)
         VALUES (?, 1, 1, 1, 1, '', '', ?)`
      ).run(guildId, nowIso());
      row = db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guildId);
    }
    return row;
  }

  function membership(guildId, userId) {
    return db
      .prepare('SELECT * FROM guild_memberships WHERE guild_id = ? AND user_id = ? AND status = ?')
      .get(guildId, userId, 'active');
  }

  function blockedEitherWay(a, b) {
    const row = db
      .prepare(
        'SELECT 1 FROM user_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)'
      )
      .get(a, b, b, a);
    return Boolean(row);
  }

  function audit(guildId, userId, action, detail = '') {
    db.prepare(
      'INSERT INTO live_location_audit (id, guild_id, user_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(newId('lla'), guildId, userId, action, String(detail).slice(0, 180), nowIso());
  }

  function purgeExpired() {
    const now = nowIso();
    const expired = db.prepare('SELECT * FROM live_location_sessions WHERE expires_at <= ?').all(now);
    for (const row of expired) {
      db.prepare('DELETE FROM live_location_sessions WHERE id = ?').run(row.id);
      audit(row.guild_id, row.user_id, 'expired', 'Session lease ended automatically');
    }
    // Members who left, were suspended or deleted must stop appearing immediately.
    const orphaned = db
      .prepare(
        `SELECT s.* FROM live_location_sessions s
         LEFT JOIN guild_memberships m
           ON m.guild_id = s.guild_id AND m.user_id = s.user_id AND m.status = 'active'
         LEFT JOIN users_private u ON u.id = s.user_id
         WHERE m.user_id IS NULL OR u.account_status != 'active'`
      )
      .all();
    for (const row of orphaned) {
      db.prepare('DELETE FROM live_location_sessions WHERE id = ?').run(row.id);
      audit(row.guild_id, row.user_id, 'revoked', 'Membership or account state changed');
    }
  }

  const sweeper = setInterval(() => {
    try {
      purgeExpired();
    } catch {
      /* database may be closing during shutdown */
    }
  }, 30_000);
  if (sweeper.unref) sweeper.unref();

  function mapConfig() {
    const provider = (process.env.MAP_PROVIDER || 'openstreetmap').toLowerCase();
    const proxy = process.env.MAP_PROXY_TILES === '1';
    const key = process.env.MAP_API_KEY || '';
    const presets = {
      openstreetmap: {
        tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19,
        requiresApiKey: false,
        billing: 'No fee. Community tile servers have a usage policy; heavy production traffic must use a commercial tile host.',
        docs: 'https://operations.osmfoundation.org/policies/tiles/'
      },
      maptiler: {
        tileUrl: `https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=${key}`,
        attribution: '© MapTiler © OpenStreetMap contributors',
        maxZoom: 20,
        requiresApiKey: true,
        billing: 'MapTiler offers a free tier then per-request billing. Set MAP_API_KEY and restrict it by domain/package.',
        docs: 'https://www.maptiler.com/cloud/pricing/'
      },
      mapbox: {
        tileUrl: `https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/256/{z}/{x}/{y}@2x?access_token=${key}`,
        attribution: '© Mapbox © OpenStreetMap contributors',
        maxZoom: 22,
        requiresApiKey: true,
        billing: 'Mapbox bills per map load. Set MAP_API_KEY; tokens must be URL-restricted before shipping.',
        docs: 'https://www.mapbox.com/pricing/'
      },
      thunderforest: {
        tileUrl: `https://tile.thunderforest.com/cycle/{z}/{x}/{y}.png?apikey=${key}`,
        attribution: 'Maps © Thunderforest, data © OpenStreetMap contributors',
        maxZoom: 19,
        requiresApiKey: true,
        billing: 'Thunderforest has a free hobby tier and paid plans per tile request.',
        docs: 'https://www.thunderforest.com/pricing/'
      }
    };
    const preset = presets[provider] || presets.openstreetmap;
    const configured = !preset.requiresApiKey || Boolean(key);
    return {
      provider,
      tile_url: proxy ? '/api/map/tile/{z}/{x}/{y}.png' : preset.tileUrl,
      attribution: preset.attribution,
      max_zoom: preset.maxZoom,
      subdomains: [],
      requires_api_key: preset.requiresApiKey,
      configured,
      key_exposed_to_client: Boolean(preset.requiresApiKey && key && !proxy),
      proxy_tiles: proxy,
      billing_note: preset.billing,
      docs_url: preset.docs
    };
  }

  function snapshot(guildId, viewer) {
    const guild = db.prepare('SELECT * FROM guilds WHERE id = ?').get(guildId);
    if (!guild) return null;
    const settings = guildSettings(guildId);

    const memberRows = db
      .prepare(
        `SELECT m.user_id, m.role, m.joined_at, p.username, p.display_name, p.avatar_url, p.district,
                u.is_minor, r.name AS rank_name, r.color_hex AS rank_color,
                COALESCE(a.show_activity, 1) AS show_activity
         FROM guild_memberships m
         JOIN profiles p ON p.user_id = m.user_id
         JOIN users_private u ON u.id = m.user_id
         LEFT JOIN ranks r ON r.id = p.rank_id
         LEFT JOIN guild_member_activity a ON a.guild_id = m.guild_id AND a.user_id = m.user_id
         WHERE m.guild_id = ? AND m.status = 'active' AND u.account_status = 'active'
         ORDER BY (m.role = 'owner') DESC, (m.role = 'moderator') DESC, p.display_name ASC`
      )
      .all(guildId)
      .filter((m) => !blockedEitherWay(viewer.id, m.user_id));

    const sessions = db
      .prepare(
        `SELECT s.*, u.is_minor FROM live_location_sessions s
         JOIN users_private u ON u.id = s.user_id
         WHERE s.guild_id = ? AND s.expires_at > ?`
      )
      .all(guildId, nowIso())
      .filter((s) => !blockedEitherWay(viewer.id, s.user_id));

    const sessionByUser = new Map(sessions.map((s) => [s.user_id, s]));

    const members = memberRows.map((m) => {
      const session = sessionByUser.get(m.user_id);
      const online = Boolean(m.show_activity) && isOnline(m.user_id);
      return {
        user_id: m.user_id,
        username: m.username,
        display_name: m.display_name,
        avatar_url: m.avatar_url,
        district: m.district,
        role: m.role,
        is_minor: Boolean(m.is_minor),
        rank_name: m.rank_name,
        rank_color: m.rank_color,
        online,
        sharing: Boolean(session),
        activity_visible: Boolean(m.show_activity),
        state: session ? 'sharing' : online ? 'online' : 'offline'
      };
    });

    const sharing_members = sessions.map((s) => {
      const member = memberRows.find((m) => m.user_id === s.user_id);
      return {
        user_id: s.user_id,
        username: member ? member.username : 'rider',
        display_name: member ? member.display_name : 'Rider',
        avatar_url: member ? member.avatar_url : '',
        role: member ? member.role : 'member',
        is_minor: Boolean(s.is_minor),
        lat: s.lat,
        lng: s.lng,
        accuracy_m: s.accuracy_m,
        radius_m: s.radius_m,
        precision_mode: s.precision_mode,
        updated_at: s.updated_at,
        started_at: s.started_at,
        expires_at: s.expires_at,
        seconds_remaining: Math.max(0, Math.floor((new Date(s.expires_at).getTime() - nowMs()) / 1000))
      };
    });

    const mine = db.prepare('SELECT * FROM live_location_sessions WHERE guild_id = ? AND user_id = ?').get(guildId, viewer.id);
    const consent = db
      .prepare('SELECT * FROM guild_share_consent WHERE guild_id = ? AND user_id = ?')
      .get(guildId, viewer.id);

    return {
      guild: {
        id: guild.id,
        name: guild.name,
        district: guild.district,
        privacy_type: guild.privacy_type,
        join_policy: guild.join_policy,
        member_limit: guild.member_limit
      },
      settings: {
        location_sharing_enabled: Boolean(settings.location_sharing_enabled),
        activity_visible: Boolean(settings.activity_visible)
      },
      permissions: { can_view_map: true, can_share: Boolean(settings.location_sharing_enabled) },
      my_consent: {
        allowed: Boolean(consent && consent.allowed),
        precision_allowed: Boolean(consent && consent.precision_allowed),
        consented_at: consent ? consent.consented_at : null,
        revoked_at: consent ? consent.revoked_at : null
      },
      my_session: mine
        ? {
            lat: mine.lat,
            lng: mine.lng,
            radius_m: mine.radius_m,
            precision_mode: mine.precision_mode,
            expires_at: mine.expires_at,
            seconds_remaining: Math.max(0, Math.floor((new Date(mine.expires_at).getTime() - nowMs()) / 1000))
          }
        : null,
      sharing_members,
      members,
      viewer: { user_id: viewer.id, is_minor: Boolean(viewer.is_minor) },
      limits: {
        max_session_minutes: MAX_SESSION_MINUTES,
        precise_session_minutes: PRECISE_SESSION_MINUTES,
        approx_radius_m: APPROX_RADIUS_M,
        minor_radius_m: MINOR_RADIUS_M,
        precise_radius_m: PRECISE_RADIUS_M,
        poll_seconds: 20
      },
      map: mapConfig(),
      retention: 'No location history is stored. A single current position is kept per member and deleted when sharing stops or the session lease expires.',
      generated_at: nowIso()
    };
  }

  return async function handle(req, res, pathname, parsedUrl) {
    /* ------------------------------- map config ------------------------------ */
    if (pathname === '/api/map/config' && req.method === 'GET') {
      const user = getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'UNAUTHENTICATED' }), true;
      return sendJson(res, 200, { map: mapConfig() }), true;
    }

    if (pathname === '/api/map/tile/probe' && req.method === 'GET') {
      // Diagnostics endpoint used by the UI's "map tiles unreachable" state.
      const cfg = mapConfig();
      return sendJson(res, 200, { reachable: null, checked_client_side: true, provider: cfg.provider }), true;
    }

    const match = pathname.match(/^\/api\/guilds\/([^/]+)\/live(?:\/([a-z-]+))?$/);
    if (!match) return false;

    const guildId = decodeURIComponent(match[1]);
    const action = match[2] || 'snapshot';
    const viewer = getAuthUser(req);
    if (!viewer) {
      sendJson(res, 401, { error: 'UNAUTHENTICATED', message: 'Sign in to use the guild map.' });
      return true;
    }

    const guild = db.prepare('SELECT * FROM guilds WHERE id = ? AND moderation_status != ?').get(guildId, 'removed');
    if (!guild) {
      sendJson(res, 404, { error: 'GUILD_NOT_FOUND' });
      return true;
    }

    const myMembership = membership(guildId, viewer.id);
    const isPlatformAdmin = viewer.role === 'admin';
    if (!myMembership && !isPlatformAdmin) {
      sendJson(res, 403, {
        error: 'GUILD_MEMBERS_ONLY',
        message: 'Live guild locations are visible only to current, active members of this guild.'
      });
      return true;
    }

    const settings = guildSettings(guildId);

    if (req.method === 'GET' && action === 'snapshot') {
      if (!checkRateLimit(`live:get:${viewer.id}`, 60, 60)) {
        sendJson(res, 429, { error: 'RATE_LIMITED', message: 'Refreshing too often. Wait a moment and try again.' });
        return true;
      }
      purgeExpired();
      const data = snapshot(guildId, viewer);
      sendJson(res, 200, data);
      return true;
    }

    if (req.method === 'POST' && action === 'consent') {
      const body = await readJsonBody(req);
      const allowed = body.allowed === true;
      const precisionAllowed = body.precision_allowed === true && !viewer.is_minor;
      const now = nowIso();
      if (!allowed) {
        db.prepare('DELETE FROM live_location_sessions WHERE guild_id = ? AND user_id = ?').run(guildId, viewer.id);
        audit(guildId, viewer.id, 'stopped', 'Consent revoked by member');
      }
      db.prepare(
        `INSERT INTO guild_share_consent (guild_id, user_id, allowed, precision_allowed, consented_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(guild_id, user_id) DO UPDATE SET
           allowed = excluded.allowed,
           precision_allowed = excluded.precision_allowed,
           consented_at = excluded.consented_at,
           revoked_at = excluded.revoked_at`
      ).run(guildId, viewer.id, allowed ? 1 : 0, precisionAllowed ? 1 : 0, allowed ? now : null, allowed ? null : now);
      sendJson(res, 200, {
        allowed,
        precision_allowed: precisionAllowed,
        message: allowed
          ? 'Location sharing consent recorded. Sharing still stays off until you start a session.'
          : 'Location sharing consent withdrawn. Any active session was stopped.'
      });
      return true;
    }

    if (req.method === 'POST' && action === 'start') {
      if (!settings.location_sharing_enabled) {
        sendJson(res, 403, {
          error: 'LOCATION_SHARING_DISABLED',
          message: 'Guild managers have disabled live location sharing for this guild.'
        });
        return true;
      }
      if (!checkRateLimit(`live:start:${viewer.id}`, 10, 60)) {
        sendJson(res, 429, { error: 'RATE_LIMITED', message: 'Too many start attempts. Wait a minute.' });
        return true;
      }
      const body = await readJsonBody(req);
      const coords = validateCoords(body.lat, body.lng);
      if (!coords) {
        sendJson(res, 400, {
          error: 'INVALID_COORDINATES',
          message: 'A valid GPS position is required. Enable device location, wait for a fix and try again.'
        });
        return true;
      }
      const consent = db
        .prepare('SELECT * FROM guild_share_consent WHERE guild_id = ? AND user_id = ?')
        .get(guildId, viewer.id);
      if (!consent || !consent.allowed) {
        sendJson(res, 403, {
          error: 'CONSENT_REQUIRED',
          message: 'Record your consent first: confirm who can see your location and for how long.'
        });
        return true;
      }

      const wantsPrecise = body.precision === 'precise';
      if (wantsPrecise && (viewer.is_minor || !consent.precision_allowed)) {
        sendJson(res, 403, {
          error: 'PRECISE_NOT_ALLOWED',
          message: viewer.is_minor
            ? 'Precise location is not available for riders aged 16–17. Approximate area sharing is used instead.'
            : 'Enable precise sharing in your consent settings before starting a precise session.'
        });
        return true;
      }

      const requestedMinutes = clamp(body.duration_minutes, 5, wantsPrecise ? PRECISE_SESSION_MINUTES : MAX_SESSION_MINUTES);
      const radius = wantsPrecise ? PRECISE_RADIUS_M : viewer.is_minor ? MINOR_RADIUS_M : APPROX_RADIUS_M;
      const point = wantsPrecise ? coords : snapToGrid(coords.lat, coords.lng, radius);
      const now = new Date();
      const expires = new Date(now.getTime() + requestedMinutes * 60_000).toISOString();

      db.prepare('DELETE FROM live_location_sessions WHERE guild_id = ? AND user_id = ?').run(guildId, viewer.id);
      db.prepare(
        `INSERT INTO live_location_sessions (id, guild_id, user_id, lat, lng, accuracy_m, precision_mode,
           radius_m, started_at, expires_at, last_seen_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        newId('lvs'),
        guildId,
        viewer.id,
        point.lat,
        point.lng,
        Number(body.accuracy_m) || null,
        wantsPrecise ? 'precise' : 'approximate',
        radius,
        now.toISOString(),
        expires,
        now.toISOString(),
        now.toISOString()
      );
      audit(guildId, viewer.id, 'started', `${wantsPrecise ? 'Precise' : 'Approximate'} session, ${requestedMinutes} min`);

      // Tell other online members to refresh without leaking coordinates in the event.
      const others = db
        .prepare("SELECT user_id FROM guild_memberships WHERE guild_id = ? AND status = 'active' AND user_id != ?")
        .all(guildId, viewer.id);
      if (notifier && notifier.stream) {
        for (const row of others) {
          notifier.stream.publish(row.user_id, 'live_map_changed', { guild_id: guildId, reason: 'member_started' });
        }
      }

      sendJson(res, 201, {
        message: `Sharing ${wantsPrecise ? 'precise' : 'approximate'} location with ${guild.name} for ${requestedMinutes} minutes.`,
        session: {
          precision_mode: wantsPrecise ? 'precise' : 'approximate',
          radius_m: radius,
          expires_at: expires,
          seconds_remaining: requestedMinutes * 60
        },
        snapshot: snapshot(guildId, viewer)
      });
      return true;
    }

    if (req.method === 'POST' && action === 'ping') {
      const body = await readJsonBody(req);
      const coords = validateCoords(body.lat, body.lng);
      const session = db
        .prepare('SELECT * FROM live_location_sessions WHERE guild_id = ? AND user_id = ?')
        .get(guildId, viewer.id);
      if (!session) {
        sendJson(res, 409, { error: 'NO_ACTIVE_SESSION', message: 'Sharing is not active. Start sharing again to appear on the map.' });
        return true;
      }
      if (!coords) {
        sendJson(res, 400, { error: 'INVALID_COORDINATES' });
        return true;
      }
      if (!checkRateLimit(`live:ping:${viewer.id}`, 30, 60)) {
        sendJson(res, 429, { error: 'RATE_LIMITED', message: 'Location updates are limited to protect battery and privacy.' });
        return true;
      }
      if (new Date(session.expires_at).getTime() < nowMs()) {
        db.prepare('DELETE FROM live_location_sessions WHERE id = ?').run(session.id);
        audit(guildId, viewer.id, 'expired', 'Lease ended before update');
        sendJson(res, 409, { error: 'SESSION_EXPIRED', message: 'Sharing time ended. Start a new session to continue.' });
        return true;
      }
      const point =
        session.precision_mode === 'precise' ? coords : snapToGrid(coords.lat, coords.lng, session.radius_m);
      db.prepare(
        'UPDATE live_location_sessions SET lat = ?, lng = ?, accuracy_m = ?, last_seen_at = ?, updated_at = ? WHERE id = ?'
      ).run(point.lat, point.lng, Number(body.accuracy_m) || null, nowIso(), nowIso(), session.id);
      sendJson(res, 200, {
        lat: point.lat,
        lng: point.lng,
        seconds_remaining: Math.max(0, Math.floor((new Date(session.expires_at).getTime() - nowMs()) / 1000))
      });
      return true;
    }

    if (req.method === 'POST' && action === 'stop') {
      const session = db
        .prepare('SELECT * FROM live_location_sessions WHERE guild_id = ? AND user_id = ?')
        .get(guildId, viewer.id);
      db.prepare('DELETE FROM live_location_sessions WHERE guild_id = ? AND user_id = ?').run(guildId, viewer.id);
      if (session) audit(guildId, viewer.id, 'stopped', 'Stopped by member');
      sendJson(res, 200, { message: 'Location sharing stopped. Your position was removed from the guild map.' });
      return true;
    }

    if (req.method === 'POST' && action === 'revoke') {
      const isGuildManager = myMembership && ['owner', 'moderator'].includes(myMembership.role);
      if (!isGuildManager && !isPlatformAdmin) {
        sendJson(res, 403, { error: 'FORBIDDEN', message: 'Only guild managers can stop another member’s share.' });
        return true;
      }
      const body = await readJsonBody(req);
      const targetId = String(body.user_id || '');
      if (!targetId) {
        sendJson(res, 400, { error: 'TARGET_REQUIRED' });
        return true;
      }
      db.prepare('DELETE FROM live_location_sessions WHERE guild_id = ? AND user_id = ?').run(guildId, targetId);
      db.prepare('UPDATE guild_share_consent SET allowed = 0, revoked_at = ? WHERE guild_id = ? AND user_id = ?').run(
        nowIso(),
        guildId,
        targetId
      );
      audit(guildId, targetId, 'revoked', `Stopped by ${viewer.username || viewer.id}`);
      notifySafe(targetId, {
        type: 'moderation',
        title: 'Location sharing stopped',
        body: `A guild manager stopped live location sharing for “${guild.name}”. You can start again after reviewing guild rules.`,
        referenceType: 'guild',
        referenceId: guildId,
        deepLink: `#/guild/${guildId}`
      });
      sendJson(res, 200, { message: 'Member location sharing stopped.' });
      return true;
    }

    if (req.method === 'POST' && action === 'activity') {
      const body = await readJsonBody(req);
      const show = body.show_activity !== false;
      db.prepare(
        `INSERT INTO guild_member_activity (guild_id, user_id, show_activity, notifications_level, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(guild_id, user_id) DO UPDATE SET show_activity = excluded.show_activity, updated_at = excluded.updated_at`
      ).run(guildId, viewer.id, show ? 1 : 0, String(body.notifications_level || 'all'), nowIso());
      sendJson(res, 200, { message: show ? 'Activity status visible to guild members.' : 'You now appear as not sharing.' });
      return true;
    }

    sendJson(res, 404, { error: 'LIVE_ACTION_NOT_FOUND' });
    return true;

    function notifySafe(userId, payload) {
      if (!notifier) return;
      try {
        notifier.notify({ userId, ...payload });
      } catch {
        /* notifications must not break the response */
      }
    }
  };
};
