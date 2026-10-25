/* RideRise LK — Events (Phase 2): calendar + list, filters, registration,
 * waiting lists and private check-in. Official studio events are visually
 * distinct from community and guild listings. */
(function () {
  'use strict';

  const { api, state, escapeHtml, toast, emptyState, errorState, skeletonList, modal, closeModal, dateLabel } = window.RR;

  const CATEGORY_LABEL = {
    community: 'Community',
    clinic: 'Skills clinic',
    race: 'Race',
    meetup: 'Meet-up',
    workshop: 'Workshop',
    showcase: 'Showcase'
  };

  function monthMatrix(year, month) {
    const first = new Date(Date.UTC(year, month, 1));
    const startDay = first.getUTCDay();
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const cells = [];
    for (let i = 0; i < startDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(Date.UTC(year, month, d)));
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }

  async function renderEvents(viewport) {
    let view = 'list';
    let cursor = new Date();
    let filters = { district: '', category: '', official: '', selectedDay: null };
    let payload = null;

    viewport.innerHTML = `
      <div class="section-head">
        <div>
          <h2>Events</h2>
          <p class="muted">Official Shaun David Studios events and community meet-ups. Safety rules, capacity and check-in details are on every listing.</p>
        </div>
        <div class="segmented" role="tablist" aria-label="Event view">
          <button class="chip active" data-view="list">List</button>
          <button class="chip" data-view="calendar">Calendar</button>
        </div>
      </div>
      <div class="catalog-toolbar card">
        <div class="catalog-filters">
          <select class="form-select" id="evDistrict" aria-label="Filter by district"><option value="">All districts</option></select>
          <select class="form-select" id="evCategory" aria-label="Filter by category"><option value="">All categories</option></select>
          <select class="form-select" id="evOfficial" aria-label="Filter by organizer">
            <option value="">Official + community</option>
            <option value="1">Official studio events only</option>
            <option value="0">Community events only</option>
          </select>
        </div>
      </div>
      <div id="eventsList">${skeletonList(3)}</div>`;

    viewport.querySelectorAll('[data-view]').forEach((btn) =>
      btn.addEventListener('click', () => {
        view = btn.dataset.view;
        viewport.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('active', b === btn));
        paint();
      })
    );

    const body = viewport.querySelector('#eventsList');

    async function load() {
      const params = new URLSearchParams();
      if (filters.district) params.set('district', filters.district);
      if (filters.category) params.set('category', filters.category);
      if (filters.official) params.set('official', filters.official);
      payload = await api(`/api/events/calendar?${params.toString()}`);
    }

    function whenLabel(dateStr) {
      const d = new Date(dateStr);
      if (Number.isNaN(d.getTime())) return dateStr;
      return d.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    }

    function eventCard(ev, isGuild) {
      const official = ev.is_official_studio_event;
      const mine = ev.my_registration || (ev.my_rsvp ? { status: ev.my_rsvp } : null);
      const full = ev.spots_left !== undefined ? ev.spots_left <= 0 : false;
      return `<article class="card event-card ${official ? 'is-official' : 'is-community'}">
        <div class="event-head">
          <div>
            <div class="event-badges">
              ${official ? '<span class="pill-badge pill-orange">★ Official Shaun David Studios Event</span>' : '<span class="pill-badge pill-cyan">Community event</span>'}
              ${isGuild ? `<span class="pill-badge">Guild · ${escapeHtml(ev.guild_name || '')}</span>` : ''}
              ${ev.featured_on_home ? '<span class="pill-badge pill-green">Featured on home</span>' : ''}
              <span class="pill-badge">${escapeHtml(CATEGORY_LABEL[ev.category] || ev.category || 'Community')}</span>
            </div>
            <h3>${escapeHtml(ev.title)}</h3>
            <small>${escapeHtml(whenLabel(ev.starts_at || ev.event_date))} · ${escapeHtml(ev.venue || 'Venue to be confirmed')} · ${escapeHtml(ev.district)}</small>
          </div>
          ${ev.status === 'cancelled' ? '<span class="pill-badge pill-red">Cancelled</span>' : ''}
        </div>
        ${ev.description ? `<p class="event-desc">${escapeHtml(ev.description.slice(0, 220))}</p>` : ''}
        <div class="event-foot">
          <span>${ev.going_count}/${ev.capacity} registered${ev.waitlist_count ? ` · ${ev.waitlist_count} waiting` : ''}</span>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            ${
              mine && mine.status === 'registered'
                ? `<span class="pill-badge pill-green">✓ Registered</span>`
                : mine && mine.status === 'going'
                ? `<span class="pill-badge pill-green">✓ Going</span>`
                : mine && mine.status === 'waitlist'
                ? `<span class="pill-badge pill-orange">On waiting list</span>`
                : ''
            }
            ${
              isGuild
                ? ''
                : mine && mine.status === 'registered'
                ? `<button class="btn btn-secondary btn-sm" data-cancel-event="${escapeHtml(ev.id)}">Cancel registration</button>
                   <span class="pill-badge pill-green">✓ You are registered</span>`
                : ev.status === 'cancelled'
                ? ''
                : `<button class="btn btn-primary btn-sm" data-register-event="${escapeHtml(ev.id)}">${
                    ev.spots_left !== undefined && ev.spots_left <= 0 ? 'Join waiting list' : 'Register'
                  }</button>`
            }
            <button class="btn btn-secondary btn-sm" data-event-detail="${escapeHtml(ev.id)}" data-guild="${isGuild ? '1' : '0'}">Details</button>
          </div>
        </div>
      </article>`;
    }

    function paint() {
      if (!payload) {
        body.innerHTML = skeletonList(3);
        return;
      }
      const events = payload.events.filter((e) => {
        if (!filters.selectedDay) return true;
        return String(e.event_date).slice(0, 10) === filters.selectedDay;
      });

      if (view === 'calendar') {
        const year = cursor.getUTCFullYear();
        const month = cursor.getUTCMonth();
        const cells = monthMatrix(year, month);
        const byDay = {};
        payload.events.forEach((e) => {
          const key = String(e.event_date).slice(0, 10);
          byDay[key] = byDay[key] || [];
          byDay[key].push(e);
        });
        body.innerHTML = `
          <section class="card calendar-card">
            <div class="calendar-head">
              <button class="icon-btn" id="calPrev" aria-label="Previous month">‹</button>
              <h3>${cursor.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</h3>
              <button class="icon-btn" id="calNext" aria-label="Next month">›</button>
            </div>
            <div class="calendar-grid" role="grid">
              ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => `<div class="calendar-dow" role="columnheader">${d}</div>`).join('')}
              ${cells
                .map((date) => {
                  if (!date) return '<div class="calendar-cell is-empty"></div>';
                  const key = date.toISOString().slice(0, 10);
                  const list = byDay[key] || [];
                  const selected = filters.selectedDay === key;
                  return `<button class="calendar-cell ${list.length ? 'has-events' : ''} ${selected ? 'is-selected' : ''}" data-cal-day="${key}" aria-label="${key}, ${list.length} events">
                    <span class="calendar-day">${date.getUTCDate()}</span>
                    ${list
                      .slice(0, 2)
                      .map((e) => `<span class="calendar-event ${e.is_official_studio_event ? 'official' : ''}">${escapeHtml(e.title.slice(0, 18))}</span>`)
                      .join('')}
                    ${list.length > 2 ? `<span class="calendar-more">+${list.length - 2} more</span>` : ''}
                  </button>`;
                })
                .join('')}
            </div>
            <p class="hint">Showing ${filters.selectedDay ? `events on ${filters.selectedDay}` : 'all dates'}${filters.selectedDay ? ' — tap the day again to clear' : ''}.</p>
          </section>
          <div class="event-list">${events.map((e) => eventCard(e, false)).join('') || emptyState({ icon: '📅', title: 'No events this month', body: 'Try another month or clear the filters.' })}</div>`;
        body.querySelector('#calPrev').addEventListener('click', () => {
          cursor = new Date(Date.UTC(year, month - 1, 1));
          paint();
        });
        body.querySelector('#calNext').addEventListener('click', () => {
          cursor = new Date(Date.UTC(year, month + 1, 1));
          paint();
        });
        body.querySelectorAll('[data-cal-day]').forEach((btn) =>
          btn.addEventListener('click', () => {
            filters.selectedDay = filters.selectedDay === btn.dataset.calDay ? null : btn.dataset.calDay;
            paint();
          })
        );
      } else {
        body.innerHTML = `
          ${events.length ? `<div class="event-list">${events.map((e) => eventCard(e, false)).join('')}</div>` : emptyState({ icon: '📅', title: 'No matching events', body: 'Adjust the district, category or organizer filter.' })}
          ${
            payload.guild_events.length
              ? `<section class="card"><h3>Your guild events</h3><p class="muted" style="font-size:.82rem">Guild events are organised by members — they are never official studio events.</p>
                  <div class="event-list">${payload.guild_events
                    .map(
                      (g) => `<article class="card event-card is-community">
                        <div class="event-head"><div><span class="pill-badge pill-cyan">Guild event</span><h3>${escapeHtml(g.title)}</h3><small>${escapeHtml(whenLabel(g.starts_at))} · ${escapeHtml(g.venue || g.district)}</small></div></div>
                        <div class="event-foot"><span>${g.going_count}/${g.capacity} going</span>
                          <a class="btn btn-secondary btn-sm" href="#/guild/${escapeHtml(g.guild_id)}?tab=events">Open ${escapeHtml(g.guild_name)}</a>
                        </div>
                      </article>`
                    )
                    .join('')}</div>
                </section>`
              : ''
          }
          <p class="hint">${escapeHtml(payload.distinction_note)}</p>`;
      }

      body.querySelectorAll('[data-event-detail]').forEach((btn) =>
        btn.addEventListener('click', () => {
          if (btn.dataset.guild === '1') {
            location.hash = `#/guild/${btn.dataset.eventDetail}`;
            return;
          }
          openEventDetail(btn.dataset.eventDetail);
        })
      );
      body.querySelectorAll('[data-register-event]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          try {
            const res = await api(`/api/events/v2/${btn.dataset.registerEvent}/register`, { method: 'POST' });
            toast(res.message, 'success', 6000);
            await load();
            paint();
          } catch (err) {
            toast(err.message, 'error');
            btn.disabled = false;
          }
        })
      );
      body.querySelectorAll('[data-cancel-event]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          if (!window.confirm('Cancel your registration for this event?')) return;
          try {
            await api(`/api/events/v2/${btn.dataset.cancelEvent}/cancel`, { method: 'POST' });
            toast('Registration cancelled. Your place may be offered to the waiting list.', 'info', 6000);
            await load();
            paint();
          } catch (err) {
            toast(err.message, 'error');
          }
        })
      );
    }

    async function openEventDetail(eventId) {
      modal({
        title: 'Event details',
        size: '820px',
        body: '<div class="skeleton"></div>',
        onMount: async (root) => {
          try {
            const data = await api(`/api/events/v2/${eventId}`);
            const ev = data.event;
            const registered = ev.my_registration && ev.my_registration.status === 'registered';
            root.querySelector('.modal-body').innerHTML = `
              <div class="event-badges">
                ${ev.is_official_studio_event ? '<span class="pill-badge pill-orange">★ Official Shaun David Studios Event</span>' : '<span class="pill-badge pill-cyan">Community event</span>'}
                ${ev.status === 'cancelled' ? '<span class="pill-badge pill-red">Cancelled</span>' : ''}
              </div>
              <h3 style="margin:6px 0">${escapeHtml(ev.title)}</h3>
              <p class="muted" style="font-size:.86rem">${escapeHtml(whenLabel(ev.event_date))} · ${escapeHtml(ev.venue)} · ${escapeHtml(ev.district)}</p>
              <p style="margin-top:10px">${escapeHtml(ev.description)}</p>
              <div class="event-reqs">
                <div><h4>Organiser</h4><p>${escapeHtml(ev.organizer_name)}${ev.organizer_contact ? ` · ${escapeHtml(ev.organizer_contact)}` : ''}</p></div>
                <div><h4>Eligibility</h4><p>${escapeHtml(ev.eligibility_requirements || 'See event rules')}</p></div>
                <div><h4>Safety requirements</h4><p>${escapeHtml(ev.safety_requirements || ev.equipment_safety_requirements || 'Certified helmet required')}</p></div>
                <div><h4>Rules</h4><p>${escapeHtml(ev.rules_text || 'Respect other riders and venue rules.')}</p></div>
                ${ev.minor_policy ? `<div><h4>Riders aged 16–17</h4><p>${escapeHtml(ev.minor_policy)}</p></div>` : ''}
                <div><h4>Capacity</h4><p>${ev.going_count}/${ev.capacity} registered${ev.waitlist_enabled ? ` · waiting list ${ev.waitlist_count}` : ''}</p></div>
                <div><h4>Registration closes</h4><p>${escapeHtml(dateLabel(ev.registration_deadline))}</p></div>
              </div>
              ${
                ev.cancellation_notice
                  ? `<div class="callout callout-danger" style="margin-top:10px"><strong>Cancellation:</strong> ${escapeHtml(ev.cancellation_notice)}</div>`
                  : ''
              }
              <div class="event-actions" style="margin-top:12px">
                ${
                  ev.status === 'cancelled'
                    ? '<span class="pill-badge pill-red">This event was cancelled</span>'
                    : registered
                    ? `<button class="btn btn-secondary" id="cancelReg">Cancel registration</button>
                       <div class="checkin-box">
                         <label class="form-label" for="checkinCode">Check in at the venue (code from the organiser)</label>
                         <div style="display:flex;gap:6px"><input class="form-input" id="checkinCode" placeholder="6-character code" maxlength="8" /><button class="btn btn-primary" id="doCheckin">Check in</button></div>
                         <p class="hint">Check-in stores a timestamp only. No GPS position is collected or published.</p>
                       </div>`
                    : `<button class="btn btn-primary" id="registerEvent">${ev.spots_left <= 0 ? 'Join waiting list' : 'Register'}</button>`
                }
              </div>
              ${
                data.announcements.length
                  ? `<h4 style="margin-top:14px">Announcements</h4>${data.announcements
                      .map((a) => `<div class="announcement-mini"><strong>${escapeHtml(a.title)}</strong><p>${escapeHtml(a.body)}</p><small class="muted">${escapeHtml(timeAgo(a.created_at))}</small></div>`)
                      .join('')}`
                  : ''
              }
              ${
                data.gallery.length
                  ? `<h4 style="margin-top:14px">Gallery</h4><div class="gallery-grid">${data.gallery
                      .map((g) => `<img src="${escapeHtml(g.media_url)}" alt="${escapeHtml(g.caption || 'Event photo')}" loading="lazy" />`)
                      .join('')}</div>`
                  : ''
              }
              ${
                data.results.length
                  ? `<h4 style="margin-top:14px">Results</h4><div class="table-wrap"><table class="compare-table"><thead><tr><th>#</th><th>Rider</th><th>Category</th><th>Note</th></tr></thead><tbody>${data.results
                      .map((r) => `<tr><td>${r.placement || '—'}</td><td>${escapeHtml(r.rider_name)}</td><td>${escapeHtml(r.category)}</td><td>${escapeHtml(r.note)}</td></tr>`)
                      .join('')}</tbody></table></div>`
                  : ''
              }`;

            const regBtn = root.querySelector('#registerEvent');
            if (regBtn) {
              regBtn.addEventListener('click', async () => {
                regBtn.disabled = true;
                try {
                  const res = await api(`/api/events/v2/${eventId}/register`, { method: 'POST' });
                  toast(res.message, 'success', 6000);
                  closeModal();
                  await load();
                  paint();
                } catch (err) {
                  toast(err.message, 'error');
                  regBtn.disabled = false;
                }
              });
            }
            const cancelBtn = root.querySelector('#cancelReg');
            if (cancelBtn) {
              cancelBtn.addEventListener('click', async () => {
                if (!window.confirm('Cancel your registration?')) return;
                try {
                  await api(`/api/events/v2/${eventId}/cancel`, { method: 'POST' });
                  toast('Registration cancelled.', 'info');
                  closeModal();
                  await load();
                  paint();
                } catch (err) {
                  toast(err.message, 'error');
                }
              });
            }
            const checkinBtn = root.querySelector('#doCheckin');
            if (checkinBtn) {
              checkinBtn.addEventListener('click', async () => {
                try {
                  const res = await api(`/api/events/v2/${eventId}/checkin`, {
                    method: 'POST',
                    body: { code: root.querySelector('#checkinCode').value }
                  });
                  toast(res.message, 'success', 6000);
                  closeModal();
                } catch (err) {
                  toast(err.message, 'error');
                }
              });
            }
          } catch (err) {
            root.querySelector('.modal-body').innerHTML = errorState(err);
          }
        }
      });
    }

    try {
      await load();
      const districtSel = viewport.querySelector('#evDistrict');
      payload.districts.forEach((d) => {
        const opt = document.createElement('option');
        opt.value = d;
        opt.textContent = d;
        districtSel.appendChild(opt);
      });
      const catSel = viewport.querySelector('#evCategory');
      payload.categories.forEach((c) => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = CATEGORY_LABEL[c] || c;
        catSel.appendChild(opt);
      });
      ['#evDistrict', '#evCategory', '#evOfficial'].forEach((sel) =>
        viewport.querySelector(sel).addEventListener('change', async () => {
          filters = {
            district: viewport.querySelector('#evDistrict').value,
            category: viewport.querySelector('#evCategory').value,
            official: viewport.querySelector('#evOfficial').value,
            selectedDay: filters.selectedDay
          };
          await load();
          paint();
        })
      );
      paint();
    } catch (err) {
      body.innerHTML = errorState(err);
    }
  }

  window.RREvents = { renderEvents };
})();
