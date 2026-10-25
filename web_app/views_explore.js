/* RideRise LK — Explore hub, leaderboards, Sri Lankan parts catalog, official events, safety centre & notifications */
(function () {
  'use strict';
  const { api, state, escapeHtml, toast, modal, closeModal, avatar, timeAgo, dateLabel, money, skeletonList, emptyState, errorState } = window.RR;

  const PART_CATEGORIES = [
    ['', 'All categories'],
    ['frames_forks', 'Frames & forks'],
    ['handlebars_stems_grips', 'Handlebars, stems & grips'],
    ['tires_wheels_hubs', 'Tires, wheels & hubs'],
    ['drivetrain_cranks_pedals', 'Drivetrain, cranks & pedals'],
    ['brakes_cables_levers', 'Brakes, cables & levers'],
    ['headsets_seats', 'Headsets, seats & posts'],
    ['pegs_accessories', 'BMX pegs & accessories'],
    ['protective_gear', 'Protective equipment'],
    ['tools_maintenance', 'Pumps, tools & maintenance']
  ];

  async function renderExplore(viewport) {
    viewport.innerHTML = `
      <div class="section-head">
        <div><h2>Explore</h2><p class="muted">Leaderboards, rider search, the Sri Lankan parts catalog and official studio events.</p></div>
      </div>
      <div class="explore-grid">
        <button class="explore-tile" onclick="location.hash='#/parts'">
          <span class="explore-icon">🛒</span><strong>Parts catalog</strong><small>Verified LKR prices &amp; compatibility notes</small>
        </button>
        <button class="explore-tile" onclick="location.hash='#/events'">
          <span class="explore-icon">📅</span><strong>Studio events</strong><small>Official clinics, jams &amp; registrations</small>
        </button>
        <button class="explore-tile" onclick="location.hash='#/friends'">
          <span class="explore-icon">👥</span><strong>Friends &amp; messages</strong><small>Friend-only private messaging</small>
        </button>
        <button class="explore-tile" onclick="location.hash='#/safety'">
          <span class="explore-icon">🛡️</span><strong>Safety Centre</strong><small>Inspection, stop conditions &amp; reporting</small>
        </button>
        <button class="explore-tile" onclick="location.hash='#/notifications'">
          <span class="explore-icon">🔔</span><strong>Notifications</strong><small>Requests, moderation &amp; reminders</small>
        </button>
        <button class="explore-tile" onclick="location.hash='#/admin'">
          <span class="explore-icon">🛠️</span><strong>Studio admin</strong><small>Moderation, ranks, parts &amp; events</small>
        </button>
      </div>

      <section class="card">
        <div class="section-head" style="margin-bottom:10px">
          <h3>Leaderboards</h3>
          <div class="chip-bar" style="margin:0" id="leaderScopeChips">
            <button class="chip active" data-scope="overall">Overall</button>
            <button class="chip" data-scope="district">My district</button>
            <button class="chip" data-scope="guild" id="guildScopeChip" hidden>My guild</button>
          </div>
        </div>
        <div id="leaderboardBody">${skeletonList(2)}</div>
      </section>

      <section class="card">
        <h3>Find riders</h3>
        <div class="feed-toolbar" style="margin-top:8px">
          <input class="form-input" id="riderSearch" type="search" placeholder="Search by username or display name…" aria-label="Search riders" />
        </div>
        <div id="riderSearchResults"></div>
      </section>`;

    let timer = null;
    viewport.querySelector('#riderSearch').addEventListener('input', (e) => {
      clearTimeout(timer);
      const q = e.target.value.trim();
      timer = setTimeout(() => searchRiders(q), 350);
    });
    // Enable the guild leaderboard only when the rider belongs to an active guild
    try {
      const guildData = await api('/api/guilds');
      const myGuild = (guildData.guilds || []).find((g) => g.my_status === 'active');
      if (myGuild) {
        const chip = viewport.querySelector('#guildScopeChip');
        chip.hidden = false;
        chip.dataset.guildId = myGuild.id;
        chip.textContent = `My guild · ${myGuild.name.split(' ')[0]}`;
        chip.addEventListener('click', () => {
          viewport.querySelectorAll('[data-scope]').forEach((c) => c.classList.toggle('active', c === chip));
          loadLeaderboard('guild', myGuild.id);
        });
        viewport.querySelectorAll('[data-scope]').forEach((c) => {
          if (c !== chip) c.addEventListener('click', () => {
            viewport.querySelectorAll('[data-scope]').forEach((x) => x.classList.toggle('active', x === c));
            loadLeaderboard(c.dataset.scope);
          });
        });
      }
    } catch (e) {
      /* leaderboard guild scope is optional */
    }
    await loadLeaderboard('overall');
  }

  async function loadLeaderboard(scope, guildId) {
    const host = document.getElementById('leaderboardBody');
    if (!host) return;
    host.innerHTML = skeletonList(2);
    try {
      const params = new URLSearchParams({ scope });
      if (scope === 'district' && state.profile) params.set('district', state.profile.district);
      if (scope === 'guild' && guildId) params.set('guildId', guildId);
      const data = await api(`/api/leaderboards?${params.toString()}`);
      if (!data.leaders.length) {
        host.innerHTML = '<p class="muted">No leaderboard entries yet for this filter.</p>';
        return;
      }
      host.innerHTML = `<ol class="leaderboard">
        ${data.leaders
          .map(
            (l, i) => `<li class="leaderboard-row">
              <span class="leaderboard-rank ${i < 3 ? 'top' : ''}">${i + 1}</span>
              ${avatar(l.avatar_url, l.display_name, 36)}
              <div class="leaderboard-text">
                <strong>${escapeHtml(l.display_name)}</strong>
                <small>@${escapeHtml(l.username)} · ${escapeHtml(l.district)} · ${escapeHtml(l.rank_name)}</small>
              </div>
              <div class="leaderboard-score">
                <strong>${l.xp} XP</strong>
                <small>${l.modules_completed} modules</small>
              </div>
            </li>`
          )
          .join('')}
      </ol>
      <p class="hint" style="margin-top:10px">${escapeHtml(data.note)}</p>`;
      host.querySelectorAll('.leaderboard-row').forEach((row, i) => {
        row.addEventListener('click', () => (location.hash = `#/user/${data.leaders[i].user_id}`));
      });
    } catch (err) {
      host.innerHTML = errorState(err);
      const retry = host.querySelector('[data-retry]');
      if (retry) retry.addEventListener('click', () => loadLeaderboard(scope));
    }
  }

  async function searchRiders(q) {
    const host = document.getElementById('riderSearchResults');
    if (!host) return;
    if (!q) {
      host.innerHTML = '';
      return;
    }
    host.innerHTML = '<div class="skeleton" style="height:56px"></div>';
    try {
      const data = await api(`/api/users/search?q=${encodeURIComponent(q)}`);
      if (!data.users.length) {
        host.innerHTML = '<p class="muted" style="font-size:.84rem">No riders matched that search.</p>';
        return;
      }
      host.innerHTML = `<ul class="member-list">${data.users
        .map(
          (u) => `<li>${avatar(u.avatar_url, u.display_name, 34)}
            <div class="member-text"><strong>${escapeHtml(u.display_name)}</strong><small>@${escapeHtml(u.username)} · ${escapeHtml(u.district)}</small></div>
            <button class="btn btn-secondary btn-sm" data-view-user="${escapeHtml(u.user_id)}">View</button>
            <button class="btn btn-primary btn-sm" data-add-friend="${escapeHtml(u.user_id)}">Add friend</button>
          </li>`
        )
        .join('')}</ul>`;
      host.querySelectorAll('[data-view-user]').forEach((b) =>
        b.addEventListener('click', () => (location.hash = `#/user/${b.dataset.viewUser}`))
      );
      host.querySelectorAll('[data-add-friend]').forEach((b) =>
        b.addEventListener('click', async () => {
          try {
            const res = await api('/api/friends/request', { method: 'POST', body: { targetUserId: b.dataset.addFriend } });
            toast(res.message, 'success');
          } catch (err) {
            toast(err.message, 'error', 5000);
          }
        })
      );
    } catch (err) {
      host.innerHTML = `<p class="muted">${escapeHtml(err.message)}</p>`;
    }
  }

  /* ------------------------------- Parts catalog -------------------------------- */
  const partsState = { category: '', search: '', verifiedOnly: false, maxPrice: '', compare: [] };

  async function renderParts(viewport) {
    viewport.innerHTML = `
      <div class="section-head">
        <div><h2>Sri Lankan parts catalog</h2><p class="muted">Information &amp; discovery directory. Unverified prices are labelled honestly.</p></div>
        <button class="btn btn-secondary btn-sm" onclick="location.hash='#/explore'">← Explore</button>
      </div>
      <div class="callout callout-warn">
        <strong>No payment, no delivery promise.</strong> Phase 1 does not process payments or guarantee stock. Prices marked <em>“Price not verified”</em> are unconfirmed by Shaun David Studios. Always verify compatibility and safety with a qualified bicycle mechanic.
      </div>
      <div class="card">
        <div class="feed-toolbar">
          <input class="form-input" id="partsSearch" type="search" placeholder="Search brand, part or description…" aria-label="Search parts" />
          <select class="form-select" id="partsCategory" style="max-width:280px">
            ${PART_CATEGORIES.map(([v, l]) => `<option value="${v}">${escapeHtml(l)}</option>`).join('')}
          </select>
        </div>
        <div class="feed-toolbar" style="margin-top:10px">
          <label class="check-row" style="margin:0"><input type="checkbox" id="partsVerified" /><span>Verified price only</span></label>
          <input class="form-input" id="partsMaxPrice" type="number" min="0" step="500" placeholder="Max price (LKR)" style="max-width:180px" />
          <button class="btn btn-secondary btn-sm" id="partsFavoritesBtn">⭐ Favorites only</button>
          <button class="btn btn-primary btn-sm" id="partsCompareBtn">⇄ Compare selected (0)</button>
        </div>
      </div>
      <div id="partsList">${skeletonList(3)}</div>`;
    viewport.querySelector('#partsSearch').addEventListener('input', (e) => {
      partsState.search = e.target.value;
      clearTimeout(partsState.timer);
      partsState.timer = setTimeout(loadParts, 320);
    });
    viewport.querySelector('#partsCategory').addEventListener('change', (e) => {
      partsState.category = e.target.value;
      loadParts();
    });
    viewport.querySelector('#partsVerified').addEventListener('change', (e) => {
      partsState.verifiedOnly = e.target.checked;
      loadParts();
    });
    viewport.querySelector('#partsMaxPrice').addEventListener('change', (e) => {
      partsState.maxPrice = e.target.value;
      loadParts();
    });
    viewport.querySelector('#partsFavoritesBtn').addEventListener('click', () => loadParts(true));
    viewport.querySelector('#partsCompareBtn').addEventListener('click', openCompare);
    await loadParts();
  }

  async function loadParts(favoritesOnly = false) {
    const host = document.getElementById('partsList');
    if (!host) return;
    host.innerHTML = skeletonList(3);
    try {
      const params = new URLSearchParams();
      if (partsState.category) params.set('category', partsState.category);
      if (partsState.search) params.set('search', partsState.search);
      if (partsState.verifiedOnly) params.set('verifiedOnly', '1');
      if (partsState.maxPrice) params.set('maxPrice', partsState.maxPrice);
      if (favoritesOnly) params.set('favoritesOnly', '1');
      const data = await api(`/api/parts?${params.toString()}`);
      if (!data.parts.length) {
        host.innerHTML = emptyState({
          icon: '🔩',
          title: 'No matching parts',
          body: 'Try a different category, clear the price filter, or search another brand.'
        });
        return;
      }
      host.innerHTML = `<div class="parts-disclaimer">${escapeHtml(data.catalogDisclaimer)}</div>
        <div class="grid-2">${data.parts
          .map(
            (p) => `<article class="card part-card">
              <div class="part-head">
                <div>
                  <span class="pill-badge pill-cyan">${escapeHtml(categoryLabel(p.category))}</span>
                  <h4>${escapeHtml(p.name)}</h4>
                  <p class="muted" style="font-size:.78rem">${escapeHtml(p.brand)} · ${escapeHtml(p.compatible_bike_types)}</p>
                </div>
                <span class="part-price ${p.price_verified ? 'verified' : 'unverified'}">${escapeHtml(p.price_display)}</span>
              </div>
              <p class="part-desc">${escapeHtml(p.description)}</p>
              <dl class="part-meta">
                <div><dt>Seller</dt><dd>${escapeHtml(p.retailer_name)}</dd></div>
                <div><dt>Availability</dt><dd>${escapeHtml(p.availability)}</dd></div>
                <div><dt>Last verified</dt><dd>${escapeHtml(dateLabel(p.last_verified_date))}</dd></div>
              </dl>
              <div class="callout callout-warn" style="font-size:.78rem">⚠ ${escapeHtml(p.compatibility_warning)}</div>
              <div class="bike-actions">
                <button class="btn btn-secondary btn-sm" data-fav="${escapeHtml(p.id)}">${p.favorited_by_me ? '⭐ Saved' : '☆ Save'}</button>
                <button class="btn btn-secondary btn-sm" data-compare-part="${escapeHtml(p.id)}">⇄ Compare</button>
                <button class="btn btn-secondary btn-sm" data-part-contact="${escapeHtml(p.id)}">Contact / source</button>
              </div>
            </article>`
          )
          .join('')}</div>`;

      const partsById = new Map(data.parts.map((p) => [p.id, p]));
      host.querySelectorAll('[data-fav]').forEach((b) =>
        b.addEventListener('click', async () => {
          try {
            const res = await api(`/api/parts/${b.dataset.fav}/favorite`, { method: 'POST' });
            b.textContent = res.favorited ? '⭐ Saved' : '☆ Save';
            toast(res.favorited ? 'Added to favorites.' : 'Removed from favorites.', 'success', 2000);
          } catch (err) {
            toast(err.message, 'error');
          }
        })
      );
      host.querySelectorAll('[data-compare-part]').forEach((b) =>
        b.addEventListener('click', () => {
          const id = b.dataset.comparePart;
          if (partsState.compare.includes(id)) {
            partsState.compare = partsState.compare.filter((x) => x !== id);
            toast('Removed from comparison.', 'info', 1800);
          } else {
            if (partsState.compare.length >= 3) {
              toast('You can compare up to 3 parts at a time.', 'error');
              return;
            }
            partsState.compare.push(id);
            toast('Added to comparison.', 'success', 1800);
          }
          const btn = document.getElementById('partsCompareBtn');
          if (btn) btn.textContent = `⇄ Compare selected (${partsState.compare.length})`;
          partsState.partsById = partsById;
        })
      );
      host.querySelectorAll('[data-part-contact]').forEach((b) =>
        b.addEventListener('click', () => {
          const p = partsById.get(b.dataset.partContact);
          if (!p) return;
          modal({
            title: 'Source & contact',
            size: '520px',
            body: `<dl class="part-meta">
                <div><dt>Retailer / seller</dt><dd>${escapeHtml(p.retailer_name)}</dd></div>
                <div><dt>Source / contact</dt><dd>${escapeHtml(p.source_contact)}</dd></div>
                <div><dt>Availability</dt><dd>${escapeHtml(p.availability)}</dd></div>
                <div><dt>Price</dt><dd>${escapeHtml(p.price_display)}</dd></div>
                <div><dt>Last verified</dt><dd>${escapeHtml(dateLabel(p.last_verified_date))}</dd></div>
              </dl>
              <div class="callout">RideRise LK does not sell parts and earns no commission. Listings are curated by studio administrators; always verify the part physically before paying.</div>`,
            footer: '<button class="btn btn-secondary" data-modal-close="1">Close</button>',
            onMount(root) {
              root.querySelector('[data-modal-close]').addEventListener('click', closeModal);
            }
          });
        })
      );
      partsState.partsById = partsById;
    } catch (err) {
      host.innerHTML = errorState(err);
      const retry = host.querySelector('[data-retry]');
      if (retry) retry.addEventListener('click', () => loadParts());
    }
  }

  function categoryLabel(cat) {
    const found = PART_CATEGORIES.find(([v]) => v === cat);
    return found ? found[1] : cat;
  }

  function openCompare() {
    const selected = partsState.compare.map((id) => partsState.partsById && partsState.partsById.get(id)).filter(Boolean);
    if (selected.length < 2) {
      toast('Select at least two parts using “Compare”.', 'error');
      return;
    }
    const rows = [
      ['Brand', (p) => p.brand],
      ['Category', (p) => categoryLabel(p.category)],
      ['Compatible bikes', (p) => p.compatible_bike_types],
      ['Price', (p) => p.price_display],
      ['Seller', (p) => p.retailer_name],
      ['Availability', (p) => p.availability],
      ['Last verified', (p) => dateLabel(p.last_verified_date)]
    ];
    modal({
      title: 'Compare parts',
      size: '820px',
      body: `<div class="table-wrap"><table class="compare-table">
        <thead><tr><th>Attribute</th>${selected.map((p) => `<th>${escapeHtml(p.name)}</th>`).join('')}</tr></thead>
        <tbody>${rows
          .map(([label, fn]) => `<tr><th scope="row">${escapeHtml(label)}</th>${selected.map((p) => `<td>${escapeHtml(fn(p))}</td>`).join('')}</tr>`)
          .join('')}</tbody></table></div>
        ${selected
          .map((p) => `<div class="callout callout-warn" style="margin-top:10px"><strong>${escapeHtml(p.name)}:</strong> ${escapeHtml(p.compatibility_warning)}</div>`)
          .join('')}`,
      footer: '<button class="btn btn-secondary" data-modal-close="1">Close</button>',
      onMount(root) {
        root.querySelector('[data-modal-close]').addEventListener('click', closeModal);
      }
    });
  }

  /* ---------------------------------- Events ----------------------------------- */
  let eventFilter = 'upcoming';

  async function renderEvents(viewport) {
    if (!state.token) {
      location.hash = '#/welcome';
      return;
    }
    viewport.innerHTML = `
      <div class="section-head">
        <div><h2>Shaun David Studios events</h2><p class="muted">Official studio clinics and jams, clearly separated from community meetups.</p></div>
        <button class="btn btn-secondary btn-sm" onclick="location.hash='#/explore'">← Explore</button>
      </div>
      <div class="chip-bar" role="tablist" aria-label="Event filters">
        ${[
          ['upcoming', 'Upcoming'],
          ['featured', 'Featured'],
          ['past', 'Past & recaps'],
          ['mine', 'My registrations']
        ]
          .map(([v, l]) => `<button class="chip ${eventFilter === v ? 'active' : ''}" data-event-filter="${v}">${l}</button>`)
          .join('')}
      </div>
      <div id="eventsList">${skeletonList(3)}</div>`;
    viewport.querySelectorAll('[data-event-filter]').forEach((chip) =>
      chip.addEventListener('click', () => {
        eventFilter = chip.dataset.eventFilter;
        viewport.querySelectorAll('[data-event-filter]').forEach((c) => c.classList.toggle('active', c === chip));
        loadEvents();
      })
    );
    await loadEvents();
  }

  async function loadEvents() {
    const host = document.getElementById('eventsList');
    if (!host) return;
    try {
      const data = await api('/api/events');
      let events = data.events || [];
      if (eventFilter === 'upcoming') events = events.filter((e) => ['upcoming', 'featured'].includes(e.status));
      if (eventFilter === 'featured') events = events.filter((e) => e.status === 'featured');
      if (eventFilter === 'past') events = events.filter((e) => e.status === 'past');
      if (eventFilter === 'mine') events = events.filter((e) => e.registered_by_me);
      if (!events.length) {
        host.innerHTML = emptyState({
          icon: '📅',
          title: 'No events in this view',
          body: 'Official Shaun David Studios clinics are published here by studio administrators. Community meetups are organised through guilds.'
        });
        return;
      }
      host.innerHTML = events
        .map(
          (e) => `<article class="card event-card ${e.status === 'cancelled' ? 'card-danger' : ''}">
            <div class="event-banner ${escapeHtml(e.banner_type)}" aria-hidden="true"><span>${e.is_official_studio_event ? 'OFFICIAL STUDIO EVENT' : 'COMMUNITY MEETUP'}</span></div>
            <div class="event-body">
              <div class="event-head">
                <div>
                  <h3>${escapeHtml(e.title)}</h3>
                  <p class="muted" style="font-size:.82rem">${escapeHtml(e.schedule_text)}</p>
                </div>
                <span class="pill-badge ${e.is_official_studio_event ? 'pill-orange' : 'pill-cyan'}">
                  ${e.is_official_studio_event ? '🏛️ Official' : '👥 Community'}
                </span>
              </div>
              <p class="event-desc">${escapeHtml(e.description)}</p>
              <dl class="spec-grid">
                <div><dt>Date</dt><dd>${escapeHtml(dateLabel(e.event_date))}</dd></div>
                <div><dt>District</dt><dd>${escapeHtml(e.district)}</dd></div>
                <div><dt>Venue</dt><dd>${escapeHtml(e.venue)}</dd></div>
                <div><dt>Registration closes</dt><dd>${escapeHtml(dateLabel(e.registration_deadline))}</dd></div>
                <div><dt>Capacity</dt><dd>${e.registered_count}/${e.capacity} registered</dd></div>
                <div><dt>Status</dt><dd>${escapeHtml(e.status)}</dd></div>
              </dl>
              <div class="event-reqs">
                <p><strong>Eligibility:</strong> ${escapeHtml(e.eligibility_requirements)}</p>
                <p><strong>Equipment &amp; safety:</strong> ${escapeHtml(e.equipment_safety_requirements)}</p>
                <p><strong>Organiser contact:</strong> ${escapeHtml(e.organizer_contact)}</p>
              </div>
              ${
                e.announcements && e.announcements.length
                  ? `<div class="event-announcements"><strong>Updates</strong><ul>${e.announcements
                      .map((a) => `<li>${escapeHtml(a)}</li>`)
                      .join('')}</ul></div>`
                  : ''
              }
              ${e.cancellation_notice ? `<div class="callout callout-danger">${escapeHtml(e.cancellation_notice)}</div>` : ''}
              ${e.post_event_recap ? `<div class="callout"><strong>Post-event recap:</strong> ${escapeHtml(e.post_event_recap)}</div>` : ''}
              <div class="bike-actions">
                ${
                  e.status === 'past'
                    ? '<span class="pill-badge pill-green">Event completed</span>'
                    : e.registered_by_me
                    ? `<button class="btn btn-secondary btn-sm" data-cancel-event="${escapeHtml(e.id)}">Cancel registration</button>
                       <span class="pill-badge pill-green">✓ You are registered</span>`
                    : `<button class="btn btn-primary btn-sm" data-register-event="${escapeHtml(e.id)}">Register</button>`
                }
                <button class="btn btn-secondary btn-sm" data-report-event="${escapeHtml(e.id)}">⚑ Report suspicious event</button>
              </div>
              <p class="hint">Attendee lists and contact details are private. Studio staff never publish participant locations.</p>
            </div>
          </article>`
        )
        .join('');

      host.querySelectorAll('[data-register-event]').forEach((b) =>
        b.addEventListener('click', async () => {
          try {
            const res = await api(`/api/events/${b.dataset.registerEvent}/register`, { method: 'POST' });
            toast(res.message, 'success', 5000);
            loadEvents();
            window.RR.refreshSession().catch(() => {});
          } catch (err) {
            toast(err.message, 'error');
          }
        })
      );
      host.querySelectorAll('[data-cancel-event]').forEach((b) =>
        b.addEventListener('click', async () => {
          if (!confirm('Cancel your registration for this event?')) return;
          try {
            const res = await api(`/api/events/${b.dataset.cancelEvent}/cancel`, { method: 'POST' });
            toast(res.message, 'success');
            loadEvents();
          } catch (err) {
            toast(err.message, 'error');
          }
        })
      );
      host.querySelectorAll('[data-report-event]').forEach((b) =>
        b.addEventListener('click', () => window.RRFeed.openReport(b.dataset.reportEvent, 'event'))
      );
    } catch (err) {
      host.innerHTML = errorState(err);
      const retry = host.querySelector('[data-retry]');
      if (retry) retry.addEventListener('click', loadEvents);
    }
  }

  /* -------------------------------- Safety Centre -------------------------------- */
  const SAFETY_RULES = [
    ['🪖', 'Always wear a properly fitted helmet', 'Use a certified BMX/skate helmet (CPSC, EN 1078 or ASTM F1492). Replace it after any significant impact — the foam does not recover.'],
    ['🏟️', 'Practise in a legal, controlled area', 'Use designated skateparks, closed courts or pump tracks. Check park rules, opening hours and local by-laws first.'],
    ['🚫', 'Never stunt on public roads or in traffic', 'No wheelies, hops or tricks among moving vehicles, and never near unsuspecting pedestrians.'],
    ['🔍', 'Inspect before every ride', 'Check frame, fork, wheels, tires, handlebars, pedals, brakes and bar-end plugs before each session.'],
    ['📈', 'Progress gradually', 'Learn advanced techniques with qualified in-person coaching in padded facilities. App tutorials never guarantee safety.'],
    ['🧠', 'Never ride impaired or distracted', 'No riding after alcohol, drugs, when exhausted, injured, or while using a phone.'],
    ['⛔', 'Stop when something is wrong', 'Damaged equipment, loose bolts, worn tires or unsafe conditions mean stop immediately.'],
    ['⚖️', 'Follow laws and venue rules', 'Respect Sri Lankan road law, park rules, event-organiser requirements and other riders.']
  ];

  async function renderSafety(viewport) {
    let notice = null;
    try {
      if (!state.config) state.config = await api('/api/config');
      notice = state.config.draftSafetyNotice;
    } catch (e) {
      /* offline */
    }
    viewport.innerHTML = `
      <div class="section-head">
        <div><h2>Safety Centre</h2><p class="muted">Permanent safety guidance — reachable from navigation, tutorials, bike profiles and the composer.</p></div>
      </div>
      <section class="card card-danger">
        <h3>Draft safety notice <span class="pill-badge pill-red">Subject to legal review</span></h3>
        <blockquote class="safety-quote">${escapeHtml(notice || 'Bicycle riding and stunt riding involve inherent risks, including serious injury, permanent disability, or death. RideRise LK provides community features and educational information; it does not supervise individual riding activities, certify a rider’s ability, or guarantee that user-generated information is accurate or safe.')}</blockquote>
        <p class="muted" style="font-size:.84rem;margin-top:10px"><strong>Never</strong> treat a social feature, tutorial, leaderboard, Bike Build Rating or another rider's advice as a guarantee of physical safety.</p>
      </section>
      <div class="grid-2">
        ${SAFETY_RULES.map(
          ([icon, title, body]) => `<section class="card safety-rule">
            <span class="safety-rule-icon" aria-hidden="true">${icon}</span>
            <div><h4>${escapeHtml(title)}</h4><p class="muted" style="font-size:.84rem">${escapeHtml(body)}</p></div>
          </section>`
        ).join('')}
      </div>
      <section class="card">
        <h3>Emergency &amp; reporting</h3>
        <p class="muted" style="font-size:.86rem">For immediate danger contact local emergency services (Sri Lanka 119 for police, 1990 Suwa Seriya ambulance). Report content or behaviour in-app so moderators can act.</p>
        <div class="bike-actions">
          <button class="btn btn-primary" id="safetyPreRide">Run 7-point pre-ride check</button>
          <button class="btn btn-danger" id="safetyReport">Report a safety issue</button>
          <button class="btn btn-secondary" onclick="location.hash='#/stunts'">Stunt-learning library</button>
        </div>
        <h4 style="margin-top:18px">Emergency contacts (Sri Lanka)</h4>
        <ul class="emergency-list">
          <li><strong>1990</strong> — Suwa Seriya ambulance service</li>
          <li><strong>119</strong> — Sri Lanka Police emergency</li>
          <li><strong>110</strong> — Fire &amp; rescue</li>
        </ul>
      </section>`;
    viewport.querySelector('#safetyPreRide').addEventListener('click', () => {
      if (!state.token) return toast('Sign in to record your inspection.', 'error');
      window.RRFeed.openSafetyChecklist();
    });
    viewport.querySelector('#safetyReport').addEventListener('click', () => {
      if (!state.token) return toast('Sign in to submit a report.', 'error');
      modal({
        title: 'Report a safety issue',
        size: '520px',
        body: `<p class="muted" style="font-size:.86rem">Use this for unsafe content, dangerous advice or an unsafe event listing. Include the content ID if possible.</p>
          <div class="form-group"><label class="form-label" for="safetyTarget">Content or account reference</label>
          <input class="form-input" id="safetyTarget" placeholder="post/comment/user/message/event ID" /></div>
          <div class="form-group"><label class="form-label" for="safetyTargetType">Type</label>
          <select class="form-select" id="safetyTargetType">
            <option value="post">Post</option><option value="comment">Comment</option><option value="user">User</option>
            <option value="message">Message</option><option value="guild">Guild</option><option value="event">Event</option>
          </select></div>`,
        footer: '<button class="btn btn-primary" id="safetyGo">Continue to report form</button>',
        onMount(root) {
          root.querySelector('#safetyGo').addEventListener('click', () => {
            const target = root.querySelector('#safetyTarget').value.trim();
            const type = root.querySelector('#safetyTargetType').value;
            closeModal();
            if (!target) {
              toast('Add a reference ID or use the ⚑ Report button on the content itself.', 'error', 5000);
              return;
            }
            window.RRFeed.openReport(target, type);
          });
        }
      });
    });
  }

  /* ------------------------------- Notifications -------------------------------- */
  async function renderNotifications(viewport) {
    if (!state.token) {
      location.hash = '#/welcome';
      return;
    }
    viewport.innerHTML = `<div class="section-head"><div><h2>Notifications</h2><p class="muted">Friend activity, moderation updates and event reminders.</p></div>
      <button class="btn btn-secondary btn-sm" id="readAllBtn">Mark all read</button></div>
      <div id="notifList">${skeletonList(3)}</div>`;
    viewport.querySelector('#readAllBtn').addEventListener('click', async () => {
      try {
        await api('/api/notifications/read-all', { method: 'POST' });
        state.unreadNotifications = 0;
        if (window.RRApp) window.RRApp.paintChrome();
        load();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
    async function load() {
      const host = document.getElementById('notifList');
      try {
        const data = await api('/api/notifications');
        if (!data.notifications.length) {
          host.innerHTML = emptyState({ icon: '🔔', title: 'Nothing yet', body: 'Friend requests, moderation decisions and event reminders will appear here.' });
          return;
        }
        host.innerHTML = `<div class="card notif-list">${data.notifications
          .map(
            (n) => `<div class="notif-row ${n.is_read ? '' : 'unread'}">
              <span class="notif-dot" aria-hidden="true"></span>
              <div><strong>${escapeHtml(n.title)}</strong><p class="muted" style="font-size:.84rem">${escapeHtml(n.body)}</p>
              <small class="post-time">${escapeHtml(timeAgo(n.created_at))}</small></div>
            </div>`
          )
          .join('')}</div>`;
        state.unreadNotifications = 0;
        if (window.RRApp) window.RRApp.paintChrome();
      } catch (err) {
        host.innerHTML = errorState(err);
        const retry = host.querySelector('[data-retry]');
        if (retry) retry.addEventListener('click', load);
      }
    }
    await load();
  }

  window.RRExplore = { renderExplore, renderParts, renderEvents, renderSafety, renderNotifications, PART_CATEGORIES };
})();
