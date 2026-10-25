/* RideRise LK — WebRTC mesh audio engine for guild voice rooms and walkie-talkie.
 *
 * This is a real peer-to-peer implementation, not a simulation:
 *   • getUserMedia(audio) is only called after an explicit user action
 *   • the microphone track is disabled unless the rider is transmitting (PTT)
 *     or has unmuted in a group room
 *   • offers/answers/ICE are exchanged through the authenticated RideRise API
 *   • a server-granted "floor" prevents overlapping walkie-talkie transmissions
 *
 * Cross-network reliability depends on a TURN relay. When the server has no TURN
 * credentials the UI states that honestly instead of pretending to be connected.
 */
(function () {
  'use strict';

  const POLL_MS = 1200;
  const HEARTBEAT_MS = 8000;
  const STATE_MS = 4000;

  class VoiceEngine {
    constructor(options) {
      this.roomId = options.roomId;
      this.kind = options.kind || 'group';
      this.onState = options.onState || (() => {});
      this.onRemoteAudio = options.onRemoteAudio || (() => {});
      this.onError = options.onError || (() => {});
      this.onFloor = options.onFloor || (() => {});
      this.onLevel = options.onLevel || (() => {});

      this.localStream = null;
      this.audioContext = null;
      this.analyser = null;
      this.micTrack = null;
      this.peers = new Map(); // userId -> { pc, audioEl, pendingIce }
      this.selfId = window.RR.state.account ? window.RR.state.account.id : '';
      this.closed = false;
      this.timers = [];
      this.pollBusy = false;
      this.transmitting = false;
      this.muted = true;
      this.remoteFloor = null;
      this.iceServers = [];
      this.connectionState = 'idle';
      this.lastSignalAt = Date.now();
    }

    async join() {
      const state = window.RR.state;
      if (!state.token) throw new Error('Sign in to join a voice room.');
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('This device or WebView does not expose microphone capture. Use the Android app and grant microphone permission.');
      }
      this.setState('requesting-mic');
      try {
        this.localStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1
          },
          video: false
        });
      } catch (err) {
        const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
        this.setState('mic-denied');
        throw new Error(
          denied
            ? 'Microphone permission was denied. Allow microphone access in Android settings, then try again.'
            : `Microphone unavailable: ${err.message}`
        );
      }
      this.micTrack = this.localStream.getAudioTracks()[0];
      if (this.micTrack) {
        this.micTrack.enabled = false;
        this.micTrack.addEventListener('ended', () => {
          this.onError('The microphone was released by the system (a call may have started). Rejoin to continue.');
          this.setState('disconnected');
        });
      }
      this._startLevelMeter();

      const joined = await window.RR.api(`/api/voice/rooms/${this.roomId}/join`, { method: 'POST' });
      this.iceServers = (joined.state.ice && joined.state.ice.iceServers) || [];
      this.setState('connected');
      this.onState(joined.state);

      for (const peer of joined.state.participants) {
        if (peer.user_id !== this.selfId) await this._createOffer(peer.user_id);
      }
      this._startLoops();
      return joined.state;
    }

    _startLevelMeter() {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        this.audioContext = new Ctx();
        const source = this.audioContext.createMediaStreamSource(this.localStream);
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 512;
        source.connect(this.analyser);
        const data = new Uint8Array(this.analyser.frequencyBinCount);
        const tick = () => {
          if (this.closed || !this.analyser) return;
          this.analyser.getByteFrequencyData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) sum += data[i];
          this.onLevel(Math.min(1, sum / data.length / 90));
          requestAnimationFrame(tick);
        };
        tick();
      } catch (e) {
        /* level meter is cosmetic */
      }
    }

    _peer(userId) {
      if (this.peers.has(userId)) return this.peers.get(userId);
      const pc = new RTCPeerConnection({ iceServers: this.iceServers });
      const audioEl = document.createElement('audio');
      audioEl.autoplay = true;
      audioEl.playsInline = true;
      audioEl.dataset.peer = userId;
      audioEl.muted = this.kind === 'walkie';
      document.body.appendChild(audioEl);

      for (const track of this.localStream.getAudioTracks()) pc.addTrack(track, this.localStream);

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          this._signal(userId, 'ice', { candidate: event.candidate.toJSON ? event.candidate.toJSON() : event.candidate });
        }
      };
      pc.ontrack = (event) => {
        audioEl.srcObject = event.streams[0];
        audioEl.play().catch(() => {});
        this.onRemoteAudio(userId, audioEl);
      };
      pc.onconnectionstatechange = () => {
        const s = pc.connectionState;
        this.onState({ peer_state: { user_id: userId, state: s } });
        if (s === 'failed' || s === 'disconnected') {
          this._renegotiate(userId);
        }
      };

      const entry = { pc, audioEl, makingOffer: false };
      this.peers.set(userId, entry);
      return entry;
    }

    async _createOffer(userId) {
      const entry = this._peer(userId);
      if (entry.makingOffer) return;
      entry.makingOffer = true;
      try {
        const offer = await entry.pc.createOffer();
        await entry.pc.setLocalDescription(offer);
        await this._signal(userId, 'offer', { sdp: entry.pc.localDescription });
      } catch (err) {
        this.onError(`Could not start audio with a participant: ${err.message}`);
      } finally {
        entry.makingOffer = false;
      }
    }

    async _renegotiate(userId) {
      const entry = this.peers.get(userId);
      if (!entry || entry.makingOffer || this.closed) return;
      try {
        if (entry.pc.restartIce) entry.pc.restartIce();
        const offer = await entry.pc.createOffer({ iceRestart: true });
        await entry.pc.setLocalDescription(offer);
        await this._signal(userId, 'offer', { sdp: entry.pc.localDescription });
      } catch (e) {
        /* the periodic state refresh will re-attempt */
      }
    }

    async _signal(to, kind, payload) {
      try {
        await window.RR.api(`/api/voice/rooms/${this.roomId}/signal`, {
          method: 'POST',
          body: { to, kind, payload }
        });
        this.lastSignalAt = Date.now();
      } catch (err) {
        if (err.status === 403) this.onError('You are no longer authorised to signal in this room.');
      }
    }

    async _applySignal(signal) {
      const entry = this._peer(signal.from);
      const { pc } = entry;
      try {
        if (signal.kind === 'offer') {
          await pc.setRemoteDescription(new RTCSessionDescription(signal.payload.sdp));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await this._signal(signal.from, 'answer', { sdp: pc.localDescription });
        } else if (signal.kind === 'answer') {
          if (pc.signalingState !== 'stable') {
            await pc.setRemoteDescription(new RTCSessionDescription(signal.payload.sdp));
          }
        } else if (signal.kind === 'ice' && signal.payload.candidate) {
          try {
            await pc.addIceCandidate(signal.payload.candidate);
          } catch (e) {
            /* candidate ordering issues are non-fatal */
          }
        } else if (signal.kind === 'renegotiate') {
          await this._createOffer(signal.from);
        }
      } catch (err) {
        this.onError(`Audio negotiation issue: ${err.message}`);
      }
    }

    _startLoops() {
      const poll = async () => {
        if (this.closed || this.pollBusy) return;
        this.pollBusy = true;
        try {
          const res = await window.RR.api(`/api/voice/rooms/${this.roomId}/signal/poll`);
          for (const signal of res.signals || []) await this._applySignal(signal);
        } catch (err) {
          if (err.status === 401 || err.status === 403) {
            this.setState('unauthorised');
            this.onError(err.message || 'You lost access to this voice room.');
            this.close();
            return;
          }
        } finally {
          this.pollBusy = false;
        }
      };

      const heartbeat = async () => {
        if (this.closed) return;
        try {
          const res = await window.RR.api(`/api/voice/rooms/${this.roomId}/heartbeat`, {
            method: 'POST',
            body: { connection_state: this.connectionState, audio_route: this.audioRoute || 'speaker' }
          });
          this.onState(res.state);
          this._syncWalkieGates(res.state);
        } catch (err) {
          if (err.status === 409 || err.status === 401 || err.status === 403) {
            this.setState('disconnected');
            this.onError(err.message || 'Disconnected from the voice room.');
            this.close();
          }
        }
      };

      const refresh = async () => {
        if (this.closed) return;
        try {
          const state = await window.RR.api(`/api/voice/rooms/${this.roomId}/state`);
          this.onState(state);
          this._syncWalkieGates(state);
        } catch (e) {
          /* transient */
        }
      };

      this.timers.push(setInterval(poll, POLL_MS));
      this.timers.push(setInterval(heartbeat, HEARTBEAT_MS));
      this.timers.push(setInterval(refresh, STATE_MS));
      this._visibility = () => {
        if (document.hidden) {
          // Reduce polling while backgrounded to protect battery and data.
          this.timers.slice(0, 2).forEach((t) => clearInterval(t));
        } else {
          this.close();
          this.onError('Call paused while the app was in the background. Rejoin to continue.');
        }
      };
      document.addEventListener('visibilitychange', this._visibility);
    }

    _syncWalkieGates(state) {
      if (!state) return;
      this.remoteFloor = state.floor ? state.floor.holder_id : null;
      if (this.kind !== 'walkie') {
        for (const [, entry] of this.peers) entry.audioEl.muted = false;
        return;
      }
      for (const [userId, entry] of this.peers) {
        entry.audioEl.muted = this.remoteFloor !== userId;
      }
      this.onFloor(state.floor || null);
    }

    async setMuted(muted) {
      this.muted = Boolean(muted);
      if (this.kind === 'walkie') {
        if (this.micTrack) this.micTrack.enabled = false;
        return;
      }
      if (this.micTrack) this.micTrack.enabled = !this.muted;
      try {
        await window.RR.api(`/api/voice/rooms/${this.roomId}/mute`, { method: 'POST', body: { muted: this.muted } });
      } catch (e) {
        /* server heartbeat reconciles state */
      }
    }

    /** Push-to-talk: ask the server for the channel, then open the microphone. */
    async startTransmitting() {
      if (this.kind !== 'walkie') return false;
      if (this.transmitting) return true;
      try {
        await window.RR.api(`/api/voice/rooms/${this.roomId}/floor/acquire`, {
          method: 'POST',
          body: { request_id: `ptt_${Date.now()}` }
        });
      } catch (err) {
        if (err.status === 409) {
          this.onError(err.message || 'Another rider is transmitting.');
          this.onFloor(err.payload || null);
          return false;
        }
        this.onError(err.message || 'Could not open the channel.');
        return false;
      }
      this.transmitting = true;
      if (this.micTrack) this.micTrack.enabled = true;
      this.setState('transmitting');
      if (navigator.vibrate) navigator.vibrate(14);
      return true;
    }

    async stopTransmitting() {
      if (!this.transmitting) return;
      this.transmitting = false;
      if (this.micTrack) this.micTrack.enabled = false;
      this.setState('connected');
      if (navigator.vibrate) navigator.vibrate(8);
      try {
        await window.RR.api(`/api/voice/rooms/${this.roomId}/floor/release`, { method: 'POST' });
      } catch (e) {
        /* the server lease expires regardless */
      }
    }

    setState(next) {
      this.connectionState = next;
      this.onState({ local_state: next });
    }

    async setAudioRoute(route) {
      this.audioRoute = route;
      // Android WebView has no setSinkId; the native shell exposes a SCO route instead.
      if (window.RRAndroid && typeof window.RRAndroid.routeAudioToBluetooth === 'function') {
        try {
          if (route === 'bluetooth') {
            window.RRAndroid.routeAudioToBluetooth();
          } else {
            window.RRAndroid.resetAudioRoute();
          }
        } catch (e) {
          /* native routing is best effort */
        }
      }
      for (const [, entry] of this.peers) {
        if (typeof entry.audioEl.setSinkId === 'function' && route === 'speaker') {
          try {
            await entry.audioEl.setSinkId('');
          } catch (e) {
            /* not supported */
          }
        }
      }
    }

    async leave() {
      try {
        await window.RR.api(`/api/voice/rooms/${this.roomId}/leave`, { method: 'POST' });
      } catch (e) {
        /* leaving locally still matters */
      }
      this.close();
    }

    close() {
      if (this.closed) return;
      this.closed = true;
      this.transmitting = false;
      for (const timer of this.timers) clearInterval(timer);
      this.timers = [];
      if (this._visibility) document.removeEventListener('visibilitychange', this._visibility);
      for (const [, entry] of this.peers) {
        try {
          entry.pc.close();
        } catch (e) {
          /* noop */
        }
        if (entry.audioEl.parentNode) entry.audioEl.parentNode.removeChild(entry.audioEl);
      }
      this.peers.clear();
      if (this.localStream) this.localStream.getTracks().forEach((t) => t.stop());
      if (this.audioContext) {
        try {
          this.audioContext.close();
        } catch (e) {
          /* noop */
        }
      }
      this.setState('closed');
    }
  }

  window.RRVoiceEngine = VoiceEngine;
})();
