/* RideRise LK — Guild live map (Phase 2): consent-first, approximate-by-default,
 * ephemeral location sharing. No history is stored or displayed. */
(function () {
  'use strict';

  const { api, state, escapeHtml, toast, avatar, emptyState, errorState, onRouteCleanup, skeletonList } = window.RR;

  const DURATIONS = [5, 10, 15, 30];

  function geoError(err) {
    if (!err) return 'Location is unavailable right now.';
    if (err.code === 1) {
      return 'Location permission was denied. Open Android Settings → Apps → RideRise LK → Permissions → Location, allow it, then try again.';
    }
    if (err.code === 2) return 'Your device could not get a GPS fix. Move outdoors or near a window and try again.';
    if (err.code === 3) return 'Getting your location timed out. Check that device location is switched on, then retry.';
    return err.message || 'Location is unavailable.';
  }

  function getPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('This device does not provide location services to the app.'));
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: false, // battery-conscious: network/cell fix is enough for an approximate area
        timeout: 15000,
        maximumAge: 45000
      });
    });
  }

  function secondsLabel(s) {
    const total = Math.max(0, Number(s) || 0);
    const m = Math.floor(total / 60);
    const sec = total % 60;
    return `${m}:${String(sec).padStart(2, '0')}`;
  }

  function markerFor(member) {
    const initials = (member.display_name || member.username || 'R')
      .replace(/[^A-Za-z\u0D80-\u0DFF\u0B80-\u0BFF ]/g, '')
      .trim()
      .slice(0, 2)
      .toUpperCase();
    return {
      id: member.user_id,
      lat: member.lat,
      lng: member.lng,
      radius: member.radius_m,
      label: member.display_name || member.username,
      subtitle: member.precision_mode === 'precise' ? 'Precise share' : `~${Math.round(member.radius_m)} m area`,
      avatar: member.avatar_url && !member.avatar_url.includes('riderise_logo') ? member.avatar_url : '',
      initials: initials || 'R',
      isSelf: state.account && member.user_id === state.account.id
    };
  }

  async function renderGuildMap(viewport, guildId) {
    if (!state.token) {
      location.hash = '#/welcome';
      return;
    }
    viewport.innerHTML = `<div class="skeleton" style="height:160px"></div><div class="skeleton"></div>`;
    let snapshot;
    try {
      snapshot = await api(`/api/guilds/${guildId}/live`);
    } catch (err) {
      viewport.innerHTML = `<div class="section-head"><div><h2>Guild map</h2></div></div>${errorState(err)}`;
      return;
    }

    const isManager = (snapshot.members.find((m) => m.user_id === (state.account && state.account.id)) || {}).role;
    const canManage = ['owner', 'moderator'].includes(isManager) || (state.account && state.account.role === 'admin');
    let sharing = Boolean(snapshot.my_session);
    let pingTimer = null;
    let tickTimer = null;
    let remaining = snapshot.my_session ? snapshot.my_session.seconds_remaining : 0;
    let map = null;
    let stopped = false;

    viewport.innerHTML = `
      <div class="section-head">
        <div>
          <button class="btn btn-secondary btn-sm" id="backToGuild" style="margin-bottom:8px">← ${escapeHtml(snapshot.guild.name)}</button>
          <h2>Live guild map</h2>
          <p class="muted">Consenting members of ${escapeHtml(snapshot.guild.name)} only. Sharing is off until you start it, and nothing is kept afterwards.</p>
        </div>
        <button class="btn btn-secondary btn-sm" id="refreshMap">↻ Refresh</button>
      </div>

      <div class="privacy-banner" role="note">
        <span class="privacy-icon" aria-hidden="true">🛡️</span>
        <div>
          <strong>Location privacy on RideRise LK</strong>
          <p>${escapeHtml(snapshot.retention)} Riders aged 16–17 always share an approximate area (~${snapshot.limits.minor_radius_m} m) and can never enable precise sharing. Blocked riders never see each other.</p>
        </div>
      </div>

      <div class="live-grid">
        <section class="card live-controls" aria-label="Location sharing controls">
          <h3>Share my live location</h3>
          <div id="shareState" class="live-state"></div>
          <label class="check-row" for="consentToggle" style="margin-top:10px">
            <input type="checkbox" id="consentToggle" ${snapshot.my_consent.allowed ? 'checked' : ''} />
            <span>I understand that current members of this guild will see my approximate riding area while I am sharing.</span>
          </label>
          <div class="form-group" style="margin-top:12px">
            <label class="form-label" for="shareDuration">Sharing session length</label>
            <select class="form-select" id="shareDuration">
              ${DURATIONS.map((d) => `<option value="${d}" ${d === 15 ? 'selected' : ''}>${d} minutes</option>`).join('')}
            </select>
            <div class="hint">Sharing stops automatically when the timer ends, when you stop it, when you leave this screen, or when you sign out.</div>
          </div>
          ${snapshot.viewer.is_minor
            ? '<div class="callout callout-warn" style="margin-bottom:10px"><strong>Riders aged 16–17:</strong> only an approximate 1.5 km area is ever shown. Precise sharing is disabled for your account.</div>'
            : `<label class="check-row" for="precisionToggle" style="margin-bottom:10px">
                 <input type="checkbox" id="precisionToggle" ${snapshot.my_consent.precision_allowed ? 'checked' : ''} />
                 <span>Allow a short <strong>precise</strong> share option (max 10 minutes, one session at a time). Use only when you deliberately want to be found, e.g. at a meet-up point.</span>
               </label>`}
          <div class="live-actions">
            <button class="btn btn-primary" id="startShare">Start sharing</button>
            <button class="btn btn-danger" id="stopShare" ${sharing ? '' : 'hidden'}>Stop sharing now</button>
          </div>
          <p class="hint" id="liveError" role="alert" style="color:var(--danger-red);margin-top:8px"></p>
        </section>

        <section class="live-map-wrap" aria-label="Map of sharing guild members">
          <div id="guildMap" class="live-map" role="application" aria-label="Interactive guild map. Use the zoom and recentre buttons to explore."></div>
          <div class="live-map-legend">
            <span><i class="legend-dot self"></i> You</span>
            <span><i class="legend-dot member"></i> Sharing member</span>
            <span><i class="legend-ring"></i> Approximate area</span>
            <span class="legend-attr">${escapeHtml(snapshot.map.attribution)}</span>
          </div>
          ${snapshot.map.configured
            ? ''
            : `<div class="callout callout-warn" style="margin-top:10px">Map provider <code>${escapeHtml(snapshot.map.provider)}</code> needs an API key on the server (<code>MAP_API_KEY</code>). ${escapeHtml(snapshot.map.billing_note)}</div>`}
        </section>
      </div>

      <section class="card">
        <div class="section-head" style="margin-bottom:8px">
          <div>
            <h3 style="margin:0">Guild members</h3>
            <p class="muted" style="font-size:.82rem">Only sharing members have a map marker. Online status respects each member's activity setting.</p>
          </div>
          <span class="pill-badge pill-cyan" id="sharingCount">0 sharing</span>
        </div>
        <div id="memberRows" class="live-member-list">${skeletonList(3)}</div>
      </section>`;

    viewport.querySelector('#backToGuild').addEventListener('click', () => (location.hash = `#/guild/${guildId}`));

    const errorEl = viewport.querySelector('#liveError');
    const startBtn = viewport.querySelector('#startShare');
    const stopBtn = viewport.querySelector('#stopShare');
    const consentBox = viewport.querySelector('#consentToggle');
    const precisionBox = viewport.querySelector('#precisionToggle');

    map = new window.RRMap(viewport.querySelector('#guildMap'), {
      tileUrl: snapshot.map.tile_url,
      attribution: snapshot.map.attribution,
      maxZoom: snapshot.map.max_zoom,
      zoom: 14,
      center: { lat: 6.9271, lng: 79.8612 }
    });

    function paint(data) {
      const mine = data.sharing_members.find((m) => state.account && m.user_id === state.account.id);
      if (mine && !sharing) {
        /* server is authoritative: adopt it */
      }
      map.setMarkers(data.sharing_members.map(markerFor));
      if (data.sharing_members.length) map.fitMarkers();
      viewport.querySelector('#sharingCount').textContent = `${data.sharing_members.length} sharing`;
      viewport.querySelector('#memberRows').innerHTML = data.members.length
        ? data.members
            .map((m) => {
              const badge =
                m.state === 'sharing'
                  ? '<span class="pill-badge pill-green">Sharing</span>'
                  : m.state === 'online'
                  ? '<span class="pill-badge pill-cyan">Online · not sharing</span>'
                  : '<span class="pill-badge">Offline</span>';
              const revoke =
                canManage && m.state === 'sharing'
                  ? `<button class="btn btn-secondary btn-sm" data-revoke="${escapeHtml(m.user_id)}">Stop share</button>`
                  : '';
              return `<div class="live-member">
                ${avatar(m.avatar_url, m.display_name, 38)}
                <div class="live-member-text">
                  <strong>${escapeHtml(m.display_name)} ${m.is_minor ? '<span class="pill-badge pill-orange">16–17</span>' : ''}</strong>
                  <small>@${escapeHtml(m.username)} · ${escapeHtml(m.role)}${m.activity_visible ? '' : ' · activity hidden'}</small>
                </div>
                ${badge}
                ${revoke}
              </div>`;
            })
            .join('')
        : emptyState({ icon: '👥', title: 'No members to show', body: 'Members who have hidden their activity or blocked you are not listed.' });

      viewport.querySelectorAll('[data-revoke]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          if (!window.confirm('Stop this member’s live location sharing? They will be notified.')) return;
          try {
            await api(`/api/guilds/${guildId}/live/revoke`, { method: 'POST', body: { user_id: btn.dataset.revoke } });
            toast('Sharing stopped for that member.', 'success');
            await load();
          } catch (err) {
            toast(err.message, 'error');
          }
        })
      );
    }

    function paintShareState() {
      const shareStateEl = viewport.querySelector('#shareState');
      startBtn.hidden = sharing;
      stopBtn.hidden = !sharing;
      if (sharing) {
        shareStateEl.innerHTML = `<span class="pill-badge pill-green">Sharing now</span> <strong id="countdown">${secondsLabel(
          remaining
        )}</strong> remaining`;
      } else {
        shareStateEl.innerHTML = '<span class="pill-badge">Not sharing</span> Your position is not on the guild map.';
      }
    }

    async function load() {
      try {
        const data = await api(`/api/guilds/${guildId}/live`);
        sharing = Boolean(data.my_session);
        remaining = data.my_session ? data.my_session.seconds_remaining : 0;
        paint(data);
        paintShareState();
      } catch (err) {
        toast(err.message, 'error');
      }
    }

    async function recordConsent(allowed) {
      return api(`/api/guilds/${guildId}/live/consent`, {
        method: 'POST',
        body: { allowed, precision_allowed: precisionBox ? precisionBox.checked : false }
      });
    }

    function stopPings() {
      if (pingTimer) clearInterval(pingTimer);
      if (tickTimer) clearInterval(tickTimer);
      pingTimer = null;
      tickTimer = null;
    }

    async function stopSharing(reason) {
      stopPings();
      sharing = false;
      remaining = 0;
      paintShareState();
      try {
        await api(`/api/guilds/${guildId}/live/stop`, { method: 'POST' });
      } catch (e) {
        /* server lease still expires */
      }
      if (reason) toast(reason, 'info');
      await load();
    }

    function startTicking() {
      stopPings();
      tickTimer = setInterval(() => {
        remaining = Math.max(0, remaining - 1);
        const el = viewport.querySelector('#countdown');
        if (el) el.textContent = secondsLabel(remaining);
        if (remaining <= 0) stopSharing('Sharing time ended. Your location was removed from the map.');
      }, 1000);

      pingTimer = setInterval(async () => {
        if (!sharing || document.hidden || stopped) return;
        try {
          const pos = await getPosition();
          const res = await api(`/api/guilds/${guildId}/live/ping`, {
            method: 'POST',
            body: { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy_m: pos.coords.accuracy }
          });
          remaining = res.seconds_remaining || remaining;
          await load();
        } catch (err) {
          if (err.code === 1 || err.status === 409) {
            errorEl.textContent = err.message || geoError(err);
            if (err.status === 409) stopSharing('Sharing session ended on the server.');
          }
        }
      }, 45000);
    }

    startBtn.addEventListener('click', async () => {
      errorEl.textContent = '';
      if (!consentBox.checked) {
        errorEl.textContent = 'Tick the consent box first so you know exactly who can see your location.';
        return;
      }
      startBtn.disabled = true;
      startBtn.textContent = 'Getting your location…';
      try {
        const wantsPrecise = Boolean(precisionBox && precisionBox.checked && !snapshot.viewer.is_minor);
        await recordConsent(true);
        const pos = await getPosition();
        const minutes = Number(viewport.querySelector('#shareDuration').value) || 15;
        const res = await api(`/api/guilds/${guildId}/live/start`, {
          method: 'POST',
          body: {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy_m: pos.coords.accuracy,
            duration_minutes: minutes,
            precision: wantsPrecise ? 'precise' : 'approximate'
          }
        });
        sharing = true;
        remaining = res.session.seconds_remaining;
        paintShareState();
        paint(res.snapshot);
        startTicking();
        toast(`Sharing for ${minutes} minutes. Stop any time.`, 'success');
      } catch (err) {
        errorEl.textContent =
          err && (err.code === 1 || err.code === 2 || err.code === 3)
            ? geoError(err)
            : err.message || 'Could not start sharing.';
      } finally {
        startBtn.disabled = false;
        startBtn.textContent = 'Start sharing';
      }
    });

    stopBtn.addEventListener('click', () => stopSharing('Location sharing stopped. You were removed from the map.'));

    consentBox.addEventListener('change', async () => {
      try {
        const res = await recordConsent(consentBox.checked);
        if (!consentBox.checked) {
          sharing = false;
          stopPings();
          paintShareState();
        }
        toast(res.message, 'info');
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    if (precisionBox) {
      precisionBox.addEventListener('change', async () => {
        try {
          await recordConsent(consentBox.checked);
          toast(
            precisionBox.checked
              ? 'Precise option enabled for short deliberate sessions. Approximate is still the default.'
              : 'Precise option disabled. Approximate area sharing only.',
            'info'
          );
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    }

    viewport.querySelector('#refreshMap').addEventListener('click', async () => {
      await load();
      toast('Guild map refreshed.', 'info', 1800);
    });

    // Manual refresh keeps the map honest even if realtime is unavailable.
    const autoRefresh = setInterval(() => {
      if (!document.hidden) load();
    }, 20000);

    paint(snapshot);
    paintShareState();
    if (sharing) startTicking();

    onRouteCleanup(() => {
      stopped = true;
      stopPings();
      clearInterval(autoRefresh);
      if (sharing) {
        // Leaving the screen is an explicit stop: never keep broadcasting silently.
        api(`/api/guilds/${guildId}/live/stop`, { method: 'POST' }).catch(() => {});
      }
      if (map) map.destroy();
    });

    window.addEventListener(
      'pagehide',
      () => {
        if (sharing) {
          fetch(`${state.apiBase}/api/guilds/${guildId}/live/stop`, {
            method: 'POST',
            keepalive: true,
            headers: { Authorization: `Bearer ${state.token}` }
          }).catch(() => {});
        }
      },
      { once: true }
    );
  }

  window.RRLive = { renderGuildMap };
})();
