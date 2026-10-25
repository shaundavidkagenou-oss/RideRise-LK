/* RideRise LK — Rider profile, bicycle build-rating questionnaire, achievements, activity & settings */
(function () {
  'use strict';
  const { api, state, escapeHtml, toast, modal, closeModal, avatar, timeAgo, dateLabel, money, skeletonList, emptyState, errorState } = window.RR;

  const BIKE_TYPES = ['BMX', 'Freestyle Bike', 'Dirt Jumper', 'Mountain Bike (Hardtail)', 'Mountain Bike (Full Suspension)', 'Other'];
  const FRAME_MATERIALS = ['Chromoly steel (4130 CrMo)', 'High-tensile steel (Hi-Ten)', 'Aluminium', 'Carbon fibre', 'Titanium', 'Other', "I don't know"];
  const FRAME_BRANDS = ['WeThePeople', 'Sunday', 'Cult', 'BSD', 'Odyssey', 'Fiend', 'Kink', 'GT', 'Haro', 'Mongoose', 'Fit Bike Co.', 'Polygon', 'Trek', 'Giant', 'Specialized', 'Dartmoor', 'Other', "I don't know"];
  const BRAKES = ['Rear U-Brake', 'Front & Rear U-Brake', 'Rear V-Brake', 'Rear Hydraulic Disc', 'Front & Rear Hydraulic Disc', 'Rear Mechanical Disc', 'Coaster / Foot Brake', 'Brakeless (skatepark only)', "I don't know"];
  const CONDITIONS = ['Excellent', 'Good', 'Fair', 'Needs Service', 'Poor'];
  const USES = ['Street riding', 'Skatepark', 'Dirt trails', 'Pump track', 'General use', 'Commuting (non-stunt)'];
  const DEFECTS = [
    ['cracks', 'Cracks in frame, fork or handlebars'],
    ['damaged_parts', 'Bent / damaged structural parts'],
    ['loose_bolts', 'Loose stem, axle, crank or headset bolts'],
    ['worn_tires', 'Worn tires, cuts or exposed cords'],
    ['faulty_brakes', 'Faulty, slipping or frayed brakes'],
    ['missing_bar_ends', 'Missing handlebar end plugs']
  ];

  async function renderProfile(viewport, targetUserId = null) {
    if (!state.token) {
      location.hash = '#/welcome';
      return;
    }
    const userId = targetUserId || (state.profile && state.profile.user_id);
    const isSelf = !targetUserId || userId === (state.profile && state.profile.user_id);
    viewport.innerHTML = skeletonList(3);
    try {
      const data = isSelf ? { profile: state.profile } : await api(`/api/profiles/${encodeURIComponent(userId)}`);
      if (!data.profile && isSelf) {
        const refreshed = await api(`/api/profiles/${encodeURIComponent(userId)}`);
        data.profile = refreshed.profile;
      }
      const p = data.profile;
      if (!p) throw new window.RR.ApiError('Rider profile not found.', 'PROFILE_NOT_FOUND', 404);
      if (isSelf) state.profile = p;

      if (p.restricted_view) {
        viewport.innerHTML = `
          <section class="card">
            <div class="profile-head">
              ${avatar(p.avatar_url, p.display_name, 84)}
              <div>
                <h2>${escapeHtml(p.display_name)} <small class="muted">@${escapeHtml(p.username)}</small></h2>
                <p class="muted">${escapeHtml(p.district || 'Sri Lanka')} · ${escapeHtml(p.rank_name)}</p>
                <p class="pill-badge pill-cyan" style="margin-top:8px">🔒 ${escapeHtml(p.message || 'Private profile')}</p>
              </div>
            </div>
            <div class="callout" style="margin-top:14px">This rider keeps their bicycles, achievements and activity private. You can still send a friend request if they allow it.</div>
            ${p.allow_friend_requests ? '<button class="btn btn-primary" id="friendReqBtn">Send friend request</button>' : ''}
          </section>`;
        const fr = viewport.querySelector('#friendReqBtn');
        if (fr) fr.addEventListener('click', () => sendFriendRequest(p.user_id));
        return;
      }

      const bikes = p.bicycles || [];
      const primary = p.primary_bike || bikes[0] || null;
      viewport.innerHTML = `
        <section class="card card-accent profile-hero">
          <div class="profile-head">
            <div class="profile-avatar-wrap">
              ${avatar(p.avatar_url, p.display_name, 92)}
              ${isSelf ? '<button class="avatar-edit" id="avatarBtn" aria-label="Change profile picture">📷</button>' : ''}
            </div>
            <div class="profile-head-text">
              <h2>${escapeHtml(p.display_name)}</h2>
              <p class="muted">@${escapeHtml(p.username)} · ${escapeHtml(p.district || 'Sri Lanka')}</p>
              <p class="profile-area">📍 ${escapeHtml(p.preferred_riding_area || 'Preferred riding area not set')}</p>
              <p class="profile-bio">${escapeHtml(p.bio || 'No biography yet.')}</p>
              <div class="profile-pills">
                <span class="pill-badge" style="background:${escapeHtml(p.rank_color || '#FF6B00')}22;color:${escapeHtml(
        p.rank_color || '#FF6B00'
      )};border:1px solid ${escapeHtml(p.rank_color || '#FF6B00')}66">🏅 ${escapeHtml(p.rank_name)}</span>
                <span class="pill-badge pill-cyan">⚡ ${p.xp} XP</span>
                <span class="pill-badge pill-green">📚 ${p.completed_modules_count} modules</span>
                <span class="pill-badge pill-cyan">🖼️ ${p.posts_count} posts</span>
                ${p.hide_from_leaderboards ? '<span class="pill-badge pill-orange">Hidden from leaderboards</span>' : ''}
                ${
                  !isSelf && p.mutual_friends && p.mutual_friends.count
                    ? `<span class="pill-badge pill-cyan" title="Riders you are both friends with">🤝 ${p.mutual_friends.count} mutual friend${
                        p.mutual_friends.count === 1 ? '' : 's'
                      }${p.mutual_friends.names.length ? ` · @${p.mutual_friends.names.join(', @')}` : ''}</span>`
                    : ''
                }
                ${!isSelf && p.is_friend ? '<span class="pill-badge pill-green">✓ Friends</span>' : ''}
              </div>
            </div>
            ${
              isSelf
                ? `<div class="profile-hero-actions">
                     <button class="btn btn-primary btn-sm" id="editProfileBtn">✎ Edit profile</button>
                     <button class="btn btn-secondary btn-sm" id="settingsBtn">⚙ Settings</button>
                   </div>`
                : `<div class="profile-hero-actions">
                     <button class="btn btn-primary btn-sm" id="friendReqBtn">＋ Add friend</button>
                     <button class="btn btn-secondary btn-sm" id="messageBtn">💬 Message</button>
                     <button class="btn btn-danger btn-sm" id="blockBtn">Block</button>
                     <button class="btn btn-secondary btn-sm" id="userReportBtn">⚑ Report</button>
                   </div>`
            }
          </div>
          ${window.RR.xpProgress(p)}
        </section>

        ${
          primary
            ? `<section class="card profile-bike-card">
                <div class="profile-bike-head">
                  <div>
                    <span class="muted" style="font-size:.76rem;letter-spacing:.12em">PRIMARY BICYCLE</span>
                    <h3>${escapeHtml(primary.name)}</h3>
                    <p class="muted" style="font-size:.8rem">${escapeHtml(primary.bike_type)} · ${escapeHtml(primary.frame_material)} · ${escapeHtml(primary.frame_brand)}</p>
                  </div>
                  ${scoreRing(primary.build_score, primary.has_critical_safety_defect)}
                </div>
                ${
                  primary.has_critical_safety_defect
                    ? `<div class="callout callout-danger"><strong>⚠ Safety issue reported</strong><br/>${escapeHtml(primary.safety_recommendation)}</div>`
                    : ''
                }
                <button class="btn btn-secondary btn-sm" id="viewBikeBreakdown">View 0–100 score breakdown</button>
              </section>`
            : `<section class="card">${emptyState({
                icon: '🔧',
                title: 'No bicycle profile yet',
                body: 'Complete the guided 13-question bicycle questionnaire to get a transparent Bike Build Rating and safety review.',
                actionHtml: isSelf ? '<button class="btn btn-primary" id="addBikeEmpty">Add my bicycle</button>' : ''
              })}</section>`
        }

        <div class="chip-bar" role="tablist" aria-label="Profile sections">
          <button class="chip active" data-profile-tab="bikes">🚲 Bicycles (${bikes.length})</button>
          <button class="chip" data-profile-tab="badges">🏅 Achievements (${(p.achievements || []).length})</button>
          <button class="chip" data-profile-tab="activity">📈 Activity</button>
        </div>
        <div id="profileTabBody"></div>

        ${
          isSelf
            ? `<section class="card quick-links">
                <h3>Shortcuts</h3>
                <div class="quick-links-grid">
                  <button class="btn btn-secondary" onclick="location.hash='#/friends'">👥 Friends &amp; messages</button>
                  <button class="btn btn-secondary" onclick="location.hash='#/parts'">🛒 Parts catalog</button>
                  <button class="btn btn-secondary" onclick="location.hash='#/events'">📅 Studio events</button>
                  <button class="btn btn-secondary" onclick="location.hash='#/notifications'">🔔 Notifications</button>
                  <button class="btn btn-safety" onclick="location.hash='#/safety'">🛡️ Safety Centre</button>
                  <button class="btn btn-secondary" onclick="location.hash='#/settings'">⚙️ Settings &amp; privacy</button>
                </div>
              </section>`
            : ''
        }`;

      const tabBody = viewport.querySelector('#profileTabBody');
      const renderTab = (tab) => {
        viewport.querySelectorAll('[data-profile-tab]').forEach((c) => c.classList.toggle('active', c.dataset.profileTab === tab));
        if (tab === 'bikes') tabBody.innerHTML = bikesTabHtml(bikes, isSelf);
        if (tab === 'badges') tabBody.innerHTML = badgesTabHtml(p.achievements || []);
        if (tab === 'activity') {
          tabBody.innerHTML = `<div class="card"><h3>Activity history</h3><div id="activityList">${skeletonList(2)}</div></div>`;
          loadActivity(p.user_id, isSelf);
        }
        wireBikeActions(bikes, isSelf, (updated) => renderProfile(viewport, targetUserId));
      };
      viewport.querySelectorAll('[data-profile-tab]').forEach((chip) =>
        chip.addEventListener('click', () => renderTab(chip.dataset.profileTab))
      );
      renderTab('bikes');

      if (isSelf) {
        viewport.querySelector('#editProfileBtn').addEventListener('click', () => openEditProfile(p, () => renderProfile(viewport)));
        viewport.querySelector('#settingsBtn').addEventListener('click', () => (location.hash = '#/settings'));
        viewport.querySelector('#avatarBtn').addEventListener('click', () => openAvatarEditor(p, () => renderProfile(viewport)));
        const addEmpty = viewport.querySelector('#addBikeEmpty');
        if (addEmpty) addEmpty.addEventListener('click', () => openBikeWizard(null, () => renderProfile(viewport)));
        const breakdownBtn = viewport.querySelector('#viewBikeBreakdown');
        if (breakdownBtn) breakdownBtn.addEventListener('click', () => openScoreBreakdown(primary));
      } else {
        viewport.querySelector('#friendReqBtn').addEventListener('click', () => sendFriendRequest(p.user_id));
        viewport.querySelector('#messageBtn').addEventListener('click', () => {
          if (!p.is_friend) {
            toast('Private messaging is restricted to accepted friends. Send a friend request first.', 'info', 5000);
            return;
          }
          location.hash = `#/friends?friend=${encodeURIComponent(p.user_id)}`;
        });
        viewport.querySelector('#blockBtn').addEventListener('click', () => blockUser(p.user_id, p.username, () => renderProfile(viewport, targetUserId)));
        viewport.querySelector('#userReportBtn').addEventListener('click', () => window.RRFeed.openReport(p.user_id, 'user'));
      }
    } catch (err) {
      viewport.innerHTML = errorState(err);
      const retry = viewport.querySelector('[data-retry]');
      if (retry) retry.addEventListener('click', () => renderProfile(viewport, targetUserId));
    }
  }

  function scoreRing(score, critical) {
    const color = critical ? 'var(--danger-red)' : score >= 80 ? 'var(--success-green)' : score >= 55 ? 'var(--brand-amber)' : 'var(--danger-red)';
    return `<div class="score-ring" style="--ring:${color};--pct:${score}" role="img" aria-label="Bike build rating ${score} out of 100">
      <span class="score-num">${score}</span><span class="score-den">/100</span>
      <small>${critical ? 'Inspection needed' : 'Build rating'}</small>
    </div>`;
  }

  function bikesTabHtml(bikes, isSelf) {
    return `<section class="card">
      <div class="section-head" style="margin-bottom:12px">
        <h3>Bicycle profiles</h3>
        ${isSelf ? '<button class="btn btn-primary btn-sm" id="addBikeBtn">+ Add bicycle</button>' : ''}
      </div>
      ${
        bikes.length
          ? `<div class="grid-2">${bikes
              .map(
                (b) => `<div class="card bike-card ${b.has_critical_safety_defect ? 'card-danger' : ''}">
                  <div class="bike-card-head">
                    <div>
                      <h4>${escapeHtml(b.name)} ${b.is_primary ? '<span class="pill-badge pill-orange">Primary</span>' : ''}</h4>
                      <p class="muted" style="font-size:.76rem">${escapeHtml(b.bike_type)} · ${escapeHtml(b.frame_brand)} ${escapeHtml(b.frame_model)}</p>
                    </div>
                    ${scoreRing(b.build_score, b.has_critical_safety_defect)}
                  </div>
                  <dl class="spec-grid">
                    <div><dt>Frame</dt><dd>${escapeHtml(b.frame_material)}</dd></div>
                    <div><dt>Fork</dt><dd>${escapeHtml(b.fork_spec)}</dd></div>
                    <div><dt>Tires</dt><dd>${escapeHtml(b.tire_spec)}</dd></div>
                    <div><dt>Wheels</dt><dd>${escapeHtml(b.wheel_rim_spec)}</dd></div>
                    <div><dt>Bars &amp; grips</dt><dd>${escapeHtml(b.handlebar_grip_spec)}</dd></div>
                    <div><dt>Drivetrain</dt><dd>${escapeHtml(b.drivetrain_spec)}</dd></div>
                    <div><dt>Brakes</dt><dd>${escapeHtml(b.brake_type)}</dd></div>
                    <div><dt>Condition</dt><dd>${escapeHtml(b.maintenance_condition)}</dd></div>
                    <div><dt>Primary use</dt><dd>${escapeHtml(b.primary_use)}</dd></div>
                    <div><dt>Cosmetic (optional)</dt><dd>${b.cosmetic_rating ? `${b.cosmetic_rating}/5 ★` : 'Not rated'}</dd></div>
                  </dl>
                  ${
                    b.has_critical_safety_defect
                      ? `<div class="callout callout-danger"><strong>⚠ Critical safety defects reported</strong><br/>${escapeHtml(b.safety_recommendation)}</div>`
                      : ''
                  }
                  <div class="tag-row"><span class="tag">Unverified user submission</span><span class="tag">User-reported condition</span></div>
                  <div class="bike-actions">
                    <button class="btn btn-secondary btn-sm" data-breakdown="${escapeHtml(b.id)}">Score breakdown</button>
                    ${
                      isSelf
                        ? `<button class="btn btn-secondary btn-sm" data-edit-bike="${escapeHtml(b.id)}">Edit</button>
                           ${b.is_primary ? '' : `<button class="btn btn-secondary btn-sm" data-primary-bike="${escapeHtml(b.id)}">Set primary</button>`}
                           <button class="btn btn-danger btn-sm" data-delete-bike="${escapeHtml(b.id)}">Delete</button>`
                        : ''
                    }
                  </div>
                </div>`
              )
              .join('')}</div>
            ${isSelf && bikes.length > 1 ? '<button class="btn btn-secondary btn-sm" id="compareBikesBtn" style="margin-top:12px">⇄ Compare my bicycles</button>' : ''}`
          : emptyState({
              icon: '🚲',
              title: 'No bicycles yet',
              body: 'Add your bicycle to generate a transparent 0–100 Bike Build Rating, safety warnings and a profile showcase.',
              actionHtml: isSelf ? '<button class="btn btn-primary" id="addBikeEmpty2">Start the questionnaire</button>' : ''
            })
      }
    </section>`;
  }

  function badgesTabHtml(achievements) {
    if (!achievements.length) {
      return `<section class="card">${emptyState({
        icon: '🏅',
        title: 'No badges yet',
        body: 'Complete safety checks, learning modules and bike profiles to earn verifiable badges.'
      })}</section>`;
    }
    return `<section class="card"><div class="badge-grid">${achievements
      .map(
        (a) => `<div class="badge-card">
          <div class="badge-icon">${badgeEmoji(a.icon)}</div>
          <div>
            <strong>${escapeHtml(a.title)}</strong>
            <p class="muted" style="font-size:.78rem">${escapeHtml(a.description)}</p>
            <small class="post-time">Awarded ${escapeHtml(timeAgo(a.awarded_at))}</small>
          </div>
        </div>`
      )
      .join('')}</div></section>`;
  }

  function badgeEmoji(icon) {
    const map = {
      'helmet-check': '🪖',
      'book-sprocket': '📚',
      'wrench-badge': '🔧',
      'hands-helping': '🤝',
      'shield-guild': '🛡️',
      'calendar-star': '📅'
    };
    return map[icon] || '🏅';
  }

  async function loadActivity(userId, isSelf) {
    const host = document.getElementById('activityList');
    if (!host) return;
    try {
      const data = await api('/api/ranks');
      const logs = data.activityHistory || [];
      if (!isSelf || !logs.length) {
        host.innerHTML = '<p class="muted" style="font-size:.84rem">Activity history is private. Only verified XP events appear here.</p>';
        return;
      }
      host.innerHTML = `<ul class="activity-list">${logs
        .map(
          (l) => `<li>
            <span class="activity-xp">+${l.xp_delta}</span>
            <div><strong>${escapeHtml(l.description)}</strong><small class="post-time">${escapeHtml(timeAgo(l.created_at))} · ${escapeHtml(
            l.action_type.replace(/_/g, ' ')
          )}</small></div>
          </li>`
        )
        .join('')}</ul>`;
    } catch (err) {
      host.innerHTML = `<p class="muted">${escapeHtml(err.message)}</p>`;
    }
  }

  function wireBikeActions(bikes, isSelf, refresh) {
    document.querySelectorAll('[data-breakdown]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const bike = bikes.find((b) => b.id === btn.dataset.breakdown);
        if (bike) openScoreBreakdown(bike);
      })
    );
    if (!isSelf) return;
    document.querySelectorAll('[data-edit-bike]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const bike = bikes.find((b) => b.id === btn.dataset.editBike);
        if (bike) openBikeWizard(bike, refresh);
      })
    );
    document.querySelectorAll('[data-delete-bike]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this bicycle profile permanently?')) return;
        try {
          await api(`/api/bicycles/${btn.dataset.deleteBike}`, { method: 'DELETE' });
          toast('Bicycle removed.', 'success');
          refresh();
        } catch (err) {
          toast(err.message, 'error');
        }
      })
    );
    document.querySelectorAll('[data-primary-bike]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        try {
          await api(`/api/bicycles/${btn.dataset.primaryBike}/primary`, { method: 'POST' });
          await window.RR.refreshSession();
          toast('Primary bicycle updated.', 'success');
          refresh();
        } catch (err) {
          toast(err.message, 'error');
        }
      })
    );
    const addBtn = document.getElementById('addBikeBtn');
    if (addBtn) addBtn.addEventListener('click', () => openBikeWizard(null, refresh));
    const addBtn2 = document.getElementById('addBikeEmpty2');
    if (addBtn2) addBtn2.addEventListener('click', () => openBikeWizard(null, refresh));
    const compareBtn = document.getElementById('compareBikesBtn');
    if (compareBtn) compareBtn.addEventListener('click', () => openCompare(bikes));
  }

  function openCompare(bikes) {
    const rows = [
      ['Bike', (b) => b.name],
      ['Build rating', (b) => `${b.build_score}/100`],
      ['Critical defects', (b) => (b.has_critical_safety_defect ? '⚠ Yes' : 'None reported')],
      ['Type', (b) => b.bike_type],
      ['Frame material', (b) => b.frame_material],
      ['Brakes', (b) => b.brake_type],
      ['Condition', (b) => b.maintenance_condition],
      ['Primary use', (b) => b.primary_use],
      ['Cosmetic', (b) => (b.cosmetic_rating ? `${b.cosmetic_rating}/5` : '—')]
    ];
    modal({
      title: 'Compare your bicycles',
      size: '760px',
      body: `<div class="table-wrap"><table class="compare-table">
        <thead><tr><th>Specification</th>${bikes.map((b) => `<th>${escapeHtml(b.name)}</th>`).join('')}</tr></thead>
        <tbody>${rows
          .map(([label, fn]) => `<tr><th scope="row">${escapeHtml(label)}</th>${bikes.map((b) => `<td>${escapeHtml(fn(b))}</td>`).join('')}</tr>`)
          .join('')}</tbody>
      </table></div>
      <div class="callout"><strong>Reminder:</strong> a higher build score never means “safe for advanced stunts”. Condition, maintenance and closed-environment practice decide risk.</div>`,
      footer: '<button class="btn btn-secondary" data-modal-close="1">Close</button>',
      onMount(root) {
        root.querySelector('[data-modal-close]').addEventListener('click', closeModal);
      }
    });
  }

  function openScoreBreakdown(bike) {
    const bd = bike.score_breakdown || {};
    const sections = [
      ['safety_structural', 'Safety &amp; structural integrity'],
      ['maintenance_condition', 'Maintenance &amp; mechanical condition'],
      ['use_case_compatibility', 'Use-case &amp; discipline compatibility'],
      ['build_completeness', 'Build completeness &amp; documentation'],
      ['component_clarity', 'Component specification clarity']
    ];
    modal({
      title: `Bike Build Rating — ${bike.name}`,
      size: '700px',
      body: `<div class="breakdown-total">${scoreRing(bike.build_score, bike.has_critical_safety_defect)}
        <div>
          <p class="muted" style="font-size:.84rem">Calculated server-side from your questionnaire answers. Cosmetic rating (${bike.cosmetic_rating || '—'}/5) is excluded — appearance never increases the safety-relevant score.</p>
          ${bd.safety_cap_applied ? '<p class="pill-badge pill-red" style="margin-top:8px">Score capped: critical safety defect reported</p>' : ''}
        </div>
      </div>
      ${sections
        .map(([key, label]) => {
          const s = bd[key] || { score: 0, max: 1, notes: [] };
          const pct = Math.round((s.score / s.max) * 100);
          return `<div class="breakdown-row">
            <div class="breakdown-head"><strong>${label}</strong><span>${s.score}/${s.max}</span></div>
            <div class="xp-progress-track"><div class="xp-progress-fill" style="width:${pct}%"></div></div>
            <ul class="breakdown-notes">${(s.notes || []).map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul>
          </div>`;
        })
        .join('')}
      <div class="callout callout-warn">${escapeHtml(bd.disclaimer || 'Unverified user submission.')}</div>
      ${
        bike.has_critical_safety_defect
          ? `<div class="callout callout-danger"><strong>Do not ride for stunts.</strong> ${escapeHtml(bike.safety_recommendation)}</div>`
          : ''
      }`,
      footer: '<button class="btn btn-secondary" data-modal-close="1">Close</button>',
      onMount(root) {
        root.querySelector('[data-modal-close]').addEventListener('click', closeModal);
      }
    });
  }

  /* -------------------- 13-question guided bicycle questionnaire ------------------- */
  function openBikeWizard(existing, onDone) {
    const draft = existing
      ? {
          name: existing.name,
          bike_type: existing.bike_type,
          frame_material: existing.frame_material,
          frame_brand: existing.frame_brand,
          frame_model: existing.frame_model,
          fork_spec: existing.fork_spec,
          tire_spec: existing.tire_spec,
          wheel_rim_spec: existing.wheel_rim_spec,
          handlebar_grip_spec: existing.handlebar_grip_spec,
          drivetrain_spec: existing.drivetrain_spec,
          brake_type: existing.brake_type,
          maintenance_condition: existing.maintenance_condition,
          safety_defects: existing.safety_defects || [],
          primary_use: existing.primary_use,
          photos: existing.photos || {},
          cosmetic_rating: existing.cosmetic_rating || null
        }
      : {
          name: '',
          bike_type: 'BMX',
          frame_material: "I don't know",
          frame_brand: "I don't know",
          frame_model: '',
          fork_spec: '',
          tire_spec: '',
          wheel_rim_spec: '',
          handlebar_grip_spec: '',
          drivetrain_spec: '',
          brake_type: 'Rear U-Brake',
          maintenance_condition: 'Good',
          safety_defects: [],
          primary_use: 'Skatepark',
          photos: {},
          cosmetic_rating: null
        };
    let step = 0;
    let preview = null;

    const steps = [
      {
        title: 'Bicycle identity',
        render: () => `
          <div class="form-group"><label class="form-label" for="bikeName">Profile name for this bicycle</label>
            <input class="form-input" id="bikeName" value="${escapeHtml(draft.name)}" placeholder="e.g. Southern Sunset 20.75in" required /></div>
          <div class="grid-2" style="gap:12px">
            <div class="form-group"><label class="form-label" for="bikeType">1. Bicycle type</label>
              <select class="form-select" id="bikeType">${BIKE_TYPES.map((t) => `<option ${draft.bike_type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
            <div class="form-group"><label class="form-label" for="primaryUse">2. Primary use</label>
              <select class="form-select" id="primaryUse">${USES.map((t) => `<option ${draft.primary_use === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
          </div>
          <div class="callout"><strong>Why we ask:</strong> discipline and terrain decide which components are appropriate. Brand prestige and price never make a bike safer.</div>`
      },
      {
        title: 'Frame & fork',
        render: () => `
          <div class="form-group"><label class="form-label" for="frameMaterial">3. Frame material</label>
            <select class="form-select" id="frameMaterial">${FRAME_MATERIALS.map((t) => `<option ${draft.frame_material === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
          <div class="grid-2" style="gap:12px">
            <div class="form-group"><label class="form-label" for="frameBrand">4. Frame brand</label>
              <input class="form-input" id="frameBrand" list="brandList" value="${escapeHtml(draft.frame_brand)}" placeholder="Search or type another brand…" />
              <datalist id="brandList">${FRAME_BRANDS.map((b) => `<option value="${b}"></option>`).join('')}</datalist></div>
            <div class="form-group"><label class="form-label" for="frameModel">5. Frame model</label>
              <input class="form-input" id="frameModel" value="${escapeHtml(draft.frame_model)}" placeholder="Model / size, or I don't know" /></div>
          </div>
          <div class="form-group"><label class="form-label" for="forkSpec">6. Fork material &amp; type</label>
            <input class="form-input" id="forkSpec" value="${escapeHtml(draft.fork_spec)}" placeholder="e.g. 4130 CrMo tapered fork 26mm offset" /></div>`
      },
      {
        title: 'Wheels, bars & drivetrain',
        render: () => `
          <div class="form-group"><label class="form-label" for="tireSpec">7. Brand, size &amp; type of tires</label>
            <input class="form-input" id="tireSpec" value="${escapeHtml(draft.tire_spec)}" placeholder="e.g. Odyssey Path Pro 20 x 2.40in" /></div>
          <div class="form-group"><label class="form-label" for="wheelSpec">8. Wheel &amp; rim specifications</label>
            <input class="form-input" id="wheelSpec" value="${escapeHtml(draft.wheel_rim_spec)}" placeholder="e.g. 20in double-wall 36H, sealed hubs" /></div>
          <div class="form-group"><label class="form-label" for="barSpec">9. Handlebars &amp; grips</label>
            <input class="form-input" id="barSpec" value="${escapeHtml(draft.handlebar_grip_spec)}" placeholder="e.g. 9.25in 2-piece CrMo bars, ODI grips, bar-end plugs" /></div>
          <div class="form-group"><label class="form-label" for="driveSpec">10. Crankset, pedals, chain &amp; drivetrain</label>
            <input class="form-input" id="driveSpec" value="${escapeHtml(draft.drivetrain_spec)}" placeholder="e.g. 170mm 3-piece CrMo, 25T-9T, half-link chain" /></div>
          <div class="callout"><strong>Bar-end plugs are mandatory.</strong> Missing plugs are a common cause of serious abdominal injuries in BMX falls.</div>`
      },
      {
        title: 'Brakes, condition & safety',
        render: () => `
          <div class="form-group"><label class="form-label" for="brakeType">11. Brake type fitted</label>
            <select class="form-select" id="brakeType">${BRAKES.map((t) => `<option ${draft.brake_type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
          <div class="form-group"><label class="form-label" for="condition">12. Maintenance &amp; condition rating</label>
            <select class="form-select" id="condition">${CONDITIONS.map((t) => `<option ${draft.maintenance_condition === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
          <div class="form-group"><label class="form-label">13. Known safety issues (select all that apply)</label>
            <div class="checklist">${DEFECTS.map(
              ([key, label]) => `<label class="check-row"><input type="checkbox" data-defect="${key}" ${
                draft.safety_defects.includes(key) ? 'checked' : ''
              } /><span>${escapeHtml(label)}</span></label>`
            ).join('')}
            <label class="check-row"><input type="checkbox" data-defect="none" ${
              !draft.safety_defects.length ? 'checked' : ''
            } /><span>No known safety issues</span></label></div>
          </div>
          <div class="form-group"><label class="form-label" for="cosmetic">Optional cosmetic rating (does not affect build score)</label>
            <select class="form-select" id="cosmetic">
              <option value="">Not rated</option>
              ${[5, 4, 3, 2, 1].map((n) => `<option value="${n}" ${draft.cosmetic_rating === n ? 'selected' : ''}>${n} / 5</option>`).join('')}
            </select></div>`
      },
      {
        title: 'Verification photographs',
        render: () => `
          <p class="muted" style="font-size:.84rem">Optional but improves score completeness. Images are validated (max 5 MB), and EXIF GPS data is removed before upload. Never include number plates, school uniforms or home addresses.</p>
          ${['frame', 'drivetrain', 'tires', 'brakes', 'complete']
            .map(
              (slot) => `<div class="photo-slot">
                <div><strong>${slot === 'complete' ? 'Complete bicycle' : slot.charAt(0).toUpperCase() + slot.slice(1)}</strong>
                  <div class="hint">${draft.photos[slot] ? 'Photo attached ✓' : 'No photo yet'}</div></div>
                <input type="file" accept="image/*" data-photo-slot="${slot}" class="form-input" style="max-width:220px" />
              </div>`
            )
            .join('')}
          <div class="callout callout-warn">A photograph never proves a bike is safe. Structural checks require an in-person inspection.</div>`
      },
      {
        title: 'Transparent score preview',
        render: () => `<div id="scorePreview">${skeletonList(1)}</div>`
      }
    ];

    modal({
      title: existing ? 'Edit bicycle profile' : 'Guided bicycle questionnaire',
      size: '780px',
      body: `<div class="wizard-steps compact">${steps
        .map((s, i) => `<div class="wizard-step" data-step-chip="${i}"><span>${i + 1}</span><em>${escapeHtml(s.title)}</em></div>`)
        .join('')}</div>
        <form id="bikeForm"><div id="bikeStepBody"></div></form>`,
      footer: `<button class="btn btn-secondary" id="bikePrev">Back</button>
               <button class="btn btn-primary" id="bikeNext">Continue</button>`,
      onMount(root) {
        const body = root.querySelector('#bikeStepBody');
        const nextBtn = root.querySelector('#bikeNext');

        const paint = () => {
          root.querySelectorAll('[data-step-chip]').forEach((chip) => {
            const i = Number(chip.dataset.stepChip);
            chip.classList.toggle('active', i === step);
            chip.classList.toggle('done', i < step);
          });
          body.innerHTML = steps[step].render();
          root.querySelector('#bikePrev').disabled = step === 0;
          nextBtn.textContent = step === steps.length - 1 ? (existing ? 'Save bicycle' : 'Save & rate my bike') : 'Continue';
          wireStep();
          if (step === steps.length - 1) refreshPreview();
        };

        const capture = () => {
          const g = (id) => {
            const el = root.querySelector(`#${id}`);
            return el ? el.value : undefined;
          };
          if (g('bikeName') !== undefined) draft.name = g('bikeName');
          if (g('bikeType') !== undefined) draft.bike_type = g('bikeType');
          if (g('primaryUse') !== undefined) draft.primary_use = g('primaryUse');
          if (g('frameMaterial') !== undefined) draft.frame_material = g('frameMaterial');
          if (g('frameBrand') !== undefined) draft.frame_brand = g('frameBrand');
          if (g('frameModel') !== undefined) draft.frame_model = g('frameModel');
          if (g('forkSpec') !== undefined) draft.fork_spec = g('forkSpec');
          if (g('tireSpec') !== undefined) draft.tire_spec = g('tireSpec');
          if (g('wheelSpec') !== undefined) draft.wheel_rim_spec = g('wheelSpec');
          if (g('barSpec') !== undefined) draft.handlebar_grip_spec = g('barSpec');
          if (g('driveSpec') !== undefined) draft.drivetrain_spec = g('driveSpec');
          if (g('brakeType') !== undefined) draft.brake_type = g('brakeType');
          if (g('condition') !== undefined) draft.maintenance_condition = g('condition');
          if (g('cosmetic') !== undefined) draft.cosmetic_rating = g('cosmetic') ? Number(g('cosmetic')) : null;
        };

        const wireStep = () => {
          root.querySelectorAll('[data-defect]').forEach((cb) =>
            cb.addEventListener('change', () => {
              const key = cb.dataset.defect;
              if (key === 'none') {
                draft.safety_defects = [];
                root.querySelectorAll('[data-defect]').forEach((o) => (o.checked = o.dataset.defect === 'none'));
              } else {
                const none = root.querySelector('[data-defect="none"]');
                if (none) none.checked = false;
                if (cb.checked) {
                  if (!draft.safety_defects.includes(key)) draft.safety_defects.push(key);
                } else {
                  draft.safety_defects = draft.safety_defects.filter((d) => d !== key);
                }
              }
            })
          );
          root.querySelectorAll('[data-photo-slot]').forEach((input) =>
            input.addEventListener('change', async () => {
              const file = input.files && input.files[0];
              if (!file) return;
              if (file.size > 5 * 1024 * 1024) {
                toast('Image exceeds 5 MB. Choose a smaller photo.', 'error');
                input.value = '';
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
                draft.photos[input.dataset.photoSlot] = uploaded.mediaUrl;
                toast('Photo validated and stored (GPS metadata stripped).', 'success', 2600);
                paint();
              } catch (err) {
                toast(err.message, 'error');
              }
            })
          );
        };

        const refreshPreview = async () => {
          const host = root.querySelector('#scorePreview');
          if (!host) return;
          try {
            preview = await api('/api/bicycles/preview-score', { method: 'POST', body: draft });
            host.innerHTML = `<div class="breakdown-total">${scoreRing(preview.build_score, preview.has_critical_safety_defect)}
                <div><p class="muted" style="font-size:.84rem">${escapeHtml(preview.breakdown.disclaimer)}</p>
                ${preview.has_critical_safety_defect ? '<p class="pill-badge pill-red" style="margin-top:8px">Score capped — inspect &amp; repair before riding</p>' : ''}</div></div>
              ${Object.entries(preview.breakdown)
                .filter(([k]) => !['safety_cap_applied', 'disclaimer'].includes(k))
                .map(([k, v]) => {
                  const pct = Math.round((v.score / v.max) * 100);
                  return `<div class="breakdown-row"><div class="breakdown-head"><strong>${escapeHtml(
                    k.replace(/_/g, ' ')
                  )}</strong><span>${v.score}/${v.max}</span></div>
                    <div class="xp-progress-track"><div class="xp-progress-fill" style="width:${pct}%"></div></div>
                    <ul class="breakdown-notes">${v.notes.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul></div>`;
                })
                .join('')}
              ${
                preview.has_critical_safety_defect
                  ? `<div class="callout callout-danger"><strong>Safety warning:</strong> ${escapeHtml(preview.safety_recommendation)}</div>`
                  : '<div class="callout callout-warn">Routine pre-ride inspection still required before every ride.</div>'
              }`;
          } catch (err) {
            host.innerHTML = `<p class="muted">${escapeHtml(err.message)}</p>`;
          }
        };

        root.querySelector('#bikePrev').addEventListener('click', () => {
          capture();
          if (step > 0) {
            step -= 1;
            paint();
          }
        });

        nextBtn.addEventListener('click', async () => {
          capture();
          if (step === 0 && !draft.name.trim()) {
            toast('Give this bicycle a profile name.', 'error');
            return;
          }
          if (step < steps.length - 1) {
            step += 1;
            paint();
            return;
          }
          nextBtn.disabled = true;
          nextBtn.textContent = 'Saving…';
          try {
            if (existing) {
              const res = await api(`/api/bicycles/${existing.id}`, { method: 'PUT', body: draft });
              toast(`Bicycle updated — new build rating ${res.rating.build_score}/100.`, 'success', 4500);
            } else {
              const res = await api('/api/bicycles', { method: 'POST', body: draft });
              toast(`Bicycle saved — build rating ${res.rating.build_score}/100 (+35 XP).`, 'success', 5000);
            }
            closeModal();
            await window.RR.refreshSession();
            if (onDone) onDone();
          } catch (err) {
            toast(err.message, 'error', 6000);
            nextBtn.disabled = false;
            nextBtn.textContent = existing ? 'Save bicycle' : 'Save & rate my bike';
          }
        });

        paint();
      }
    });
  }

  /* -------------------------------- Profile editing ------------------------------- */
  async function openEditProfile(profile, onDone) {
    let districts = ['Colombo', 'Gampala', 'Kalutara (incl. Bentota)', 'Kandy', 'Galle'];
    try {
      if (!state.config) state.config = await api('/api/config');
      districts = state.config.brand.sriLankaDistricts || districts;
    } catch (e) {
      /* default */
    }
    modal({
      title: 'Edit rider profile',
      size: '640px',
      body: `<div class="form-group"><label class="form-label" for="epDisplay">Display name</label>
          <input class="form-input" id="epDisplay" value="${escapeHtml(profile.display_name)}" maxlength="50" /></div>
        <div class="form-group"><label class="form-label" for="epUsername">Username</label>
          <input class="form-input" id="epUsername" value="${escapeHtml(profile.username)}" maxlength="24" />
          <div class="hint">Usernames are unique across RideRise LK.</div></div>
        <div class="form-group"><label class="form-label" for="epBio">Biography</label>
          <textarea class="form-textarea" id="epBio" rows="3" maxlength="300">${escapeHtml(profile.bio || '')}</textarea></div>
        <div class="grid-2" style="gap:12px">
          <div class="form-group"><label class="form-label" for="epDistrict">District</label>
            <select class="form-select" id="epDistrict">${districts
              .map((d) => `<option ${profile.district === d ? 'selected' : ''}>${escapeHtml(d)}</option>`)
              .join('')}</select></div>
          <div class="form-group"><label class="form-label" for="epArea">Preferred riding area</label>
            <input class="form-input" id="epArea" value="${escapeHtml(profile.preferred_riding_area || '')}" maxlength="120" /></div>
        </div>
        <div class="callout"><strong>Privacy:</strong> your email, date of birth and exact coordinates are never shown on your public profile and cannot be edited from here.</div>`,
      footer: `<button class="btn btn-secondary" data-modal-close="1">Cancel</button>
               <button class="btn btn-primary" id="saveProfileBtn">Save profile</button>`,
      onMount(root) {
        root.querySelector('[data-modal-close]').addEventListener('click', closeModal);
        root.querySelector('#saveProfileBtn').addEventListener('click', async () => {
          try {
            const res = await api('/api/profile', {
              method: 'PUT',
              body: {
                display_name: root.querySelector('#epDisplay').value.trim(),
                username: root.querySelector('#epUsername').value.trim().toLowerCase(),
                bio: root.querySelector('#epBio').value.trim(),
                district: root.querySelector('#epDistrict').value,
                preferred_riding_area: root.querySelector('#epArea').value.trim()
              }
            });
            state.profile = res.profile;
            closeModal();
            toast('Profile updated.', 'success');
            if (onDone) onDone();
          } catch (err) {
            toast(err.message, 'error', 5000);
          }
        });
      }
    });
  }

  function openAvatarEditor(profile, onDone) {
    modal({
      title: 'Profile picture',
      size: '560px',
      body: `<div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">
          <div id="avatarPreview">${avatar(profile.avatar_url, profile.display_name, 96)}</div>
          <div class="muted" style="font-size:.82rem;max-width:280px">Upload a square image (max 5 MB). Crop to fit with the zoom slider. Uploads are validated and EXIF metadata is stripped.</div>
        </div>
        <div class="form-group" style="margin-top:14px"><label class="form-label" for="avatarFile">Choose image</label>
          <input class="form-input" type="file" id="avatarFile" accept="image/*" /></div>
        <div id="cropTools" hidden>
          <label class="form-label" for="cropZoom">Zoom: <span id="zoomVal">100%</span></label>
          <input type="range" id="cropZoom" min="100" max="220" value="100" class="form-input" style="padding:4px" />
          <div class="crop-frame"><img id="cropImg" alt="Image to crop" /></div>
        </div>
        <div id="avatarProgress" class="upload-progress" hidden><div id="avatarProgressBar"></div></div>`,
      footer: `<button class="btn btn-danger" id="removeAvatar">Remove picture</button>
               <button class="btn btn-secondary" data-modal-close="1">Cancel</button>
               <button class="btn btn-primary" id="saveAvatar" disabled>Upload &amp; save</button>`,
      onMount(root) {
        let croppedDataUrl = null;
        root.querySelector('[data-modal-close]').addEventListener('click', closeModal);
        const fileInput = root.querySelector('#avatarFile');
        const saveBtn = root.querySelector('#saveAvatar');
        const cropImg = root.querySelector('#cropImg');
        let sourceImage = null;

        fileInput.addEventListener('change', () => {
          const file = fileInput.files[0];
          if (!file) return;
          if (file.size > 5 * 1024 * 1024) {
            toast('Image exceeds 5 MB. Choose a smaller file.', 'error');
            fileInput.value = '';
            return;
          }
          const reader = new FileReader();
          reader.onload = () => {
            sourceImage = new Image();
            sourceImage.onload = () => {
              root.querySelector('#cropTools').hidden = false;
              cropImg.src = reader.result;
              cropImg.style.transform = 'scale(1)';
              renderCrop();
              saveBtn.disabled = false;
            };
            sourceImage.src = reader.result;
          };
          reader.readAsDataURL(file);
        });

        const renderCrop = () => {
          if (!sourceImage) return;
          const zoom = Number(root.querySelector('#cropZoom').value) / 100;
          root.querySelector('#zoomVal').textContent = `${Math.round(zoom * 100)}%`;
          const size = Math.min(sourceImage.width, sourceImage.height);
          const canvas = document.createElement('canvas');
          canvas.width = 400;
          canvas.height = 400;
          const ctx = canvas.getContext('2d');
          const cropSize = size / zoom;
          const sx = (sourceImage.width - cropSize) / 2;
          const sy = (sourceImage.height - cropSize) / 2;
          ctx.drawImage(sourceImage, sx, sy, cropSize, cropSize, 0, 0, 400, 400);
          croppedDataUrl = canvas.toDataURL('image/jpeg', 0.86);
          cropImg.style.transform = `scale(${Math.min(1, 1)})`;
        };
        root.querySelector('#cropZoom').addEventListener('input', renderCrop);

        saveBtn.addEventListener('click', async () => {
          if (!croppedDataUrl) return;
          const progress = root.querySelector('#avatarProgress');
          const bar = root.querySelector('#avatarProgressBar');
          progress.hidden = false;
          bar.style.width = '40%';
          try {
            const uploaded = await api('/api/upload/media', { method: 'POST', body: { dataUrl: croppedDataUrl } });
            bar.style.width = '85%';
            const res = await api('/api/profile', { method: 'PUT', body: { avatar_url: uploaded.mediaUrl } });
            bar.style.width = '100%';
            state.profile = res.profile;
            closeModal();
            toast('Profile picture updated.', 'success');
            if (onDone) onDone();
          } catch (err) {
            progress.hidden = true;
            toast(err.message, 'error');
          }
        });

        root.querySelector('#removeAvatar').addEventListener('click', async () => {
          try {
            const res = await api('/api/profile', { method: 'PUT', body: { avatar_url: '' } });
            state.profile = res.profile;
            closeModal();
            toast('Profile picture removed — default avatar restored.', 'success');
            if (onDone) onDone();
          } catch (err) {
            toast(err.message, 'error');
          }
        });
      }
    });
  }

  async function sendFriendRequest(targetUserId) {
    try {
      const res = await api('/api/friends/request', { method: 'POST', body: { targetUserId } });
      toast(res.message, 'success', 4000);
    } catch (err) {
      toast(err.message, 'error', 5000);
    }
  }

  async function blockUser(userId, username, onDone) {
    if (!confirm(`Block @${username}? They will no longer be able to view your profile, message you or send friend requests.`)) return;
    try {
      const res = await api('/api/blocks', { method: 'POST', body: { blockedUserId: userId } });
      toast(res.message, 'success', 4500);
      if (onDone) onDone();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  /* ---------------------------------- Settings ---------------------------------- */
  async function renderSettings(viewport) {
    if (!state.token) {
      location.hash = '#/welcome';
      return;
    }
    viewport.innerHTML = skeletonList(2);
    try {
      const [friends, configData] = await Promise.all([api('/api/friends'), api('/api/config')]);
      state.config = configData;
      const acc = state.account || {};
      const profile = state.profile || {};
      const districts = configData.brand.sriLankaDistricts;

      viewport.innerHTML = `
        <div class="section-head">
          <div><h2>Settings &amp; privacy</h2><p class="muted">Private account data, safety controls and accessibility preferences.</p></div>
          <button class="btn btn-secondary btn-sm" onclick="location.hash='#/profile'">← Profile</button>
        </div>

        <section class="card">
          <h3>Privacy</h3>
          <div class="form-group"><label class="form-label" for="setVisibility">Profile visibility</label>
            <select class="form-select" id="setVisibility">
              ${['public', 'friends', 'private']
                .map((v) => `<option value="${v}" ${profile.profile_visibility === v ? 'selected' : ''}>${
                  v === 'public' ? 'Public — discoverable' : v === 'friends' ? 'Friends only' : 'Private — minimal card'
                }</option>`)
                .join('')}
            </select></div>
          <label class="check-row"><input type="checkbox" id="setHideLeaderboard" ${profile.hide_from_leaderboards ? 'checked' : ''} />
            <span>Hide me from public leaderboards</span></label>
          <label class="check-row"><input type="checkbox" id="setAllowFriends" ${profile.allow_friend_requests ? 'checked' : ''} />
            <span>Allow friend requests</span></label>
          <div class="form-group" style="margin-top:12px"><label class="form-label" for="setAllowMessages">Who can start private messages</label>
            <select class="form-select" id="setAllowMessages">
              <option value="friends_only" ${profile.allow_messages_from !== 'nobody' ? 'selected' : ''}>Accepted friends only (recommended)</option>
              <option value="nobody" ${profile.allow_messages_from === 'nobody' ? 'selected' : ''}>Nobody</option>
            </select>
            <div class="hint">Non-friends can never send unsolicited messages, links or attachments.</div></div>
          <button class="btn btn-primary btn-sm" id="savePrivacy">Save privacy settings</button>
        </section>

        <section class="card">
          <h3>Account (private — never shown publicly)</h3>
          <dl class="account-grid">
            <div><dt>Email</dt><dd>${escapeHtml(acc.email || '—')}</dd></div>
            <div><dt>Role</dt><dd>${escapeHtml(acc.role || 'rider')}</dd></div>
            <div><dt>Youth safeguards</dt><dd>${acc.is_minor ? 'Active (16–17 defaults)' : 'Standard adult account'}</dd></div>
            <div><dt>Date of birth</dt><dd>${acc.is_minor ? 'Stored privately for safeguards' : 'Private / not displayed'}</dd></div>
            <div><dt>Accepted terms</dt><dd>v${escapeHtml(acc.terms_accepted_version || '—')}</dd></div>
          </dl>
          <p class="hint">Your email and date of birth are stored separately from your public profile and are never exposed by the API to other riders.</p>
        </section>

        <section class="card">
          <h3>Notifications &amp; accessibility</h3>
          <label class="check-row"><input type="checkbox" id="setNotifications" ${acc.notifications_enabled ? 'checked' : ''} />
            <span>In-app notifications (friend requests, moderation updates, event reminders)</span></label>
          <label class="check-row"><input type="checkbox" id="setMotion" ${state.reducedMotion ? 'checked' : ''} />
            <span>Reduce motion (respects system accessibility setting)</span></label>
          <label class="check-row"><input type="checkbox" id="setContrast" ${state.highContrast ? 'checked' : ''} />
            <span>High-contrast mode</span></label>
          <div class="form-group" style="margin-top:10px"><label class="form-label" for="setLocale">Language</label>
            <select class="form-select" id="setLocale">
              <option value="en" ${state.locale === 'en' ? 'selected' : ''}>English</option>
              <option value="si" ${state.locale === 'si' ? 'selected' : ''}>සිංහල (Sinhala)</option>
              <option value="ta" ${state.locale === 'ta' ? 'selected' : ''}>தமிழ் (Tamil)</option>
            </select></div>
          ${window.RR.isAndroidShell() ? `<button class="btn btn-secondary btn-sm" id="enablePushBtn">Enable Android notifications</button>` : ''}
        </section>

        <section class="card">
          <h3>Blocked riders (${friends.blocked.length})</h3>
          ${
            friends.blocked.length
              ? `<ul class="member-list">${friends.blocked
                  .map(
                    (b) => `<li><div class="member-text"><strong>${escapeHtml(b.display_name)}</strong><small>@${escapeHtml(
                      b.username
                    )}</small></div><button class="btn btn-secondary btn-sm" data-unblock="${escapeHtml(b.user_id)}">Unblock</button></li>`
                  )
                  .join('')}</ul>`
              : '<p class="muted" style="font-size:.84rem">You have not blocked anyone.</p>'
          }
        </section>

        <section class="card">
          <h3>Legal &amp; safety documents</h3>
          <div class="quick-links-grid">
            <button class="btn btn-secondary" data-legal="terms_of_service">Terms of Service</button>
            <button class="btn btn-secondary" data-legal="privacy_policy">Privacy Policy</button>
            <button class="btn btn-secondary" data-legal="community_guidelines">Community Guidelines</button>
            <button class="btn btn-safety" data-legal="safety_notice">Safety Notice</button>
          </div>
        </section>

        ${
          window.RR.isAndroidShell()
            ? `<section class="card">
                <h3>Server connection</h3>
                <p class="muted" style="font-size:.84rem">This Android build talks to the RideRise LK backend API. Enter your deployed API URL (for example <code>https://riderise-api.yourdomain.lk</code>).</p>
                <div class="form-group"><label class="form-label" for="apiBaseInput">API base URL</label>
                  <input class="form-input" id="apiBaseInput" value="${escapeHtml(state.apiBase || '')}" placeholder="https://your-riderise-api.example" /></div>
                <button class="btn btn-primary btn-sm" id="saveApiBase">Save &amp; test connection</button>
                <div id="apiTestResult" class="hint"></div>
              </section>`
            : ''
        }

        <section class="card card-danger">
          <h3>Account deletion</h3>
          <p class="muted" style="font-size:.86rem">Deleting your account permanently removes your profile, bicycles, posts, comments, friendships, guild memberships and private messages. Resolved safety-report audit records are retained for up to 90 days for abuse prevention. This cannot be undone.</p>
          <p class="hint">Account recovery: RideRise LK cannot restore a deleted account. If you can no longer access your Google account, sign-in recovery is handled by Google at <code>accounts.google.com</code>.</p>
          <button class="btn btn-danger" id="deleteAccountBtn">Delete my account permanently</button>
        </section>

        <section class="card">
          <h3>Session</h3>
          <button class="btn btn-secondary" id="signOutBtn">Sign out of RideRise LK</button>
        </section>`;

      viewport.querySelectorAll('[data-legal]').forEach((b) =>
        b.addEventListener('click', () => window.RRAuth.openLegalDocument(b.dataset.legal))
      );

      viewport.querySelector('#savePrivacy').addEventListener('click', async () => {
        try {
          const res = await api('/api/profile', {
            method: 'PUT',
            body: {
              profile_visibility: viewport.querySelector('#setVisibility').value,
              hide_from_leaderboards: viewport.querySelector('#setHideLeaderboard').checked,
              allow_friend_requests: viewport.querySelector('#setAllowFriends').checked,
              allow_messages_from: viewport.querySelector('#setAllowMessages').value
            }
          });
          state.profile = res.profile;
          toast('Privacy settings saved.', 'success');
        } catch (err) {
          toast(err.message, 'error');
        }
      });

      const persistPrefs = async () => {
        try {
          const res = await api('/api/profile', {
            method: 'PUT',
            body: {
              notifications_enabled: viewport.querySelector('#setNotifications').checked,
              reduced_motion: viewport.querySelector('#setMotion').checked,
              locale: viewport.querySelector('#setLocale').value
            }
          });
          state.profile = res.profile;
          window.RR.setReducedMotion(viewport.querySelector('#setMotion').checked);
          window.RR.setHighContrast(viewport.querySelector('#setContrast').checked);
          window.RR.setLocale(viewport.querySelector('#setLocale').value);
          toast('Preferences saved.', 'success', 2400);
          if (window.RRApp) window.RRApp.paintChrome();
        } catch (err) {
          toast(err.message, 'error');
        }
      };
      ['#setNotifications', '#setMotion', '#setLocale', '#setContrast'].forEach((sel) => {
        viewport.querySelector(sel).addEventListener('change', () => {
          if (sel === '#setContrast') {
            window.RR.setHighContrast(viewport.querySelector('#setContrast').checked);
            return;
          }
          persistPrefs();
        });
      });

      viewport.querySelectorAll('[data-unblock]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          try {
            const res = await api(`/api/blocks/${encodeURIComponent(btn.dataset.unblock)}`, { method: 'DELETE' });
            toast(res.message, 'success');
            renderSettings(viewport);
          } catch (err) {
            toast(err.message, 'error');
          }
        })
      );

      const pushBtn = viewport.querySelector('#enablePushBtn');
      if (pushBtn)
        pushBtn.addEventListener('click', () => {
          try {
            const granted = window.RRAndroid.requestNotificationPermission();
            toast(
              granted
                ? 'Notification permission granted. Register your FCM token with the backend to receive pushes.'
                : 'Notification permission declined — you can enable it later in Android settings.',
              granted ? 'success' : 'info',
              6000
            );
          } catch (e) {
            toast('Notification bridge unavailable in this build.', 'error');
          }
        });

      const apiSave = viewport.querySelector('#saveApiBase');
      if (apiSave)
        apiSave.addEventListener('click', async () => {
          const url = viewport.querySelector('#apiBaseInput').value.trim().replace(/\/$/, '');
          const resultEl = viewport.querySelector('#apiTestResult');
          resultEl.textContent = 'Testing…';
          try {
            const res = await fetch(`${url}/api/health`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const health = await res.json();
            if (window.RRAndroid && window.RRAndroid.setApiBase) window.RRAndroid.setApiBase(url);
            localStorage.setItem(window.RR.STORAGE_API_BASE, url);
            state.apiBase = url;
            resultEl.textContent = `Connected to ${health.app} (Phase ${health.phase}) ✓ Host saved.`;
            resultEl.style.color = 'var(--success-green)';
          } catch (err) {
            resultEl.textContent = `Connection failed: ${err.message}. Check the URL, TLS certificate and network.`;
            resultEl.style.color = 'var(--danger-red)';
          }
        });

      viewport.querySelector('#deleteAccountBtn').addEventListener('click', () => {
        modal({
          title: 'Delete account permanently?',
          size: '520px',
          body: `<p class="muted">This erases your profile, bicycles, posts, comments, guild memberships, friendships and messages. Type <strong>DELETE</strong> to confirm.</p>
            <input class="form-input" id="deleteConfirm" placeholder="DELETE" style="margin-top:10px" />`,
          footer: `<button class="btn btn-secondary" data-modal-close="1">Cancel</button>
                   <button class="btn btn-danger" id="confirmDelete">Permanently delete</button>`,
          onMount(root) {
            root.querySelector('[data-modal-close]').addEventListener('click', closeModal);
            root.querySelector('#confirmDelete').addEventListener('click', async () => {
              if (root.querySelector('#deleteConfirm').value.trim() !== 'DELETE') {
                toast('Type DELETE exactly to confirm.', 'error');
                return;
              }
              try {
                const res = await api('/api/account', { method: 'DELETE' });
                window.RR.setToken('');
                state.account = null;
                state.profile = null;
                closeModal();
                toast(res.message, 'success', 6000);
                location.hash = '#/welcome';
              } catch (err) {
                toast(err.message, 'error');
              }
            });
          }
        });
      });

      viewport.querySelector('#signOutBtn').addEventListener('click', () => {
        window.RR.setToken('');
        state.account = null;
        state.profile = null;
        toast('Signed out. Your session token was cleared from this device.', 'success');
        location.hash = '#/welcome';
      });
    } catch (err) {
      viewport.innerHTML = errorState(err);
      const retry = viewport.querySelector('[data-retry]');
      if (retry) retry.addEventListener('click', () => renderSettings(viewport));
    }
  }

  window.RRProfile = { renderProfile, renderSettings, openBikeWizard };
})();
