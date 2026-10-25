// RideRise LK Phase 2 — Direct messaging (receipts, reactions, replies, typing),
// notification centre/preferences, SSE realtime stream, studio news and feedback.
'use strict';

const { nowIso, newId, clamp, parseJson } = require('./core');

const SHORTENERS = ['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'is.gd', 'cutt.ly', 'rb.gy', 'shorturl.at'];

module.exports = function registerSocial2(ctx) {
  const { db, sendJson, readJsonBody, getAuthUser, checkRateLimit, stream, notifier, brandConfig, auditAdmin } = ctx;

  function areFriends(a, b) {
    return Boolean(
      db
        .prepare(
          `SELECT 1 FROM friendships WHERE status = 'accepted'
             AND ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?))`
        )
        .get(a, b, b, a)
    );
  }

  function blockedEitherWay(a, b) {
    return Boolean(
      db
        .prepare('SELECT 1 FROM user_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)')
        .get(a, b, b, a)
    );
  }

  function prefsFor(userId) {
    let row = db.prepare('SELECT * FROM notification_preferences WHERE user_id = ?').get(userId);
    if (!row) {
      db.prepare(
        `INSERT INTO notification_preferences (user_id, messages, friend_requests, guild_invites, events, moderation,
           news, show_previews, quiet_hours_start, quiet_hours_end, updated_at)
         VALUES (?, 1, 1, 1, 1, 1, 1, 1, NULL, NULL, ?)`
      ).run(userId, nowIso());
      row = db.prepare('SELECT * FROM notification_preferences WHERE user_id = ?').get(userId);
    }
    return row;
  }

  function findConversation(a, b) {
    return db
      .prepare(
        `SELECT * FROM conversations
         WHERE (user_a_id = ? AND user_b_id = ?) OR (user_a_id = ? AND user_b_id = ?)`
      )
      .get(a, b, b, a);
  }

  function ensureConversation(a, b) {
    let convo = findConversation(a, b);
    if (convo) return convo;
    const id = newId('conv');
    const now = nowIso();
    db.prepare(
      'INSERT INTO conversations (id, user_a_id, user_b_id, muted_by_a, muted_by_b, last_message_at, created_at) VALUES (?, ?, ?, 0, 0, ?, ?)'
    ).run(id, a, b, now, now);
    return db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
  }

  function conversationSettings(conversationId, userId) {
    let row = db
      .prepare('SELECT * FROM conversation_settings WHERE conversation_id = ? AND user_id = ?')
      .get(conversationId, userId);
    if (!row) {
      db.prepare(
        'INSERT INTO conversation_settings (conversation_id, user_id, muted, preview_allowed, archived) VALUES (?, ?, 0, 1, 0)'
      ).run(conversationId, userId);
      row = db.prepare('SELECT * FROM conversation_settings WHERE conversation_id = ? AND user_id = ?').get(conversationId, userId);
    }
    return row;
  }

  function reactionsFor(messageId) {
    const rows = db.prepare('SELECT emoji, COUNT(*) AS count FROM message_reactions WHERE message_id = ? GROUP BY emoji').all(messageId);
    return rows;
  }

  function serializeMessage(row, viewerId, counterPrefs) {
    const isMine = row.sender_id === viewerId;
    const hideReceipts = counterPrefs && counterPrefs.read_receipts === 0;
    return {
      id: row.id,
      conversation_id: row.conversation_id,
      sender_id: row.sender_id,
      body: row.deleted_at ? '' : row.body,
      deleted: Boolean(row.deleted_at),
      deleted_at: row.deleted_at,
      attachment_url: row.deleted_at ? '' : row.attachment_url,
      reply_to_id: row.reply_to_id || null,
      delivery_status: hideReceipts && !isMine ? 'delivered' : row.delivery_status,
      read_at: hideReceipts && !isMine ? null : row.read_at || null,
      delivered_at: row.delivered_at || null,
      created_at: row.created_at,
      edited_at: row.edited_at || null,
      reactions: reactionsFor(row.id),
      mine: isMine
    };
  }

  function flagSuspicious(text) {
    const urls = text.match(/https?:\/\/[^\s]+/gi) || [];
    const short = urls.filter((u) => SHORTENERS.some((s) => u.includes(s)));
    if (short.length) return 'shortened_link';
    if (urls.length >= 3) return 'many_links';
    if (/(\+94|0)\d{9}/.test(text.replace(/\s/g, '')) && /(bank|otp|password|wallet|deposit)/i.test(text)) return 'possible_scam';
    return '';
  }

  function onlineStatus(userId) {
    const { isOnline } = require('./core');
    return isOnline(userId);
  }

  return async function handle(req, res, pathname, parsedUrl) {
    /* ---------------------------- realtime stream --------------------------- */
    if (pathname === '/api/realtime/ticket' && req.method === 'POST') {
      const user = getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'UNAUTHENTICATED' }), true;
      const ticket = stream.issueTicket(user.id);
      return sendJson(res, 200, {
        ticket,
        url: `/api/realtime/stream?ticket=${ticket}`,
        expires_in: 60,
        note: 'Tickets are single-use and expire after 60 seconds.'
      }), true;
    }

    if (pathname === '/api/realtime/stream' && req.method === 'GET') {
      const ticket = parsedUrl.searchParams.get('ticket') || '';
      const userId = stream.consumeTicket(ticket);
      if (!userId) {
        sendJson(res, 403, { error: 'INVALID_TICKET', message: 'Realtime ticket is invalid or already used. Request a new one.' });
        return true;
      }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        'Access-Control-Allow-Origin': '*'
      });
      res.write('retry: 3000\n\n');
      res.write(`event: ready\ndata: ${JSON.stringify({ user_id: userId, server_time: nowIso() })}\n\n`);
      const unsubscribe = stream.subscribe(userId, res);
      const ping = setInterval(() => {
        try {
          res.write(': keep-alive\n\n');
        } catch {
          /* connection closed */
        }
      }, 25_000);
      if (ping.unref) ping.unref();
      req.on('close', () => {
        clearInterval(ping);
        unsubscribe();
      });
      return true;
    }

    /* -------------------------------- DM threads ---------------------------- */
    if (pathname === '/api/dm/threads' && req.method === 'GET') {
      const user = getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'UNAUTHENTICATED' }), true;
      const convos = db
        .prepare('SELECT * FROM conversations WHERE user_a_id = ? OR user_b_id = ? ORDER BY last_message_at DESC LIMIT 100')
        .all(user.id, user.id);
      const threads = [];
      for (const c of convos) {
        const friendId = c.user_a_id === user.id ? c.user_b_id : c.user_a_id;
        if (blockedEitherWay(user.id, friendId)) continue;
        const friend = db
          .prepare('SELECT user_id, username, display_name, avatar_url, district FROM profiles WHERE user_id = ?')
          .get(friendId);
        if (!friend) continue;
        const settings = conversationSettings(c.id, user.id);
        if (settings.archived) continue;
        const last = db
          .prepare("SELECT * FROM messages WHERE conversation_id = ? AND moderation_status = 'visible' ORDER BY created_at DESC LIMIT 1")
          .get(c.id);
        const unread = db
          .prepare(
            "SELECT COUNT(*) AS c FROM messages WHERE conversation_id = ? AND sender_id != ? AND moderation_status = 'visible' AND (read_at IS NULL AND delivery_status != 'read')"
          )
          .get(c.id, user.id).c;
        threads.push({
          conversation_id: c.id,
          friend,
          online: onlineStatus(friendId),
          muted: Boolean(settings.muted),
          preview_allowed: Boolean(settings.preview_allowed),
          archived: Boolean(settings.archived),
          last_message: last ? serializeMessage(last, user.id, null) : null,
          unread_count: unread,
          last_message_at: c.last_message_at
        });
      }
      return sendJson(res, 200, { threads }), true;
    }

    const dmMatch = pathname.match(/^\/api\/dm\/threads\/([^/]+)(?:\/([a-z-]+))?$/);
    if (dmMatch) {
      const user = getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'UNAUTHENTICATED' }), true;
      const friendId = decodeURIComponent(dmMatch[1]);
      const action = dmMatch[2] || '';

      const friend = db.prepare('SELECT user_id FROM profiles WHERE user_id = ?').get(friendId);
      if (!friend) return sendJson(res, 404, { error: 'USER_NOT_FOUND' }), true;
      if (blockedEitherWay(user.id, friendId)) {
        return sendJson(res, 403, {
          error: 'CONTACT_BLOCKED',
          message: 'Messaging is unavailable while a block is active between these accounts.'
        }), true;
      }
      const friends = areFriends(user.id, friendId);
      const isAdmin = user.role === 'admin';
      if (!friends) {
        return sendJson(res, 403, {
          error: 'FRIENDS_ONLY_MESSAGING',
          message: 'Safety policy: private messages only between accepted friends. Send a friend request first.'
        }), true;
      }
      const convo = ensureConversation(user.id, friendId);
      const settings = conversationSettings(convo.id, user.id);

      if (!action && req.method === 'GET') {
        const before = parsedUrl.searchParams.get('before');
        const limit = clamp(parsedUrl.searchParams.get('limit') || 40, 1, 100);
        const rows = db
          .prepare(
            `SELECT * FROM messages WHERE conversation_id = ? AND moderation_status = 'visible'
             ${before ? 'AND created_at < ?' : ''} ORDER BY created_at DESC LIMIT ?`
          )
          .all(...(before ? [convo.id, before, limit] : [convo.id, limit]));
        const ordered = rows.reverse();
        // Mark delivered/read for my own unread inbound messages.
        const now = nowIso();
        db.prepare(
          "UPDATE messages SET delivery_status = 'read', read_at = COALESCE(read_at, ?) WHERE conversation_id = ? AND sender_id != ? AND delivery_status != 'read'"
        ).run(now, convo.id, user.id);
        const friendPrefs = prefsFor(friendId);
        const typing = db
          .prepare('SELECT * FROM typing_indicators WHERE conversation_id = ? AND user_id != ? AND updated_at > ?')
          .all(convo.id, user.id, new Date(Date.now() - 8000).toISOString());
        const friendProfile = db
          .prepare('SELECT user_id, username, display_name, avatar_url, district FROM profiles WHERE user_id = ?')
          .get(friendId);
        return sendJson(res, 200, {
          conversation_id: convo.id,
          friend: friendProfile,
          online: onlineStatus(friendId),
          messages: ordered.map((m) => serializeMessage(m, user.id, friendPrefs)),
          typing: typing.map((t) => ({ user_id: t.user_id })),
          settings: {
            muted: Boolean(settings.muted),
            preview_allowed: Boolean(settings.preview_allowed),
            read_receipts_shared: friendPrefs.read_receipts !== 0
          },
          next_before: ordered.length === limit ? ordered[0].created_at : null,
          retention_note: 'Messages are deleted automatically after the server retention window. Deleted messages show a placeholder for both people.'
        }), true;
      }

      if (!action && req.method === 'POST') {
        if (!checkRateLimit(`dm:send:${user.id}`, brandConfig.rateLimits.messagesPerWindow, brandConfig.rateLimits.windowSeconds)) {
          return sendJson(res, 429, { error: 'RATE_LIMITED', message: 'You are sending messages too quickly. Slow down and try again.' }), true;
        }
        const body = await readJsonBody(req);
        const text = String(body.body || '').trim().slice(0, 4000);
        const attachment = String(body.attachment_url || '').slice(0, 500);
        if (!text && !attachment) return sendJson(res, 400, { error: 'EMPTY_MESSAGE', message: 'Write a message first.' }), true;
        let replyTo = null;
        if (body.reply_to_id) {
          const parent = db.prepare('SELECT * FROM messages WHERE id = ? AND conversation_id = ?').get(String(body.reply_to_id), convo.id);
          if (parent) replyTo = parent.id;
        }
        const now = nowIso();
        const id = newId('msg');
        const flag = flagSuspicious(text);
        db.prepare(
          `INSERT INTO messages (id, conversation_id, sender_id, body, attachment_url, delivery_status, moderation_status,
             created_at, reply_to_id, delivered_at, flagged_reason)
           VALUES (?, ?, ?, ?, ?, 'delivered', 'visible', ?, ?, ?, ?)`
        ).run(id, convo.id, user.id, text, attachment, now, replyTo, now, flag);
        db.prepare('UPDATE conversations SET last_message_at = ? WHERE id = ?').run(now, convo.id);

        const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
        const payload = serializeMessage(row, friendId, null);
        stream.publish(friendId, 'message', {
          ...payload,
          conversation_id: convo.id,
          from: { user_id: user.id, username: user.username, display_name: user.display_name, avatar_url: user.avatar_url }
        });

        const friendSettings = conversationSettings(convo.id, friendId);
        const friendPrefs = prefsFor(friendId);
        if (!friendSettings.muted && friendPrefs.messages !== 0) {
          notifier.notify({
            userId: friendId,
            type: 'message',
            title: `New message from @${user.username}`,
            body: text.slice(0, 120) || 'Sent an attachment',
            referenceType: 'user',
            referenceId: friendId,
            deepLink: `#/messages/${friendId}`,
            sensitive: true
          });
        }
        return sendJson(res, 201, {
          message: serializeMessage(row, user.id, null),
          warning: flag ? 'This message contains links that may be unsafe. Never share OTPs, bank details or passwords.' : null
        }), true;
      }

      if (action === 'typing' && req.method === 'POST') {
        db.prepare(
          `INSERT INTO typing_indicators (conversation_id, user_id, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(conversation_id, user_id) DO UPDATE SET updated_at = excluded.updated_at`
        ).run(convo.id, user.id, nowIso());
        stream.publish(friendId, 'typing', { conversation_id: convo.id, user_id: user.id });
        return sendJson(res, 200, { ok: true }), true;
      }

      if (action === 'read' && req.method === 'POST') {
        db.prepare(
          "UPDATE messages SET delivery_status = 'read', read_at = COALESCE(read_at, ?) WHERE conversation_id = ? AND sender_id != ?"
        ).run(nowIso(), convo.id, user.id);
        const myPrefs = prefsFor(user.id);
        if (myPrefs.read_receipts !== 0) {
          stream.publish(friendId, 'read_receipt', { conversation_id: convo.id, reader_id: user.id, at: nowIso() });
        }
        return sendJson(res, 200, { ok: true, receipts_shared: myPrefs.read_receipts !== 0 }), true;
      }

      if (action === 'settings' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const next = {
          muted: body.muted === undefined ? settings.muted : body.muted ? 1 : 0,
          preview_allowed: body.preview_allowed === undefined ? settings.preview_allowed : body.preview_allowed ? 1 : 0,
          archived: body.archived === undefined ? settings.archived : body.archived ? 1 : 0
        };
        db.prepare(
          'UPDATE conversation_settings SET muted = ?, preview_allowed = ?, archived = ? WHERE conversation_id = ? AND user_id = ?'
        ).run(next.muted, next.preview_allowed, next.archived, convo.id, user.id);
        return sendJson(res, 200, {
          settings: { muted: Boolean(next.muted), preview_allowed: Boolean(next.preview_allowed), archived: Boolean(next.archived) }
        }), true;
      }
    }

    /* -------------------------- message-level actions ----------------------- */
    const msgMatch = pathname.match(/^\/api\/dm\/messages\/([^/]+)(?:\/([a-z-]+))?$/);
    if (msgMatch) {
      const user = getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'UNAUTHENTICATED' }), true;
      const messageId = decodeURIComponent(msgMatch[1]);
      const action = msgMatch[2] || '';
      const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
      if (!row) return sendJson(res, 404, { error: 'MESSAGE_NOT_FOUND' }), true;
      const convo = db.prepare('SELECT * FROM conversations WHERE id = ?').get(row.conversation_id);
      const participant = convo && (convo.user_a_id === user.id || convo.user_b_id === user.id);
      if (!participant && user.role !== 'admin') {
        return sendJson(res, 403, { error: 'FORBIDDEN', message: 'You can only act on messages in your own conversations.' }), true;
      }

      if (action === 'reactions' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const emoji = String(body.emoji || '').slice(0, 8);
        if (!emoji) return sendJson(res, 400, { error: 'EMOJI_REQUIRED' }), true;
        const existing = db
          .prepare('SELECT 1 FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?')
          .get(messageId, user.id, emoji);
        if (existing) {
          db.prepare('DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').run(messageId, user.id, emoji);
        } else {
          db.prepare('INSERT INTO message_reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)').run(
            messageId,
            user.id,
            emoji,
            nowIso()
          );
        }
        const reactions = reactionsFor(messageId);
        const peerId = convo.user_a_id === user.id ? convo.user_b_id : convo.user_a_id;
        stream.publish(peerId, 'reaction', { message_id: messageId, conversation_id: convo.id, reactions });
        return sendJson(res, 200, { reactions, toggled: !existing }), true;
      }

      if (req.method === 'DELETE') {
        const isOwner = row.sender_id === user.id;
        const isModerator = user.role === 'admin';
        if (!isOwner && !isModerator) {
          return sendJson(res, 403, { error: 'FORBIDDEN', message: 'Only the sender or a studio moderator can delete a message.' }), true;
        }
        db.prepare(
          "UPDATE messages SET body = '', attachment_url = '', deleted_at = ?, deleted_by = ?, moderation_status = 'visible' WHERE id = ?"
        ).run(nowIso(), user.id, messageId);
        if (isModerator && !isOwner) {
          auditAdmin(user.id, 'message_deleted', 'message', messageId, 'Deleted via moderation tools', { conversation_id: row.conversation_id });
          notifier.notify({
            userId: row.sender_id,
            type: 'moderation',
            title: 'A message was removed',
            body: 'A studio moderator removed one of your private messages after a report. Repeated violations can restrict your account.',
            referenceType: 'message',
            referenceId: messageId,
            deepLink: '#/notifications'
          });
        }
        const peerId = convo.user_a_id === user.id ? convo.user_b_id : convo.user_a_id;
        stream.publish(peerId, 'message_deleted', { message_id: messageId, conversation_id: convo.id });
        return sendJson(res, 200, { message: 'Message deleted.' }), true;
      }
    }

    /* ----------------------------- notification feed ------------------------ */
    if (pathname === '/api/notifications/feed' && req.method === 'GET') {
      const user = getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'UNAUTHENTICATED' }), true;
      const limit = clamp(parsedUrl.searchParams.get('limit') || 30, 1, 100);
      const before = parsedUrl.searchParams.get('before');
      const rows = db
        .prepare(
          `SELECT * FROM notifications WHERE user_id = ? ${before ? 'AND created_at < ?' : ''}
           ORDER BY created_at DESC LIMIT ?`
        )
        .all(...(before ? [user.id, before, limit] : [user.id, limit]));
      const unread = db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0').get(user.id).c;
      return sendJson(res, 200, {
        notifications: rows.map((n) => ({
          ...n,
          is_read: Boolean(n.is_read),
          deep_link: deepLinkFor(n)
        })),
        unread,
        next_before: rows.length === limit ? rows[rows.length - 1].created_at : null
      }), true;
    }

    if (pathname.match(/^\/api\/notifications\/[^/]+\/read$/) && req.method === 'POST') {
      const user = getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'UNAUTHENTICATED' }), true;
      const id = decodeURIComponent(pathname.split('/')[3]);
      const row = db.prepare('SELECT * FROM notifications WHERE id = ? AND user_id = ?').get(id, user.id);
      if (!row) return sendJson(res, 404, { error: 'NOTIFICATION_NOT_FOUND' }), true;
      db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(id);
      return sendJson(res, 200, { is_read: true }), true;
    }

    if (pathname === '/api/notifications/preferences') {
      const user = getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'UNAUTHENTICATED' }), true;
      if (req.method === 'GET') return sendJson(res, 200, { preferences: prefsFor(user.id) }), true;
      if (req.method === 'PUT') {
        const body = await readJsonBody(req);
        const p = prefsFor(user.id);
        const bit = (v, fb) => (v === undefined ? fb : v ? 1 : 0);
        db.prepare(
          `UPDATE notification_preferences SET messages = ?, friend_requests = ?, guild_invites = ?, events = ?,
             moderation = ?, news = ?, show_previews = ?, read_receipts = ?, quiet_hours_start = ?, quiet_hours_end = ?, updated_at = ?
           WHERE user_id = ?`
        ).run(
          bit(body.messages, p.messages),
          bit(body.friend_requests, p.friend_requests),
          bit(body.guild_invites, p.guild_invites),
          bit(body.events, p.events),
          bit(body.moderation, p.moderation),
          bit(body.news, p.news),
          bit(body.show_previews, p.show_previews),
          bit(body.read_receipts, p.read_receipts === undefined ? 1 : p.read_receipts),
          body.quiet_hours_start === undefined ? p.quiet_hours_start : body.quiet_hours_start,
          body.quiet_hours_end === undefined ? p.quiet_hours_end : body.quiet_hours_end,
          nowIso(),
          user.id
        );
        return sendJson(res, 200, { preferences: prefsFor(user.id), message: 'Notification preferences saved.' }), true;
      }
    }

    /* ------------------------------- device tokens -------------------------- */
    if (pathname === '/api/devices' && req.method === 'POST') {
      const user = getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'UNAUTHENTICATED' }), true;
      const body = await readJsonBody(req);
      const token = String(body.token || '').trim();
      if (token.length < 20) return sendJson(res, 400, { error: 'INVALID_TOKEN', message: 'A valid FCM registration token is required.' }), true;
      db.prepare(
        `INSERT INTO device_tokens (id, user_id, token, platform, app_version, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, token) DO UPDATE SET last_seen_at = excluded.last_seen_at, app_version = excluded.app_version`
      ).run(newId('dvt'), user.id, token, String(body.platform || 'android'), String(body.app_version || ''), nowIso(), nowIso());
      return sendJson(res, 201, { message: 'Device registered for push notifications.' }), true;
    }

    if (pathname === '/api/devices' && req.method === 'DELETE') {
      const user = getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'UNAUTHENTICATED' }), true;
      const body = await readJsonBody(req);
      db.prepare('DELETE FROM device_tokens WHERE user_id = ? AND token = ?').run(user.id, String(body.token || ''));
      return sendJson(res, 200, { message: 'Device removed.' }), true;
    }

    /* ---------------------------------- news -------------------------------- */
    if (pathname === '/api/news' && req.method === 'GET') {
      const rows = db
        .prepare(
          `SELECT n.*, p.display_name AS author_name FROM studio_news n
           LEFT JOIN profiles p ON p.user_id = n.author_admin_id
           WHERE n.published = 1 ORDER BY n.pinned DESC, n.published_at DESC LIMIT 50`
        )
        .all();
      return sendJson(res, 200, { news: rows }), true;
    }

    /* -------------------------------- feedback ------------------------------ */
    if (pathname === '/api/feedback' && req.method === 'POST') {
      const user = getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'UNAUTHENTICATED', message: 'Sign in to send feedback to the studio.' }), true;
      if (!checkRateLimit(`feedback:${user.id}`, 5, 300)) {
        return sendJson(res, 429, { error: 'RATE_LIMITED', message: 'Feedback is limited to 5 messages per 5 minutes.' }), true;
      }
      const body = await readJsonBody(req);
      const subject = String(body.subject || '').trim().slice(0, 160);
      const text = String(body.body || '').trim().slice(0, 4000);
      if (subject.length < 3 || text.length < 5) {
        return sendJson(res, 400, { error: 'FEEDBACK_INCOMPLETE', message: 'Add a short subject and a description.' }), true;
      }
      const id = newId('fbk');
      const category = ['bug', 'safety', 'abuse', 'idea', 'general'].includes(body.category) ? body.category : 'general';
      const priority = category === 'safety' || category === 'abuse' ? 'high' : 'normal';
      db.prepare(
        `INSERT INTO feedback_messages (id, user_id, category, subject, body, contact_email, status, priority, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'new', ?, ?, ?)`
      ).run(id, user.id, category, subject, text, String(body.contact_email || '').slice(0, 160), priority, nowIso(), nowIso());
      const admins = db.prepare("SELECT id FROM users_private WHERE role IN ('admin','moderator') AND account_status = 'active'").all();
      for (const a of admins) {
        notifier.notify({
          userId: a.id,
          type: 'moderation',
          title: `${priority === 'high' ? '⚠ High priority' : 'New'} feedback: ${subject}`,
          body: `@${user.username} · ${category}`,
          referenceType: 'feedback',
          referenceId: id,
          deepLink: '#/admin?tab=feedback'
        });
      }
      return sendJson(res, 201, { id, message: 'Feedback delivered to the studio admin inbox.' }), true;
    }

    return false;
  };

  function deepLinkFor(notification) {
    const type = notification.type;
    const map = {
      message: () => (notification.reference_id ? `#/messages/${notification.reference_id}` : '#/messages'),
      friend_request: () => '#/friends?tab=requests',
      friend_accept: () => '#/friends',
      guild_invite: () => '#/guilds?filter=invites',
      guild_announcement: () => (notification.reference_id ? `#/guild/${notification.reference_id}?tab=announcements` : '#/guilds'),
      guild_join_request: () => (notification.reference_id ? `#/guild/${notification.reference_id}?tab=members` : '#/guilds'),
      event_reminder: () => '#/events',
      event_announcement: () => '#/events',
      moderation: () => '#/notifications',
      news: () => '#/news',
      system: () => '#/notifications'
    };
    if (map[type]) return map[type]();
    if (notification.reference_type === 'guild' && notification.reference_id) return `#/guild/${notification.reference_id}`;
    return '#/notifications';
  }
};
