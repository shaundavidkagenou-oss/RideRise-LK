// RideRise LK Phase 2 — Advanced guild management: announcements, discussions,
// guild events with RSVP/waitlist, settings, audit history and appeals.
'use strict';

const { nowIso, newId, clamp } = require('./core');

module.exports = function registerGuilds2(ctx) {
  const { db, sendJson, readJsonBody, getAuthUser, checkRateLimit, notifier } = ctx;

  function guildOr404(guildId) {
    return db.prepare("SELECT * FROM guilds WHERE id = ? AND moderation_status != 'removed'").get(guildId);
  }

  function membershipOf(guildId, userId) {
    return db.prepare('SELECT * FROM guild_memberships WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
  }

  function settingsFor(guildId) {
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

  function audit(guildId, actorId, action, targetType, targetId, details = {}) {
    db.prepare(
      `INSERT INTO guild_audit_logs (id, guild_id, actor_id, action, target_type, target_id, details_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(newId('gal'), guildId, actorId, action, targetType || '', targetId || '', JSON.stringify(details), nowIso());
  }

  function profileMini(userId) {
    return db
      .prepare('SELECT user_id, username, display_name, avatar_url FROM profiles WHERE user_id = ?')
      .get(userId);
  }

  function notifyGuild(guildId, { type, title, body, referenceType, referenceId, deepLink, excludeUserId }) {
    const members = db
      .prepare("SELECT user_id FROM guild_memberships WHERE guild_id = ? AND status = 'active'")
      .all(guildId);
    for (const m of members) {
      if (m.user_id === excludeUserId) continue;
      try {
        notifier.notify({
          userId: m.user_id,
          type,
          title,
          body,
          referenceType,
          referenceId,
          deepLink
        });
      } catch {
        /* notification failure must not break the request */
      }
    }
  }

  async function guard(guildId, req, res, { requireMember = true, requireManager = false } = {}) {
    const user = getAuthUser(req);
    if (!user) {
      sendJson(res, 401, { error: 'UNAUTHENTICATED' });
      return null;
    }
    const guild = guildOr404(guildId);
    if (!guild) {
      sendJson(res, 404, { error: 'GUILD_NOT_FOUND' });
      return null;
    }
    const membership = membershipOf(guildId, user.id);
    const isManager = user.role === 'admin' || (membership && membership.status === 'active' && ['owner', 'moderator'].includes(membership.role));
    if (requireManager && !isManager) {
      sendJson(res, 403, { error: 'FORBIDDEN', message: 'Only guild owners, moderators or studio admins can do that.' });
      return null;
    }
    if (requireMember && (!membership || membership.status !== 'active') && user.role !== 'admin') {
      sendJson(res, 403, { error: 'GUILD_MEMBERS_ONLY', message: 'This area is for active members of the guild.' });
      return null;
    }
    return { user, guild, membership, isManager };
  }

  return async function handle(req, res, pathname) {
    if (!pathname.startsWith('/api/guilds/')) return false;
    const parts = pathname.split('/').filter(Boolean); // api, guilds, :id, ...
    if (parts.length < 4) return false;
    const guildId = decodeURIComponent(parts[2]);
    const section = parts[3];
    const itemId = parts[4] ? decodeURIComponent(parts[4]) : null;
    const subAction = parts[5] || '';

    if (!['settings', 'announcements', 'discussions', 'events', 'audit', 'appeals', 'hub', 'rules', 'leave'].includes(section)) return false;

    /* --------------------------------- hub ---------------------------------- */
    if (section === 'hub' && req.method === 'GET') {
      const g = await guard(guildId, req, res);
      if (!g) return true;
      const settings = settingsFor(guildId);
      const memberCount = db
        .prepare("SELECT COUNT(*) AS c FROM guild_memberships WHERE guild_id = ? AND status = 'active'")
        .get(guildId).c;
      const pendingCount = db
        .prepare("SELECT COUNT(*) AS c FROM guild_memberships WHERE guild_id = ? AND status = 'pending_approval'")
        .get(guildId).c;
      const announcements = db
        .prepare(
          `SELECT ga.*, p.username, p.display_name, p.avatar_url
           FROM guild_announcements ga JOIN profiles p ON p.user_id = ga.author_id
           WHERE ga.guild_id = ? AND ga.moderation_status = 'visible'
           ORDER BY ga.pinned DESC, ga.created_at DESC LIMIT 20`
        )
        .all(guildId);
      const discussions = db
        .prepare(
          `SELECT gd.*, p.username, p.display_name, p.avatar_url
           FROM guild_discussions gd JOIN profiles p ON p.user_id = gd.author_id
           WHERE gd.guild_id = ? AND gd.moderation_status = 'visible'
           ORDER BY gd.pinned DESC, gd.created_at DESC LIMIT 30`
        )
        .all(guildId);
      const events = db
        .prepare(
          `SELECT ge.*, (SELECT COUNT(*) FROM guild_event_rsvps r WHERE r.event_id = ge.id AND r.status = 'going') AS going_count,
                  (SELECT COUNT(*) FROM guild_event_rsvps r WHERE r.event_id = ge.id AND r.status = 'waitlist') AS waitlist_count,
                  (SELECT status FROM guild_event_rsvps r WHERE r.event_id = ge.id AND r.user_id = ?) AS my_rsvp
           FROM guild_events ge WHERE ge.guild_id = ? ORDER BY ge.starts_at ASC`
        )
        .all(g.user.id, guildId);
      const rooms = db
        .prepare('SELECT * FROM voice_rooms WHERE guild_id = ? ORDER BY kind DESC, created_at ASC')
        .all(guildId)
        .map((r) => ({
          ...r,
          is_active: Boolean(r.is_active),
          participant_count: db.prepare('SELECT COUNT(*) AS c FROM voice_participants WHERE room_id = ?').get(r.id).c
        }));
      const rules = db.prepare('SELECT rules_text FROM guilds WHERE id = ?').get(guildId).rules_text || settings.rules_text;
      const memberRows = db
        .prepare(
          `SELECT m.user_id, m.role, m.status, m.joined_at, p.username, p.display_name, p.avatar_url,
                  COALESCE(a.show_activity, 1) AS show_activity
           FROM guild_memberships m
           JOIN profiles p ON p.user_id = m.user_id
           LEFT JOIN guild_member_activity a ON a.guild_id = m.guild_id AND a.user_id = m.user_id
           WHERE m.guild_id = ?
           ORDER BY (m.status = 'active') DESC, (m.role = 'owner') DESC, (m.role = 'moderator') DESC, p.display_name ASC`
        )
        .all(guildId)
        .filter((m) => m.status === 'active' || g.isManager);
      const myAppeals = db
        .prepare('SELECT * FROM guild_appeals WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC')
        .all(guildId, g.user.id);
      return sendJson(res, 200, {
        guild: {
          id: g.guild.id,
          name: g.guild.name,
          description: g.guild.description,
          announcement: g.guild.announcement,
          district: g.guild.district,
          category: g.guild.category,
          emblem: g.guild.emblem,
          privacy_type: g.guild.privacy_type,
          join_policy: g.guild.join_policy,
          member_limit: g.guild.member_limit,
          owner_id: g.guild.owner_id,
          rules_text: rules
        },
        my_role: g.membership ? g.membership.role : 'admin_override',
        is_manager: g.isManager,
        is_studio_admin: g.user.role === 'admin',
        member_count: memberCount,
        pending_count: g.isManager ? pendingCount : 0,
        settings: {
          location_sharing_enabled: Boolean(settings.location_sharing_enabled),
          voice_enabled: Boolean(settings.voice_enabled),
          walkie_enabled: Boolean(settings.walkie_enabled),
          activity_visible: Boolean(settings.activity_visible),
          welcome_message: settings.welcome_message,
          rules_text: rules
        },
        announcements,
        discussions,
        events,
        rooms,
        members: memberRows,
        my_appeals: myAppeals
      }), true;
    }

    /* ------------------------------- settings ------------------------------- */
    if (section === 'settings') {
      if (req.method === 'GET') {
        const g = await guard(guildId, req, res, { requireMember: false });
        if (!g) return true;
        const settings = settingsFor(guildId);
        return sendJson(res, 200, {
          settings,
          join_policy: g.guild.join_policy,
          can_manage: g.isManager
        }), true;
      }
      if (req.method === 'PUT') {
        const g = await guard(guildId, req, res, { requireManager: true });
        if (!g) return true;
        const body = await readJsonBody(req);
        const current = settingsFor(guildId);
        const flag = (value, fallback) => (value === undefined ? fallback : value === true || value === 1 ? 1 : 0);
        db.prepare(
          `UPDATE guild_settings SET location_sharing_enabled = ?, voice_enabled = ?, walkie_enabled = ?,
             activity_visible = ?, rules_text = ?, welcome_message = ?, updated_at = ?, updated_by = ? WHERE guild_id = ?`
        ).run(
          flag(body.location_sharing_enabled, current.location_sharing_enabled),
          flag(body.voice_enabled, current.voice_enabled),
          flag(body.walkie_enabled, current.walkie_enabled),
          flag(body.activity_visible, current.activity_visible),
          String(body.rules_text ?? current.rules_text).slice(0, 4000),
          String(body.welcome_message ?? current.welcome_message).slice(0, 500),
          nowIso(),
          g.user.id,
          guildId
        );
        if (body.rules_text !== undefined) {
          db.prepare('UPDATE guilds SET rules_text = ?, updated_at = ? WHERE id = ?').run(String(body.rules_text).slice(0, 4000), nowIso(), guildId);
        }
        if (['open', 'approval', 'invite_only'].includes(body.join_policy)) {
          db.prepare('UPDATE guilds SET join_policy = ?, privacy_type = ?, updated_at = ? WHERE id = ?').run(
            body.join_policy,
            body.join_policy === 'open' ? 'public' : 'private',
            nowIso(),
            guildId
          );
        }
        // Turning sharing off must immediately clear every live session.
        if (body.location_sharing_enabled === false) {
          const sessions = db.prepare('SELECT user_id FROM live_location_sessions WHERE guild_id = ?').all(guildId);
          db.prepare('DELETE FROM live_location_sessions WHERE guild_id = ?').run(guildId);
          for (const s of sessions) {
            db.prepare(
              'INSERT INTO live_location_audit (id, guild_id, user_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)'
            ).run(newId('lla'), guildId, s.user_id, 'revoked', 'Guild disabled location sharing', nowIso());
          }
        }
        audit(guildId, g.user.id, 'settings_updated', 'guild', guildId, {
          location_sharing_enabled: body.location_sharing_enabled,
          voice_enabled: body.voice_enabled,
          join_policy: body.join_policy
        });
        return sendJson(res, 200, { message: 'Guild settings saved.', settings: settingsFor(guildId) }), true;
      }
    }

    /* ---------------------------- announcements ---------------------------- */
    if (section === 'announcements') {
      if (req.method === 'GET') {
        const g = await guard(guildId, req, res);
        if (!g) return true;
        const rows = db
          .prepare(
            `SELECT ga.*, p.username, p.display_name, p.avatar_url
             FROM guild_announcements ga JOIN profiles p ON p.user_id = ga.author_id
             WHERE ga.guild_id = ? AND ga.moderation_status = 'visible'
             ORDER BY ga.pinned DESC, ga.created_at DESC LIMIT 50`
          )
          .all(guildId)
          .map((r) => ({ ...r, media: JSON.parse(r.media_json || '[]'), pinned: Boolean(r.pinned) }));
        return sendJson(res, 200, { announcements: rows, can_manage: g.isManager }), true;
      }
      if (req.method === 'POST' && !itemId) {
        const g = await guard(guildId, req, res, { requireManager: true });
        if (!g) return true;
        const body = await readJsonBody(req);
        const title = String(body.title || '').trim().slice(0, 140);
        const text = String(body.body || '').trim().slice(0, 6000);
        if (title.length < 3 || text.length < 3) {
          return sendJson(res, 400, { error: 'INVALID_ANNOUNCEMENT', message: 'Give the announcement a title and a message.' }), true;
        }
        if (!checkRateLimit(`guild:announce:${g.user.id}`, 10, 300)) {
          return sendJson(res, 429, { error: 'RATE_LIMITED', message: 'Announcements are limited to 10 per 5 minutes.' }), true;
        }
        const id = newId('gan');
        db.prepare(
          `INSERT INTO guild_announcements (id, guild_id, author_id, title, body, media_json, pinned, moderation_status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'visible', ?, ?)`
        ).run(id, guildId, g.user.id, title, text, JSON.stringify(body.media || []), body.pinned ? 1 : 0, nowIso(), nowIso());
        audit(guildId, g.user.id, 'announcement_created', 'announcement', id, { title });
        notifyGuild(guildId, {
          type: 'guild_announcement',
          title: `${g.guild.name}: ${title}`,
          body: text.slice(0, 160),
          referenceType: 'guild_announcement',
          referenceId: id,
          deepLink: `#/guild/${guildId}?tab=announcements`,
          excludeUserId: g.user.id
        });
        return sendJson(res, 201, { id, message: 'Announcement published to the guild.' }), true;
      }
      if (req.method === 'POST' && itemId && subAction === 'pin') {
        const g = await guard(guildId, req, res, { requireManager: true });
        if (!g) return true;
        const row = db.prepare('SELECT * FROM guild_announcements WHERE id = ? AND guild_id = ?').get(itemId, guildId);
        if (!row) return sendJson(res, 404, { error: 'ANNOUNCEMENT_NOT_FOUND' }), true;
        db.prepare('UPDATE guild_announcements SET pinned = ?, updated_at = ? WHERE id = ?').run(row.pinned ? 0 : 1, nowIso(), itemId);
        audit(guildId, g.user.id, row.pinned ? 'announcement_unpinned' : 'announcement_pinned', 'announcement', itemId, {});
        return sendJson(res, 200, { pinned: !row.pinned }), true;
      }
      if (req.method === 'DELETE' && itemId) {
        const g = await guard(guildId, req, res);
        if (!g) return true;
        const row = db.prepare('SELECT * FROM guild_announcements WHERE id = ? AND guild_id = ?').get(itemId, guildId);
        if (!row) return sendJson(res, 404, { error: 'ANNOUNCEMENT_NOT_FOUND' }), true;
        if (row.author_id !== g.user.id && !g.isManager) {
          return sendJson(res, 403, { error: 'FORBIDDEN', message: 'Only the author or a guild manager can remove this announcement.' }), true;
        }
        db.prepare("UPDATE guild_announcements SET moderation_status = 'removed', updated_at = ? WHERE id = ?").run(nowIso(), itemId);
        audit(guildId, g.user.id, 'announcement_removed', 'announcement', itemId, {});
        return sendJson(res, 200, { message: 'Announcement removed.' }), true;
      }
    }

    /* ------------------------------ discussions ----------------------------- */
    if (section === 'discussions') {
      if (req.method === 'GET') {
        const g = await guard(guildId, req, res);
        if (!g) return true;
        const before = req.url.includes('before=') ? decodeURIComponent(new URL(req.url, 'http://x').searchParams.get('before')) : null;
        const limit = clamp(new URL(req.url, 'http://x').searchParams.get('limit') || 20, 1, 50);
        const rows = db
          .prepare(
            `SELECT gd.*, p.username, p.display_name, p.avatar_url
             FROM guild_discussions gd JOIN profiles p ON p.user_id = gd.author_id
             WHERE gd.guild_id = ? AND gd.moderation_status = 'visible' ${before ? 'AND gd.created_at < ?' : ''}
             ORDER BY gd.pinned DESC, gd.created_at DESC LIMIT ?`
          )
          .all(...(before ? [guildId, before, limit] : [guildId, limit]));
        return sendJson(res, 200, { discussions: rows, next_before: rows.length === limit ? rows[rows.length - 1].created_at : null }), true;
      }
      if (req.method === 'POST' && !itemId) {
        const g = await guard(guildId, req, res);
        if (!g) return true;
        if (!checkRateLimit(`guild:discuss:${g.user.id}`, 12, 60)) {
          return sendJson(res, 429, { error: 'RATE_LIMITED', message: 'Slow down — guild posting is limited.' }), true;
        }
        const body = await readJsonBody(req);
        const text = String(body.body || '').trim().slice(0, 4000);
        if (!text) return sendJson(res, 400, { error: 'EMPTY_POST' }), true;
        const id = newId('gds');
        db.prepare(
          `INSERT INTO guild_discussions (id, guild_id, author_id, title, body, media_url, media_type, pinned, moderation_status, reply_to_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'visible', ?, ?)`
        ).run(
          id,
          guildId,
          g.user.id,
          String(body.title || '').slice(0, 160),
          text,
          String(body.media_url || '').slice(0, 500),
          ['image', 'video'].includes(body.media_type) ? body.media_type : 'none',
          body.reply_to_id || null,
          nowIso()
        );
        return sendJson(res, 201, { id, message: 'Posted to the guild discussion feed.' }), true;
      }
      if (req.method === 'DELETE' && itemId) {
        const g = await guard(guildId, req, res);
        if (!g) return true;
        const row = db.prepare('SELECT * FROM guild_discussions WHERE id = ? AND guild_id = ?').get(itemId, guildId);
        if (!row) return sendJson(res, 404, { error: 'POST_NOT_FOUND' }), true;
        if (row.author_id !== g.user.id && !g.isManager) {
          return sendJson(res, 403, { error: 'FORBIDDEN' }), true;
        }
        db.prepare("UPDATE guild_discussions SET moderation_status = 'removed' WHERE id = ?").run(itemId);
        audit(guildId, g.user.id, 'discussion_removed', 'discussion', itemId, {});
        return sendJson(res, 200, { message: 'Post removed.' }), true;
      }
    }

    /* -------------------------------- events -------------------------------- */
    if (section === 'events') {
      if (req.method === 'GET') {
        const g = await guard(guildId, req, res);
        if (!g) return true;
        const rows = db
          .prepare(
            `SELECT ge.*,
                (SELECT COUNT(*) FROM guild_event_rsvps r WHERE r.event_id = ge.id AND r.status = 'going') AS going_count,
                (SELECT COUNT(*) FROM guild_event_rsvps r WHERE r.event_id = ge.id AND r.status = 'waitlist') AS waitlist_count,
                (SELECT status FROM guild_event_rsvps r WHERE r.event_id = ge.id AND r.user_id = ?) AS my_rsvp
             FROM guild_events ge WHERE ge.guild_id = ? ORDER BY ge.starts_at ASC`
          )
          .all(g.user.id, guildId);
        return sendJson(res, 200, { events: rows, can_manage: g.isManager }), true;
      }
      if (req.method === 'POST' && !itemId) {
        const g = await guard(guildId, req, res, { requireManager: true });
        if (!g) return true;
        const body = await readJsonBody(req);
        const title = String(body.title || '').trim().slice(0, 140);
        const starts = String(body.starts_at || '').trim();
        if (title.length < 3 || !starts || Number.isNaN(new Date(starts).getTime())) {
          return sendJson(res, 400, { error: 'INVALID_EVENT', message: 'A title and a valid start date/time are required.' }), true;
        }
        const id = newId('gev');
        db.prepare(
          `INSERT INTO guild_events (id, guild_id, title, description, category, venue, district, starts_at, ends_at,
             capacity, waitlist_enabled, rules_text, safety_requirements, status, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?)`
        ).run(
          id,
          guildId,
          title,
          String(body.description || '').slice(0, 4000),
          String(body.category || 'meetup').slice(0, 40),
          String(body.venue || '').slice(0, 200),
          String(body.district || g.guild.district).slice(0, 60),
          new Date(starts).toISOString(),
          body.ends_at ? new Date(body.ends_at).toISOString() : null,
          clamp(body.capacity || 40, 2, 500),
          body.waitlist_enabled === false ? 0 : 1,
          String(body.rules_text || '').slice(0, 3000),
          String(body.safety_requirements || '').slice(0, 3000),
          g.user.id,
          nowIso()
        );
        audit(guildId, g.user.id, 'guild_event_created', 'guild_event', id, { title });
        notifyGuild(guildId, {
          type: 'event_reminder',
          title: `New ${g.guild.name} event: ${title}`,
          body: `${new Date(starts).toLocaleString('en-GB')} · ${body.venue || g.guild.district}`,
          referenceType: 'guild_event',
          referenceId: id,
          deepLink: `#/guild/${guildId}?tab=events`,
          excludeUserId: g.user.id
        });
        return sendJson(res, 201, { id, message: 'Guild event created.' }), true;
      }
      if (req.method === 'POST' && itemId) {
        const g = await guard(guildId, req, res);
        if (!g) return true;
        const event = db.prepare('SELECT * FROM guild_events WHERE id = ? AND guild_id = ?').get(itemId, guildId);
        if (!event) return sendJson(res, 404, { error: 'EVENT_NOT_FOUND' }), true;
        const body = await readJsonBody(req);

        if (subAction === 'cancel' && g.isManager) {
          db.prepare("UPDATE guild_events SET status = 'cancelled' WHERE id = ?").run(itemId);
          audit(guildId, g.user.id, 'guild_event_cancelled', 'guild_event', itemId, {});
          notifyGuild(guildId, {
            type: 'event_announcement',
            title: `${event.title} was cancelled`,
            body: 'The organizer cancelled this guild event.',
            referenceType: 'guild_event',
            referenceId: itemId,
            deepLink: `#/guild/${guildId}?tab=events`
          });
          return sendJson(res, 200, { message: 'Event cancelled and members notified.' }), true;
        }

        if (event.status === 'cancelled') return sendJson(res, 400, { error: 'EVENT_CANCELLED' }), true;

        const existing = db.prepare('SELECT * FROM guild_event_rsvps WHERE event_id = ? AND user_id = ?').get(itemId, g.user.id);
        if (body.action === 'cancel' || subAction === 'cancel-rsvp') {
          db.prepare(
            `INSERT INTO guild_event_rsvps (event_id, user_id, status, created_at, updated_at) VALUES (?, ?, 'cancelled', ?, ?)
             ON CONFLICT(event_id, user_id) DO UPDATE SET status = 'cancelled', updated_at = excluded.updated_at`
          ).run(itemId, g.user.id, nowIso(), nowIso());
          // Promote the first person on the waiting list.
          const next = db
            .prepare("SELECT * FROM guild_event_rsvps WHERE event_id = ? AND status = 'waitlist' ORDER BY created_at ASC LIMIT 1")
            .get(itemId);
          if (next) {
            db.prepare("UPDATE guild_event_rsvps SET status = 'going', updated_at = ? WHERE event_id = ? AND user_id = ?").run(
              nowIso(),
              itemId,
              next.user_id
            );
            notifier.notify({
              userId: next.user_id,
              type: 'event_reminder',
              title: `You are off the waitlist: ${event.title}`,
              body: 'A place opened up and you are now registered.',
              referenceType: 'guild_event',
              referenceId: itemId,
              deepLink: `#/guild/${guildId}?tab=events`
            });
          }
          return sendJson(res, 200, { status: 'cancelled', message: 'RSVP cancelled.' }), true;
        }

        const going = db
          .prepare("SELECT COUNT(*) AS c FROM guild_event_rsvps WHERE event_id = ? AND status = 'going'")
          .get(itemId).c;
        if (existing && existing.status === 'going') return sendJson(res, 200, { status: 'going', message: 'You are already registered.' }), true;
        if (going >= event.capacity) {
          if (!event.waitlist_enabled) return sendJson(res, 409, { error: 'EVENT_FULL', message: 'This event is full and has no waiting list.' }), true;
          db.prepare(
            `INSERT INTO guild_event_rsvps (event_id, user_id, status, created_at, updated_at) VALUES (?, ?, 'waitlist', ?, ?)
             ON CONFLICT(event_id, user_id) DO UPDATE SET status = 'waitlist', updated_at = excluded.updated_at`
          ).run(itemId, g.user.id, nowIso(), nowIso());
          return sendJson(res, 200, { status: 'waitlist', message: 'Event is full — you were added to the waiting list.' }), true;
        }
        db.prepare(
          `INSERT INTO guild_event_rsvps (event_id, user_id, status, created_at, updated_at) VALUES (?, ?, 'going', ?, ?)
           ON CONFLICT(event_id, user_id) DO UPDATE SET status = 'going', updated_at = excluded.updated_at`
        ).run(itemId, g.user.id, nowIso(), nowIso());
        return sendJson(res, 200, { status: 'going', message: 'You are registered. Meet safely and follow the organizer rules.' }), true;
      }
    }

    /* -------------------------------- appeals ------------------------------- */
    if (section === 'appeals') {
      if (req.method === 'GET') {
        const g = await guard(guildId, req, res);
        if (!g) return true;
        const rows = g.isManager
          ? db
              .prepare(
                `SELECT a.*, p.username FROM guild_appeals a JOIN profiles p ON p.user_id = a.user_id
                 WHERE a.guild_id = ? ORDER BY a.created_at DESC LIMIT 100`
              )
              .all(guildId)
          : db.prepare('SELECT * FROM guild_appeals WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC').all(guildId, g.user.id);
        return sendJson(res, 200, { appeals: rows, can_review: g.isManager }), true;
      }
      if (req.method === 'POST' && !itemId) {
        const g = await guard(guildId, req, res);
        if (!g) return true;
        const body = await readJsonBody(req);
        const message = String(body.message || '').trim().slice(0, 2000);
        if (message.length < 10) return sendJson(res, 400, { error: 'APPEAL_TOO_SHORT', message: 'Explain what happened in at least 10 characters.' }), true;
        if (!checkRateLimit(`guild:appeal:${g.user.id}`, 3, 3600)) {
          return sendJson(res, 429, { error: 'RATE_LIMITED', message: 'You can submit up to 3 appeals per hour.' }), true;
        }
        const id = newId('gap');
        db.prepare(
          `INSERT INTO guild_appeals (id, guild_id, user_id, action_ref, message, status, created_at)
           VALUES (?, ?, ?, ?, ?, 'pending', ?)`
        ).run(id, guildId, g.user.id, String(body.action_ref || '').slice(0, 120), message, nowIso());
        notifyGuild(guildId, {
          type: 'moderation',
          title: 'Guild moderation appeal submitted',
          body: `@${g.user.username} appealed a guild decision.`,
          referenceType: 'guild_appeal',
          referenceId: id,
          deepLink: `#/guild/${guildId}?tab=appeals`
        });
        return sendJson(res, 201, { id, message: 'Appeal sent to guild managers. Unresolved appeals can be escalated to studio support.' }), true;
      }
      if (req.method === 'POST' && itemId && subAction === 'resolve') {
        const g = await guard(guildId, req, res, { requireManager: true });
        if (!g) return true;
        const body = await readJsonBody(req);
        const decision = body.decision === 'overturned' ? 'overturned' : 'upheld';
        const row = db.prepare('SELECT * FROM guild_appeals WHERE id = ? AND guild_id = ?').get(itemId, guildId);
        if (!row) return sendJson(res, 404, { error: 'APPEAL_NOT_FOUND' }), true;
        db.prepare('UPDATE guild_appeals SET status = ?, reviewer_id = ?, resolution = ?, resolved_at = ? WHERE id = ?').run(
          decision,
          g.user.id,
          String(body.resolution || '').slice(0, 1000),
          nowIso(),
          itemId
        );
        audit(guildId, g.user.id, `appeal_${decision}`, 'guild_appeal', itemId, {});
        notifier.notify({
          userId: row.user_id,
          type: 'moderation',
          title: `Guild appeal ${decision}`,
          body: String(body.resolution || 'Your appeal was reviewed by guild managers.').slice(0, 300),
          referenceType: 'guild',
          referenceId: guildId,
          deepLink: `#/guild/${guildId}?tab=appeals`
        });
        return sendJson(res, 200, { status: decision }), true;
      }
    }

    /* --------------------------------- audit -------------------------------- */
    if (section === 'audit' && req.method === 'GET') {
      const g = await guard(guildId, req, res, { requireManager: true });
      if (!g) return true;
      const rows = db
        .prepare(
          `SELECT l.*, p.username AS actor_username
           FROM guild_audit_logs l LEFT JOIN profiles p ON p.user_id = l.actor_id
           WHERE l.guild_id = ? ORDER BY l.created_at DESC LIMIT 200`
        )
        .all(guildId)
        .map((r) => ({ ...r, details: JSON.parse(r.details_json || '{}') }));
      return sendJson(res, 200, { audit: rows }), true;
    }

    return false;
  };
};
