// RideRise LK Phase 2 — Guild voice rooms and half-duplex walkie-talkie.
// Real WebRTC mesh signalling (offer/answer/ICE) with server-authoritative
// membership, room access and push-to-talk floor control. No audio is recorded.
'use strict';

const crypto = require('node:crypto');
const { nowIso, nowMs, newId, clamp } = require('./core');

const STALE_PARTICIPANT_MS = 45_000;
const SIGNAL_TTL_MS = 60_000;
const ROLE_RANK = { member: 1, moderator: 2, owner: 3 };

module.exports = function registerVoice(ctx) {
  const { db, sendJson, readJsonBody, getAuthUser, checkRateLimit, notifier } = ctx;

  const MAX_SIGNAL_BYTES = 64 * 1024;

  /* ------------------------------- ICE config ------------------------------ */
  function iceConfig(userId) {
    const servers = [];
    const stunUrls = (process.env.STUN_URLS || 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (stunUrls.length) servers.push({ urls: stunUrls });

    const turnUrls = (process.env.TURN_URLS || process.env.TURN_URL || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    let turnMode = 'none';
    const turnSecret = process.env.TURN_SECRET || '';
    const turnUser = process.env.TURN_USERNAME || '';
    const turnCred = process.env.TURN_CREDENTIAL || '';

    if (turnUrls.length && turnSecret) {
      // coturn "TURN REST API" ephemeral credentials: username is an expiry stamp
      // signed with HMAC-SHA1 so credentials cannot be reused indefinitely.
      const ttl = clamp(process.env.TURN_TTL_SECONDS, 3600, 86_400);
      const username = `${Math.floor(nowMs() / 1000) + ttl}:${userId}`;
      const credential = crypto.createHmac('sha1', turnSecret).update(username).digest('base64');
      servers.push({ urls: turnUrls, username, credential });
      turnMode = 'ephemeral';
    } else if (turnUrls.length && turnUser && turnCred) {
      servers.push({ urls: turnUrls, username: turnUser, credential: turnCred });
      turnMode = 'static';
    }

    return {
      iceServers: servers,
      stun_available: stunUrls.length > 0,
      turn_available: turnMode !== 'none',
      turn_mode: turnMode,
      note: turnMode
        ? 'TURN relay configured — calls can traverse strict NATs and mobile carriers.'
        : 'No TURN relay configured. Peer-to-peer audio works on many networks but can fail on strict carrier NAT. Add TURN_URLS + TURN_SECRET (see docs/PHASE2_VOICE_AND_MAP.md).',
      recording: false
    };
  }

  /* -------------------------------- helpers -------------------------------- */
  function getRoom(roomId) {
    return db.prepare('SELECT * FROM voice_rooms WHERE id = ?').get(roomId);
  }

  function guildSettings(guildId) {
    let row = db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guildId);
    if (!row) {
      db.prepare(
        `INSERT INTO guild_settings (guild_id, location_sharing_enabled, voice_enabled, walkie_enabled,
          activity_visible, rules_text, welcome_message, updated_at) VALUES (?, 1, 1, 1, 1, '', '', ?)`
      ).run(guildId, nowIso());
      row = db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guildId);
    }
    return row;
  }

  function activeMembership(guildId, userId) {
    return db
      .prepare("SELECT * FROM guild_memberships WHERE guild_id = ? AND user_id = ? AND status = 'active'")
      .get(guildId, userId);
  }

  function isBanned(roomId, userId) {
    return Boolean(db.prepare('SELECT 1 FROM voice_room_bans WHERE room_id = ? AND user_id = ?').get(roomId, userId));
  }

  function blockedEitherWay(a, b) {
    return Boolean(
      db
        .prepare(
          'SELECT 1 FROM user_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)'
        )
        .get(a, b, b, a)
    );
  }

  function pruneRoom(roomId) {
    const cutoff = new Date(nowMs() - STALE_PARTICIPANT_MS).toISOString();
    const stale = db
      .prepare('SELECT user_id FROM voice_participants WHERE room_id = ? AND last_seen_at < ?')
      .all(roomId, cutoff);
    for (const row of stale) {
      db.prepare('DELETE FROM voice_participants WHERE room_id = ? AND user_id = ?').run(roomId, row.user_id);
      db.prepare('DELETE FROM voice_floor WHERE room_id = ? AND holder_id = ?').run(roomId, row.user_id);
    }
    db.prepare('DELETE FROM voice_signals WHERE room_id = ? AND created_at < ?').run(
      roomId,
      new Date(nowMs() - SIGNAL_TTL_MS).toISOString()
    );
    const floor = db.prepare('SELECT * FROM voice_floor WHERE room_id = ?').get(roomId);
    if (floor && floor.expires_at <= nowIso()) {
      db.prepare('DELETE FROM voice_floor WHERE room_id = ?').run(roomId);
    }
  }

  function participants(roomId, viewerId) {
    const rows = db
      .prepare(
        `SELECT vp.*, p.username, p.display_name, p.avatar_url, u.is_minor
         FROM voice_participants vp
         JOIN profiles p ON p.user_id = vp.user_id
         JOIN users_private u ON u.id = vp.user_id
         WHERE vp.room_id = ? AND vp.last_seen_at >= ?
         ORDER BY vp.joined_at ASC`
      )
      .all(roomId, new Date(nowMs() - STALE_PARTICIPANT_MS).toISOString());
    return rows
      .filter((r) => !blockedEitherWay(viewerId, r.user_id))
      .map((r) => ({
        user_id: r.user_id,
        username: r.username,
        display_name: r.display_name,
        avatar_url: r.avatar_url,
        muted: Boolean(r.muted),
        self_muted: Boolean(r.self_muted),
        connection_state: r.connection_state,
        audio_route: r.audio_route,
        joined_at: r.joined_at,
        is_self: r.user_id === viewerId
      }));
  }

  function roomState(room, viewer) {
    pruneRoom(room.id);
    const floor = db.prepare('SELECT * FROM voice_floor WHERE room_id = ?').get(room.id);
    const attendance = db.prepare('SELECT * FROM voice_participants WHERE room_id = ? AND user_id = ?').get(room.id, viewer.id);
    return {
      room: {
        id: room.id,
        guild_id: room.guild_id,
        name: room.name,
        kind: room.kind,
        min_role: room.min_role,
        max_participants: room.max_participants,
        max_transmission_seconds: room.max_transmission_seconds,
        is_active: Boolean(room.is_active)
      },
      participants: participants(room.id, viewer.id),
      joined: Boolean(attendance),
      self: attendance
        ? {
            muted: Boolean(attendance.muted),
            self_muted: Boolean(attendance.self_muted),
            connection_state: attendance.connection_state,
            audio_route: attendance.audio_route
          }
        : null,
      floor: floor
        ? {
            holder_id: floor.holder_id,
            is_self: floor.holder_id === viewer.id,
            started_at: floor.started_at,
            expires_at: floor.expires_at,
            milliseconds_remaining: Math.max(0, new Date(floor.expires_at).getTime() - nowMs()),
            request_id: floor.request_id
          }
        : null,
      ice: iceConfig(viewer.id),
      recording: false,
      server_time: nowIso()
    };
  }

  function canEnter(room, user) {
    if (!room.is_active) return { ok: false, error: 'ROOM_INACTIVE', message: 'This room is currently closed by guild managers.' };
    const guild = db.prepare('SELECT * FROM guilds WHERE id = ?').get(room.guild_id);
    if (!guild) return { ok: false, error: 'GUILD_NOT_FOUND', message: 'This guild no longer exists.' };
    const settings = guildSettings(room.guild_id);
    if (room.kind === 'walkie' && !settings.walkie_enabled) {
      return { ok: false, error: 'WALKIE_DISABLED', message: 'Guild managers have disabled walkie-talkie mode.' };
    }
    if (room.kind === 'group' && !settings.voice_enabled) {
      return { ok: false, error: 'VOICE_DISABLED', message: 'Guild managers have disabled voice chat.' };
    }
    const membership = activeMembership(room.guild_id, user.id);
    if (!membership && user.role !== 'admin') {
      return { ok: false, error: 'GUILD_MEMBERS_ONLY', message: 'Only active members of this guild can join its voice rooms.' };
    }
    const myRank = user.role === 'admin' ? 99 : ROLE_RANK[membership.role] || 0;
    if (myRank < ROLE_RANK[room.min_role]) {
      return { ok: false, error: 'ROLE_TOO_LOW', message: `This channel is limited to guild ${room.min_role}s.` };
    }
    if (isBanned(room.id, user.id)) {
      return { ok: false, error: 'ROOM_BANNED', message: 'You were removed from this room by a guild moderator.' };
    }
    return { ok: true, guild, membership, isAdmin: user.role === 'admin' };
  }

  function guildRooms(guildId) {
    return db
      .prepare("SELECT * FROM voice_rooms WHERE guild_id = ? ORDER BY kind DESC, created_at ASC")
      .all(guildId)
      .map((room) => {
        const count = db
          .prepare('SELECT COUNT(*) AS c FROM voice_participants WHERE room_id = ? AND last_seen_at >= ?')
          .get(room.id, new Date(nowMs() - STALE_PARTICIPANT_MS).toISOString()).c;
        const floor = db.prepare('SELECT * FROM voice_floor WHERE room_id = ?').get(room.id);
        return {
          id: room.id,
          name: room.name,
          kind: room.kind,
          min_role: room.min_role,
          max_participants: room.max_participants,
          max_transmission_seconds: room.max_transmission_seconds,
          is_active: Boolean(room.is_active),
          participant_count: count,
          transmitting_user_id: floor ? floor.holder_id : null
        };
      });
  }

  return async function handle(req, res, pathname) {
    if (pathname === '/api/voice/ice' && req.method === 'GET') {
      const user = getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'UNAUTHENTICATED' }), true;
      return sendJson(res, 200, iceConfig(user.id)), true;
    }

    /* --------------------- guild-level room management --------------------- */
    const guildMatch = pathname.match(/^\/api\/guilds\/([^/]+)\/voice(?:\/rooms(?:\/([^/]+))?)?$/);
    if (guildMatch) {
      const guildId = decodeURIComponent(guildMatch[1]);
      const roomId = guildMatch[2] ? decodeURIComponent(guildMatch[2]) : null;
      const user = getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'UNAUTHENTICATED' }), true;
      const guild = db.prepare('SELECT * FROM guilds WHERE id = ?').get(guildId);
      if (!guild) return sendJson(res, 404, { error: 'GUILD_NOT_FOUND' }), true;
      const membership = activeMembership(guildId, user.id);
      const isManager = user.role === 'admin' || (membership && ['owner', 'moderator'].includes(membership.role));
      if (!membership && user.role !== 'admin') {
        return sendJson(res, 403, {
          error: 'GUILD_MEMBERS_ONLY',
          message: 'Guild voice rooms are visible only to active members of this guild.'
        }), true;
      }

      if (req.method === 'GET' && !roomId) {
        const settings = guildSettings(guildId);
        return sendJson(res, 200, {
          guild: { id: guild.id, name: guild.name },
          settings: {
            voice_enabled: Boolean(settings.voice_enabled),
            walkie_enabled: Boolean(settings.walkie_enabled)
          },
          rooms: guildRooms(guildId),
          ice: iceConfig(user.id),
          recording: false,
          can_manage: Boolean(isManager)
        }), true;
      }

      if (req.method === 'POST' && !roomId) {
        if (!isManager) return sendJson(res, 403, { error: 'FORBIDDEN', message: 'Only guild owners, moderators or admins can create channels.' }), true;
        const body = await readJsonBody(req);
        const name = String(body.name || '').trim().slice(0, 40);
        if (name.length < 2) return sendJson(res, 400, { error: 'INVALID_ROOM_NAME', message: 'Channel name must be at least 2 characters.' }), true;
        const kind = body.kind === 'walkie' ? 'walkie' : 'group';
        const minRole = ['moderator', 'owner'].includes(body.min_role) ? body.min_role : 'member';
        const id = newId(kind === 'walkie' ? 'vwr' : 'vrg');
        db.prepare(
          `INSERT INTO voice_rooms (id, guild_id, name, kind, min_role, max_participants, max_transmission_seconds,
             is_active, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
        ).run(
          id,
          guildId,
          name,
          kind,
          minRole,
          clamp(body.max_participants || (kind === 'walkie' ? 6 : 8), 2, 12),
          clamp(body.max_transmission_seconds || (kind === 'walkie' ? 30 : 30), 5, 120),
          user.id,
          nowIso()
        );
        db.prepare(
          'INSERT INTO guild_audit_logs (id, guild_id, actor_id, action, target_type, target_id, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(newId('gal'), guildId, user.id, 'voice_room_created', 'voice_room', id, JSON.stringify({ name, kind, minRole }), nowIso());
        return sendJson(res, 201, { room_id: id, rooms: guildRooms(guildId) }), true;
      }

      if (req.method === 'POST' && roomId) {
        if (!isManager) return sendJson(res, 403, { error: 'FORBIDDEN' }), true;
        const body = await readJsonBody(req);
        const room = db.prepare('SELECT * FROM voice_rooms WHERE id = ? AND guild_id = ?').get(roomId, guildId);
        if (!room) return sendJson(res, 404, { error: 'ROOM_NOT_FOUND' }), true;
        if (body.action === 'close') {
          db.prepare('UPDATE voice_rooms SET is_active = 0 WHERE id = ?').run(roomId);
          db.prepare('DELETE FROM voice_participants WHERE room_id = ?').run(roomId);
          db.prepare('DELETE FROM voice_signals WHERE room_id = ?').run(roomId);
          db.prepare('DELETE FROM voice_floor WHERE room_id = ?').run(roomId);
        } else if (body.action === 'open') {
          db.prepare('UPDATE voice_rooms SET is_active = 1 WHERE id = ?').run(roomId);
        } else if (body.action === 'delete') {
          db.prepare('DELETE FROM voice_rooms WHERE id = ?').run(roomId);
        } else {
          return sendJson(res, 400, { error: 'UNKNOWN_ACTION' }), true;
        }
        db.prepare(
          'INSERT INTO guild_audit_logs (id, guild_id, actor_id, action, target_type, target_id, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(newId('gal'), guildId, user.id, `voice_room_${body.action}`, 'voice_room', roomId, '{}', nowIso());
        return sendJson(res, 200, { rooms: guildRooms(guildId) }), true;
      }
      return sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED' }), true;
    }

    /* ----------------------- room-level participation ---------------------- */
    const roomMatch = pathname.match(/^\/api\/voice\/rooms\/([^/]+)\/([a-z-]+)(?:\/([a-z-]+))?$/);
    if (!roomMatch) return false;

    const roomId = decodeURIComponent(roomMatch[1]);
    const action = roomMatch[2];
    const subAction = roomMatch[3] || '';
    const user = getAuthUser(req);
    if (!user) return sendJson(res, 401, { error: 'UNAUTHENTICATED' }), true;

    const room = getRoom(roomId);
    if (!room) return sendJson(res, 404, { error: 'ROOM_NOT_FOUND', message: 'This voice room no longer exists.' }), true;
    const gate = canEnter(room, user);
    if (!gate.ok) return sendJson(res, 403, { error: gate.error, message: gate.message }), true;

    const joinedRow = db.prepare('SELECT * FROM voice_participants WHERE room_id = ? AND user_id = ?').get(roomId, user.id);

    if (action === 'state' && req.method === 'GET') {
      db.prepare('UPDATE voice_participants SET last_seen_at = ? WHERE room_id = ? AND user_id = ?').run(nowIso(), roomId, user.id);
      return sendJson(res, 200, roomState(room, user)), true;
    }

    if (action === 'join' && req.method === 'POST') {
      if (!checkRateLimit(`voice:join:${user.id}`, 20, 60)) {
        return sendJson(res, 429, { error: 'RATE_LIMITED', message: 'Too many join attempts.' }), true;
      }
      pruneRoom(roomId);
      const count = db
        .prepare('SELECT COUNT(*) AS c FROM voice_participants WHERE room_id = ? AND last_seen_at >= ?')
        .get(roomId, new Date(nowMs() - STALE_PARTICIPANT_MS).toISOString()).c;
      if (!joinedRow && count >= room.max_participants) {
        return sendJson(res, 409, {
          error: 'ROOM_FULL',
          message: `This room is full (${room.max_participants} participants). Try again when someone leaves.`
        }), true;
      }
      db.prepare(
        `INSERT INTO voice_participants (room_id, user_id, joined_at, last_seen_at, muted, self_muted, connection_state, audio_route)
         VALUES (?, ?, ?, ?, 0, 1, 'connected', 'speaker')
         ON CONFLICT(room_id, user_id) DO UPDATE SET last_seen_at = excluded.last_seen_at, connection_state = 'connected'`
      ).run(roomId, user.id, nowIso(), nowIso());
      const state = roomState(room, user);
      for (const p of state.participants) {
        if (p.user_id !== user.id) {
          try {
            notifier.stream.publish(p.user_id, 'voice_participant_joined', {
              room_id: roomId,
              user_id: user.id,
              display_name: user.display_name,
              count: state.participants.length
            });
          } catch {
            /* realtime is best effort */
          }
        }
      }
      return sendJson(res, 200, { joined: true, state }), true;
    }

    if (action === 'leave' && req.method === 'POST') {
      db.prepare('DELETE FROM voice_participants WHERE room_id = ? AND user_id = ?').run(roomId, user.id);
      db.prepare('DELETE FROM voice_floor WHERE room_id = ? AND holder_id = ?').run(roomId, user.id);
      db.prepare('DELETE FROM voice_signals WHERE room_id = ? AND (from_user = ? OR to_user = ?)').run(roomId, user.id, user.id);
      return sendJson(res, 200, { message: 'You left the voice room. Microphone released.' }), true;
    }

    if (action === 'heartbeat' && req.method === 'POST') {
      const body = await readJsonBody(req).catch(() => ({}));
      if (!joinedRow) return sendJson(res, 409, { error: 'NOT_IN_ROOM', message: 'You are not connected to this room.' }), true;
      db.prepare('UPDATE voice_participants SET last_seen_at = ?, connection_state = ?, audio_route = ? WHERE room_id = ? AND user_id = ?').run(
        nowIso(),
        String(body.connection_state || 'connected').slice(0, 20),
        String(body.audio_route || 'speaker').slice(0, 20),
        roomId,
        user.id
      );
      const state = roomState(room, user);
      return sendJson(res, 200, { state }), true;
    }

    if (action === 'mute' && req.method === 'POST') {
      const body = await readJsonBody(req);
      if (!joinedRow) return sendJson(res, 409, { error: 'NOT_IN_ROOM' }), true;
      db.prepare('UPDATE voice_participants SET self_muted = ?, muted = ? WHERE room_id = ? AND user_id = ?').run(
        body.muted === false ? 0 : 1,
        body.muted === false ? 0 : 1,
        roomId,
        user.id
      );
      if (body.muted !== false) {
        db.prepare('DELETE FROM voice_floor WHERE room_id = ? AND holder_id = ?').run(roomId, user.id);
      }
      return sendJson(res, 200, { muted: body.muted !== false }), true;
    }

    if (action === 'signal' && subAction === 'poll' && req.method === 'GET') {
      if (!joinedRow) return sendJson(res, 403, { error: 'NOT_IN_ROOM', message: 'Join the room before exchanging call signals.' }), true;
      pruneRoom(roomId);
      const rows = db
        .prepare('SELECT * FROM voice_signals WHERE room_id = ? AND to_user = ? ORDER BY created_at ASC LIMIT 40')
        .all(roomId, user.id);
      for (const row of rows) {
        db.prepare('DELETE FROM voice_signals WHERE id = ?').run(row.id);
      }
      return sendJson(res, 200, {
        signals: rows
          .filter((r) => !blockedEitherWay(user.id, r.from_user))
          .map((r) => ({ id: r.id, from: r.from_user, kind: r.kind, payload: JSON.parse(r.payload_json), created_at: r.created_at })),
        server_time: nowIso()
      }), true;
    }

    if (action === 'signal' && req.method === 'POST') {
      if (!joinedRow) return sendJson(res, 403, { error: 'NOT_IN_ROOM' }), true;
      if (!checkRateLimit(`voice:signal:${user.id}`, 180, 60)) {
        return sendJson(res, 429, { error: 'RATE_LIMITED', message: 'Signalling rate limit reached.' }), true;
      }
      const body = await readJsonBody(req, MAX_SIGNAL_BYTES + 4096);
      const to = String(body.to || '');
      const kind = String(body.kind || '');
      if (!['offer', 'answer', 'ice', 'renegotiate'].includes(kind)) {
        return sendJson(res, 400, { error: 'INVALID_SIGNAL_KIND' }), true;
      }
      const target = db.prepare('SELECT * FROM voice_participants WHERE room_id = ? AND user_id = ?').get(roomId, to);
      if (!target) return sendJson(res, 404, { error: 'TARGET_NOT_IN_ROOM' }), true;
      if (blockedEitherWay(user.id, to)) {
        return sendJson(res, 403, { error: 'BLOCKED', message: 'You cannot connect to a participant you blocked or who blocked you.' }), true;
      }
      const payloadJson = JSON.stringify(body.payload || {});
      if (Buffer.byteLength(payloadJson) > MAX_SIGNAL_BYTES) {
        return sendJson(res, 413, { error: 'SIGNAL_TOO_LARGE' }), true;
      }
      db.prepare(
        'INSERT INTO voice_signals (id, room_id, from_user, to_user, kind, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(newId('vsg'), roomId, user.id, to, kind, payloadJson, nowIso());
      return sendJson(res, 202, { queued: true }), true;
    }

    if (action === 'floor' && subAction === 'acquire' && req.method === 'POST') {
      if (!joinedRow) return sendJson(res, 403, { error: 'NOT_IN_ROOM', message: 'Join the channel before pressing to talk.' }), true;
      const body = await readJsonBody(req);
      const now = nowMs();
      const current = db.prepare('SELECT * FROM voice_floor WHERE room_id = ?').get(roomId);
      if (current && current.holder_id !== user.id && new Date(current.expires_at).getTime() > now) {
        const holder = db.prepare('SELECT username, display_name FROM profiles WHERE user_id = ?').get(current.holder_id);
        return sendJson(res, 409, {
          error: 'CHANNEL_BUSY',
          message: `${holder ? holder.display_name : 'Another rider'} is transmitting. Wait for the channel to clear.`,
          holder_id: current.holder_id,
          milliseconds_remaining: new Date(current.expires_at).getTime() - now
        }), true;
      }
      const maxSeconds = clamp(room.max_transmission_seconds, 5, 120);
      const expires = new Date(now + maxSeconds * 1000).toISOString();
      db.prepare(
        `INSERT INTO voice_floor (room_id, holder_id, started_at, expires_at, request_id)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(room_id) DO UPDATE SET holder_id = excluded.holder_id, started_at = excluded.started_at,
           expires_at = excluded.expires_at, request_id = excluded.request_id`
      ).run(roomId, user.id, new Date(now).toISOString(), expires, String(body.request_id || newId('ptt')).slice(0, 64));
      const peers = db.prepare('SELECT user_id FROM voice_participants WHERE room_id = ? AND user_id != ?').all(roomId, user.id);
      for (const p of peers) {
        try {
          notifier.stream.publish(p.user_id, 'ptt_floor', {
            room_id: roomId,
            holder_id: user.id,
            expires_at: expires,
            max_seconds: maxSeconds
          });
        } catch {
          /* best effort */
        }
      }
      return sendJson(res, 200, {
        granted: true,
        holder_id: user.id,
        expires_at: expires,
        max_seconds: maxSeconds,
        message: 'Channel granted. Speak now.'
      }), true;
    }

    if (action === 'floor' && subAction === 'release' && req.method === 'POST') {
      const floor = db.prepare('SELECT * FROM voice_floor WHERE room_id = ?').get(roomId);
      if (floor && floor.holder_id === user.id) {
        db.prepare('DELETE FROM voice_floor WHERE room_id = ?').run(roomId);
        const peers = db.prepare('SELECT user_id FROM voice_participants WHERE room_id = ? AND user_id != ?').all(roomId, user.id);
        for (const p of peers) {
          try {
            notifier.stream.publish(p.user_id, 'ptt_floor', { room_id: roomId, holder_id: null, released: true });
          } catch {
            /* best effort */
          }
        }
      }
      return sendJson(res, 200, { released: true }), true;
    }

    if (action === 'floor' && req.method === 'GET') {
      const floor = db.prepare('SELECT * FROM voice_floor WHERE room_id = ?').get(roomId);
      if (floor && new Date(floor.expires_at).getTime() <= nowMs()) {
        db.prepare('DELETE FROM voice_floor WHERE room_id = ?').run(roomId);
        return sendJson(res, 200, { floor: null }), true;
      }
      return sendJson(res, 200, {
        floor: floor
          ? {
              holder_id: floor.holder_id,
              is_self: floor.holder_id === user.id,
              expires_at: floor.expires_at,
              milliseconds_remaining: new Date(floor.expires_at).getTime() - nowMs()
            }
          : null
      }), true;
    }

    if (action === 'report' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const targetId = String(body.target_user_id || '');
      if (!targetId) return sendJson(res, 400, { error: 'TARGET_REQUIRED' }), true;
      const reason = String(body.reason || 'other');
      const allowedReasons = [
        'bullying_harassment', 'threats_violence', 'impersonation', 'unwanted_sexual_content',
        'suspicious_pii_request', 'dangerous_road_stunt', 'scam_marketplace', 'other'
      ];
      const id = newId('rep');
      db.prepare(
        `INSERT INTO reports (id, reporter_id, target_type, target_id, reason_category, details, status, created_at, severity, context_json)
         VALUES (?, ?, 'voice_session', ?, ?, ?, 'pending', ?, 'high', ?)`
      ).run(
        id,
        user.id,
        `${roomId}:${targetId}`,
        allowedReasons.includes(reason) ? reason : 'other',
        String(body.details || 'Reported from a guild voice session.').slice(0, 1000),
        nowIso(),
        JSON.stringify({ room_id: roomId, guild_id: room.guild_id, reported_user_id: targetId, room_kind: room.kind })
      );
      return sendJson(res, 201, {
        report_id: id,
        message: 'Voice session reported. Studio moderators review voice reports with priority. No audio is recorded by RideRise LK.'
      }), true;
    }

    if (action === 'block' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const targetId = String(body.target_user_id || '');
      if (!targetId) return sendJson(res, 400, { error: 'TARGET_REQUIRED' }), true;
      db.prepare('INSERT OR REPLACE INTO user_blocks (blocker_id, blocked_id, reason, created_at) VALUES (?, ?, ?, ?)').run(
        user.id,
        targetId,
        'Blocked from voice session',
        nowIso()
      );
      db.prepare('DELETE FROM voice_signals WHERE room_id = ? AND (from_user = ? OR to_user = ?)').run(roomId, targetId, targetId);
      return sendJson(res, 200, { message: 'Rider blocked. Their audio is muted and you will not be matched with them again.' }), true;
    }

    if (action === 'moderate' && req.method === 'POST') {
      const isManager = user.role === 'admin' || (gate.membership && ['owner', 'moderator'].includes(gate.membership.role));
      if (!isManager) return sendJson(res, 403, { error: 'FORBIDDEN' }), true;
      const body = await readJsonBody(req);
      const targetId = String(body.target_user_id || '');
      if (!targetId) return sendJson(res, 400, { error: 'TARGET_REQUIRED' }), true;
      if (body.action === 'kick') {
        db.prepare('DELETE FROM voice_participants WHERE room_id = ? AND user_id = ?').run(roomId, targetId);
        db.prepare('DELETE FROM voice_floor WHERE room_id = ? AND holder_id = ?').run(roomId, targetId);
      } else if (body.action === 'ban') {
        db.prepare('INSERT OR REPLACE INTO voice_room_bans (room_id, user_id, banned_by, created_at) VALUES (?, ?, ?, ?)').run(
          roomId,
          targetId,
          user.id,
          nowIso()
        );
        db.prepare('DELETE FROM voice_participants WHERE room_id = ? AND user_id = ?').run(roomId, targetId);
      } else if (body.action === 'unmute_all') {
        db.prepare('UPDATE voice_participants SET muted = 1 WHERE room_id = ? AND user_id != ?').run(roomId, user.id);
      } else {
        return sendJson(res, 400, { error: 'UNKNOWN_ACTION' }), true;
      }
      db.prepare(
        'INSERT INTO guild_audit_logs (id, guild_id, actor_id, action, target_type, target_id, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        newId('gal'),
        room.guild_id,
        user.id,
        `voice_${body.action}`,
        'user',
        targetId,
        JSON.stringify({ room_id: roomId }),
        nowIso()
      );
      return sendJson(res, 200, { message: `Participant ${body.action === 'unmute_all' ? 'muted' : body.action + 'ed'}.` }), true;
    }

    return sendJson(res, 404, { error: 'VOICE_ACTION_NOT_FOUND' }), true;
  };
};
