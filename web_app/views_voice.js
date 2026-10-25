/* RideRise LK — Guild voice rooms and walkie-talkie push-to-talk (Phase 2).
 * Real WebRTC audio between devices. The microphone is never opened without an
 * explicit tap, and every screen shows whether it is live. Nothing is recorded.
 */
(function () {
  'use strict';

  const { api, state, escapeHtml, toast, avatar, emptyState, errorState, modal, closeModal, onRouteCleanup, timeAgo } =
    window.RR;

  const STATUS_LABEL = {
    idle: 'Ready',
    'requesting-mic': 'Waiting for microphone permission…',
    'mic-denied': 'Microphone permission denied',
    connecting: 'Connecting…',
    connected: 'Connected',
    transmitting: 'Transmitting',
    disconnected: 'Disconnected',
    unauthorised: 'Access removed',
    closed: 'Left the room'
  };

  async function renderGuildVoice(viewport, guildId) {
    if (!state.token) {
      location.hash = '#/welcome';
      return;
    }
    viewport.innerHTML = `<div class="skeleton" style="height:120px"></div><div class="skeleton"></div>`;
    let data;
    try {
      data = await api(`/api/guilds/${guildId}/voice`);
    } catch (err) {
      viewport.innerHTML = `<div class="section-head"><div><h2>Guild voice</h2></div></div>${errorState(err)}`;
      return;
    }

    const iceNote = data.ice.turn_available
      ? '<span class="pill-badge pill-green">TURN relay configured</span> Calls should work across mobile carriers.'
      : '<span class="pill-badge pill-orange">No TURN relay</span> Peer-to-peer audio works on many networks but can fail on strict carrier NAT. See docs/PHASE2_VOICE_AND_MAP.md.';

    viewport.innerHTML = `
      <div class="section-head">
        <div>
          <button class="btn btn-secondary btn-sm" id="backToGuild" style="margin-bottom:8px">← ${escapeHtml(data.guild.name)}</button>
          <h2>Voice &amp; walkie-talkie</h2>
          <p class="muted">Live audio for current guild members only. Nothing is recorded, and your microphone stays closed until you choose to speak.</p>
        </div>
      </div>

      <div class="callout ${data.ice.turn_available ? '' : 'callout-warn'}" style="display:flex;gap:10px;align-items:flex-start;flex-wrap:wrap">
        <div style="flex:1;min-width:240px"><strong>Connection readiness:</strong> ${iceNote}</div>
      </div>

      <div class="voice-grid">
        <section class="card">
          <h3>Group voice rooms</h3>
          <p class="muted" style="font-size:.84rem">Always-on conversation. You join muted; tap “Unmute mic” when you want to speak.</p>
          <div class="voice-room-list">
            ${
              data.rooms.filter((r) => r.kind === 'group').length
                ? data.rooms
                    .filter((r) => r.kind === 'group')
                    .map(
                      (r) => `<div class="voice-room-row">
                        <div class="voice-room-icon" aria-hidden="true">🎙️</div>
                        <div class="voice-room-text">
                          <strong>${escapeHtml(r.name)}</strong>
                          <small>${r.is_active ? `${r.participant_count} in room` : 'Closed by guild managers'} · limit ${r.max_participants}</small>
                        </div>
                        <button class="btn ${r.is_active ? 'btn-primary' : 'btn-secondary'} btn-sm" data-join-room="${escapeHtml(
                          r.id
                        )}" data-kind="group" ${r.is_active ? '' : 'disabled'}>${r.is_active ? 'Open room' : 'Closed'}</button>
                      </div>`
                    )
                    .join('')
                : '<p class="muted" style="font-size:.85rem">No group rooms yet. A guild manager can create one.</p>'
            }
          </div>
        </section>

        <section class="card">
          <h3>Walkie-talkie channels</h3>
          <p class="muted" style="font-size:.84rem">Push to talk: one rider transmits at a time, and the channel is held for a limited time so a stuck button cannot block everyone.</p>
          <div class="voice-room-list">
            ${
              data.rooms.filter((r) => r.kind === 'walkie').length
                ? data.rooms
                    .filter((r) => r.kind === 'walkie')
                    .map(
                      (r) => `<div class="voice-room-row">
                        <div class="voice-room-icon" aria-hidden="true">📻</div>
                        <div class="voice-room-text">
                          <strong>${escapeHtml(r.name)}</strong>
                          <small>${r.is_active ? `${r.participant_count} listening` : 'Closed'} · ${escapeHtml(r.min_role)}+ · PTT ${
                            r.max_transmission_seconds
                          }s</small>
                        </div>
                        <button class="btn ${r.is_active ? 'btn-safety' : 'btn-secondary'} btn-sm" data-join-room="${escapeHtml(
                          r.id
                        )}" data-kind="walkie" ${r.is_active ? '' : 'disabled'}>${r.is_active ? 'Enter channel' : 'Closed'}</button>
                      </div>`
                    )
                    .join('')
                : '<p class="muted" style="font-size:.85rem">No walkie channels yet.</p>'
            }
          </div>
        </section>
      </div>

      <div class="callout" style="margin-top:14px">
        <strong>What is shared:</strong> while connected, guild members in the room can hear your microphone when you transmit or unmute. RideRise LK does not record, transcribe or store conversations. If recording is ever introduced it will be announced in-app before the microphone opens.
      </div>`;

    viewport.querySelector('#backToGuild').addEventListener('click', () => (location.hash = `#/guild/${guildId}`));
    viewport.querySelectorAll('[data-join-room]').forEach((btn) =>
      btn.addEventListener('click', () => {
        location.hash = `#/guild/${guildId}/voice/${btn.dataset.joinRoom}`;
      })
    );
  }

  function reportModal(roomId, participant) {
    modal({
      title: `Report ${participant.display_name}`,
      body: `
        <p class="muted" style="font-size:.86rem;margin-bottom:12px">Voice reports are prioritised for human review. RideRise LK does not record audio, so include what was said and when.</p>
        <div class="form-group">
          <label class="form-label" for="voiceReportReason">Reason</label>
          <select class="form-select" id="voiceReportReason">
            <option value="bullying_harassment">Bullying / harassment</option>
            <option value="threats_violence">Threats / violence</option>
            <option value="unwanted_sexual_content">Unwanted sexual content</option>
            <option value="impersonation">Impersonation</option>
            <option value="suspicious_pii_request">Asking for personal information</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="voiceReportDetails">What happened?</label>
          <textarea class="form-textarea" id="voiceReportDetails" rows="4" placeholder="Describe the behaviour and approximate time."></textarea>
        </div>`,
      footer: `<button class="btn btn-secondary" data-modal-close="1">Cancel</button><button class="btn btn-danger" id="sendVoiceReport">Send report</button>`,
      onMount(root) {
        root.querySelector('#sendVoiceReport').addEventListener('click', async (e) => {
          e.target.disabled = true;
          try {
            const res = await api(`/api/voice/rooms/${roomId}/report`, {
              method: 'POST',
              body: {
                target_user_id: participant.user_id,
                reason: root.querySelector('#voiceReportReason').value,
                details: root.querySelector('#voiceReportDetails').value
              }
            });
            closeModal();
            toast(res.message, 'success');
          } catch (err) {
            toast(err.message, 'error');
            e.target.disabled = false;
          }
        });
      }
    });
  }

  async function renderVoiceRoom(viewport, guildId, roomId) {
    if (!state.token) {
      location.hash = '#/welcome';
      return;
    }
    viewport.innerHTML = `<div class="skeleton" style="height:120px"></div><div class="skeleton"></div>`;
    let stateData;
    try {
      stateData = await api(`/api/voice/rooms/${roomId}/state`);
    } catch (err) {
      viewport.innerHTML = `<div class="section-head"><div><h2>Voice room</h2></div></div>${errorState(err)}`;
      return;
    }
    const room = stateData.room;
    const kind = room.kind;
    const isWalkie = kind === 'walkie';
    let engine = null;
    let joined = false;
    let selfMuted = true;
    let micLive = false;
    let floor = null;
    let participants = stateData.participants;
    let status = 'idle';
    let level = 0;
    let statusTimer = null;

    viewport.innerHTML = `
      <div class="section-head">
        <div>
          <button class="btn btn-secondary btn-sm" id="backToVoice" style="margin-bottom:8px">← Voice rooms</button>
          <h2>${escapeHtml(room.name)}</h2>
          <p class="muted">${isWalkie
            ? 'Push-to-talk channel. Hold the button to speak; releasing immediately stops transmission.'
            : 'Group voice room. Join muted, then unmute when you want to speak.'}
            ${escapeHtml(room.min_role)}+ · up to ${room.max_participants} participants</p>
        </div>
        <span class="pill-badge ${isWalkie ? 'pill-orange' : 'pill-cyan'}">${isWalkie ? 'Walkie-talkie' : 'Group voice'}</span>
      </div>

      <div id="voiceStage" class="voice-stage">
        <div class="voice-lobby card">
          <div class="voice-lobby-icon" aria-hidden="true">${isWalkie ? '📻' : '🎙️'}</div>
          <h3>${joined ? 'Connected' : 'Join this room?'}</h3>
          <p class="muted" style="font-size:.88rem">Joining asks Android for microphone permission and connects live audio with the ${participants.length} rider${
            participants.length === 1 ? '' : 's'
          } already here. Nothing is recorded.</p>
          <div class="voice-preflight">
            <div class="preflight-row"><span>Guild membership</span><strong class="ok">Verified</strong></div>
            <div class="preflight-row"><span>Microphone</span><strong id="micStatus">Not opened</strong></div>
            <div class="preflight-row"><span>Relay</span><strong>${stateData.ice.turn_available ? 'TURN configured' : 'STUN only'}</strong></div>
            <div class="preflight-row"><span>Recording</span><strong>Off</strong></div>
          </div>
          <div class="voice-actions">
            <button class="btn btn-primary" id="joinVoice">Join with microphone</button>
            <button class="btn btn-secondary" id="joinListenOnly">Join listen-only</button>
          </div>
          <p class="hint" id="voiceError" role="alert" style="color:var(--danger-red)"></p>
        </div>

        <div class="voice-live" hidden>
          <div class="voice-live-head">
            <div class="voice-status-line">
              <span class="voice-dot" aria-hidden="true"></span>
              <span id="voiceStatusText">Connected</span>
              <span class="pill-badge" id="micIndicator">Mic closed</span>
            </div>
            <div class="voice-live-actions">
              <button class="btn btn-secondary btn-sm" id="toggleMute">Unmute mic</button>
              <button class="btn btn-secondary btn-sm" id="routeBtn" title="Switch audio route where supported">🔊 Speaker</button>
              <button class="btn btn-danger btn-sm" id="leaveVoice">Leave</button>
            </div>
          </div>

          ${
            isWalkie
              ? `<div class="ptt-panel">
                   <div class="ptt-channel">CHANNEL · ${escapeHtml(room.name.replace(/^Walkie · /, ''))}</div>
                   <button class="ptt-button" id="pttButton" aria-label="Hold to talk" aria-pressed="false">
                     <span class="ptt-ripple" aria-hidden="true"></span>
                     <span class="ptt-icon" aria-hidden="true">🎙️</span>
                     <span class="ptt-label">HOLD TO TALK</span>
                     <span class="ptt-sub">Release to stop</span>
                   </button>
                   <div class="ptt-floor" id="pttFloor">Channel idle — hold the button to transmit.</div>
                   <div class="ptt-meter" aria-hidden="true"><div class="ptt-meter-fill" id="pttMeter"></div></div>
                   <p class="hint">Transmissions are limited to ${room.max_transmission_seconds}s and the channel is released automatically. Only one rider can transmit at a time.</p>
                 </div>`
              : `<div class="voice-participants" id="voiceParticipants"></div>`
          }

          <div class="voice-participant-grid" id="voiceParticipantGrid"></div>
          <div class="callout callout-warn" style="margin-top:12px" id="networkNote" hidden></div>
        </div>
      </div>`;

    const errorEl = viewport.querySelector('#voiceError');
    const stage = viewport.querySelector('#voiceStage');
    const livePane = viewport.querySelector('.voice-live');
    const lobby = viewport.querySelector('.voice-lobby');

    function paintParticipants() {
      const host = viewport.querySelector('#voiceParticipantGrid');
      if (!host) return;
      host.innerHTML = participants.length
        ? participants
            .map(
              (p) => `<div class="voice-participant ${p.is_self ? 'is-self' : ''}">
                ${avatar(p.avatar_url, p.display_name, 46)}
                <span class="voice-participant-name">${escapeHtml(p.display_name)}${p.is_self ? ' (you)' : ''}</span>
                <span class="voice-participant-state">${
                  floor && floor.holder_id === p.user_id
                    ? '<span class="pill-badge pill-orange">Transmitting</span>'
                    : p.self_muted
                    ? '<span class="pill-badge">Muted</span>'
                    : '<span class="pill-badge pill-green">Live</span>'
                }</span>
                ${
                  p.is_self
                    ? ''
                    : `<span class="voice-participant-actions">
                        <button class="icon-btn" title="Report" aria-label="Report ${escapeHtml(p.display_name)}" data-report="${escapeHtml(
                          p.user_id
                        )}">⚑</button>
                        <button class="icon-btn" title="Block" aria-label="Block ${escapeHtml(p.display_name)}" data-block="${escapeHtml(
                          p.user_id
                        )}">⛔</button>
                      </span>`
                }
              </div>`
            )
            .join('')
        : '<p class="muted">No one else is here yet. Share the channel with your guild.</p>';

      host.querySelectorAll('[data-report]').forEach((btn) =>
        btn.addEventListener('click', () => {
          const p = participants.find((x) => x.user_id === btn.dataset.report);
          if (p) reportModal(roomId, p);
        })
      );
      host.querySelectorAll('[data-block]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          const p = participants.find((x) => x.user_id === btn.dataset.block);
          if (!p) return;
          if (!window.confirm(`Block ${p.display_name}? You will no longer hear each other.`)) return;
          try {
            const res = await api(`/api/voice/rooms/${roomId}/block`, { method: 'POST', body: { target_user_id: p.user_id } });
            toast(res.message, 'success');
            if (engine) engine.close();
            location.hash = `#/guild/${guildId}/voice`;
          } catch (err) {
            toast(err.message, 'error');
          }
        })
      );
    }

    function paintStatus(next) {
      status = next || status;
      const text = viewport.querySelector('#voiceStatusText');
      if (text) text.textContent = STATUS_LABEL[status] || status;
      const mic = viewport.querySelector('#micIndicator');
      if (mic) {
        mic.textContent = micLive ? 'Mic LIVE' : 'Mic closed';
        mic.className = `pill-badge ${micLive ? 'pill-red' : ''}`;
      }
      const live = viewport.querySelector('.voice-live');
      if (live) live.classList.toggle('is-transmitting', Boolean(floor && floor.is_self) || status === 'transmitting');
      const note = viewport.querySelector('#networkNote');
      if (note) {
        const offline = navigator.onLine === false;
        note.hidden = !offline;
        if (offline) note.innerHTML = '<strong>You are offline.</strong> Audio will resume when the connection returns; if not, leave and rejoin.';
      }
    }

    function paintFloor(nextFloor) {
      floor = nextFloor;
      const el = viewport.querySelector('#pttFloor');
      if (el) {
        if (!floor) el.textContent = 'Channel idle — hold the button to transmit.';
        else if (floor.is_self || (state.account && floor.holder_id === state.account.id)) el.innerHTML = '<strong>You are transmitting…</strong>';
        else {
          const speaker = participants.find((p) => p.user_id === floor.holder_id);
          el.innerHTML = `<strong>${escapeHtml(speaker ? speaker.display_name : 'Another rider')} is transmitting…</strong>`;
        }
      }
      const btn = viewport.querySelector('#pttButton');
      if (btn) {
        const mine = Boolean(floor && (floor.is_self || (state.account && floor.holder_id === state.account.id)));
        btn.classList.toggle('is-transmitting', mine);
        btn.setAttribute('aria-pressed', mine ? 'true' : 'false');
      }
      paintParticipants();
    }

    async function begin(listenOnly) {
      errorEl.textContent = '';
      const joinBtn = viewport.querySelector('#joinVoice');
      const listenBtn = viewport.querySelector('#joinListenOnly');
      joinBtn.disabled = true;
      listenBtn.disabled = true;
      statusTimer = setInterval(() => paintStatus(), 800);
      try {
        engine = new window.RRVoiceEngine({
          roomId,
          kind,
          onState(update) {
            if (update.local_state) paintStatus(update.local_state);
            if (update.participants) {
              participants = update.participants;
              paintParticipants();
            }
            if (update.floor !== undefined) paintFloor(update.floor);
            if (update.room) {
              /* room metadata updates */
            }
            if (update.peer_state && update.peer_state.state === 'failed') {
              toast('A participant connection dropped. Attempting to reconnect…', 'error');
            }
          },
          onError(message) {
            errorEl.textContent = message;
            toast(message, 'error', 6000);
          },
          onFloor(nextFloor) {
            paintFloor(nextFloor);
          },
          onLevel(value) {
            level = value;
            const meter = viewport.querySelector('#pttMeter');
            if (meter) meter.style.width = `${Math.round(value * 100)}%`;
          }
        });

        if (listenOnly) {
          // Listen-only still needs the room membership but must not request the mic.
          await api(`/api/voice/rooms/${roomId}/join`, { method: 'POST' });
          const latest = await api(`/api/voice/rooms/${roomId}/state`);
          participants = latest.participants;
          joined = true;
          lobby.hidden = true;
          livePane.hidden = false;
          paintParticipants();
          paintStatus('connected');
          paintFloor(latest.floor || null);
          toast('Joined listen-only. Your microphone was not opened.', 'info', 5000);
          const muteBtn = viewport.querySelector('#toggleMute');
          muteBtn.disabled = true;
          muteBtn.textContent = 'Listen only';
          const ptt = viewport.querySelector('#pttButton');
          if (ptt) {
            ptt.disabled = true;
            ptt.querySelector('.ptt-label').textContent = 'LISTEN ONLY';
          }
          engine.localStream = null;
          engine.micTrack = null;
          onRouteCleanup(() => {
            api(`/api/voice/rooms/${roomId}/leave`, { method: 'POST' }).catch(() => {});
            if (statusTimer) clearInterval(statusTimer);
          });
          return;
        }

        await engine.join();
        joined = true;
        selfMuted = true;
        micLive = false;
        lobby.hidden = true;
        livePane.hidden = false;
        viewport.querySelector('#micStatus').textContent = 'Open (muted)';
        paintParticipants();
        paintStatus('connected');
        toast('Connected. Your microphone is open but muted until you speak.', 'success');
      } catch (err) {
        errorEl.textContent = err.message || 'Could not join the room.';
        if (statusTimer) clearInterval(statusTimer);
        if (engine) engine.close();
        joinBtn.disabled = false;
        listenBtn.disabled = false;
      }
    }

    viewport.querySelector('#joinVoice').addEventListener('click', () => begin(false));
    viewport.querySelector('#joinListenOnly').addEventListener('click', () => begin(true));
    viewport.querySelector('#backToVoice').addEventListener('click', () => (location.hash = `#/guild/${guildId}/voice`));

    viewport.querySelector('#toggleMute').addEventListener('click', async (e) => {
      if (!engine || !joined) return;
      selfMuted = !selfMuted;
      await engine.setMuted(selfMuted);
      micLive = !selfMuted && !isWalkie;
      e.target.textContent = selfMuted ? 'Unmute mic' : 'Mute mic';
      e.target.classList.toggle('btn-primary', !selfMuted);
      paintStatus();
      paintParticipants();
    });

    viewport.querySelector('#routeBtn').addEventListener('click', async (e) => {
      if (!engine) return;
      // Cycle speaker → earpiece → Bluetooth headset (native shell only).
      const cycle = ['speaker', 'earpiece', 'bluetooth'];
      const current = e.target.dataset.route || 'speaker';
      const next = cycle[(cycle.indexOf(current) + 1) % cycle.length];
      e.target.dataset.route = next;
      await engine.setAudioRoute(next);
      e.target.textContent = next === 'speaker' ? '🔊 Speaker' : next === 'earpiece' ? '📞 Earpiece' : '🎧 Bluetooth';
      toast(
        next === 'speaker'
          ? 'Speaker route preferred.'
          : next === 'earpiece'
          ? 'Earpiece route preferred where supported by the device.'
          : window.RRAndroid
          ? 'Bluetooth route requested. Pair a headset first, otherwise audio stays on the phone.'
          : 'Bluetooth routing needs the Android app; the browser uses your system audio route.',
        'info',
        3200
      );
    });

    viewport.querySelector('#leaveVoice').addEventListener('click', async () => {
      if (engine) {
        await engine.leave();
        engine = null;
      }
      if (statusTimer) clearInterval(statusTimer);
      toast('Left the room. Microphone released.', 'info');
      location.hash = `#/guild/${guildId}/voice`;
    });

    // Push-to-talk: press and hold. Pointer + touch + keyboard support.
    const ptt = viewport.querySelector('#pttButton');
    if (ptt) {
      let pressing = false;
      const startTx = async (ev) => {
        if (ev) ev.preventDefault();
        if (!engine || !joined || pressing) return;
        if (engine.micTrack === null || (engine.localStream === null && joined)) {
          errorEl.textContent = 'You joined listen-only. Leave and rejoin with the microphone to transmit.';
          return;
        }
        pressing = true;
        ptt.classList.add('is-holding');
        const granted = await engine.startTransmitting();
        if (!granted) {
          pressing = false;
          ptt.classList.remove('is-holding');
          return;
        }
        micLive = true;
        paintStatus('transmitting');
        if (statusTimer) clearInterval(statusTimer);
        statusTimer = setInterval(() => {
          paintStatus(engine && engine.transmitting ? 'transmitting' : 'connected');
          paintStatus();
        }, 500);
        // Hard client-side guard mirroring the server lease.
        clearTimeout(viewport._pttGuard);
        viewport._pttGuard = setTimeout(() => stopTx(), (room.max_transmission_seconds + 2) * 1000);
      };
      const stopTx = async () => {
        if (!pressing) return;
        pressing = false;
        ptt.classList.remove('is-holding');
        micLive = false;
        clearTimeout(viewport._pttGuard);
        if (engine) await engine.stopTransmitting();
        paintStatus('connected');
      };

      ptt.addEventListener('pointerdown', startTx);
      ptt.addEventListener('pointerup', stopTx);
      ptt.addEventListener('pointercancel', stopTx);
      ptt.addEventListener('pointerleave', () => {
        if (pressing) stopTx();
      });
      ptt.addEventListener('keydown', (ev) => {
        if (ev.key === ' ' || ev.key === 'Enter') startTx(ev);
      });
      ptt.addEventListener('keyup', (ev) => {
        if (ev.key === ' ' || ev.key === 'Enter') stopTx();
      });
      ptt.addEventListener('contextmenu', (ev) => ev.preventDefault());
      document.addEventListener('visibilitychange', () => {
        if (document.hidden && pressing) stopTx();
      });
    }

    window.addEventListener('offline', () => paintStatus(status));
    window.addEventListener('online', () => paintStatus(status));

    onRouteCleanup(() => {
      if (statusTimer) clearInterval(statusTimer);
      if (engine) {
        engine.close();
        engine = null;
      }
      if (joined) api(`/api/voice/rooms/${roomId}/leave`, { method: 'POST' }).catch(() => {});
    });

    paintParticipants();
    paintStatus('idle');
    paintFloor(stateData.floor || null);
  }

  window.RRVoice = { renderGuildVoice, renderVoiceRoom };
})();
