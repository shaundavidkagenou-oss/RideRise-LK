/* RideRise LK — Friendships, requests, blocking and friend-only private messaging */
(function () {
  'use strict';
  const { api, state, escapeHtml, toast, modal, closeModal, avatar, timeAgo, skeletonList, emptyState, errorState } = window.RR;

  let activeFriendId = null;
  let socialTab = 'friends';

  async function renderFriends(viewport, query = '') {
    if (!state.token) {
      location.hash = '#/welcome';
      return;
    }
    const friendParam = new URLSearchParams(query).get('friend');
    activeFriendId = friendParam || activeFriendId;

    if (activeFriendId) {
      await renderChat(viewport, activeFriendId);
      return;
    }

    viewport.innerHTML = `
      <div class="section-head">
        <div><h2>Friends &amp; messages</h2><p class="muted">Private messaging is restricted to accepted friends — a core teen-safety control.</p></div>
        <button class="btn btn-secondary btn-sm" onclick="location.hash='#/explore'">← Explore</button>
      </div>
      <div class="chip-bar" role="tablist" aria-label="Social sections">
        ${[
          ['friends', 'Friends'],
          ['requests', 'Requests'],
          ['chats', 'Conversations'],
          ['blocked', 'Blocked']
        ]
          .map(([v, l]) => `<button class="chip ${socialTab === v ? 'active' : ''}" data-social-tab="${v}">${l}</button>`)
          .join('')}
      </div>
      <div class="card">
        <h3>Search riders by username</h3>
        <div class="feed-toolbar" style="margin-top:8px">
          <input class="form-input" id="friendSearch" type="search" placeholder="Type a username or display name…" aria-label="Search riders" />
        </div>
        <div id="friendSearchResults"></div>
      </div>
      <div id="socialBody">${skeletonList(3)}</div>`;

    viewport.querySelectorAll('[data-social-tab]').forEach((chip) =>
      chip.addEventListener('click', () => {
        socialTab = chip.dataset.socialTab;
        viewport.querySelectorAll('[data-social-tab]').forEach((c) => c.classList.toggle('active', c === chip));
        loadSocial();
      })
    );
    let timer = null;
    viewport.querySelector('#friendSearch').addEventListener('input', (e) => {
      clearTimeout(timer);
      const q = e.target.value.trim();
      timer = setTimeout(() => searchUsers(q), 320);
    });

    await loadSocial();
  }

  async function searchUsers(q) {
    const host = document.getElementById('friendSearchResults');
    if (!host) return;
    if (!q) {
      host.innerHTML = '';
      return;
    }
    try {
      const data = await api(`/api/users/search?q=${encodeURIComponent(q)}`);
      if (!data.users.length) {
        host.innerHTML = '<p class="muted" style="font-size:.84rem">No riders matched that username.</p>';
        return;
      }
      host.innerHTML = `<ul class="member-list">${data.users
        .map(
          (u) => `<li>${avatar(u.avatar_url, u.display_name, 34)}
            <div class="member-text"><strong>${escapeHtml(u.display_name)}</strong><small>@${escapeHtml(u.username)} · ${escapeHtml(u.district)} · ${escapeHtml(u.rank_name)}</small></div>
            <button class="btn btn-primary btn-sm" data-send-request="${escapeHtml(u.user_id)}">Add friend</button>
            <button class="btn btn-secondary btn-sm" data-open-profile="${escapeHtml(u.user_id)}">Profile</button>
          </li>`
        )
        .join('')}</ul>`;
      host.querySelectorAll('[data-send-request]').forEach((b) =>
        b.addEventListener('click', async () => {
          try {
            const res = await api('/api/friends/request', { method: 'POST', body: { targetUserId: b.dataset.sendRequest } });
            toast(res.message, 'success', 4000);
            loadSocial();
          } catch (err) {
            toast(err.message, 'error', 5000);
          }
        })
      );
      host.querySelectorAll('[data-open-profile]').forEach((b) =>
        b.addEventListener('click', () => (location.hash = `#/user/${b.dataset.openProfile}`))
      );
    } catch (err) {
      host.innerHTML = `<p class="muted">${escapeHtml(err.message)}</p>`;
    }
  }

  async function loadSocial() {
    const host = document.getElementById('socialBody');
    if (!host) return;
    host.innerHTML = skeletonList(3);
    try {
      if (socialTab === 'chats') {
        const data = await api('/api/conversations');
        if (!data.conversations.length) {
          host.innerHTML = emptyState({
            icon: '💬',
            title: 'No conversations yet',
            body: 'Accept a friend request first. Private messaging is only available between accepted friends.'
          });
          return;
        }
        host.innerHTML = `<div class="card convo-list">${data.conversations
          .map(
            (c) => `<button class="convo-row" data-convo="${escapeHtml(c.friend.user_id)}">
              ${avatar(c.friend.avatar_url, c.friend.display_name, 46)}
              <div class="convo-text">
                <strong>${escapeHtml(c.friend.display_name)} ${c.muted ? '🔇' : ''}</strong>
                <small>${escapeHtml(c.last_message ? c.last_message.body.slice(0, 70) : 'No messages yet')}</small>
              </div>
              <div class="convo-side">
                <small class="post-time">${escapeHtml(timeAgo(c.last_message_at))}</small>
                ${c.unread_count ? `<span class="badge-counter">${c.unread_count}</span>` : ''}
              </div>
            </button>`
          )
          .join('')}</div>`;
        host.querySelectorAll('[data-convo]').forEach((b) =>
          b.addEventListener('click', () => {
            activeFriendId = b.dataset.convo;
            renderChat(document.getElementById('mainViewport'), activeFriendId);
          })
        );
        return;
      }

      const data = await api('/api/friends');

      if (socialTab === 'friends') {
        host.innerHTML = data.accepted.length
          ? `<div class="card"><h3>Your friends (${data.accepted.length})</h3>
              <ul class="member-list">${data.accepted
                .map(
                  (f) => `<li>${avatar(f.avatar_url, f.display_name, 38)}
                    <div class="member-text"><strong>${escapeHtml(f.display_name)}</strong><small>@${escapeHtml(f.username)} · ${escapeHtml(
                    f.district || 'LK'
                  )}</small></div>
                    <button class="btn btn-primary btn-sm" data-chat="${escapeHtml(f.user_id)}">Message</button>
                    <button class="btn btn-secondary btn-sm" data-remove-friend="${escapeHtml(f.friendship_id)}">Remove</button>
                    <button class="btn btn-secondary btn-sm" data-view="${escapeHtml(f.user_id)}">Profile</button>
                  </li>`
                )
                .join('')}</ul></div>`
          : emptyState({
              icon: '👥',
              title: 'No friends yet',
              body: 'Search a username above and send a friend request. Mutual friends are shown once you are connected.'
            });
      }

      if (socialTab === 'requests') {
        host.innerHTML = `<div class="card"><h3>Incoming requests (${data.incoming.length})</h3>
            ${
              data.incoming.length
                ? `<ul class="member-list">${data.incoming
                    .map(
                      (f) => `<li>${avatar(f.avatar_url, f.display_name, 38)}
                        <div class="member-text"><strong>${escapeHtml(f.display_name)}</strong><small>@${escapeHtml(f.username)}</small></div>
                        <button class="btn btn-primary btn-sm" data-accept="${escapeHtml(f.friendship_id)}">Accept</button>
                        <button class="btn btn-secondary btn-sm" data-decline="${escapeHtml(f.friendship_id)}">Decline</button>
                      </li>`
                    )
                    .join('')}</ul>`
                : '<p class="muted" style="font-size:.84rem">No incoming requests.</p>'
            }
          </div>
          <div class="card"><h3>Sent requests (${data.outgoing.length})</h3>
            ${
              data.outgoing.length
                ? `<ul class="member-list">${data.outgoing
                    .map(
                      (f) => `<li>${avatar(f.avatar_url, f.display_name, 38)}
                        <div class="member-text"><strong>${escapeHtml(f.display_name)}</strong><small>@${escapeHtml(f.username)}</small></div>
                        <span class="pill-badge pill-orange">Pending</span>
                        <button class="btn btn-secondary btn-sm" data-cancel="${escapeHtml(f.friendship_id)}">Cancel</button>
                      </li>`
                    )
                    .join('')}</ul>`
                : '<p class="muted" style="font-size:.84rem">No pending requests sent.</p>'
            }
          </div>`;
      }

      if (socialTab === 'blocked') {
        host.innerHTML = `<div class="card"><h3>Blocked riders (${data.blocked.length})</h3>
          <p class="muted" style="font-size:.84rem">Blocking stops all profile views, friend requests and messages in both directions.</p>
          ${
            data.blocked.length
              ? `<ul class="member-list">${data.blocked
                  .map(
                    (b) => `<li><div class="member-text"><strong>${escapeHtml(b.display_name)}</strong><small>@${escapeHtml(
                      b.username
                    )} · blocked ${escapeHtml(timeAgo(b.created_at))}</small></div>
                      <button class="btn btn-secondary btn-sm" data-unblock="${escapeHtml(b.user_id)}">Unblock</button></li>`
                  )
                  .join('')}</ul>`
              : '<p class="muted" style="font-size:.84rem">You have not blocked anyone.</p>'
          }</div>`;
      }

      host.querySelectorAll('[data-accept]').forEach((b) =>
        b.addEventListener('click', () => friendAction(b.dataset.accept, 'accept')))
      host.querySelectorAll('[data-decline]').forEach((b) =>
        b.addEventListener('click', () => friendAction(b.dataset.decline, 'decline')))
      host.querySelectorAll('[data-cancel]').forEach((b) =>
        b.addEventListener('click', () => friendAction(b.dataset.cancel, 'cancel')))
      host.querySelectorAll('[data-remove-friend]').forEach((b) =>
        b.addEventListener('click', () => friendAction(b.dataset.removeFriend, 'remove')))
      host.querySelectorAll('[data-chat]').forEach((b) =>
        b.addEventListener('click', () => {
          activeFriendId = b.dataset.chat;
          renderChat(document.getElementById('mainViewport'), activeFriendId);
        }))
      host.querySelectorAll('[data-view]').forEach((b) =>
        b.addEventListener('click', () => (location.hash = `#/user/${b.dataset.view}`)))
      host.querySelectorAll('[data-unblock]').forEach((b) =>
        b.addEventListener('click', async () => {
          try {
            const res = await api(`/api/blocks/${encodeURIComponent(b.dataset.unblock)}`, { method: 'DELETE' });
            toast(res.message, 'success');
            loadSocial();
          } catch (err) {
            toast(err.message, 'error');
          }
        }))
    } catch (err) {
      host.innerHTML = errorState(err);
      const retry = host.querySelector('[data-retry]');
      if (retry) retry.addEventListener('click', loadSocial);
    }
  }

  async function friendAction(friendshipId, action) {
    try {
      const res = await api(`/api/friends/${friendshipId}`, { method: 'POST', body: { action } });
      toast(res.message, 'success');
      loadSocial();
      window.RR.refreshSession().catch(() => {});
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function renderChat(viewport, friendId) {
    viewport.innerHTML = `<div class="skeleton" style="height:120px"></div>`;
    try {
      const data = await api(`/api/conversations/${encodeURIComponent(friendId)}/messages`);
      const friendProfile = await api(`/api/profiles/${encodeURIComponent(friendId)}`);
      const friend = friendProfile.profile;
      viewport.innerHTML = `
        <div class="chat-head card">
          <button class="icon-btn" id="chatBack" aria-label="Back to conversations">←</button>
          ${avatar(friend.avatar_url, friend.display_name, 42)}
          <div class="chat-head-text">
            <strong>${escapeHtml(friend.display_name)}</strong>
            <small>@${escapeHtml(friend.username)} · ${escapeHtml(friend.district || 'LK')}</small>
          </div>
          <div class="chat-head-actions">
            <button class="btn btn-secondary btn-sm" id="muteChatBtn">🔇 Mute</button>
            <button class="btn btn-secondary btn-sm" id="reportChatBtn">⚑ Report chat</button>
            <button class="btn btn-danger btn-sm" id="blockChatBtn">Block</button>
          </div>
        </div>
        <div class="chat-window card" id="chatWindow">
          ${data.messages
            .map(
              (m) => `<div class="bubble-row ${m.sender_id === (state.profile && state.profile.user_id) ? 'mine' : ''}">
                <div class="bubble">
                  ${m.attachment_url ? `<img src="${escapeHtml(m.attachment_url)}" alt="Shared attachment" class="bubble-img" />` : ''}
                  ${m.body ? `<p>${escapeHtml(m.body)}</p>` : ''}
                  <span class="bubble-meta">${escapeHtml(timeAgo(m.created_at))}${m.sender_id === (state.profile && state.profile.user_id) ? ` · ${escapeHtml(m.delivery_status)}` : ''}</span>
                </div>
              </div>`
            )
            .join('') || '<p class="muted" style="text-align:center;font-size:.84rem">Say hello — you are friends, so this conversation is private between you.</p>'}
        </div>
        <div class="chat-composer card">
          <label class="btn btn-secondary btn-sm" for="chatImage" title="Attach an image (max 5 MB)">📎 Image</label>
          <input type="file" id="chatImage" accept="image/*" hidden />
          <form id="chatForm" class="chat-form">
            <input class="form-input" id="chatInput" placeholder="Write a message…" maxlength="1000" autocomplete="off" />
            <button class="btn btn-primary" type="submit">Send</button>
          </form>
        </div>
        <div class="callout callout-warn"><strong>Safety:</strong> never share your home address, school, phone number or financial details in chat. Report harassment immediately — moderators can act, and blocking stops all contact.</div>`;

      const win = viewport.querySelector('#chatWindow');
      win.scrollTop = win.scrollHeight;

      viewport.querySelector('#chatBack').addEventListener('click', () => {
        activeFriendId = null;
        socialTab = 'chats';
        renderFriends(document.getElementById('mainViewport'), '');
      });
      viewport.querySelector('#muteChatBtn').addEventListener('click', async () => {
        try {
          const res = await api(`/api/conversations/${data.conversation_id}/mute`, { method: 'POST' });
          toast(res.muted ? 'Conversation muted.' : 'Conversation unmuted.', 'success');
        } catch (err) {
          toast(err.message, 'error');
        }
      });
      viewport.querySelector('#reportChatBtn').addEventListener('click', () => {
        const first = data.messages[0];
        window.RRFeed.openReport(first ? first.id : friendId, first ? 'message' : 'user');
      });
      viewport.querySelector('#blockChatBtn').addEventListener('click', async () => {
        if (!confirm(`Block @${friend.username}? All contact stops immediately.`)) return;
        try {
          const res = await api('/api/blocks', { method: 'POST', body: { blockedUserId: friendId, reason: 'Blocked from conversation' } });
          activeFriendId = null;
          socialTab = 'friends';
          toast(res.message, 'success');
          renderFriends(document.getElementById('mainViewport'), '');
        } catch (err) {
          toast(err.message, 'error');
        }
      });

      let pendingAttachment = '';
      viewport.querySelector('#chatImage').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) {
          toast('Image exceeds 5 MB limit.', 'error');
          return;
        }
        try {
          const dataUrl = await new Promise((res, rej) => {
            const r = new FileReader();
            r.onload = () => res(r.result);
            r.onerror = () => rej(new Error('Could not read file.'));
            r.readAsDataURL(file);
          });
          const uploaded = await api('/api/upload/media', { method: 'POST', body: { dataUrl } });
          pendingAttachment = uploaded.mediaUrl;
          toast('Image validated — tap Send to deliver it.', 'success', 3000);
        } catch (err) {
          toast(err.message, 'error');
        }
      });

      viewport.querySelector('#chatForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = viewport.querySelector('#chatInput');
        const body = input.value.trim();
        if (!body && !pendingAttachment) return;
        input.value = '';
        try {
          await api(`/api/conversations/${encodeURIComponent(friendId)}/messages`, {
            method: 'POST',
            body: { body, attachment_url: pendingAttachment }
          });
          pendingAttachment = '';
          renderChat(viewport, friendId);
        } catch (err) {
          toast(err.message, 'error', 5000);
        }
      });
    } catch (err) {
      viewport.innerHTML = `<div class="section-head"><div><h2>Conversation</h2></div>
        <button class="btn btn-secondary btn-sm" id="backToFriends">← Back</button></div>${errorState(err)}`;
      viewport.querySelector('#backToFriends').addEventListener('click', () => {
        activeFriendId = null;
        renderFriends(viewport, '');
      });
      const retry = viewport.querySelector('[data-retry]');
      if (retry) retry.addEventListener('click', () => renderChat(viewport, friendId));
    }
  }

  window.RRSocial = { renderFriends };
})();
