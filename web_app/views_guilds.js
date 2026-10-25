/* RideRise LK — Guilds: discovery, creation, membership, roles, announcements, guild chat & shared posts */
(function () {
  'use strict';
  const { api, state, escapeHtml, toast, modal, closeModal, avatar, timeAgo, skeletonList, emptyState, errorState } = window.RR;

  const EMBLEMS = ['sunset-wave', 'sprocket-crown', 'mountain-shield', 'lotus-wheel', 'lightning-chain', 'compass-spoke'];
  const EMOJI = { 'sunset-wave': '🌅', 'sprocket-crown': '⚙️', 'mountain-shield': '⛰️', 'lotus-wheel': '🪷', 'lightning-chain': '⚡', 'compass-spoke': '🧭' };

  let guildFilter = 'all';

  async function renderGuilds(viewport) {
    if (!state.token) {
      location.hash = '#/welcome';
      return;
    }
    viewport.innerHTML = `
      <div class="section-head">
        <div>
          <h2>Riding guilds</h2>
          <p class="muted">Join a district crew, share builds and chat with riders who ride where you ride.</p>
        </div>
        <button class="btn btn-primary" id="createGuildBtn">+ Create guild</button>
      </div>
      <div class="chip-bar" role="tablist" aria-label="Guild filters">
        ${[
          ['all', 'All guilds'],
          ['public', 'Public'],
          ['private', 'Approval-based'],
          ['mine', 'My guilds'],
          ['invites', 'Invitations']
        ]
          .map(([v, l]) => `<button class="chip ${guildFilter === v ? 'active' : ''}" data-guild-filter="${v}">${l}</button>`)
          .join('')}
      </div>
      <div id="guildList">${skeletonList(3)}</div>`;
    viewport.querySelector('#createGuildBtn').addEventListener('click', openCreateGuild);
    viewport.querySelectorAll('[data-guild-filter]').forEach((chip) =>
      chip.addEventListener('click', () => {
        guildFilter = chip.dataset.guildFilter;
        viewport.querySelectorAll('[data-guild-filter]').forEach((c) => c.classList.toggle('active', c === chip));
        loadGuilds();
      })
    );
    await loadGuilds();
  }

  async function loadGuilds() {
    const host = document.getElementById('guildList');
    if (!host) return;
    try {
      const data = await api('/api/guilds');
      let guilds = data.guilds || [];
      if (guildFilter === 'public') guilds = guilds.filter((g) => g.privacy_type === 'public');
      if (guildFilter === 'private') guilds = guilds.filter((g) => g.privacy_type === 'private');
      if (guildFilter === 'mine') guilds = guilds.filter((g) => g.my_status === 'active' || g.my_status === 'pending_approval');
      if (guildFilter === 'invites') guilds = guilds.filter((g) => g.my_status === 'invited');
      if (!guilds.length) {
        host.innerHTML = emptyState({
          icon: '🛡️',
          title: 'No guilds here yet',
          body: 'Start a guild for your district, park or build crew. You become the owner and can invite moderators.',
          actionHtml: '<button class="btn btn-primary" id="emptyCreateGuild">Create the first guild</button>'
        });
        const btn = host.querySelector('#emptyCreateGuild');
        if (btn) btn.addEventListener('click', openCreateGuild);
        return;
      }
      host.innerHTML = `<div class="grid-2">${guilds
        .map(
          (g) => `<article class="card guild-card">
            <div class="guild-card-head">
              <span class="guild-emblem" aria-hidden="true">${EMOJI[g.emblem] || '⚙️'}</span>
              <div>
                <h3>${escapeHtml(g.name)}</h3>
                <p class="muted" style="font-size:.78rem">${escapeHtml(g.category)} · ${escapeHtml(g.district)}</p>
              </div>
              <span class="pill-badge ${g.privacy_type === 'private' ? 'pill-red' : 'pill-cyan'}">
                ${g.privacy_type === 'private' ? 'Approval' : 'Public'}
              </span>
            </div>
            <p class="guild-desc">${escapeHtml(g.description)}</p>
            <div class="guild-stats">
              <span>👥 ${g.member_count || 0}/${g.member_limit} members</span>
              <span>Owner @${escapeHtml(g.owner_username)}</span>
              ${g.my_role ? `<span class="pill-badge pill-orange">Your role: ${escapeHtml(g.my_role)}</span>` : ''}
              ${g.my_status === 'pending_approval' ? '<span class="pill-badge pill-red">Approval pending</span>' : ''}
              ${g.my_status === 'invited' ? '<span class="pill-badge pill-cyan">✉️ You are invited</span>' : ''}
            </div>
            <div class="guild-actions">
              <button class="btn btn-primary btn-sm" data-open-guild="${escapeHtml(g.id)}">Open guild</button>
              ${
                g.my_status === 'active'
                  ? '<button class="btn btn-secondary btn-sm" data-leave-guild="' + escapeHtml(g.id) + '">Leave</button>'
                  : g.my_status === 'pending_approval'
                  ? '<span class="pill-badge pill-orange">Awaiting moderator approval</span>'
                  : g.my_status === 'invited'
                  ? `<button class="btn btn-primary btn-sm" data-invite-accept="${escapeHtml(g.id)}">Accept invite</button>
                     <button class="btn btn-secondary btn-sm" data-invite-decline="${escapeHtml(g.id)}">Decline</button>`
                  : `<button class="btn btn-secondary btn-sm" data-join-guild="${escapeHtml(g.id)}">${
                      g.privacy_type === 'private' ? 'Request to join' : 'Join guild'
                    }</button>`
              }
              <button class="btn btn-secondary btn-sm" data-report-guild="${escapeHtml(g.id)}">⚑ Report</button>
            </div>
          </article>`
        )
        .join('')}</div>`;

      host.querySelectorAll('[data-open-guild]').forEach((b) =>
        b.addEventListener('click', () => (location.hash = `#/guild/${b.dataset.openGuild}`))
      );
      host.querySelectorAll('[data-join-guild]').forEach((b) =>
        b.addEventListener('click', async () => {
          try {
            const res = await api(`/api/guilds/${b.dataset.joinGuild}/join`, { method: 'POST' });
            toast(res.message, 'success', 4000);
            loadGuilds();
          } catch (err) {
            toast(err.message, 'error');
          }
        })
      );
      host.querySelectorAll('[data-leave-guild]').forEach((b) =>
        b.addEventListener('click', async () => {
          if (!confirm('Leave this guild?')) return;
          try {
            const res = await api(`/api/guilds/${b.dataset.leaveGuild}/leave`, { method: 'POST' });
            toast(res.message, 'success');
            loadGuilds();
          } catch (err) {
            toast(err.message, 'error');
          }
        })
      );
      host.querySelectorAll('[data-report-guild]').forEach((b) =>
        b.addEventListener('click', () => window.RRFeed.openReport(b.dataset.reportGuild, 'guild'))
      );
      host.querySelectorAll('[data-invite-accept]').forEach((b) =>
        b.addEventListener('click', () => respondToInvite(b.dataset.inviteAccept, 'accept'))
      );
      host.querySelectorAll('[data-invite-decline]').forEach((b) =>
        b.addEventListener('click', () => respondToInvite(b.dataset.inviteDecline, 'decline'))
      );
    } catch (err) {
      host.innerHTML = errorState(err);
      const retry = host.querySelector('[data-retry]');
      if (retry) retry.addEventListener('click', loadGuilds);
    }
  }

  async function respondToInvite(guildId, decision) {
    try {
      const res = await api(`/api/guilds/${guildId}/invite-response`, { method: 'POST', body: { decision } });
      toast(res.message, 'success', 4000);
      loadGuilds();
      window.RR.refreshSession().catch(() => {});
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function openCreateGuild() {
    let districts = ['Colombo', 'Gampaha', 'Kalutara (incl. Bentota)', 'Kandy', 'Galle', 'Matara'];
    try {
      if (!state.config) state.config = await api('/api/config');
      districts = state.config.brand.sriLankaDistricts || districts;
    } catch (e) {
      /* defaults */
    }
    modal({
      title: 'Create a riding guild',
      size: '620px',
      body: `<form id="guildForm">
        <div class="form-group">
          <label class="form-label" for="guildName">Guild name</label>
          <input class="form-input" id="guildName" required maxlength="50" placeholder="e.g. Southern Coast BMX" />
        </div>
        <div class="grid-2" style="gap:12px">
          <div class="form-group">
            <label class="form-label" for="guildCategory">Category</label>
            <select class="form-select" id="guildCategory">
              ${['BMX & Park Flow', 'Bike Customization & Mechanics', 'Dirt & Pump Track', 'Street & Flatground', 'Beginner Learning Crew', 'Women & Youth Riders']
                .map((c) => `<option>${c}</option>`)
                .join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" for="guildDistrict">District</label>
            <select class="form-select" id="guildDistrict">
              ${districts.map((d) => `<option ${state.profile && state.profile.district === d ? 'selected' : ''}>${escapeHtml(d)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label" for="guildEmblem">Emblem</label>
          <select class="form-select" id="guildEmblem">
            ${EMBLEMS.map((e) => `<option value="${e}">${EMOJI[e]} ${e}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="guildPrivacy">Privacy</label>
          <select class="form-select" id="guildPrivacy">
            <option value="public">Public — anyone can join instantly</option>
            <option value="private">Approval-based — moderators approve joins</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="guildDesc">Description</label>
          <textarea class="form-textarea" id="guildDesc" rows="3" maxlength="400" placeholder="What does your guild ride, build and teach?"></textarea>
        </div>
        <div class="callout"><strong>Reminder:</strong> guild owners and moderators can see only public profile fields (username, district, rank) — never emails, dates of birth or private messages.</div>
      </form>`,
      footer: `<button class="btn btn-secondary" data-modal-close="1">Cancel</button>
               <button class="btn btn-primary" id="submitGuild">Create guild</button>`,
      onMount(root) {
        root.querySelector('[data-modal-close]').addEventListener('click', closeModal);
        root.querySelector('#submitGuild').addEventListener('click', async () => {
          const name = root.querySelector('#guildName').value.trim();
          if (name.length < 3) {
            toast('Guild name must be at least 3 characters.', 'error');
            return;
          }
          try {
            const res = await api('/api/guilds', {
              method: 'POST',
              body: {
                name,
                category: root.querySelector('#guildCategory').value,
                district: root.querySelector('#guildDistrict').value,
                emblem: root.querySelector('#guildEmblem').value,
                privacy_type: root.querySelector('#guildPrivacy').value,
                description: root.querySelector('#guildDesc').value.trim()
              }
            });
            closeModal();
            toast(res.message, 'success');
            location.hash = `#/guild/${res.guildId}`;
          } catch (err) {
            toast(err.message, 'error');
          }
        });
      }
    });
  }

  async function renderGuildDetail(viewport, guildId) {
    if (!state.token) {
      location.hash = '#/welcome';
      return;
    }
    viewport.innerHTML = `<div class="skeleton"></div><div class="skeleton"></div>`;
    try {
      const data = await api(`/api/guilds/${guildId}`);
      const g = data.guild;
      const isOwnerOrMod = ['owner', 'moderator'].includes(g.my_role);
      const active = g.my_status === 'active';

      viewport.innerHTML = `
        <button class="link-inline" onclick="location.hash='#/guilds'">← All guilds</button>
        <section class="card card-accent guild-hero">
          <div class="guild-hero-main">
            <span class="guild-emblem lg" aria-hidden="true">${EMOJI[g.emblem] || '⚙️'}</span>
            <div>
              <h2>${escapeHtml(g.name)} <span class="pill-badge ${g.privacy_type === 'private' ? 'pill-red' : 'pill-cyan'}">${g.privacy_type === 'private' ? 'Approval-based' : 'Public'}</span></h2>
              <p class="muted">${escapeHtml(g.category)} · ${escapeHtml(g.district)}</p>
              <p class="guild-desc">${escapeHtml(g.description)}</p>
            </div>
          </div>
          <div class="guild-actions">
            ${
              active
                ? `<button class="btn btn-secondary btn-sm" id="leaveGuildBtn">Leave guild</button>`
                : g.my_status === 'invited'
                ? `<button class="btn btn-primary btn-sm" id="acceptInviteBtn">Accept invite</button>
                   <button class="btn btn-secondary btn-sm" id="declineInviteBtn">Decline</button>`
                : g.my_status === 'pending_approval'
                ? '<span class="pill-badge pill-orange">Join request pending approval</span>'
                : `<button class="btn btn-primary btn-sm" id="joinGuildBtn">${g.privacy_type === 'private' ? 'Request to join' : 'Join guild'}</button>`
            }
            <button class="btn btn-secondary btn-sm" id="reportGuildBtn">⚑ Report guild</button>
            ${isOwnerOrMod ? '<button class="btn btn-secondary btn-sm" id="inviteRiderBtn">✉️ Invite rider</button>' : ''}
            ${isOwnerOrMod ? '<button class="btn btn-secondary btn-sm" id="editGuildBtn">✎ Edit guild</button>' : ''}
          </div>
        </section>

        ${
          data.canViewInternal
            ? `<div class="grid-2">
                <section class="card">
                  <h3>📢 Guild announcement</h3>
                  <p class="muted" style="font-size:.86rem;margin-top:6px">${escapeHtml(g.announcement || 'No announcement yet.')}</p>
                  ${isOwnerOrMod ? '<button class="btn btn-secondary btn-sm" id="editAnnouncementBtn" style="margin-top:10px">Update announcement</button>' : ''}
                  <h3 style="margin-top:18px">👥 Members (${data.members.length})</h3>
                  <ul class="member-list">
                    ${data.members
                      .map(
                        (m) => `<li>
                          ${avatar(m.avatar_url, m.display_name, 34)}
                          <div class="member-text">
                            <strong>${escapeHtml(m.display_name)}</strong>
                            <small>@${escapeHtml(m.username)} · ${escapeHtml(m.district || 'LK')} · ${escapeHtml(m.rank_name)}</small>
                          </div>
                          <span class="pill-badge ${m.role === 'owner' ? 'pill-orange' : m.role === 'moderator' ? 'pill-cyan' : 'pill-green'}">${escapeHtml(m.role)}</span>
                          ${isOwnerOrMod && m.role !== 'owner' ? `<button class="link-inline" data-remove-member="${escapeHtml(m.user_id)}">Remove</button>` : ''}
                          ${g.my_role === 'owner' && m.role === 'member' ? `<button class="link-inline" data-promote-member="${escapeHtml(m.user_id)}">Promote</button>` : ''}
                        </li>`
                      )
                      .join('')}
                  </ul>
                  ${
                    isOwnerOrMod && data.pendingRequests.length
                      ? `<h3 style="margin-top:18px">⏳ Pending requests (${data.pendingRequests.length})</h3>
                         <ul class="member-list">
                           ${data.pendingRequests
                             .map(
                               (m) => `<li>${avatar(m.avatar_url, m.display_name, 34)}
                                 <div class="member-text"><strong>${escapeHtml(m.display_name)}</strong><small>@${escapeHtml(m.username)}</small></div>
                                 <button class="btn btn-primary btn-sm" data-approve-member="${escapeHtml(m.user_id)}">Approve</button>
                                 <button class="btn btn-secondary btn-sm" data-remove-member="${escapeHtml(m.user_id)}">Decline</button>
                               </li>`
                             )
                             .join('')}
                         </ul>`
                      : ''
                  }
                </section>

                <section class="card">
                  <h3>💬 Guild chat</h3>
                  <p class="muted" style="font-size:.78rem">Members only. Reported messages can be reviewed by moderators.</p>
                  <div class="guild-chat" id="guildChat">
                    ${
                      data.messages.length
                        ? data.messages
                            .map(
                              (m) => `<div class="chat-row">
                                ${avatar(m.avatar_url, m.display_name, 28)}
                                <div><strong>@${escapeHtml(m.username)}</strong> <span class="post-time">${escapeHtml(timeAgo(m.created_at))}</span>
                                <p>${escapeHtml(m.body)}</p>
                                <button class="link-inline" data-report-message="${escapeHtml(m.id)}">⚑ report</button></div>
                              </div>`
                            )
                            .join('')
                        : '<p class="muted" style="font-size:.82rem">No messages yet. Say hello and share what you are working on.</p>'
                    }
                  </div>
                  ${
                    active
                      ? `<form id="guildChatForm" class="comment-form" style="margin-top:10px">
                           <input class="form-input" id="guildChatInput" maxlength="500" placeholder="Message your guild…" required />
                           <button class="btn btn-primary btn-sm" type="submit">Send</button>
                         </form>`
                      : '<p class="hint">Join this guild to post in its chat.</p>'
                  }
                </section>
              </div>
              <section class="card">
                <div class="section-head" style="margin-bottom:8px">
                  <h3>🔧 Shared guild posts</h3>
                  <button class="btn btn-secondary btn-sm" id="guildPostBtn">+ Share a post here</button>
                </div>
                <div id="guildPosts"><div class="skeleton"></div></div>
              </section>`
            : `<div class="card">
                <h3>🔒 Members-only guild</h3>
                <p class="muted" style="margin-top:6px">This approval-based guild keeps its member list, chat and shared posts private. Request to join and a moderator will review your profile.</p>
              </div>`
        }`;

      const acceptInviteBtn = viewport.querySelector('#acceptInviteBtn');
      if (acceptInviteBtn)
        acceptInviteBtn.addEventListener('click', async () => {
          try {
            const res = await api(`/api/guilds/${guildId}/invite-response`, { method: 'POST', body: { decision: 'accept' } });
            toast(res.message, 'success');
            renderGuildDetail(viewport, guildId);
          } catch (err) {
            toast(err.message, 'error');
          }
        });
      const declineInviteBtn = viewport.querySelector('#declineInviteBtn');
      if (declineInviteBtn)
        declineInviteBtn.addEventListener('click', async () => {
          try {
            const res = await api(`/api/guilds/${guildId}/invite-response`, { method: 'POST', body: { decision: 'decline' } });
            toast(res.message, 'success');
            renderGuildDetail(viewport, guildId);
          } catch (err) {
            toast(err.message, 'error');
          }
        });
      const joinBtn = viewport.querySelector('#joinGuildBtn');
      if (joinBtn)
        joinBtn.addEventListener('click', async () => {
          try {
            const res = await api(`/api/guilds/${guildId}/join`, { method: 'POST' });
            toast(res.message, 'success', 4500);
            renderGuildDetail(viewport, guildId);
          } catch (err) {
            toast(err.message, 'error');
          }
        });
      const leaveBtn = viewport.querySelector('#leaveGuildBtn');
      if (leaveBtn)
        leaveBtn.addEventListener('click', async () => {
          if (!confirm('Leave this guild?')) return;
          try {
            const res = await api(`/api/guilds/${guildId}/leave`, { method: 'POST' });
            toast(res.message, 'success');
            renderGuildDetail(viewport, guildId);
          } catch (err) {
            toast(err.message, 'error');
          }
        });
      viewport.querySelector('#reportGuildBtn').addEventListener('click', () => window.RRFeed.openReport(guildId, 'guild'));

      const inviteBtn = viewport.querySelector('#inviteRiderBtn');
      if (inviteBtn)
        inviteBtn.addEventListener('click', () => {
          modal({
            title: `Invite a rider to ${g.name}`,
            size: '480px',
            body: `<p class="muted" style="font-size:.85rem">Search by exact username. The rider receives a notification and can accept or decline. Invitations count against the guild member limit only once accepted.</p>
              <div class="form-group"><label class="form-label" for="inviteUsername">Rider username</label>
              <input class="form-input" id="inviteUsername" placeholder="e.g. kasun_bmx_lk" /></div>`,
            footer: '<button class="btn btn-primary" id="sendInviteBtn">Send invitation</button>',
            onMount(root) {
              root.querySelector('#sendInviteBtn').addEventListener('click', async () => {
                const username = root.querySelector('#inviteUsername').value.trim();
                if (!username) return;
                try {
                  const res = await api(`/api/guilds/${guildId}/invite`, { method: 'POST', body: { username } });
                  closeModal();
                  toast(res.message, 'success', 4000);
                  renderGuildDetail(viewport, guildId);
                } catch (err) {
                  toast(err.message, 'error');
                }
              });
            }
          });
        });
      const editBtn = viewport.querySelector('#editGuildBtn');
      if (editBtn) editBtn.addEventListener('click', () => openEditGuild(g, () => renderGuildDetail(viewport, guildId)));
      const annBtn = viewport.querySelector('#editAnnouncementBtn');
      if (annBtn)
        annBtn.addEventListener('click', () => {
          modal({
            title: 'Update guild announcement',
            body: `<textarea class="form-textarea" id="annInput" rows="4" maxlength="400">${escapeHtml(g.announcement || '')}</textarea>`,
            footer: '<button class="btn btn-primary" id="saveAnn">Save announcement</button>',
            onMount(root) {
              root.querySelector('#saveAnn').addEventListener('click', async () => {
                try {
                  await api(`/api/guilds/${guildId}`, {
                    method: 'PUT',
                    body: { announcement: root.querySelector('#annInput').value }
                  });
                  closeModal();
                  toast('Announcement updated.', 'success');
                  renderGuildDetail(viewport, guildId);
                } catch (err) {
                  toast(err.message, 'error');
                }
              });
            }
          });
        });

      viewport.querySelectorAll('[data-approve-member]').forEach((b) =>
        b.addEventListener('click', () => memberAction(guildId, b.dataset.approveMember, 'approve', viewport))
      );
      viewport.querySelectorAll('[data-remove-member]').forEach((b) =>
        b.addEventListener('click', () => memberAction(guildId, b.dataset.removeMember, 'remove', viewport))
      );
      viewport.querySelectorAll('[data-promote-member]').forEach((b) =>
        b.addEventListener('click', () => memberAction(guildId, b.dataset.promoteMember, 'promote', viewport))
      );
      viewport.querySelectorAll('[data-report-message]').forEach((b) =>
        b.addEventListener('click', () => window.RRFeed.openReport(b.dataset.reportMessage, 'message'))
      );

      const chatForm = viewport.querySelector('#guildChatForm');
      if (chatForm)
        chatForm.addEventListener('submit', async (e) => {
          e.preventDefault();
          const input = viewport.querySelector('#guildChatInput');
          const body = input.value.trim();
          if (!body) return;
          try {
            await api(`/api/guilds/${guildId}/messages`, { method: 'POST', body: { body } });
            input.value = '';
            renderGuildDetail(viewport, guildId);
            setTimeout(() => {
              const chat = document.getElementById('guildChat');
              if (chat) chat.scrollTop = chat.scrollHeight;
            }, 100);
          } catch (err) {
            toast(err.message, 'error');
          }
        });

      if (data.canViewInternal) {
        const postBtn = viewport.querySelector('#guildPostBtn');
        if (postBtn)
          postBtn.addEventListener('click', () =>
            window.RRFeed.openComposer(() => renderGuildDetail(viewport, guildId))
          );
        loadGuildPosts(guildId);
      }
    } catch (err) {
      viewport.innerHTML = errorState(err);
      const retry = viewport.querySelector('[data-retry]');
      if (retry) retry.addEventListener('click', () => renderGuildDetail(viewport, guildId));
    }
  }

  async function loadGuildPosts(guildId) {
    const host = document.getElementById('guildPosts');
    if (!host) return;
    try {
      const data = await api(`/api/posts?guildId=${encodeURIComponent(guildId)}&limit=10`);
      if (!data.posts.length) {
        host.innerHTML = '<p class="muted" style="font-size:.84rem">No guild posts yet. Share a build, a maintenance win or a session recap.</p>';
        return;
      }
      host.innerHTML = data.posts
        .map(
          (p) => `<article class="guild-post-row">
            ${avatar(p.avatar_url, p.display_name, 34)}
            <div>
              <strong>${escapeHtml(p.title)}</strong>
              <div class="post-time">@${escapeHtml(p.username)} · ${escapeHtml(timeAgo(p.created_at))}</div>
              <p class="muted" style="font-size:.82rem">${escapeHtml(p.body.slice(0, 160))}${p.body.length > 160 ? '…' : ''}</p>
            </div>
            <span class="pill-badge pill-cyan">${p.likes_count} ♥</span>
          </article>`
        )
        .join('');
    } catch (err) {
      host.innerHTML = `<p class="muted">${escapeHtml(err.message)}</p>`;
    }
  }

  async function memberAction(guildId, userId, memberAction, viewport) {
    try {
      await api(`/api/guilds/${guildId}/members/${userId}`, { method: 'POST', body: { memberAction } });
      toast('Guild membership updated.', 'success');
      renderGuildDetail(viewport, guildId);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function openEditGuild(g, onDone) {
    modal({
      title: 'Edit guild',
      size: '560px',
      body: `<div class="form-group"><label class="form-label" for="gDesc">Description</label>
          <textarea class="form-textarea" id="gDesc" rows="3">${escapeHtml(g.description)}</textarea></div>
        <div class="form-group"><label class="form-label" for="gAnn">Announcement</label>
          <textarea class="form-textarea" id="gAnn" rows="3">${escapeHtml(g.announcement || '')}</textarea></div>
        <div class="form-group"><label class="form-label" for="gPriv">Privacy</label>
          <select class="form-select" id="gPriv">
            <option value="public" ${g.privacy_type === 'public' ? 'selected' : ''}>Public</option>
            <option value="private" ${g.privacy_type === 'private' ? 'selected' : ''}>Approval-based</option>
          </select></div>`,
      footer: '<button class="btn btn-primary" id="saveGuild">Save changes</button>',
      onMount(root) {
        root.querySelector('#saveGuild').addEventListener('click', async () => {
          try {
            await api(`/api/guilds/${g.id}`, {
              method: 'PUT',
              body: {
                description: root.querySelector('#gDesc').value,
                announcement: root.querySelector('#gAnn').value,
                privacy_type: root.querySelector('#gPriv').value
              }
            });
            closeModal();
            toast('Guild updated.', 'success');
            if (onDone) onDone();
          } catch (err) {
            toast(err.message, 'error');
          }
        });
      }
    });
  }

  window.RRGuilds = { renderGuilds, renderGuildDetail };
})();
