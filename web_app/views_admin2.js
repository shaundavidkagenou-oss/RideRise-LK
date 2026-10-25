/* RideRise LK — Studio administration console (Phase 2).
 * Credential or Google sign-in, moderation queue, user restrictions, feedback
 * inbox, news, official events, tutorial CMS, catalogue verification, broadcast,
 * push diagnostics and a full audit trail.
 *
 * Every permission is enforced by the backend; this UI never decides access by
 * itself and never receives private message content unless it was reported.
 */
(function () {
  'use strict';

  const { api, state, escapeHtml, toast, avatar, timeAgo, dateLabel, emptyState, errorState, skeletonList, modal, closeModal } =
    window.RR;

  const TABS = [
    ['overview', '📊 Overview'],
    ['reports', '⚑ Reports & appeals'],
    ['users', '👥 Riders'],
    ['feedback', '📥 Feedback'],
    ['content', '🧹 Content'],
    ['events', '📅 News & events'],
    ['learning', '🎓 Tutorials'],
    ['catalog', '🔧 Catalogue'],
    ['broadcast', '📣 Broadcast'],
    ['audit', '🧾 Audit & push']
  ];

  let activeTab = 'overview';
  let cachedMe = null;

  async function renderAdminConsole(viewport, query) {
    const params = new URLSearchParams(query || '');
    if (params.get('tab') && TABS.some(([id]) => id === params.get('tab'))) activeTab = params.get('tab');

    if (!state.token || !state.account || !['admin', 'moderator'].includes(state.account.role)) {
      renderAdminLogin(viewport);
      return;
    }

    try {
      cachedMe = await api('/api/admin/me');
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        renderAdminLogin(viewport, err.message);
        return;
      }
    }

    viewport.innerHTML = `
      <div class="section-head">
        <div>
          <h2>Studio administration</h2>
          <p class="muted">Signed in as <strong>${escapeHtml(cachedMe.user.display_name)}</strong> · ${escapeHtml(cachedMe.user.role)} · every action is audit-logged.</p>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn btn-secondary btn-sm" id="adminHome">← App home</button>
          <button class="btn btn-secondary btn-sm" id="adminSecurity">🔑 Password</button>
          <button class="btn btn-secondary btn-sm" id="adminLegacy">Classic console</button>
        </div>
      </div>
      ${
        cachedMe.must_change_password
          ? `<div class="callout callout-danger" role="alert"><strong>Change the bootstrap password now.</strong> Moderation write actions are blocked until you set a new administrator password.
               <button class="btn btn-danger btn-sm" id="forceChange" style="margin-left:10px">Change password</button></div>`
          : ''
      }
      <div class="chip-bar admin-tabs" role="tablist" aria-label="Admin sections">
        ${TABS.map(([id, label]) => `<button class="chip ${activeTab === id ? 'active' : ''}" data-admin-tab="${id}" role="tab">${label}</button>`).join('')}
      </div>
      <div id="adminBody">${skeletonList(3)}</div>`;

    viewport.querySelector('#adminHome').addEventListener('click', () => (location.hash = '#/home'));
    viewport.querySelector('#adminLegacy').addEventListener('click', () => (location.hash = '#/admin/legacy'));
    if (viewport.querySelector('#forceChange')) {
      viewport.querySelector('#forceChange').addEventListener('click', () => changePasswordModal(true));
      viewport.querySelector('#adminSecurity').addEventListener('click', () => changePasswordModal(false));
    }
    viewport.querySelectorAll('[data-admin-tab]').forEach((chip) =>
      chip.addEventListener('click', () => {
        activeTab = chip.dataset.adminTab;
        viewport.querySelectorAll('[data-admin-tab]').forEach((c) => c.classList.toggle('active', c === chip));
        paint();
      })
    );

    const body = viewport.querySelector('#adminBody');
    paint();

    function paint() {
      if (activeTab === 'overview') return paintOverview();
      if (activeTab === 'reports') return paintReports();
      if (activeTab === 'users') return paintUsers();
      if (activeTab === 'feedback') return paintFeedback();
      if (activeTab === 'content') return paintContent();
      if (activeTab === 'events') return paintEvents();
      if (activeTab === 'learning') return paintLearning();
      if (activeTab === 'catalog') return paintCatalog();
      if (activeTab === 'broadcast') return paintBroadcast();
      if (activeTab === 'audit') return paintAudit();
    }

    /* -------------------------------- overview ------------------------------ */
    async function paintOverview() {
      body.innerHTML = skeletonList(3);
      try {
        const [overview, push] = await Promise.all([api('/api/admin/overview2'), api('/api/admin/push/status')]);
        const m = overview.metrics;
        body.innerHTML = `
          <div class="metric-grid">
            ${metric('Riders', m.active_riders, '👥')}
            ${metric('Aged 16–17', m.minors, '🛡️')}
            ${metric('Suspended', m.suspended, '⛔', m.suspended > 0)}
            ${metric('Pending reports', m.pending_reports, '⚑', m.pending_reports > 0)}
            ${metric('Pending appeals', m.pending_appeals, '⚖️', m.pending_appeals > 0)}
            ${metric('New feedback', m.new_feedback, '📥', m.new_feedback > 0)}
            ${metric('Sharing live location', m.live_members_sharing, '📍')}
            ${metric('In voice rooms', m.active_voice_participants, '🎙️')}
            ${metric('Published news', m.published_news, '📰')}
            ${metric('Unverified prices', m.unverified_price_listings, '❔')}
          </div>
          <div class="grid-2">
            <section class="card">
              <h3>Live safety state</h3>
              ${
                overview.live_sharing_by_guild.length
                  ? `<div class="report-list">${overview.live_sharing_by_guild
                      .map((g) => `<div class="report-row"><div class="report-main"><strong>${escapeHtml(g.guild_name)}</strong><small>${g.sharing_count} member(s) sharing an approximate area</small></div><span class="pill-badge pill-green">Consenting</span></div>`)
                      .join('')}</div>`
                  : '<p class="muted" style="font-size:.85rem">No members are sharing location right now.</p>'
              }
              <p class="hint">Coordinates are never returned to administrators through this console. Only sharing counts are shown.</p>
            </section>
            <section class="card">
              <h3>Push delivery</h3>
              <p style="font-size:.86rem">${push.configured ? '<span class="pill-badge pill-green">FCM configured</span>' : '<span class="pill-badge pill-orange">Not configured</span>'} ${escapeHtml(push.note)}</p>
              <div class="report-list" style="margin-top:8px">
                ${(push.recent || [])
                  .slice(0, 6)
                  .map((r) => `<div class="report-row"><div class="report-main"><strong>${escapeHtml(r.title)}</strong><small>${escapeHtml(r.channel)} · ${escapeHtml(r.status)} · ${escapeHtml(timeAgo(r.created_at))}</small></div></div>`)
                  .join('') || '<p class="hint">No delivery attempts logged yet.</p>'}
              </div>
            </section>
          </div>
          <section class="card">
            <h3>Recent moderation</h3>
            <div class="report-list">
              ${overview.recent_moderation.length
                ? overview.recent_moderation
                    .map((a) => `<div class="report-row"><div class="report-main"><strong>${escapeHtml(a.action)}</strong><small>${escapeHtml(a.target_type)} ${escapeHtml(a.target_id)} · ${escapeHtml(a.reason || '')} · ${escapeHtml(timeAgo(a.created_at))}</small></div></div>`)
                    .join('')
                : '<p class="hint">No moderation actions yet.</p>'}
            </div>
          </section>`;
      } catch (err) {
        body.innerHTML = errorState(err);
      }
    }

    /* -------------------------------- reports ------------------------------- */
    async function paintReports() {
      body.innerHTML = skeletonList(3);
      try {
        const data = await api('/api/admin/reports?status=pending');
        body.innerHTML = `
          <div class="section-head" style="margin-bottom:6px">
            <div><h3 style="margin:0">Moderation queue</h3><p class="muted" style="font-size:.82rem">Voice and reported-message items are reviewed with priority. Private conversations are never browsed proactively.</p></div>
            <span class="pill-badge pill-red">${data.reports.length} pending</span>
          </div>
          <div class="report-list">
            ${data.reports.length
              ? data.reports
                  .map(
                    (r) => `<div class="report-row ${r.severity === 'critical' || r.severity === 'high' ? 'is-urgent' : ''}">
                      <div class="report-main">
                        <strong>${escapeHtml(r.reason_category.replace(/_/g, ' '))} · ${escapeHtml(r.target_type)}</strong>
                        <small>@${escapeHtml(r.reporter_username || 'rider')} · ${escapeHtml(timeAgo(r.created_at))} · severity ${escapeHtml(r.severity)}</small>
                        <p>${escapeHtml(r.details)}</p>
                        ${r.context && r.context.reported_user_id ? `<p class="hint">Context: room ${escapeHtml(r.context.room_id || '')} · reported user ${escapeHtml(r.context.reported_user_id)}</p>` : ''}
                      </div>
                      <button class="btn btn-primary btn-sm" data-report-action="${escapeHtml(r.id)}">Review</button>
                    </div>`
                  )
                  .join('')
              : '<p class="muted">Queue clear. Nice work.</p>'}
          </div>
          <section class="card">
            <h3>Appeals</h3>
            ${
              data.appeals.length
                ? `<div class="report-list">${data.appeals
                    .map(
                      (a) => `<div class="report-row"><div class="report-main"><strong>@${escapeHtml(a.username || 'rider')} · ${escapeHtml(a.scope)}</strong><small>${escapeHtml(timeAgo(a.created_at))}</small><p>${escapeHtml(a.message)}</p></div>
                        <button class="btn btn-secondary btn-sm" data-appeal-review="${escapeHtml(a.id)}">Resolve</button></div>`
                    )
                    .join('')}</div>`
                : '<p class="muted" style="font-size:.85rem">No pending appeals.</p>'
            }
          </section>`;

        body.querySelectorAll('[data-report-action]').forEach((b) =>
          b.addEventListener('click', () => reportActionModal(data.reports.find((r) => r.id === b.dataset.reportAction)))
        );
        body.querySelectorAll('[data-appeal-review]').forEach((b) =>
          b.addEventListener('click', () => appealModal(data.appeals.find((a) => a.id === b.dataset.appealReview)))
        );
      } catch (err) {
        body.innerHTML = errorState(err);
      }
    }

    function reportActionModal(report) {
      modal({
        title: 'Moderate report',
        size: '700px',
        body: `
          <p><strong>${escapeHtml(report.reason_category.replace(/_/g, ' '))}</strong> · ${escapeHtml(report.target_type)}</p>
          <p class="muted" style="font-size:.85rem">${escapeHtml(report.details)}</p>
          <div class="form-group"><label class="form-label" for="modNote">Resolution note (shared with the reporter)</label><textarea class="form-textarea" id="modNote" rows="3"></textarea></div>
          <div class="form-group"><label class="form-label" for="suspendDays">Suspension length if applicable</label><input class="form-input" type="number" id="suspendDays" value="7" min="1" max="365" /></div>
          <div class="mod-actions">
            <button class="btn btn-secondary" data-mod="dismiss">Dismiss</button>
            <button class="btn btn-secondary" data-mod="delete_content">Remove content</button>
            <button class="btn btn-secondary" data-mod="warn">Warn rider</button>
            <button class="btn btn-danger" data-mod="suspend">Suspend</button>
            <button class="btn btn-danger" data-mod="ban">Ban account</button>
          </div>`,
        onMount(root) {
          root.querySelectorAll('[data-mod]').forEach((btn) =>
            btn.addEventListener('click', async () => {
              if (btn.dataset.mod === 'ban' && !window.confirm('Permanently ban this account? They can appeal.')) return;
              try {
                const res = await api(`/api/admin/reports/${report.id}/action`, {
                  method: 'POST',
                  body: {
                    action: btn.dataset.mod,
                    note: root.querySelector('#modNote').value,
                    days: Number(root.querySelector('#suspendDays').value)
                  }
                });
                closeModal();
                toast(res.message, 'success');
                paintReports();
              } catch (err) {
                toast(err.message, 'error');
              }
            })
          );
        }
      });
    }

    function appealModal(appeal) {
      modal({
        title: 'Review appeal',
        body: `<p>${escapeHtml(appeal.message)}</p>
          <div class="form-group" style="margin-top:12px"><label class="form-label" for="appealNote">Resolution</label><textarea class="form-textarea" id="appealNote" rows="3"></textarea></div>`,
        footer: `<button class="btn btn-secondary" data-modal-close="1">Close</button>
          <button class="btn btn-danger" id="uphold">Uphold</button><button class="btn btn-primary" id="overturn">Overturn &amp; restore</button>`,
        onMount(root) {
          const resolve = async (decision) => {
            try {
              await api(`/api/admin/appeals/${appeal.id}/resolve`, {
                method: 'POST',
                body: { decision, resolution: root.querySelector('#appealNote').value }
              });
              closeModal();
              toast(`Appeal ${decision}.`, 'success');
              paintReports();
            } catch (err) {
              toast(err.message, 'error');
            }
          };
          root.querySelector('#uphold').addEventListener('click', () => resolve('upheld'));
          root.querySelector('#overturn').addEventListener('click', () => resolve('overturned'));
        }
      });
    }

    /* --------------------------------- users -------------------------------- */
    async function paintUsers() {
      body.innerHTML = `
        <div class="catalog-toolbar card">
          <div class="catalog-search">
            <input class="form-input" id="userSearch" placeholder="Search username, name or email" />
            <select class="form-select" id="userStatus" aria-label="Account status">
              <option value="">Any status</option><option value="active">Active</option><option value="warned">Warned</option><option value="suspended">Suspended</option><option value="deleted">Deleted</option>
            </select>
            <button class="btn btn-primary" id="searchUsers">Search</button>
          </div>
        </div>
        <div id="userResults">${skeletonList(3)}</div>`;
      const load = async () => {
        const q = body.querySelector('#userSearch').value;
        const st = body.querySelector('#userStatus').value;
        body.querySelector('#userResults').innerHTML = skeletonList(2);
        try {
          const data = await api(`/api/admin/users?q=${encodeURIComponent(q)}&status=${encodeURIComponent(st)}`);
          body.querySelector('#userResults').innerHTML = `
            <p class="hint">${data.total} account(s). Emails are ${data.email_visible ? 'visible to administrators' : 'hidden for moderator accounts'}.</p>
            <div class="report-list">${data.users
              .map(
                (u) => `<div class="report-row">
                  <div class="report-main">
                    <strong>${escapeHtml(u.display_name || u.username || u.id)} ${u.role !== 'rider' ? `<span class="pill-badge pill-orange">${escapeHtml(u.role)}</span>` : ''} ${u.is_minor ? '<span class="pill-badge">16–17</span>' : ''}</strong>
                    <small>@${escapeHtml(u.username || '—')} · ${escapeHtml(u.email)} · ${escapeHtml(u.account_status)} · joined ${escapeHtml(dateLabel(u.created_at))}</small>
                    ${u.ban_reason ? `<p class="hint">Ban reason: ${escapeHtml(u.ban_reason)}</p>` : ''}
                  </div>
                  <div class="user-actions">
                    <button class="btn btn-secondary btn-sm" data-user-info="${escapeHtml(u.id)}">Inspect</button>
                    <button class="btn btn-secondary btn-sm" data-user-warn="${escapeHtml(u.id)}">Warn</button>
                    <button class="btn btn-danger btn-sm" data-user-ban="${escapeHtml(u.id)}">Ban</button>
                    <button class="btn btn-secondary btn-sm" data-user-restore="${escapeHtml(u.id)}">Restore</button>
                  </div>
                </div>`
              )
              .join('')}</div>`;
          body.querySelectorAll('[data-user-info]').forEach((b) =>
            b.addEventListener('click', () => inspectUser(data.users.find((u) => u.id === b.dataset.userInfo)))
          );
          body.querySelectorAll('[data-user-warn]').forEach((b) =>
            b.addEventListener('click', () => userAction(b.dataset.userWarn, 'warn', 'Send a warning to this rider?'))
          );
          body.querySelectorAll('[data-user-ban]').forEach((b) =>
            b.addEventListener('click', () => userAction(b.dataset.userBan, 'ban', 'Ban this account? They can appeal.'))
          );
          body.querySelectorAll('[data-user-restore]').forEach((b) =>
            b.addEventListener('click', () => userAction(b.dataset.userRestore, 'unban', 'Restore this account?'))
          );
        } catch (err) {
          body.querySelector('#userResults').innerHTML = errorState(err);
        }
      };
      body.querySelector('#searchUsers').addEventListener('click', load);
      body.querySelector('#userSearch').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') load();
      });
      load();

      async function userAction(userId, action, question) {
        if (!window.confirm(question)) return;
        let reason = '';
        if (action === 'ban' || action === 'warn') reason = window.prompt('Reason (shown to the rider):') || '';
        try {
          await api(`/api/admin/users/${userId}/${action}`, { method: 'POST', body: { reason } });
          toast('Account updated.', 'success');
          load();
        } catch (err) {
          toast(err.message, 'error');
        }
      }

      async function inspectUser(u) {
        modal({
          title: `Inspect ${u.display_name || u.username}`,
          size: '760px',
          body: '<div class="skeleton"></div>',
          onMount: async (root) => {
            try {
              const data = await api(`/api/admin/users/${u.id}/activity`, { method: 'POST', body: {} });
              root.querySelector('.modal-body').innerHTML = `
                <div class="spec-grid">
                  <div class="spec-row"><span>Status</span><strong>${escapeHtml(u.account_status)}</strong></div>
                  <div class="spec-row"><span>Role</span><strong>${escapeHtml(u.role)}</strong></div>
                  <div class="spec-row"><span>Minor</span><strong>${u.is_minor ? 'Yes (16–17)' : 'No'}</strong></div>
                  <div class="spec-row"><span>Ban reason</span><strong>${escapeHtml(u.ban_reason || '—')}</strong></div>
                </div>
                <p class="hint" style="margin-top:8px">${escapeHtml(data.privacy_note)}</p>
                <h4 style="margin-top:12px">Recent messages (moderation only)</h4>
                <div class="report-list">${(data.recent_messages || [])
                  .slice(0, 6)
                  .map((m) => `<div class="report-row"><div class="report-main"><p>${escapeHtml((m.body || '').slice(0, 160) || '(deleted)')}</p><small>${escapeHtml(timeAgo(m.created_at))}</small></div></div>`)
                  .join('') || '<p class="hint">No messages.</p>'}</div>
                <h4 style="margin-top:12px">Internal notes</h4>
                <div class="form-group"><textarea class="form-textarea" id="userNote" rows="2" placeholder="Add an internal note (staff only)"></textarea></div>
                <button class="btn btn-secondary btn-sm" id="addNote">Save note</button>
                <div class="report-list" style="margin-top:8px">${(data.notes || [])
                  .map((n) => `<div class="report-row"><div class="report-main"><p>${escapeHtml(n.note)}</p><small>${escapeHtml(timeAgo(n.created_at))}</small></div></div>`)
                  .join('') || '<p class="hint">No notes.</p>'}</div>
                <h4 style="margin-top:12px">Moderation history</h4>
                <div class="report-list">${(data.actions || [])
                  .slice(0, 8)
                  .map((a) => `<div class="report-row"><div class="report-main"><strong>${escapeHtml(a.action)}</strong><small>${escapeHtml(a.reason)} · ${escapeHtml(timeAgo(a.created_at))}</small></div></div>`)
                  .join('') || '<p class="hint">No actions.</p>'}</div>`;
              root.querySelector('#addNote').addEventListener('click', async () => {
                try {
                  await api(`/api/admin/users/${u.id}/note`, {
                    method: 'POST',
                    body: { note: root.querySelector('#userNote').value }
                  });
                  toast('Note saved.', 'success');
                } catch (err) {
                  toast(err.message, 'error');
                }
              });
            } catch (err) {
              root.querySelector('.modal-body').innerHTML = errorState(err);
            }
          }
        });
      }
    }

    /* -------------------------------- feedback ------------------------------ */
    async function paintFeedback() {
      body.innerHTML = skeletonList(2);
      try {
        const data = await api('/api/admin/feedback');
        body.innerHTML = `
          <div class="section-head" style="margin-bottom:6px">
            <div><h3 style="margin:0">Feedback inbox</h3><p class="muted" style="font-size:.82rem">Everything riders send through the feedback form lands here and notifies staff.</p></div>
            <span class="pill-badge pill-orange">${data.counts.map((c) => `${c.status}: ${c.c}`).join(' · ') || 'empty'}</span>
          </div>
          <div class="report-list">
            ${data.feedback.length
              ? data.feedback
                  .map(
                    (f) => `<div class="report-row ${f.priority === 'high' || f.priority === 'urgent' ? 'is-urgent' : ''}">
                      <div class="report-main">
                        <strong>${escapeHtml(f.subject)} <span class="pill-badge">${escapeHtml(f.category)}</span></strong>
                        <small>@${escapeHtml(f.username || 'rider')} · ${escapeHtml(f.status)} · ${escapeHtml(timeAgo(f.created_at))}${f.contact_email ? ` · ${escapeHtml(f.contact_email)}` : ''}</small>
                        <p>${escapeHtml(f.body)}</p>
                        ${f.admin_note ? `<p class="hint">Staff note: ${escapeHtml(f.admin_note)}</p>` : ''}
                      </div>
                      <div class="user-actions">
                        <button class="btn btn-secondary btn-sm" data-fb="${escapeHtml(f.id)}" data-status="in_progress">Working</button>
                        <button class="btn btn-primary btn-sm" data-fb="${escapeHtml(f.id)}" data-status="resolved">Resolve</button>
                      </div>
                    </div>`
                  )
                  .join('')
              : '<p class="muted">No feedback yet.</p>'}
          </div>`;
        body.querySelectorAll('[data-fb]').forEach((b) =>
          b.addEventListener('click', async () => {
            const note = b.dataset.status === 'resolved' ? window.prompt('Reply note to the rider (optional):') || '' : '';
            try {
              await api(`/api/admin/feedback/${b.dataset.fb}`, {
                method: 'POST',
                body: { status: b.dataset.status, admin_note: note, notify_user: Boolean(note) }
              });
              toast('Feedback updated.', 'success');
              paintFeedback();
            } catch (err) {
              toast(err.message, 'error');
            }
          })
        );
      } catch (err) {
        body.innerHTML = errorState(err);
      }
    }

    /* -------------------------------- content ------------------------------- */
    async function paintContent() {
      body.innerHTML = skeletonList(2);
      try {
        const overview = await api('/api/admin/overview');
        body.innerHTML = `
          <section class="card">
            <h3>Posts awaiting review</h3>
            <div class="report-list">
              ${overview.pendingPosts.length
                ? overview.pendingPosts
                    .map(
                      (p) => `<div class="report-row">
                        <div class="report-main"><strong>${escapeHtml(p.title)}</strong><small>@${escapeHtml(p.username)} · ${escapeHtml(timeAgo(p.created_at))}</small><p>${escapeHtml((p.body || '').slice(0, 200))}</p></div>
                        <div class="user-actions">
                          <button class="btn btn-secondary btn-sm" data-approve="${escapeHtml(p.id)}">Restore</button>
                          <button class="btn btn-danger btn-sm" data-remove="${escapeHtml(p.id)}">Remove</button>
                        </div>
                      </div>`
                    )
                    .join('')
                : '<p class="muted">Nothing waiting.</p>'}
            </div>
          </section>
          <section class="card">
            <h3>Reported content shortcuts</h3>
            <p class="muted" style="font-size:.84rem">Use the Reports tab for full context. Removing a message preserves the audit trail and shows a placeholder to both people.</p>
            <button class="btn btn-secondary" id="goReports">Open report queue</button>
          </section>`;
        body.querySelector('#goReports').addEventListener('click', () => {
          activeTab = 'reports';
          viewport.querySelectorAll('[data-admin-tab]').forEach((c) => c.classList.toggle('active', c.dataset.adminTab === 'reports'));
          paint();
        });
        body.querySelectorAll('[data-approve]').forEach((b) =>
          b.addEventListener('click', async () => {
            try {
              await api(`/api/posts/${b.dataset.approve}`, { method: 'POST', body: { moderationAction: 'restore' } });
              toast('Post restored.', 'success');
              paintContent();
            } catch (err) {
              toast(err.message, 'error');
            }
          })
        );
        body.querySelectorAll('[data-remove]').forEach((b) =>
          b.addEventListener('click', async () => {
            if (!window.confirm('Remove this post from the community feed?')) return;
            try {
              await api(`/api/posts/${b.dataset.remove}`, { method: 'POST', body: { moderationAction: 'remove' } });
              toast('Post removed.', 'info');
              paintContent();
            } catch (err) {
              toast(err.message, 'error');
            }
          })
        );
      } catch (err) {
        body.innerHTML = errorState(err);
      }
    }

    /* -------------------------------- events -------------------------------- */
    async function paintEvents() {
      body.innerHTML = skeletonList(2);
      try {
        const [data, newsData] = await Promise.all([api('/api/admin/events'), api('/api/admin/news')]);
        body.innerHTML = `
          <div class="grid-2">
            <section class="card">
              <h3>Publish studio news</h3>
              <div class="form-group"><label class="form-label" for="newsTitle">Headline</label><input class="form-input" id="newsTitle" maxlength="180" /></div>
              <div class="form-group"><label class="form-label" for="newsBody">Body</label><textarea class="form-textarea" id="newsBody" rows="5"></textarea></div>
              <div class="grid-2" style="gap:10px">
                <div class="form-group"><label class="form-label" for="newsCategory">Category</label><input class="form-input" id="newsCategory" value="announcement" /></div>
                <label class="check-row" style="align-self:end"><input type="checkbox" id="newsPin" /> <span>Pin to top</span></label>
              </div>
              <label class="check-row"><input type="checkbox" id="newsNotify" checked /> <span>Notify all active riders</span></label>
              <button class="btn btn-primary" id="publishNews" style="margin-top:8px">Publish news</button>
            </section>
            <section class="card">
              <h3>Published news</h3>
              <div class="report-list">
                ${newsData.news.length
                  ? newsData.news
                      .map(
                        (n) => `<div class="report-row"><div class="report-main"><strong>${escapeHtml(n.title)}</strong><small>${escapeHtml(n.category)} · ${n.published ? 'published' : 'draft'} · ${escapeHtml(timeAgo(n.published_at))}</small></div>
                          <div class="user-actions"><button class="btn btn-secondary btn-sm" data-news-toggle="${escapeHtml(n.id)}" data-pub="${n.published ? '0' : '1'}">${n.published ? 'Unpublish' : 'Publish'}</button></div></div>`
                      )
                      .join('')
                  : '<p class="hint">No news yet.</p>'}
              </div>
            </section>
          </div>

          <section class="card">
            <h3>Events</h3>
            <p class="muted" style="font-size:.84rem">Only studio administrators can create an <strong>Official Shaun David Studios Event</strong>. Moderators can manage community events but cannot apply the official badge.</p>
            <div class="report-list">
              ${data.events.length
                ? data.events
                    .map(
                      (e) => `<div class="report-row">
                        <div class="report-main">
                          <strong>${escapeHtml(e.title)}</strong>
                          <small>${escapeHtml(dateLabel(e.event_date))} · ${escapeHtml(e.district)} · ${e.is_official_studio_event ? 'OFFICIAL STUDIO EVENT' : 'community event'} · ${e.going_count}/${e.capacity} registered</small>
                        </div>
                        <div class="user-actions">
                          <button class="btn btn-secondary btn-sm" data-event-feature="${escapeHtml(e.id)}" data-featured="${e.featured_on_home ? '1' : '0'}">${e.featured_on_home ? 'Unfeature' : 'Feature home'}</button>
                          <button class="btn btn-secondary btn-sm" data-event-announce="${escapeHtml(e.id)}">Announce</button>
                          <button class="btn btn-secondary btn-sm" data-event-remind="${escapeHtml(e.id)}">Remind</button>
                        </div>
                      </div>`
                    )
                    .join('')
                : '<p class="hint">No events yet.</p>'}
            </div>
            <details class="admin-details">
              <summary>Create or update an event</summary>
              <div class="grid-2" style="gap:10px;margin-top:10px">
                <div class="form-group"><label class="form-label" for="evTitle2">Title</label><input class="form-input" id="evTitle2" /></div>
                <div class="form-group"><label class="form-label" for="evDate2">Event date</label><input class="form-input" type="date" id="evDate2" /></div>
                <div class="form-group"><label class="form-label" for="evDistrict2">District</label><input class="form-input" id="evDistrict2" value="Colombo" /></div>
                <div class="form-group"><label class="form-label" for="evVenue2">Venue</label><input class="form-input" id="evVenue2" /></div>
                <div class="form-group"><label class="form-label" for="evCapacity2">Capacity</label><input class="form-input" type="number" id="evCapacity2" value="40" /></div>
                <div class="form-group"><label class="form-label" for="evCategory2">Category</label><input class="form-input" id="evCategory2" value="clinic" /></div>
              </div>
              <div class="form-group"><label class="form-label" for="evDesc2">Description</label><textarea class="form-textarea" id="evDesc2" rows="3"></textarea></div>
              <div class="form-group"><label class="form-label" for="evSafety2">Safety requirements</label><textarea class="form-textarea" id="evSafety2" rows="2">Certified helmet, inspected bicycle, closed practice area only.</textarea></div>
              <label class="check-row"><input type="checkbox" id="evOfficial2" ${data.can_designate_official ? '' : 'disabled'} /> <span>Mark as Official Shaun David Studios Event</span></label>
              <label class="check-row"><input type="checkbox" id="evFeature2" ${data.can_designate_official ? '' : 'disabled'} /> <span>Feature on home screen (official events only)</span></label>
              <label class="check-row"><input type="checkbox" id="evNotify2" /> <span>Notify riders</span></label>
              <button class="btn btn-primary" id="createEvent2" style="margin-top:8px">Publish event</button>
            </details>
          </section>`;

        body.querySelector('#publishNews').addEventListener('click', async (e) => {
          e.target.disabled = true;
          try {
            await api('/api/admin/news', {
              method: 'POST',
              body: {
                title: body.querySelector('#newsTitle').value,
                body: body.querySelector('#newsBody').value,
                category: body.querySelector('#newsCategory').value,
                pinned: body.querySelector('#newsPin').checked,
                notify: body.querySelector('#newsNotify').checked
              }
            });
            toast('News published.', 'success');
            paintEvents();
          } catch (err) {
            toast(err.message, 'error');
            e.target.disabled = false;
          }
        });
        body.querySelectorAll('[data-news-toggle]').forEach((b) =>
          b.addEventListener('click', async () => {
            try {
              await api(`/api/admin/news/${b.dataset.newsToggle}/${b.dataset.pub === '1' ? 'publish' : 'unpublish'}`, { method: 'POST' });
              paintEvents();
            } catch (err) {
              toast(err.message, 'error');
            }
          })
        );
        body.querySelectorAll('[data-event-feature]').forEach((b) =>
          b.addEventListener('click', async () => {
            try {
              await api(`/api/admin/events/${b.dataset.eventFeature}/feature`, {
                method: 'POST',
                body: { featured: b.dataset.featured !== '1' }
              });
              paintEvents();
            } catch (err) {
              toast(err.message, 'error');
            }
          })
        );
        body.querySelectorAll('[data-event-announce]').forEach((b) =>
          b.addEventListener('click', async () => {
            const title = window.prompt('Announcement title');
            if (!title) return;
            const text = window.prompt('Announcement body');
            if (!text) return;
            try {
              const res = await api(`/api/admin/events/${b.dataset.eventAnnounce}/announce`, {
                method: 'POST',
                body: { title, body: text }
              });
              toast(res.message, 'success');
            } catch (err) {
              toast(err.message, 'error');
            }
          })
        );
        body.querySelectorAll('[data-event-remind]').forEach((b) =>
          b.addEventListener('click', async () => {
            try {
              const res = await api(`/api/admin/events/${b.dataset.eventRemind}/remind`, { method: 'POST' });
              toast(res.message, 'success');
            } catch (err) {
              toast(err.message, 'error');
            }
          })
        );
        body.querySelector('#createEvent2').addEventListener('click', async (e) => {
          e.target.disabled = true;
          try {
            const res = await api('/api/admin/events', {
              method: 'POST',
              body: {
                title: body.querySelector('#evTitle2').value,
                event_date: body.querySelector('#evDate2').value,
                district: body.querySelector('#evDistrict2').value,
                venue: body.querySelector('#evVenue2').value,
                capacity: Number(body.querySelector('#evCapacity2').value),
                category: body.querySelector('#evCategory2').value,
                description: body.querySelector('#evDesc2').value,
                safety_requirements: body.querySelector('#evSafety2').value,
                is_official_studio_event: body.querySelector('#evOfficial2').checked,
                featured_on_home: body.querySelector('#evFeature2').checked,
                notify_members: body.querySelector('#evNotify2').checked
              }
            });
            toast(`${res.message} Check-in code: ${res.checkin_code}`, 'success', 9000);
            paintEvents();
          } catch (err) {
            toast(err.message, 'error');
            e.target.disabled = false;
          }
        });
      } catch (err) {
        body.innerHTML = errorState(err);
      }
    }

    /* -------------------------------- learning ------------------------------ */
    async function paintLearning() {
      body.innerHTML = skeletonList(2);
      try {
        const data = await api('/api/admin/learning/modules');
        body.innerHTML = `
          <section class="card">
            <h3>Tutorial content management</h3>
            <p class="muted" style="font-size:.84rem">Edits are versioned and audit-logged. Keep every module educational: no module may promise that a rider can safely perform a manoeuvre.</p>
            <div class="report-list">
              ${data.modules
                .map(
                  (m) => `<div class="report-row">
                    <div class="report-main"><strong>${escapeHtml(m.title)}</strong><small>${escapeHtml(m.category)} · ${escapeHtml(m.track)} · ${escapeHtml(m.status)} · v${m.version}</small></div>
                    <div class="user-actions">
                      <button class="btn btn-secondary btn-sm" data-edit-module="${escapeHtml(m.id)}">Edit</button>
                      <button class="btn ${m.status === 'published' ? 'btn-secondary' : 'btn-primary'} btn-sm" data-toggle-module="${escapeHtml(m.id)}" data-pub="${m.status === 'published' ? '0' : '1'}">${m.status === 'published' ? 'Unpublish' : 'Publish'}</button>
                    </div>
                  </div>`
                )
                .join('')}
            </div>
          </section>`;
        body.querySelectorAll('[data-toggle-module]').forEach((b) =>
          b.addEventListener('click', async () => {
            try {
              await api(`/api/admin/learning/modules/${b.dataset.toggleModule}/${b.dataset.pub === '1' ? 'publish' : 'unpublish'}`, { method: 'POST' });
              toast('Module status updated.', 'success');
              paintLearning();
            } catch (err) {
              toast(err.message, 'error');
            }
          })
        );
        body.querySelectorAll('[data-edit-module]').forEach((b) =>
          b.addEventListener('click', () => editModule(data.modules.find((m) => m.id === b.dataset.editModule)))
        );
      } catch (err) {
        body.innerHTML = errorState(err);
      }
    }

    function editModule(mod) {
      modal({
        title: `Edit: ${mod.title}`,
        size: '860px',
        body: `
          <div class="grid-2" style="gap:10px">
            <div class="form-group"><label class="form-label" for="mTitle">Title</label><input class="form-input" id="mTitle" value="${escapeHtml(mod.title)}" /></div>
            <div class="form-group"><label class="form-label" for="mDifficulty">Difficulty</label><input class="form-input" id="mDifficulty" value="${escapeHtml(mod.difficulty)}" /></div>
            <div class="form-group"><label class="form-label" for="mTrack">Track</label>
              <select class="form-select" id="mTrack">${['beginner', 'intermediate', 'advanced', 'maintenance'].map((t) => `<option value="${t}" ${mod.track === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
            <div class="form-group"><label class="form-label" for="mCategory">Category</label>
              <select class="form-select" id="mCategory">${['fundamentals', 'beginner_freestyle', 'intermediate', 'advanced'].map((c) => `<option value="${c}" ${mod.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
            <div class="form-group"><label class="form-label" for="mXp">XP reward</label><input class="form-input" type="number" id="mXp" value="${mod.xp_reward}" /></div>
            <div class="form-group"><label class="form-label" for="mVideo">Video URL (optional)</label><input class="form-input" id="mVideo" value="${escapeHtml(mod.video_url || '')}" placeholder="https://…" /></div>
          </div>
          <div class="form-group"><label class="form-label" for="mCoach">Coaching reminder</label><textarea class="form-textarea" id="mCoach" rows="2">${escapeHtml(mod.coaching_reminder)}</textarea></div>
          <div class="form-group"><label class="form-label" for="mObjectives">Learning objectives (one per line)</label><textarea class="form-textarea" id="mObjectives" rows="3">${escapeHtml((mod.learning_objectives || []).join('\n'))}</textarea></div>
          <div class="form-group"><label class="form-label" for="mChecklist">Inspection checklist (one per line)</label><textarea class="form-textarea" id="mChecklist" rows="4">${escapeHtml((JSON.parse(mod.inspection_checklist_json || '[]')).join('\n'))}</textarea></div>
          <div class="form-group"><label class="form-label" for="mQuiz">Quiz JSON</label><textarea class="form-textarea code-input" id="mQuiz" rows="8">${escapeHtml(JSON.stringify(mod.quiz_questions || [], null, 2))}</textarea>
            <div class="hint">Each question: { "prompt": "...", "options": ["a","b"], "correctIndex": 1, "explanation": "..." }. Answers are graded server-side.</div></div>
          <label class="check-row"><input type="checkbox" id="mSupervision" ${mod.requires_supervision ? 'checked' : ''} /> <span>Requires supervised practice</span></label>
          <label class="check-row"><input type="checkbox" id="mAck" ${mod.requires_safety_ack ? 'checked' : ''} /> <span>Requires explicit safety acknowledgement</span></label>`,
        footer: `<button class="btn btn-secondary" data-modal-close="1">Cancel</button><button class="btn btn-secondary" id="saveDraft">Save draft</button><button class="btn btn-primary" id="savePublish">Save &amp; publish</button>`,
        onMount(root) {
          const save = async (publish) => {
            let quiz;
            try {
              quiz = JSON.parse(root.querySelector('#mQuiz').value || '[]');
            } catch (e) {
              toast('Quiz JSON is not valid. Fix the syntax before saving.', 'error');
              return;
            }
            try {
              await api('/api/admin/learning/modules', {
                method: 'POST',
                body: {
                  id: mod.id,
                  title: root.querySelector('#mTitle').value,
                  difficulty: root.querySelector('#mDifficulty').value,
                  track: root.querySelector('#mTrack').value,
                  category: root.querySelector('#mCategory').value,
                  xp_reward: Number(root.querySelector('#mXp').value),
                  video_url: root.querySelector('#mVideo').value,
                  coaching_reminder: root.querySelector('#mCoach').value,
                  learning_objectives: root.querySelector('#mObjectives').value.split('\n').filter(Boolean),
                  inspection_checklist: root.querySelector('#mChecklist').value.split('\n').filter(Boolean),
                  quiz_questions: quiz,
                  requires_supervision: root.querySelector('#mSupervision').checked,
                  requires_safety_ack: root.querySelector('#mAck').checked,
                  publish
                }
              });
              closeModal();
              toast(publish ? 'Module published.' : 'Draft saved.', 'success');
              paintLearning();
            } catch (err) {
              toast(err.message, 'error');
            }
          };
          root.querySelector('#saveDraft').addEventListener('click', () => save(false));
          root.querySelector('#savePublish').addEventListener('click', () => save(true));
        }
      });
    }

    /* -------------------------------- catalog ------------------------------- */
    async function paintCatalog() {
      body.innerHTML = skeletonList(2);
      try {
        const data = await api('/api/admin/catalog/parts');
        body.innerHTML = `
          <section class="card">
            <h3>Catalogue records</h3>
            <p class="muted" style="font-size:.84rem">Prices must come from a real verification. Never guess a price, stock level or certification. Unlisting hides an entry without losing its history.</p>
            <div class="report-list">
              ${data.parts
                .map(
                  (p) => `<div class="report-row">
                    <div class="report-main"><strong>${escapeHtml(p.name)}</strong>
                      <small>${escapeHtml(p.brand)} · ${p.price_verified ? 'LKR ' + Number(p.price_lkr).toLocaleString('en-LK') + ' verified ' + escapeHtml(p.last_verified_date || '') : 'Price not verified'} · ${p.is_listed ? 'listed' : 'unlisted'}</small>
                    </div>
                    <div class="user-actions">
                      <button class="btn btn-secondary btn-sm" data-verify-price="${escapeHtml(p.id)}">Verify price</button>
                      <button class="btn btn-secondary btn-sm" data-list-part="${escapeHtml(p.id)}" data-listed="${p.is_listed ? '1' : '0'}">${p.is_listed ? 'Unlist' : 'Relist'}</button>
                      <button class="btn btn-secondary btn-sm" data-link-retailer="${escapeHtml(p.id)}">Add retailer</button>
                    </div>
                  </div>`
                )
                .join('')}
            </div>
            <details class="admin-details">
              <summary>Add a new catalogue entry</summary>
              <div class="grid-2" style="gap:10px;margin-top:10px">
                <div class="form-group"><label class="form-label" for="pName">Name</label><input class="form-input" id="pName" /></div>
                <div class="form-group"><label class="form-label" for="pBrand">Brand</label><input class="form-input" id="pBrand" /></div>
                <div class="form-group"><label class="form-label" for="pModel">Model</label><input class="form-input" id="pModel" /></div>
                <div class="form-group"><label class="form-label" for="pCategory">Category</label><input class="form-input" id="pCategory" value="pegs_accessories" /></div>
              </div>
              <div class="form-group"><label class="form-label" for="pDesc">Description</label><textarea class="form-textarea" id="pDesc" rows="2"></textarea></div>
              <div class="grid-2" style="gap:10px">
                <div class="form-group"><label class="form-label" for="pPrice">Verified LKR price (leave blank if unverified)</label><input class="form-input" type="number" id="pPrice" /></div>
                <div class="form-group"><label class="form-label" for="pRetailer">Retailer</label><input class="form-input" id="pRetailer" /></div>
              </div>
              <button class="btn btn-primary" id="createPart">Create entry</button>
            </details>
          </section>`;

        body.querySelectorAll('[data-verify-price]').forEach((b) =>
          b.addEventListener('click', async () => {
            const price = window.prompt('Verified price in LKR (leave blank to keep unverified):');
            if (price === null) return;
            if (!price.trim()) {
              toast('No price recorded — entry stays “Price not verified”.', 'info');
              return;
            }
            const source = window.prompt('Where was this price verified? (retailer, phone call, visit)') || 'Administrator verification';
            try {
              await api(`/api/admin/catalog/parts/${b.dataset.verifyPrice}/price`, {
                method: 'POST',
                body: { price_lkr: Number(price), source_label: source }
              });
              toast('Price verified with today’s date.', 'success');
              paintCatalog();
            } catch (err) {
              toast(err.message, 'error');
            }
          })
        );
        body.querySelectorAll('[data-list-part]').forEach((b) =>
          b.addEventListener('click', async () => {
            try {
              await api(`/api/admin/catalog/parts/${b.dataset.listPart}/${b.dataset.listed === '1' ? 'unlist' : 'relist'}`, { method: 'POST' });
              paintCatalog();
            } catch (err) {
              toast(err.message, 'error');
            }
          })
        );
        body.querySelectorAll('[data-link-retailer]').forEach((b) =>
          b.addEventListener('click', async () => {
            const name = window.prompt('Retailer name');
            if (!name) return;
            const url = window.prompt('Product URL (https://, optional)') || '';
            try {
              await api(`/api/admin/catalog/parts/${b.dataset.linkRetailer}/retailer`, {
                method: 'POST',
                body: { name, url, product_url: url }
              });
              toast('Retailer linked.', 'success');
            } catch (err) {
              toast(err.message, 'error');
            }
          })
        );
        body.querySelector('#createPart').addEventListener('click', async (e) => {
          e.target.disabled = true;
          const price = body.querySelector('#pPrice').value;
          try {
            await api('/api/admin/catalog/parts', {
              method: 'POST',
              body: {
                name: body.querySelector('#pName').value,
                brand: body.querySelector('#pBrand').value,
                model: body.querySelector('#pModel').value,
                category: body.querySelector('#pCategory').value,
                description: body.querySelector('#pDesc').value,
                retailer_name: body.querySelector('#pRetailer').value,
                price_lkr: price ? Number(price) : null,
                price_verified: Boolean(price)
              }
            });
            toast('Catalogue entry created.', 'success');
            paintCatalog();
          } catch (err) {
            toast(err.message, 'error');
            e.target.disabled = false;
          }
        });
      } catch (err) {
        body.innerHTML = errorState(err);
      }
    }

    /* ------------------------------- broadcast ------------------------------ */
    function paintBroadcast() {
      body.innerHTML = `
        <section class="card">
          <h3>Broadcast to riders</h3>
          <p class="muted" style="font-size:.84rem">Use for safety notices, maintenance windows and studio announcements. Every recipient receives an in-app notification; push delivery depends on FCM configuration.</p>
          <div class="form-group"><label class="form-label" for="bcTitle">Title</label><input class="form-input" id="bcTitle" maxlength="140" /></div>
          <div class="form-group"><label class="form-label" for="bcBody">Message</label><textarea class="form-textarea" id="bcBody" rows="4" maxlength="1000"></textarea></div>
          <div class="form-group"><label class="form-label" for="bcAudience">Audience</label>
            <select class="form-select" id="bcAudience"><option value="all">All active riders</option><option value="minors">Riders aged 16–17</option><option value="admins">Studio staff only</option></select>
          </div>
          <button class="btn btn-primary" id="sendBroadcast">Send broadcast</button>
        </section>`;
      body.querySelector('#sendBroadcast').addEventListener('click', async (e) => {
        if (!window.confirm('Send this broadcast now?')) return;
        e.target.disabled = true;
        try {
          const res = await api('/api/admin/broadcast', {
            method: 'POST',
            body: {
              title: body.querySelector('#bcTitle').value,
              body: body.querySelector('#bcBody').value,
              audience: body.querySelector('#bcAudience').value
            }
          });
          toast(res.message, 'success');
        } catch (err) {
          toast(err.message, 'error');
          e.target.disabled = false;
        }
      });
    }

    /* --------------------------------- audit -------------------------------- */
    async function paintAudit() {
      body.innerHTML = skeletonList(2);
      try {
        const [data, push] = await Promise.all([api('/api/admin/audit'), api('/api/admin/push/status')]);
        body.innerHTML = `
          <section class="card">
            <h3>Push notifications</h3>
            <p style="font-size:.86rem">${push.configured ? '<span class="pill-badge pill-green">Configured</span>' : '<span class="pill-badge pill-orange">Not configured</span>'} ${escapeHtml(push.note)}</p>
            <button class="btn btn-secondary btn-sm" id="testPush" ${push.configured ? '' : 'disabled'}>Send test push to my device</button>
            <div class="report-list" style="margin-top:8px">
              ${(push.recent || [])
                .slice(0, 12)
                .map((r) => `<div class="report-row"><div class="report-main"><strong>${escapeHtml(r.title)}</strong><small>${escapeHtml(r.channel)} · ${escapeHtml(r.status)} · ${escapeHtml(r.detail)} · ${escapeHtml(timeAgo(r.created_at))}</small></div></div>`)
                .join('') || '<p class="hint">No delivery log yet.</p>'}
            </div>
          </section>
          <section class="card">
            <h3>Administrator audit log</h3>
            <div class="audit-list">
              ${data.audit.length
                ? data.audit
                    .map(
                      (a) => `<div class="audit-row"><span class="audit-action">${escapeHtml(a.action)}</span><span class="audit-who">@${escapeHtml(a.admin_username || a.admin_id)}</span><span class="audit-detail">${escapeHtml(a.target_type)} ${escapeHtml(a.target_id)} ${escapeHtml(a.reason || '')}</span><span class="audit-when">${escapeHtml(timeAgo(a.created_at))}</span></div>`
                    )
                    .join('')
                : '<p class="muted">No entries yet.</p>'}
            </div>
          </section>`;
        body.querySelector('#testPush').addEventListener('click', async () => {
          try {
            const res = await api('/api/admin/push/test', { method: 'POST' });
            toast(res.message, res.sent ? 'success' : 'error');
          } catch (err) {
            toast(err.message, 'error');
          }
        });
      } catch (err) {
        body.innerHTML = errorState(err);
      }
    }
  }

  /* -------------------------------- login --------------------------------- */
  function renderAdminLogin(viewport, message) {
    viewport.innerHTML = `
      <div class="section-head">
        <div><h2>Studio administration</h2><p class="muted">Restricted area · authorised Shaun David Studios staff only.</p></div>
      </div>
      ${message ? `<div class="callout callout-danger" role="alert">${escapeHtml(message)}</div>` : ''}
      <div class="admin-login">
        <section class="card">
          <h3>Administrator sign-in</h3>
          <p class="muted" style="font-size:.84rem">Use the studio administrator credential. Repeated failures lock the account for 15 minutes.</p>
          <div class="form-group"><label class="form-label" for="adminUser">Username</label><input class="form-input" id="adminUser" autocomplete="username" /></div>
          <div class="form-group"><label class="form-label" for="adminPass">Password</label><input class="form-input" id="adminPass" type="password" autocomplete="current-password" /></div>
          <button class="btn btn-primary" id="adminLoginBtn">Sign in</button>
          <p class="hint" id="adminLoginError" style="color:var(--danger-red)"></p>
        </section>
        <section class="card">
          <h3>Sign in with your studio rider account</h3>
          <p class="muted" style="font-size:.84rem">A rider account whose database role is <code>admin</code> or <code>moderator</code> reaches this console automatically. Firebase accounts never gain a role from the client — it is read from the database on every request.</p>
          <button class="btn btn-primary" id="adminGoogle">Go to rider sign-in</button>
          <p class="hint">Change the bootstrap password immediately after signing in with the studio credential. Production servers refuse the development default.</p>
        </section>
      </div>`;

    viewport.querySelector('#adminLoginBtn').addEventListener('click', async (e) => {
      e.target.disabled = true;
      const errEl = viewport.querySelector('#adminLoginError');
      errEl.textContent = '';
      try {
        const res = await api('/api/admin/login', {
          method: 'POST',
          body: {
            username: viewport.querySelector('#adminUser').value,
            password: viewport.querySelector('#adminPass').value
          }
        });
        window.RR.setToken(res.token);
        await window.RR.refreshSession();
        window.RRApp.paintChrome();
        toast('Signed in to the studio console.', 'success');
        if (res.must_change_password) {
          renderAdminConsole(viewport);
          setTimeout(() => changePasswordModal(true), 250);
        } else {
          renderAdminConsole(viewport);
        }
      } catch (err) {
        errEl.textContent = err.message;
      } finally {
        e.target.disabled = false;
      }
    });

    viewport.querySelector('#adminGoogle').addEventListener('click', () => window.RRAuth.openSignIn());
  }

  function changePasswordModal(forced) {
    modal({
      title: forced ? 'Set a new administrator password' : 'Change administrator password',
      dismissible: !forced,
      body: `
        <p class="muted" style="font-size:.86rem">The bootstrap password from the project brief is public. Choose a long, unique passphrase and store it in a password manager.</p>
        <div class="form-group"><label class="form-label" for="cpCurrent">Current password</label><input class="form-input" id="cpCurrent" type="password" autocomplete="current-password" /></div>
        <div class="form-group"><label class="form-label" for="cpNew">New password (min 12 characters)</label><input class="form-input" id="cpNew" type="password" autocomplete="new-password" /></div>
        <div class="form-group"><label class="form-label" for="cpAgain">Repeat new password</label><input class="form-input" id="cpAgain" type="password" autocomplete="new-password" /></div>
        <p class="hint" id="cpError" style="color:var(--danger-red)"></p>`,
      footer: forced ? '' : '<button class="btn btn-secondary" data-modal-close="1">Cancel</button><button class="btn btn-primary" id="cpSave">Update password</button>',
      onMount(root) {
        const btn = root.querySelector('#cpSave');
        if (!btn) {
          root.querySelector('.modal-body').insertAdjacentHTML(
            'beforeend',
            '<button class="btn btn-primary" id="cpSave" style="margin-top:10px">Update password</button>'
          );
        }
        root.querySelector('#cpSave').addEventListener('click', async () => {
          const errEl = root.querySelector('#cpError');
          const next = root.querySelector('#cpNew').value;
          if (next !== root.querySelector('#cpAgain').value) {
            errEl.textContent = 'The new passwords do not match.';
            return;
          }
          try {
            await api('/api/admin/change-password', {
              method: 'POST',
              body: { current_password: root.querySelector('#cpCurrent').value, new_password: next }
            });
            closeModal();
            toast('Password updated. Moderation tools are now unlocked.', 'success');
            window.RRApp.route();
          } catch (err) {
            errEl.textContent = err.message;
          }
        });
      }
    });
  }

  function metric(label, value, icon, urgent) {
    return `<div class="metric-card ${urgent ? 'is-urgent' : ''}">
      <div class="metric-icon" aria-hidden="true">${icon}</div>
      <div><strong>${value}</strong><small>${escapeHtml(label)}</small></div>
    </div>`;
  }

  window.RRAdminConsole = { renderAdminConsole, changePasswordModal };
})();
