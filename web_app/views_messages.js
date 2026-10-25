/* RideRise LK — Messaging, notification centre and studio news (Phase 2).
 * Friends-only private messaging with replies, reactions, receipts, mute and
 * delete. Realtime updates arrive over SSE and degrade to polling gracefully.
 */
(function () {
  'use strict';

  const { api, state, escapeHtml, toast, avatar, timeAgo, emptyState, errorState, skeletonList, onRouteCleanup, modal, closeModal } =
    window.RR;

  const QUICK_REACTIONS = ['👍', '🔥', '😂', '❤️', '🚲'];

  async function renderThreads(viewport) {
    if (!state.token) {
      location.hash = '#/welcome';
      return;
    }
    viewport.innerHTML = `<div class="section-head"><div><h2>Messages</h2><p class="muted">Friends only. Blocked accounts disappear from both sides instantly.</p></div></div><div id="threadList">${skeletonList(3)}</div>`;
    try {
      const data = await api('/api/dm/threads');
      const host = viewport.querySelector('#threadList');
      host.innerHTML = data.threads.length
        ? `<div class="convo-list">${data.threads
            .map(
              (t) => `<button class="convo-row" data-thread="${escapeHtml(t.friend.user_id)}">
                <div class="convo-avatar">${avatar(t.friend.avatar_url, t.friend.display_name, 46)}${t.online ? '<span class="online-dot" aria-label="Online"></span>' : ''}</div>
                <div class="convo-text">
                  <strong>${escapeHtml(t.friend.display_name)}</strong>
                  <small>${t.last_message ? (t.last_message.deleted ? 'Message deleted' : escapeHtml(t.last_message.body.slice(0, 60))) : 'Say hello'}</small>
                </div>
                <div class="convo-side">
                  <small>${escapeHtml(timeAgo(t.last_message_at))}</small>
                  ${t.unread_count ? `<span class="unread-badge">${t.unread_count}</span>` : ''}
                  ${t.muted ? '<span class="muted" title="Muted">🔕</span>' : ''}
                </div>
              </button>`
            )
            .join('')}</div>`
        : emptyState({
            icon: '💬',
            title: 'No conversations yet',
            body: 'Messaging opens once you and another rider accept a friend request. This keeps unsolicited contact out of your inbox.',
            actionHtml: '<button class="btn btn-primary" onclick="location.hash=\'#/friends\'">Find riders</button>'
          });
      host.querySelectorAll('[data-thread]').forEach((row) =>
        row.addEventListener('click', () => (location.hash = `#/messages/${row.dataset.thread}`))
      );
    } catch (err) {
      viewport.querySelector('#threadList').innerHTML = errorState(err);
    }
  }

  async function renderThread(viewport, friendId) {
    if (!state.token) {
      location.hash = '#/welcome';
      return;
    }
    let friend = null;
    let settings = { muted: false, preview_allowed: true };
    let messages = [];
    let oldest = null;
    let replyTo = null;
    let typingTimeout = null;
    let realtime = null;

    viewport.innerHTML = `
      <div class="section-head">
        <div>
          <button class="btn btn-secondary btn-sm" id="backThreads" style="margin-bottom:8px">← Messages</button>
          <h2 id="threadName">Conversation</h2>
          <p class="muted" id="threadStatus">Loading…</p>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn btn-secondary btn-sm" id="muteThread">🔕 Mute</button>
          <button class="btn btn-secondary btn-sm" id="prefsThread">⚙️ Previews</button>
          <button class="btn btn-danger btn-sm" id="blockThread">⛔ Block</button>
        </div>
      </div>
      <div class="chat-window card">
        <div class="chat-scroll" id="chatScroll"><div class="skeleton"></div></div>
        <div id="typingLine" class="typing-line" aria-live="polite"></div>
        <div id="replyBanner" class="reply-banner" hidden></div>
        <form class="chat-composer" id="chatForm">
          <textarea class="form-textarea" id="chatInput" rows="1" placeholder="Write a message…" aria-label="Message"></textarea>
          <button class="btn btn-primary" type="submit" id="sendBtn">Send</button>
        </form>
        <p class="hint chat-privacy">Private messages are visible to you and your friend. Studio moderators only review a message that has been formally reported. Nothing here is end-to-end encrypted — do not share passwords, OTPs or bank details.</p>
      </div>`;

    viewport.querySelector('#backThreads').addEventListener('click', () => (location.hash = '#/messages'));
    const scroll = viewport.querySelector('#chatScroll');

    function bubble(m) {
      const mine = m.mine || (state.account && m.sender_id === state.account.id);
      const reply = m.reply_to_id ? messages.find((x) => x.id === m.reply_to_id) : null;
      return `<div class="bubble-row ${mine ? 'is-mine' : ''}">
        ${!mine ? avatar(friend && friend.avatar_url, friend && friend.display_name, 28) : ''}
        <div class="bubble-wrap">
          ${reply ? `<div class="bubble-quote">${escapeHtml((reply.body || 'Message').slice(0, 80))}</div>` : ''}
          <div class="bubble ${m.deleted ? 'is-deleted' : ''}">
            ${m.deleted ? '<em>Message deleted</em>' : escapeHtml(m.body)}
            ${m.attachment_url && !m.deleted ? `<img class="bubble-img" src="${escapeHtml(m.attachment_url)}" alt="Attachment" loading="lazy" />` : ''}
          </div>
          <div class="bubble-meta">
            <span>${escapeHtml(timeAgo(m.created_at))}</span>
            ${mine ? `<span>${m.delivery_status === 'read' ? '✓✓ Read' : m.delivery_status === 'delivered' ? '✓ Delivered' : '✓ Sent'}</span>` : ''}
            <span class="bubble-actions">
              <button class="icon-btn" data-react="${escapeHtml(m.id)}" aria-label="React">☺</button>
              <button class="icon-btn" data-reply="${escapeHtml(m.id)}" aria-label="Reply">↩</button>
              ${mine ? `<button class="icon-btn" data-delete="${escapeHtml(m.id)}" aria-label="Delete">🗑️</button>` : ''}
            </span>
          </div>
          ${
            m.reactions && m.reactions.length
              ? `<div class="reaction-row">${m.reactions.map((r) => `<span class="reaction">${escapeHtml(r.emoji)} ${r.count}</span>`).join('')}</div>`
              : ''
          }
        </div>
      </div>`;
    }

    function paint() {
      if (!messages.length) {
        scroll.innerHTML = emptyState({ icon: '👋', title: 'Start the conversation', body: 'Say hello and keep it friendly. Harassment and spam can be reported from every message.' });
      } else {
        scroll.innerHTML =
          `<div class="load-older-wrap">${oldest ? '<button class="btn btn-secondary btn-sm" id="loadOlder">Load older messages</button>' : ''}</div>` +
          messages.map(bubble).join('');
        scroll.querySelector('#loadOlder')?.addEventListener('click', loadOlder);
        scroll.querySelectorAll('[data-react]').forEach((b) =>
          b.addEventListener('click', () => reactionPicker(b.dataset.react))
        );
        scroll.querySelectorAll('[data-reply]').forEach((b) =>
          b.addEventListener('click', () => setReply(b.dataset.reply))
        );
        scroll.querySelectorAll('[data-delete]').forEach((b) =>
          b.addEventListener('click', async () => {
            if (!window.confirm('Delete this message for both of you? It will show as “Message deleted”.')) return;
            try {
              await api(`/api/dm/messages/${b.dataset.delete}`, { method: 'DELETE' });
              await load();
            } catch (err) {
              toast(err.message, 'error');
            }
          })
        );
      }
      scroll.scrollTop = scroll.scrollHeight;
    }

    function reactionPicker(messageId) {
      modal({
        title: 'React',
        size: '380px',
        body: `<div class="reaction-picker">${QUICK_REACTIONS.map((e) => `<button class="reaction-choice" data-emoji="${e}">${e}</button>`).join('')}</div>`,
        onMount(root) {
          root.querySelectorAll('[data-emoji]').forEach((b) =>
            b.addEventListener('click', async () => {
              try {
                await api(`/api/dm/messages/${messageId}/reactions`, { method: 'POST', body: { emoji: b.dataset.emoji } });
                closeModal();
                await load();
              } catch (err) {
                toast(err.message, 'error');
              }
            })
          );
        }
      });
    }

    function setReply(messageId) {
      const m = messages.find((x) => x.id === messageId);
      replyTo = messageId;
      const banner = viewport.querySelector('#replyBanner');
      banner.hidden = false;
      banner.innerHTML = `<span>Replying to: ${escapeHtml((m.body || '').slice(0, 60))}</span><button class="icon-btn" id="cancelReply" aria-label="Cancel reply">✕</button>`;
      banner.querySelector('#cancelReply').addEventListener('click', () => {
        replyTo = null;
        banner.hidden = true;
      });
      viewport.querySelector('#chatInput').focus();
    }

    async function load(before) {
      try {
        const url = `/api/dm/threads/${friendId}${before ? `?before=${encodeURIComponent(before)}` : ''}`;
        const data = await api(url);
        friend = data.friend;
        settings = data.settings;
        viewport.querySelector('#threadName').textContent = friend.display_name;
        viewport.querySelector('#threadStatus').textContent = `${data.online ? 'Online now' : 'Offline'} · ${friend.district || 'Sri Lanka'}${
          data.settings.muted ? ' · muted' : ''
        }`;
        viewport.querySelector('#muteThread').textContent = data.settings.muted ? '🔔 Unmute' : '🔕 Mute';
        if (before) {
          messages = [...data.messages, ...messages];
        } else {
          messages = data.messages;
        }
        oldest = data.next_before;
        if (before) {
          const previousHeight = scroll.scrollHeight;
          paint();
          scroll.scrollTop = scroll.scrollHeight - previousHeight;
        } else {
          paint();
        }
      } catch (err) {
        scroll.innerHTML = errorState(err);
      }
    }

    async function loadOlder() {
      if (!oldest) return;
      await load(oldest);
    }

    viewport.querySelector('#chatForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = viewport.querySelector('#chatInput');
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      try {
        const res = await api(`/api/dm/threads/${friendId}`, {
          method: 'POST',
          body: { body: text, reply_to_id: replyTo }
        });
        replyTo = null;
        viewport.querySelector('#replyBanner').hidden = true;
        if (res.warning) toast(res.warning, 'error', 7000);
        await load();
      } catch (err) {
        toast(err.message, 'error');
        input.value = text;
      }
    });

    const input = viewport.querySelector('#chatInput');
    input.addEventListener('input', () => {
      if (typingTimeout) return;
      typingTimeout = setTimeout(() => (typingTimeout = null), 2500);
      api(`/api/dm/threads/${friendId}/typing`, { method: 'POST' }).catch(() => {});
    });

    viewport.querySelector('#muteThread').addEventListener('click', async () => {
      try {
        const res = await api(`/api/dm/threads/${friendId}/settings`, { method: 'POST', body: { muted: !settings.muted } });
        settings = res.settings;
        viewport.querySelector('#muteThread').textContent = settings.muted ? '🔔 Unmute' : '🔕 Mute';
        toast(settings.muted ? 'Conversation muted.' : 'Conversation unmuted.', 'info');
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    viewport.querySelector('#prefsThread').addEventListener('click', async () => {
      try {
        const res = await api(`/api/dm/threads/${friendId}/settings`, {
          method: 'POST',
          body: { preview_allowed: !settings.preview_allowed }
        });
        settings = res.settings;
        toast(settings.preview_allowed ? 'Notification previews allowed for this chat.' : 'Previews hidden for this chat.', 'info');
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    viewport.querySelector('#blockThread').addEventListener('click', async () => {
      if (!window.confirm(`Block ${friend ? friend.display_name : 'this rider'}? You will not see each other and cannot message.`)) return;
      try {
        await api('/api/blocks', { method: 'POST', body: { blockedUserId: friendId, reason: 'Blocked from conversation' } });
        toast('Rider blocked. They are not notified.', 'success');
        location.hash = '#/messages';
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    realtime = window.RRRealtime.connect({
      onEvent(name, data) {
        if (name === 'message' && data.conversation_id) load();
        if (name === 'typing') {
          const line = viewport.querySelector('#typingLine');
          line.textContent = `${friend ? friend.display_name : 'They'} is typing…`;
          clearTimeout(line._t);
          line._t = setTimeout(() => (line.textContent = ''), 3000);
        }
        if (name === 'reaction' || name === 'message_deleted' || name === 'read_receipt') load();
      }
    });

    onRouteCleanup(() => {
      if (realtime) realtime.close();
      if (typingTimeout) clearTimeout(typingTimeout);
    });

    await load();
    api(`/api/dm/threads/${friendId}/read`, { method: 'POST' }).catch(() => {});
  }

  async function renderNotifications(viewport) {
    if (!state.token) {
      location.hash = '#/welcome';
      return;
    }
    viewport.innerHTML = `<div class="section-head"><div><h2>Notifications</h2><p class="muted">In-app history, delivery preferences and privacy controls.</p></div><button class="btn btn-secondary btn-sm" id="markAllRead">Mark all read</button></div>
      <div class="notif-layout"><div id="notifList">${skeletonList(3)}</div><section class="card" id="notifPrefs"><div class="skeleton"></div></section></div>`;

    try {
      const [feed, prefs] = await Promise.all([api('/api/notifications/feed?limit=50'), api('/api/notifications/preferences')]);
      const host = viewport.querySelector('#notifList');
      host.innerHTML = feed.notifications.length
        ? `<div class="notif-list">${feed.notifications
            .map(
              (n) => `<button class="notif-row ${n.is_read ? '' : 'is-unread'}" data-notif="${escapeHtml(n.id)}" data-link="${escapeHtml(n.deep_link)}">
                <div class="notif-icon" aria-hidden="true">${n.type === 'message' ? '💬' : n.type === 'event_reminder' || n.type === 'event_announcement' ? '📅' : n.type === 'guild_invite' || n.type === 'guild_announcement' ? '🛡️' : n.type === 'moderation' ? '⚑' : n.type === 'news' ? '📰' : '🔔'}</div>
                <div class="notif-text"><strong>${escapeHtml(n.title)}</strong><p>${escapeHtml(n.body)}</p><small>${escapeHtml(timeAgo(n.created_at))}</small></div>
                ${n.is_read ? '' : '<span class="notif-dot"></span>'}
              </button>`
            )
            .join('')}</div>`
        : emptyState({ icon: '🔔', title: 'Nothing yet', body: 'Messages, friend requests, guild invitations and event reminders will appear here.' });

      host.querySelectorAll('[data-notif]').forEach((row) =>
        row.addEventListener('click', async () => {
          try {
            await api(`/api/notifications/${row.dataset.notif}/read`, { method: 'POST' });
          } catch (e) {
            /* reading is best effort */
          }
          location.hash = row.dataset.link.replace(/^#/, '');
        })
      );

      const p = prefs.preferences;
      viewport.querySelector('#notifPrefs').innerHTML = `
        <h3>Notification preferences</h3>
        <p class="muted" style="font-size:.82rem">Lock-screen and push previews never include private message content unless you allow previews here.</p>
        <div class="prefs-list">
          ${[
            ['messages', 'Direct messages', p.messages],
            ['friend_requests', 'Friend requests', p.friend_requests],
            ['guild_invites', 'Guild invitations & announcements', p.guild_invites],
            ['events', 'Event reminders', p.events],
            ['moderation', 'Moderation & safety updates', p.moderation],
            ['news', 'Studio news', p.news],
            ['show_previews', 'Show message previews in notifications', p.show_previews],
            ['read_receipts', 'Share read receipts with friends', p.read_receipts]
          ]
            .map(
              ([key, label, value]) => `<label class="check-row"><input type="checkbox" data-pref="${key}" ${value ? 'checked' : ''} /> <span>${label}</span></label>`
            )
            .join('')}
        </div>
        <div class="grid-2" style="gap:10px;margin-top:8px">
          <div class="form-group" style="margin:0"><label class="form-label" for="quietStart">Quiet hours start (0–23)</label><input class="form-input" id="quietStart" type="number" min="0" max="23" value="${p.quiet_hours_start === null ? '' : p.quiet_hours_start}" placeholder="22" /></div>
          <div class="form-group" style="margin:0"><label class="form-label" for="quietEnd">Quiet hours end</label><input class="form-input" id="quietEnd" type="number" min="0" max="23" value="${p.quiet_hours_end === null ? '' : p.quiet_hours_end}" placeholder="7" /></div>
        </div>
        <button class="btn btn-primary" id="savePrefs" style="margin-top:10px">Save preferences</button>`;

      viewport.querySelector('#savePrefs').addEventListener('click', async (e) => {
        e.target.disabled = true;
        const bodyData = {};
        viewport.querySelectorAll('[data-pref]').forEach((box) => (bodyData[box.dataset.pref] = box.checked));
        const qs = viewport.querySelector('#quietStart').value;
        const qe = viewport.querySelector('#quietEnd').value;
        bodyData.quiet_hours_start = qs === '' ? null : Number(qs);
        bodyData.quiet_hours_end = qe === '' ? null : Number(qe);
        try {
          await api('/api/notifications/preferences', { method: 'PUT', body: bodyData });
          toast('Notification preferences saved.', 'success');
        } catch (err) {
          toast(err.message, 'error');
        } finally {
          e.target.disabled = false;
        }
      });

      viewport.querySelector('#markAllRead').addEventListener('click', async () => {
        try {
          await api('/api/notifications/read-all', { method: 'POST' });
          toast('All notifications marked read.', 'info');
          renderNotifications(viewport);
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    } catch (err) {
      viewport.querySelector('#notifList').innerHTML = errorState(err);
    }
  }

  async function renderNews(viewport) {
    viewport.innerHTML = `<div class="section-head"><div><h2>Studio news</h2><p class="muted">Official announcements from Shaun David Studios.</p></div></div><div id="newsList">${skeletonList(2)}</div>`;
    try {
      const data = await api('/api/news');
      const host = viewport.querySelector('#newsList');
      host.innerHTML = data.news.length
        ? `<div class="news-list">${data.news
            .map(
              (n) => `<article class="card news-card ${n.pinned ? 'is-pinned' : ''}">
                <div class="news-head">
                  <span class="pill-badge pill-orange">★ ${escapeHtml(n.category)}</span>
                  ${n.pinned ? '<span class="pill-badge">Pinned</span>' : ''}
                  <small class="muted">${escapeHtml(timeAgo(n.published_at))}</small>
                </div>
                <h3>${escapeHtml(n.title)}</h3>
                <p>${escapeHtml(n.body)}</p>
                <small class="muted">Shaun David Studios${n.author_name ? ' · ' + escapeHtml(n.author_name) : ''}</small>
              </article>`
            )
            .join('')}</div>`
        : emptyState({ icon: '📰', title: 'No news yet', body: 'Studio announcements will appear here.' });
    } catch (err) {
      viewport.querySelector('#newsList').innerHTML = errorState(err);
    }
  }

  window.RRMessages = { renderThreads, renderThread, renderNotifications, renderNews };
})();
