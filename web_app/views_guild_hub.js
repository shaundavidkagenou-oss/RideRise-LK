/* RideRise LK — Guild centre (Phase 2): announcements, discussion feed, guild
 * events with RSVP, member activity, appeals and a manager-only audit log. */
(function () {
  'use strict';

  const { api, state, escapeHtml, toast, avatar, timeAgo, dateLabel, emptyState, errorState, skeletonList, modal, closeModal } =
    window.RR;

  const TABS = [
    ['announcements', '📣 Announcements'],
    ['discussion', '💬 Discussion'],
    ['events', '📅 Events'],
    ['members', '👥 Members'],
    ['manage', '⚙️ Manage']
  ];

  function tabFromQuery(query) {
    const params = new URLSearchParams(query || '');
    const tab = params.get('tab');
    return TABS.some(([id]) => id === tab) ? tab : 'announcements';
  }

  async function renderGuildHub(viewport, guildId, query) {
    if (!state.token) {
      location.hash = '#/welcome';
      return;
    }
    viewport.innerHTML = `<div class="skeleton" style="height:140px"></div><div class="skeleton"></div>`;
    let hub;
    try {
      hub = await api(`/api/guilds/${guildId}/hub`);
    } catch (err) {
      viewport.innerHTML = `<div class="section-head"><div><h2>Guild centre</h2></div></div>${errorState(err)}`;
      return;
    }

    let activeTab = tabFromQuery(query);
    let audit = null;
    let settings = hub.settings;

    viewport.innerHTML = `
      <div class="section-head">
        <div>
          <button class="btn btn-secondary btn-sm" id="hubBack" style="margin-bottom:8px">← Guild</button>
          <h2>${escapeHtml(hub.guild.name)}</h2>
          <p class="muted">${escapeHtml(hub.guild.category)} · ${escapeHtml(hub.guild.district)} · ${hub.member_count} members${
            hub.is_manager ? ` · ${hub.pending_count} pending` : ''
          }</p>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn btn-safety btn-sm" id="hubMap">🗺️ Live map</button>
          <button class="btn btn-secondary btn-sm" id="hubVoice">🎙️ Voice</button>
        </div>
      </div>

      <div class="chip-bar hub-tabs" role="tablist" aria-label="Guild sections">
        ${TABS.filter(([id]) => id !== 'manage' || hub.is_manager || hub.is_studio_admin)
          .map(([id, label]) => `<button class="chip ${activeTab === id ? 'active' : ''}" role="tab" data-hub-tab="${id}">${label}</button>`)
          .join('')}
      </div>
      <div id="hubBody">${skeletonList(2)}</div>`;

    viewport.querySelector('#hubBack').addEventListener('click', () => (location.hash = `#/guild/${guildId}`));
    viewport.querySelector('#hubMap').addEventListener('click', () => (location.hash = `#/guild/${guildId}/map`));
    viewport.querySelector('#hubVoice').addEventListener('click', () => (location.hash = `#/guild/${guildId}/voice`));
    viewport.querySelectorAll('[data-hub-tab]').forEach((chip) =>
      chip.addEventListener('click', () => {
        activeTab = chip.dataset.hubTab;
        viewport.querySelectorAll('[data-hub-tab]').forEach((c) => c.classList.toggle('active', c === chip));
        renderTab();
      })
    );

    const body = viewport.querySelector('#hubBody');

    function renderTab() {
      if (activeTab === 'announcements') return renderAnnouncements();
      if (activeTab === 'discussion') return renderDiscussion();
      if (activeTab === 'events') return renderEvents();
      if (activeTab === 'members') return renderMembers();
      if (activeTab === 'manage') return renderManage();
      return renderAnnouncements();
    }

    /* ----------------------------- announcements ---------------------------- */
    function renderAnnouncements() {
      body.innerHTML = `
        ${
          hub.is_manager
            ? `<section class="card">
                 <h3>Post an announcement</h3>
                 <div class="form-group"><label class="form-label" for="annTitle">Title</label><input class="form-input" id="annTitle" maxlength="140" placeholder="Saturday clinic moved to 4pm" /></div>
                 <div class="form-group"><label class="form-label" for="annBody">Message</label><textarea class="form-textarea" id="annBody" rows="3" placeholder="What changed and what members should do."></textarea></div>
                 <label class="check-row" for="annPinned"><input type="checkbox" id="annPinned" /> <span>Pin to the top of the guild</span></label>
                 <button class="btn btn-primary" id="postAnnouncement" style="margin-top:10px">Publish announcement</button>
               </section>`
            : ''
        }
        <div class="announcement-list">
          ${
            hub.announcements.length
              ? hub.announcements
                  .map(
                    (a) => `<article class="card announcement ${a.pinned ? 'is-pinned' : ''}">
                      <div class="announcement-head">
                        ${a.pinned ? '<span class="pill-badge pill-orange">📌 Pinned</span>' : ''}
                        <h3>${escapeHtml(a.title)}</h3>
                      </div>
                      <p class="announcement-body">${escapeHtml(a.body)}</p>
                      <div class="announcement-meta">
                        ${avatar(a.avatar_url, a.display_name, 26)}
                        <span>${escapeHtml(a.display_name)} · ${escapeHtml(timeAgo(a.created_at))}</span>
                        ${
                          hub.is_manager
                            ? `<span class="announcement-actions">
                                <button class="icon-btn" data-pin="${escapeHtml(a.id)}" title="${a.pinned ? 'Unpin' : 'Pin'}">📌</button>
                                <button class="icon-btn" data-remove-ann="${escapeHtml(a.id)}" title="Remove">🗑️</button>
                              </span>`
                            : ''
                        }
                      </div>
                    </article>`
                  )
                  .join('')
              : emptyState({ icon: '📣', title: 'No announcements yet', body: 'Guild managers can pin meet-ups, rule changes and safety notices here.' })
          }
        </div>`;

      if (hub.is_manager) {
        body.querySelector('#postAnnouncement').addEventListener('click', async (e) => {
          e.target.disabled = true;
          try {
            await api(`/api/guilds/${guildId}/announcements`, {
              method: 'POST',
              body: {
                title: body.querySelector('#annTitle').value,
                body: body.querySelector('#annBody').value,
                pinned: body.querySelector('#annPinned').checked
              }
            });
            toast('Announcement published and members notified.', 'success');
            hub = await api(`/api/guilds/${guildId}/hub`);
            renderAnnouncements();
          } catch (err) {
            toast(err.message, 'error');
            e.target.disabled = false;
          }
        });
        body.querySelectorAll('[data-pin]').forEach((b) =>
          b.addEventListener('click', async () => {
            try {
              await api(`/api/guilds/${guildId}/announcements/${b.dataset.pin}/pin`, { method: 'POST' });
              hub = await api(`/api/guilds/${guildId}/hub`);
              renderAnnouncements();
            } catch (err) {
              toast(err.message, 'error');
            }
          })
        );
        body.querySelectorAll('[data-remove-ann]').forEach((b) =>
          b.addEventListener('click', async () => {
            if (!window.confirm('Remove this announcement?')) return;
            try {
              await api(`/api/guilds/${guildId}/announcements/${b.dataset.removeAnn}`, { method: 'DELETE' });
              hub = await api(`/api/guilds/${guildId}/hub`);
              renderAnnouncements();
            } catch (err) {
              toast(err.message, 'error');
            }
          })
        );
      }
    }

    /* ------------------------------- discussion ----------------------------- */
    async function renderDiscussion() {
      body.innerHTML = `<div class="skeleton"></div>`;
      let data;
      try {
        data = await api(`/api/guilds/${guildId}/discussions?limit=25`);
      } catch (err) {
        body.innerHTML = errorState(err);
        return;
      }
      body.innerHTML = `
        <section class="card">
          <div class="form-group"><input class="form-input" id="discTitle" maxlength="160" placeholder="Topic (optional)" /></div>
          <div class="form-group"><textarea class="form-textarea" id="discBody" rows="3" placeholder="Ask the crew, share a build update, or post a clip link."></textarea></div>
          <div class="grid-2" style="gap:10px">
            <div class="form-group"><label class="form-label" for="discMediaType">Attachment type</label>
              <select class="form-select" id="discMediaType"><option value="none">No attachment</option><option value="image">Image URL</option><option value="video">Video URL</option></select>
            </div>
            <div class="form-group"><label class="form-label" for="discMedia">HTTPS link (optional)</label><input class="form-input" id="discMedia" placeholder="https://…" /></div>
          </div>
          <button class="btn btn-primary" id="postDiscussion">Post to guild feed</button>
        </section>
        <div class="discussion-list">
          ${
            data.discussions.length
              ? data.discussions
                  .map(
                    (d) => `<article class="card discussion-row">
                      <div class="discussion-head">
                        ${avatar(d.avatar_url, d.display_name, 34)}
                        <div><strong>${escapeHtml(d.display_name)}</strong><small>@${escapeHtml(d.username)} · ${escapeHtml(timeAgo(d.created_at))}</small></div>
                        ${d.author_id === (state.account && state.account.id) || hub.is_manager ? `<button class="icon-btn" data-del-disc="${escapeHtml(d.id)}" title="Remove">🗑️</button>` : ''}
                      </div>
                      ${d.title ? `<h4>${escapeHtml(d.title)}</h4>` : ''}
                      <p>${escapeHtml(d.body)}</p>
                      ${
                        d.media_url && d.media_type === 'image'
                          ? `<img class="discussion-media" src="${escapeHtml(d.media_url)}" alt="Member attachment" loading="lazy" />`
                          : d.media_url && d.media_type === 'video'
                          ? `<a class="link-inline" href="${escapeHtml(d.media_url)}" target="_blank" rel="noopener noreferrer">▶ Watch attached clip (opens in browser)</a>`
                          : ''
                      }
                    </article>`
                  )
                  .join('')
              : emptyState({ icon: '💬', title: 'No discussion yet', body: 'Start the conversation — builds, spots, maintenance questions.' })
          }
        </div>`;

      body.querySelector('#postDiscussion').addEventListener('click', async (e) => {
        e.target.disabled = true;
        try {
          await api(`/api/guilds/${guildId}/discussions`, {
            method: 'POST',
            body: {
              title: body.querySelector('#discTitle').value,
              body: body.querySelector('#discBody').value,
              media_type: body.querySelector('#discMediaType').value,
              media_url: body.querySelector('#discMedia').value
            }
          });
          toast('Posted to the guild feed.', 'success');
          renderDiscussion();
        } catch (err) {
          toast(err.message, 'error');
          e.target.disabled = false;
        }
      });
      body.querySelectorAll('[data-del-disc]').forEach((b) =>
        b.addEventListener('click', async () => {
          if (!window.confirm('Remove this post?')) return;
          try {
            await api(`/api/guilds/${guildId}/discussions/${b.dataset.delDisc}`, { method: 'DELETE' });
            renderDiscussion();
          } catch (err) {
            toast(err.message, 'error');
          }
        })
      );
    }

    /* -------------------------------- events -------------------------------- */
    async function renderEvents() {
      body.innerHTML = `<div class="skeleton"></div>`;
      let data;
      try {
        data = await api(`/api/guilds/${guildId}/events`);
      } catch (err) {
        body.innerHTML = errorState(err);
        return;
      }
      body.innerHTML = `
        ${
          hub.is_manager
            ? `<section class="card">
                 <h3>Create a guild event</h3>
                 <div class="grid-2" style="gap:10px">
                   <div class="form-group"><label class="form-label" for="gevTitle">Title</label><input class="form-input" id="gevTitle" /></div>
                   <div class="form-group"><label class="form-label" for="gevCategory">Category</label>
                     <select class="form-select" id="gevCategory"><option value="meetup">Meet-up</option><option value="clinic">Skills clinic</option><option value="maintenance">Maintenance day</option><option value="ride">Group ride</option></select>
                   </div>
                 </div>
                 <div class="grid-2" style="gap:10px">
                   <div class="form-group"><label class="form-label" for="gevStart">Starts</label><input class="form-input" type="datetime-local" id="gevStart" /></div>
                   <div class="form-group"><label class="form-label" for="gevVenue">Venue</label><input class="form-input" id="gevVenue" placeholder="Bentota skatepark" /></div>
                 </div>
                 <div class="grid-2" style="gap:10px">
                   <div class="form-group"><label class="form-label" for="gevCapacity">Capacity</label><input class="form-input" type="number" id="gevCapacity" value="30" min="2" max="500" /></div>
                   <div class="form-group"><label class="form-label" for="gevDistrict">District</label><input class="form-input" id="gevDistrict" value="${escapeHtml(hub.guild.district)}" /></div>
                 </div>
                 <div class="form-group"><label class="form-label" for="gevDesc">Description</label><textarea class="form-textarea" id="gevDesc" rows="2"></textarea></div>
                 <div class="form-group"><label class="form-label" for="gevRules">Rules &amp; safety requirements</label><textarea class="form-textarea" id="gevRules" rows="2" placeholder="Helmet required, no road stunts, minors need guardian consent."></textarea></div>
                 <button class="btn btn-primary" id="createGuildEvent">Create event</button>
               </section>`
            : ''
        }
        <div class="event-list">
          ${
            data.events.length
              ? data.events
                  .map((ev) => {
                    const mine = ev.my_rsvp;
                    const full = ev.going_count >= ev.capacity;
                    return `<article class="card event-card">
                      <div class="event-head">
                        <div>
                          <span class="pill-badge pill-cyan">Guild event</span>
                          <h3>${escapeHtml(ev.title)}</h3>
                          <small>${escapeHtml(ev.category)} · ${escapeHtml(dateLabel(ev.starts_at))} · ${escapeHtml(ev.venue || ev.district)}</small>
                        </div>
                        <span class="pill-badge ${ev.status === 'cancelled' ? 'pill-red' : 'pill-green'}">${escapeHtml(ev.status)}</span>
                      </div>
                      <p class="event-desc">${escapeHtml(ev.description)}</p>
                      ${ev.rules_text ? `<p class="hint">📋 ${escapeHtml(ev.rules_text)}</p>` : ''}
                      <div class="event-foot">
                        <span>${ev.going_count}/${ev.capacity} going${ev.waitlist_count ? ` · ${ev.waitlist_count} waiting` : ''}</span>
                        <div style="display:flex;gap:6px;flex-wrap:wrap">
                          ${
                            ev.status !== 'cancelled'
                              ? `<button class="btn btn-${mine === 'going' ? 'secondary' : 'primary'} btn-sm" data-rsvp="${escapeHtml(ev.id)}" data-cancel="${mine === 'going' ? '1' : '0'}">${
                                  mine === 'going' ? '✓ Going — cancel' : mine === 'waitlist' ? 'On waitlist — cancel' : full ? 'Join waitlist' : 'RSVP'
                                }</button>`
                              : ''
                          }
                          ${hub.is_manager && ev.status !== 'cancelled' ? `<button class="btn btn-danger btn-sm" data-cancel-event="${escapeHtml(ev.id)}">Cancel event</button>` : ''}
                        </div>
                      </div>
                    </article>`;
                  })
                  .join('')
              : emptyState({ icon: '📅', title: 'No guild events', body: 'Guild managers can schedule meet-ups, clinics and maintenance days.' })
          }
        </div>`;

      if (hub.is_manager && body.querySelector('#createGuildEvent')) {
        body.querySelector('#createGuildEvent').addEventListener('click', async (e) => {
          e.target.disabled = true;
          try {
            await api(`/api/guilds/${guildId}/events`, {
              method: 'POST',
              body: {
                title: body.querySelector('#gevTitle').value,
                category: body.querySelector('#gevCategory').value,
                starts_at: body.querySelector('#gevStart').value,
                venue: body.querySelector('#gevVenue').value,
                district: body.querySelector('#gevDistrict').value,
                capacity: Number(body.querySelector('#gevCapacity').value),
                description: body.querySelector('#gevDesc').value,
                rules_text: body.querySelector('#gevRules').value
              }
            });
            toast('Guild event created.', 'success');
            renderEvents();
          } catch (err) {
            toast(err.message, 'error');
            e.target.disabled = false;
          }
        });
      }
      body.querySelectorAll('[data-rsvp]').forEach((b) =>
        b.addEventListener('click', async () => {
          b.disabled = true;
          try {
            const cancel = b.dataset.cancel === '1';
            const res = await api(`/api/guilds/${guildId}/events/${b.dataset.rsvp}`, {
              method: 'POST',
              body: { action: cancel ? 'cancel' : 'rsvp' }
            });
            toast(res.message || (res.status === 'waitlist' ? 'Added to the waiting list.' : 'You are registered.'), 'success');
            renderEvents();
          } catch (err) {
            toast(err.message, 'error');
            b.disabled = false;
          }
        })
      );
      body.querySelectorAll('[data-cancel-event]').forEach((b) =>
        b.addEventListener('click', async () => {
          if (!window.confirm('Cancel this guild event and notify everyone? This cannot be undone.')) return;
          try {
            await api(`/api/guilds/${guildId}/events/${b.dataset.cancelEvent}`, { method: 'POST', body: { action: 'cancel' } });
            toast('Event cancelled.', 'info');
            renderEvents();
          } catch (err) {
            toast(err.message, 'error');
          }
        })
      );
    }

    /* -------------------------------- members ------------------------------- */
    function renderMembers() {
      const members = hub.members || [];
      body.innerHTML = `
        <section class="card">
          <h3>Member activity settings</h3>
          <p class="muted" style="font-size:.84rem">When activity is hidden you appear as “offline” in the guild map member list and are never shown as sharing.</p>
          <div class="grid-2" style="gap:10px;margin-top:8px">
            <label class="check-row" for="showActivity"><input type="checkbox" id="showActivity" checked /> <span>Show my online status to guild members</span></label>
            <div class="form-group" style="margin:0"><label class="form-label" for="notifLevel">Guild notifications</label>
              <select class="form-select" id="notifLevel"><option value="all">All</option><option value="mentions">Mentions only</option><option value="none">None</option></select>
            </div>
          </div>
          <button class="btn btn-secondary btn-sm" id="saveActivity" style="margin-top:10px">Save activity settings</button>
        </section>
        <section class="card">
          <h3>Members</h3>
          <div class="member-list">
            ${
              members.length
                ? members
                    .map(
                      (m) => `<div class="member-row">
                        ${avatar(m.avatar_url, m.display_name, 36)}
                        <div class="member-text"><strong>${escapeHtml(m.display_name)}</strong><small>@${escapeHtml(m.username)} · ${escapeHtml(m.role)}</small></div>
                        ${m.status === 'active' ? `<span class="pill-badge pill-cyan">Active</span>` : `<span class="pill-badge pill-orange">${escapeHtml(m.status)}</span>`}
                      </div>`
                    )
                    .join('')
                : '<p class="muted">Member list is visible to guild managers and members according to privacy settings.</p>'
            }
          </div>
        </section>`;

      body.querySelector('#saveActivity').addEventListener('click', async () => {
        try {
          await api(`/api/guilds/${guildId}/live/activity`, {
            method: 'POST',
            body: {
              show_activity: body.querySelector('#showActivity').checked,
              notifications_level: body.querySelector('#notifLevel').value
            }
          });
          toast('Activity preferences saved.', 'success');
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    }

    /* --------------------------------- manage ------------------------------- */
    async function renderManage() {
      body.innerHTML = `<div class="skeleton"></div>`;
      if (!audit) {
        try {
          audit = await api(`/api/guilds/${guildId}/audit`);
        } catch (err) {
          body.innerHTML = errorState(err);
          return;
        }
      }
      let appeals = [];
      try {
        appeals = (await api(`/api/guilds/${guildId}/appeals`)).appeals || [];
      } catch (e) {
        appeals = [];
      }

      body.innerHTML = `
        <section class="card">
          <h3>Guild settings</h3>
          <div class="grid-2" style="gap:10px">
            <label class="check-row"><input type="checkbox" id="setLocation" ${settings.location_sharing_enabled ? 'checked' : ''} /> <span>Allow live location sharing</span></label>
            <label class="check-row"><input type="checkbox" id="setVoice" ${settings.voice_enabled ? 'checked' : ''} /> <span>Allow group voice</span></label>
            <label class="check-row"><input type="checkbox" id="setWalkie" ${settings.walkie_enabled ? 'checked' : ''} /> <span>Allow walkie-talkie</span></label>
            <label class="check-row"><input type="checkbox" id="setActivity" ${settings.activity_visible ? 'checked' : ''} /> <span>Show member activity states</span></label>
          </div>
          <div class="form-group" style="margin-top:10px">
            <label class="form-label" for="setJoinPolicy">Discovery &amp; joining</label>
            <select class="form-select" id="setJoinPolicy">
              <option value="open" ${hub.guild.join_policy === 'open' ? 'selected' : ''}>Public — anyone can join instantly</option>
              <option value="approval" ${hub.guild.join_policy === 'approval' ? 'selected' : ''}>Approval — managers review requests</option>
              <option value="invite_only" ${hub.guild.join_policy === 'invite_only' ? 'selected' : ''}>Private — invitation only</option>
            </select>
          </div>
          <div class="form-group"><label class="form-label" for="setRules">Community rules</label><textarea class="form-textarea" id="setRules" rows="4">${escapeHtml(hub.guild.rules_text || '')}</textarea></div>
          <div class="form-group"><label class="form-label" for="setWelcome">Welcome message</label><input class="form-input" id="setWelcome" value="${escapeHtml(settings.welcome_message || '')}" /></div>
          <button class="btn btn-primary" id="saveGuildSettings">Save settings</button>
        </section>

        <section class="card">
          <h3>Member appeals</h3>
          ${
            appeals.length
              ? `<div class="report-list">${appeals
                  .map(
                    (a) => `<div class="report-row">
                      <div class="report-main"><strong>${escapeHtml(a.username || 'Member')}</strong><small>${escapeHtml(a.status)} · ${escapeHtml(timeAgo(a.created_at))}</small><p>${escapeHtml(a.message)}</p></div>
                      ${a.status === 'pending' ? `<button class="btn btn-secondary btn-sm" data-appeal="${escapeHtml(a.id)}">Review</button>` : ''}
                    </div>`
                  )
                  .join('')}</div>`
              : '<p class="muted" style="font-size:.85rem">No appeals. Members can appeal a guild moderation decision; unresolved appeals escalate to studio support.</p>'
          }
        </section>

        <section class="card">
          <h3>Audit history</h3>
          <p class="muted" style="font-size:.82rem">Every moderation and settings action is recorded. Entries cannot be edited.</p>
          <div class="audit-list">
            ${
              audit.audit.length
                ? audit.audit
                    .map(
                      (l) => `<div class="audit-row"><span class="audit-action">${escapeHtml(l.action)}</span><span class="audit-who">@${escapeHtml(
                        l.actor_username || 'system'
                      )}</span><span class="audit-when">${escapeHtml(timeAgo(l.created_at))}</span></div>`
                    )
                    .join('')
                : '<p class="muted">No actions recorded yet.</p>'
            }
          </div>
        </section>`;

      body.querySelector('#saveGuildSettings').addEventListener('click', async (e) => {
        e.target.disabled = true;
        try {
          const res = await api(`/api/guilds/${guildId}/settings`, {
            method: 'PUT',
            body: {
              location_sharing_enabled: body.querySelector('#setLocation').checked,
              voice_enabled: body.querySelector('#setVoice').checked,
              walkie_enabled: body.querySelector('#setWalkie').checked,
              activity_visible: body.querySelector('#setActivity').checked,
              join_policy: body.querySelector('#setJoinPolicy').value,
              rules_text: body.querySelector('#setRules').value,
              welcome_message: body.querySelector('#setWelcome').value
            }
          });
          settings = res.settings;
          hub.settings = res.settings;
          toast('Guild settings saved.', 'success');
          audit = null;
        } catch (err) {
          toast(err.message, 'error');
        } finally {
          e.target.disabled = false;
        }
      });

      body.querySelectorAll('[data-appeal]').forEach((b) =>
        b.addEventListener('click', () => {
          const appeal = appeals.find((a) => a.id === b.dataset.appeal);
          modal({
            title: 'Review appeal',
            body: `<p>${escapeHtml(appeal.message)}</p>
              <div class="form-group" style="margin-top:12px"><label class="form-label" for="appealResolution">Resolution note</label><textarea class="form-textarea" id="appealResolution" rows="3"></textarea></div>`,
            footer: `<button class="btn btn-secondary" data-modal-close="1">Close</button>
              <button class="btn btn-danger" id="upholdAppeal">Uphold decision</button>
              <button class="btn btn-primary" id="overturnAppeal">Overturn</button>`,
            onMount(root) {
              const resolve = async (decision) => {
                try {
                  await api(`/api/guilds/${guildId}/appeals/${appeal.id}/resolve`, {
                    method: 'POST',
                    body: { decision, resolution: root.querySelector('#appealResolution').value }
                  });
                  closeModal();
                  toast(`Appeal ${decision}.`, 'success');
                  audit = null;
                  renderManage();
                } catch (err) {
                  toast(err.message, 'error');
                }
              };
              root.querySelector('#upholdAppeal').addEventListener('click', () => resolve('upheld'));
              root.querySelector('#overturnAppeal').addEventListener('click', () => resolve('overturned'));
            }
          });
        })
      );
    }

    if (!['announcements', 'discussion', 'events', 'members', 'manage'].includes(activeTab)) activeTab = 'announcements';
    renderTab();
  }

  window.RRGuildHub = { renderGuildHub };
})();
