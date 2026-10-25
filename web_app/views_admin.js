/* RideRise LK — Studio administration console (RBAC-gated): reports, moderation, ranks, parts & events */
(function () {
  'use strict';
  const { api, state, escapeHtml, toast, modal, closeModal, timeAgo, skeletonList, emptyState, errorState } = window.RR;

  const REASON_LABELS = {
    bullying_harassment: 'Bullying / harassment',
    threats_violence: 'Threats / violence',
    impersonation: 'Impersonation',
    unwanted_sexual_content: 'Unwanted sexual content',
    suspicious_pii_request: 'Suspicious PII request',
    dangerous_road_stunt: 'Dangerous road stunt',
    scam_marketplace: 'Scam marketplace',
    other: 'Other'
  };

  async function renderAdmin(viewport) {
    if (!state.token) {
      viewport.innerHTML = `
        <div class="section-head"><div><h2>Studio administration</h2><p class="muted">Restricted area — authorised Shaun David Studios staff only.</p></div></div>
        <div class="card">${emptyState({
          icon: '🛠️',
          title: 'Administrator sign-in required',
          body: 'Moderation, rank configuration, catalog verification and official event publishing require an administrator or moderator role. Sign in with the studio admin account to review this console.',
          actionHtml: '<button class="btn btn-primary" id="adminSignIn">Sign in</button>'
        })}</div>`;
      viewport.querySelector('#adminSignIn').addEventListener('click', () => window.RRAuth.openSignIn());
      return;
    }
    viewport.innerHTML = `<div class="skeleton" style="height:140px"></div><div class="skeleton"></div>`;
    try {
      const data = await api('/api/admin/overview');
      const m = data.metrics;
      viewport.innerHTML = `
        <div class="section-head">
          <div><h2>Studio administration</h2><p class="muted">Signed in as ${escapeHtml(state.account.role)} · least-privilege access · all actions are audit-logged.</p></div>
          <button class="btn btn-secondary btn-sm" onclick="location.hash='#/explore'">← Explore</button>
        </div>

        <div class="metric-grid">
          ${metric('Active riders', m.totalRiders, '👥')}
          ${metric('Youth accounts (16–17)', m.minorAccountsProtected, '🛡️')}
          ${metric('Bicycle profiles', m.totalBikes, '🚲')}
          ${metric('Bikes with safety flags', m.bikesWithSafetyWarnings, '⚠️', true)}
          ${metric('Pending reports', m.pendingReports, '⚑', true)}
          ${metric('Posts awaiting review', m.pendingReviewPosts, '⏳', true)}
          ${metric('Visible posts', m.visiblePosts, '📝')}
          ${metric('Active guilds', m.activeGuilds, '🛡️')}
          ${metric('Verified parts', m.verifiedPartsCount, '✅')}
          ${metric('Unverified prices', m.unverifiedPartsCount, '❔')}
        </div>

        <section class="card">
          <h3>Report queue</h3>
          <p class="muted" style="font-size:.82rem">Private messages are never browsed proactively — only formally reported messages are reviewed, with an audit trail.</p>
          ${
            data.reports.length
              ? `<div class="report-list">${data.reports
                  .map(
                    (r) => `<div class="report-row ${r.status}">
                      <div class="report-main">
                        <strong>${escapeHtml(REASON_LABELS[r.reason_category] || r.reason_category)}</strong>
                        <small>${escapeHtml(r.target_type)} · ${escapeHtml(r.target_id)} · by @${escapeHtml(r.reporter_username)} · ${escapeHtml(
                      timeAgo(r.created_at)
                    )}</small>
                        <p>${escapeHtml(r.details)}</p>
                        ${r.resolution_note ? `<p class="hint">Resolution: ${escapeHtml(r.resolution_note)}</p>` : ''}
                      </div>
                      <span class="pill-badge ${r.status === 'pending' ? 'pill-red' : 'pill-green'}">${escapeHtml(r.status)}</span>
                      ${
                        r.status === 'pending'
                          ? `<button class="btn btn-primary btn-sm" data-resolve="${escapeHtml(r.id)}">Review</button>`
                          : ''
                      }
                    </div>`
                  )
                  .join('')}</div>`
              : '<p class="muted" style="font-size:.84rem">No reports submitted.</p>'
          }
        </section>

        <section class="card">
          <h3>Content moderation</h3>
          ${
            data.pendingPosts.length
              ? `<div class="report-list">${data.pendingPosts
                  .map(
                    (p) => `<div class="report-row">
                      <div class="report-main">
                        <strong>${escapeHtml(p.title)}</strong>
                        <small>@${escapeHtml(p.username)} · ${escapeHtml(p.moderation_status)} · ${escapeHtml(timeAgo(p.created_at))}</small>
                        <p>${escapeHtml(p.body.slice(0, 220))}…</p>
                      </div>
                      <button class="btn btn-primary btn-sm" data-approve-post="${escapeHtml(p.id)}">Restore</button>
                      <button class="btn btn-danger btn-sm" data-remove-post="${escapeHtml(p.id)}">Remove</button>
                    </div>`
                  )
                  .join('')}</div>`
              : '<p class="muted" style="font-size:.84rem">No content awaiting review.</p>'
          }
        </section>

        <div class="grid-2">
          <section class="card">
            <h3>Rider ranks</h3>
            <p class="muted" style="font-size:.82rem">Rename ranks, change thresholds, or add new levels. Server-side XP validation is unaffected by client requests.</p>
            <div id="rankEditor">${skeletonList(2)}</div>
          </section>
          <section class="card">
            <h3>Official event publisher</h3>
            ${state.account.role === 'admin'
              ? `<div class="form-group"><label class="form-label" for="evTitle">Title</label><input class="form-input" id="evTitle" placeholder="Official clinic name" /></div>
                 <div class="grid-2" style="gap:10px">
                   <div class="form-group"><label class="form-label" for="evDate">Event date</label><input class="form-input" type="date" id="evDate" /></div>
                   <div class="form-group"><label class="form-label" for="evDeadline">Registration deadline</label><input class="form-input" type="date" id="evDeadline" /></div>
                 </div>
                 <div class="grid-2" style="gap:10px">
                   <div class="form-group"><label class="form-label" for="evDistrict">District</label><input class="form-input" id="evDistrict" value="Colombo" /></div>
                   <div class="form-group"><label class="form-label" for="evCapacity">Capacity</label><input class="form-input" type="number" id="evCapacity" value="40" /></div>
                 </div>
                 <div class="form-group"><label class="form-label" for="evVenue">Venue</label><input class="form-input" id="evVenue" placeholder="Closed practice arena" /></div>
                 <div class="form-group"><label class="form-label" for="evDesc">Description</label><textarea class="form-textarea" id="evDesc" rows="2"></textarea></div>
                 <button class="btn btn-primary btn-sm" id="publishEventBtn">Publish official event</button>`
              : '<p class="hint">Only studio administrators can publish events marked as officially hosted by Shaun David Studios.</p>'
            }
          </section>
        </div>

        <section class="card">
          <h3>Parts catalog verification</h3>
          <p class="muted" style="font-size:.82rem">Never invent prices. Leave “price verified” unchecked to display <em>Price not verified</em>.</p>
          <div class="grid-2" style="gap:10px">
            <div class="form-group"><label class="form-label" for="partName">Part name</label><input class="form-input" id="partName" /></div>
            <div class="form-group"><label class="form-label" for="partBrand">Brand / reference</label><input class="form-input" id="partBrand" /></div>
            <div class="form-group"><label class="form-label" for="partCategory">Category</label><select class="form-select" id="partCategory">
              ${(window.RRExplore.PART_CATEGORIES || [['pegs_accessories', 'BMX pegs & accessories']])
                .filter(([v]) => v)
                .map(([v, l]) => `<option value="${v}">${escapeHtml(l)}</option>`)
                .join('')}
            </select></div>
            <div class="form-group"><label class="form-label" for="partRetailer">Retailer</label><input class="form-input" id="partRetailer" /></div>
            <div class="form-group"><label class="form-label" for="partPrice">Price (LKR, blank if unverified)</label><input class="form-input" type="number" id="partPrice" /></div>
            <div class="form-group" style="display:flex;align-items:flex-end"><label class="check-row" style="margin:0"><input type="checkbox" id="partVerified" /><span>Price verified today</span></label></div>
          </div>
          <div class="form-group"><label class="form-label" for="partWarning">Compatibility warning</label><input class="form-input" id="partWarning" placeholder="e.g. Requires 14mm axle; never fit to quick-release hubs" /></div>
          <button class="btn btn-primary btn-sm" id="addPartBtn">Add catalog entry</button>
        </section>

        <section class="card">
          <h3>Administrative audit log</h3>
          ${
            data.auditLogs.length
              ? `<ul class="audit-list">${data.auditLogs
                  .map(
                    (a) => `<li><strong>${escapeHtml(a.action)}</strong> · ${escapeHtml(a.target_type)} <code>${escapeHtml(
                      a.target_id
                    )}</code> · @${escapeHtml(a.admin_username)} · ${escapeHtml(timeAgo(a.created_at))}</li>`
                  )
                  .join('')}</ul>`
              : '<p class="muted" style="font-size:.84rem">No administrative actions recorded yet.</p>'
          }
        </section>`;

      viewport.querySelectorAll('[data-resolve]').forEach((b) =>
        b.addEventListener('click', () => openResolve(b.dataset.resolve))
      );
      viewport.querySelectorAll('[data-remove-post]').forEach((b) =>
        b.addEventListener('click', () => moderatePost(b.dataset.removePost, 'removed'))
      );
      viewport.querySelectorAll('[data-approve-post]').forEach((b) =>
        b.addEventListener('click', () => moderatePost(b.dataset.approvePost, 'visible'))
      );

      loadRanks();

      const publishBtn = viewport.querySelector('#publishEventBtn');
      if (publishBtn)
        publishBtn.addEventListener('click', async () => {
          try {
            const res = await api('/api/admin/events', {
              method: 'POST',
              body: {
                title: viewport.querySelector('#evTitle').value.trim(),
                event_date: viewport.querySelector('#evDate').value,
                registration_deadline: viewport.querySelector('#evDeadline').value,
                district: viewport.querySelector('#evDistrict').value,
                capacity: Number(viewport.querySelector('#evCapacity').value),
                venue: viewport.querySelector('#evVenue').value,
                description: viewport.querySelector('#evDesc').value
              }
            });
            toast(res.message, 'success');
            renderAdmin(viewport);
          } catch (err) {
            toast(err.message, 'error');
          }
        });

      viewport.querySelector('#addPartBtn').addEventListener('click', async () => {
        try {
          const res = await api('/api/admin/parts', {
            method: 'POST',
            body: {
              name: viewport.querySelector('#partName').value.trim(),
              brand: viewport.querySelector('#partBrand').value.trim(),
              category: viewport.querySelector('#partCategory').value,
              retailer_name: viewport.querySelector('#partRetailer').value.trim(),
              price_lkr: viewport.querySelector('#partPrice').value || null,
              price_verified: viewport.querySelector('#partVerified').checked,
              compatibility_warning: viewport.querySelector('#partWarning').value.trim() || undefined
            }
          });
          toast(res.message, 'success');
          renderAdmin(viewport);
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    } catch (err) {
      viewport.innerHTML = errorState(err, 'data-retry="1"');
      const retry = viewport.querySelector('[data-retry]');
      if (retry) retry.addEventListener('click', () => renderAdmin(viewport));
    }
  }

  function metric(label, value, icon, warn = false) {
    return `<div class="metric-card ${warn && value ? 'warn' : ''}">
      <span class="metric-icon" aria-hidden="true">${icon}</span>
      <strong>${value}</strong>
      <small>${escapeHtml(label)}</small>
    </div>`;
  }

  async function loadRanks() {
    const host = document.getElementById('rankEditor');
    if (!host) return;
    try {
      const data = await api('/api/ranks');
      host.innerHTML = data.ranks
        .map(
          (r) => `<div class="rank-row">
            <span class="pill-badge" style="background:${escapeHtml(r.color_hex)}22;color:${escapeHtml(r.color_hex)};border:1px solid ${escapeHtml(
            r.color_hex
          )}66">L${r.level_order}</span>
            <strong>${escapeHtml(r.name)}</strong>
            <span class="muted" style="font-size:.78rem">${r.min_xp} XP</span>
            <button class="btn btn-secondary btn-sm" data-edit-rank="${escapeHtml(r.id)}">Edit</button>
          </div>`
        )
        .join('') + `<button class="btn btn-secondary btn-sm" id="addRankBtn" style="margin-top:10px">+ Add rank level</button>`;

      host.querySelectorAll('[data-edit-rank]').forEach((b) =>
        b.addEventListener('click', () => {
          const rank = data.ranks.find((r) => r.id === b.dataset.editRank);
          openRankEditor(rank);
        })
      );
      host.querySelector('#addRankBtn').addEventListener('click', () => openRankEditor(null));
    } catch (err) {
      host.innerHTML = `<p class="muted" style="font-size:.82rem">${escapeHtml(err.message)}</p>`;
    }
  }

  function openRankEditor(rank) {
    modal({
      title: rank ? `Edit rank — ${rank.name}` : 'Create rank level',
      size: '520px',
      body: `<div class="form-group"><label class="form-label" for="rankName">Rank name</label>
          <input class="form-input" id="rankName" value="${rank ? escapeHtml(rank.name) : ''}" /></div>
        <div class="form-group"><label class="form-label" for="rankXp">Minimum XP threshold</label>
          <input class="form-input" type="number" id="rankXp" value="${rank ? rank.min_xp : 3000}" /></div>
        <div class="form-group"><label class="form-label" for="rankDesc">Description</label>
          <textarea class="form-textarea" id="rankDesc" rows="2">${rank ? escapeHtml(rank.description) : ''}</textarea></div>
        <div class="callout">Thresholds are validated server-side. Existing riders are recalculated from their verified XP log on the next award.</div>`,
      footer: '<button class="btn btn-primary" id="saveRank">Save rank</button>',
      onMount(root) {
        root.querySelector('#saveRank').addEventListener('click', async () => {
          try {
            await api('/api/admin/ranks', {
              method: 'POST',
              body: {
                id: rank ? rank.id : undefined,
                name: root.querySelector('#rankName').value.trim(),
                min_xp: Number(root.querySelector('#rankXp').value),
                description: root.querySelector('#rankDesc').value
              }
            });
            closeModal();
            toast('Rank configuration saved.', 'success');
            loadRanks();
          } catch (err) {
            toast(err.message, 'error');
          }
        });
      }
    });
  }

  function openResolve(reportId) {
    modal({
      title: 'Resolve report',
      size: '560px',
      body: `<div class="form-group"><label class="form-label" for="resolveDecision">Decision</label>
          <select class="form-select" id="resolveDecision">
            <option value="action_taken">Action taken — remove content / restrict account</option>
            <option value="dismissed">Dismiss — no violation found</option>
          </select></div>
        <div class="form-group"><label class="form-label" for="resolveNote">Resolution note (shared with the reporter and, when actioned, the rider)</label>
          <textarea class="form-textarea" id="resolveNote" rows="3" maxlength="400"></textarea></div>
        <div class="form-group"><label class="form-label" for="accountAction">Account action</label>
          <select class="form-select" id="accountAction">
            <option value="none">No account action</option>
            <option value="warn">Issue a warning</option>
            <option value="suspend">Suspend the account</option>
          </select></div>
        <div class="form-group" id="suspendDaysWrap" hidden><label class="form-label" for="suspendDays">Suspension length</label>
          <select class="form-select" id="suspendDays">
            <option value="3">3 days</option>
            <option value="7" selected>7 days</option>
            <option value="30">30 days</option>
            <option value="permanent">Permanent (serious violations)</option>
          </select>
          <div class="hint">Temporary suspensions lift automatically when they expire.</div></div>
        <div class="callout callout-warn">This action is recorded in the administrative audit log with your account ID, and the rider is notified.</div>`,
      footer: '<button class="btn btn-primary" id="confirmResolve">Record decision</button>',
      onMount(root) {
        root.querySelector('#accountAction').addEventListener('change', (e) => {
          root.querySelector('#suspendDaysWrap').hidden = e.target.value !== 'suspend';
        });
        root.querySelector('#confirmResolve').addEventListener('click', async () => {
          try {
            const action = root.querySelector('#accountAction').value;
            const res = await api(`/api/admin/reports/${reportId}/resolve`, {
              method: 'POST',
              body: {
                decision: root.querySelector('#resolveDecision').value,
                resolution_note: root.querySelector('#resolveNote').value || 'Reviewed by moderation team.',
                accountAction: action,
                suspensionDays: root.querySelector('#suspendDays').value
              }
            });
            closeModal();
            toast(res.message, 'success');
            renderAdmin(document.getElementById('mainViewport'));
          } catch (err) {
            toast(err.message, 'error');
          }
        });
      }
    });
  }

  async function moderatePost(postId, status) {
    try {
      const note = status === 'visible' ? 'Restored after review.' : 'Removed for breaching the Community Guidelines.';
      const res = await api(`/api/admin/posts/${encodeURIComponent(postId)}/moderate`, {
        method: 'POST',
        body: { status, note }
      });
      toast(`${res.message} The author was notified.`, 'success', 4500);
      renderAdmin(document.getElementById('mainViewport'));
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  window.RRAdmin = { renderAdmin };
})();
