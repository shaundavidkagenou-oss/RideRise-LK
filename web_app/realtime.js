/* RideRise LK — realtime client (Server-Sent Events with exponential backoff).
 *
 * Realtime is an enhancement, never a requirement: every screen also works with
 * normal request/response calls and manual refresh.
 */
(function () {
  'use strict';

  const EVENTS = [
    'ready',
    'notification',
    'message',
    'typing',
    'read_receipt',
    'reaction',
    'message_deleted',
    'live_map_changed',
    'voice_participant_joined',
    'ptt_floor'
  ];

  function connect({ onEvent, onStatus } = {}) {
    const state = window.RR.state;
    let source = null;
    let closed = false;
    let attempt = 0;
    let reconnectTimer = null;

    const report = (status, detail) => {
      if (onStatus) {
        try {
          onStatus(status, detail);
        } catch (e) {
          /* listener errors must not break the socket */
        }
      }
    };

    async function open() {
      if (closed || !state.token) return;
      try {
        const ticket = await window.RR.api('/api/realtime/ticket', { method: 'POST' });
        if (closed) return;
        if (typeof EventSource === 'undefined') {
          report('unsupported', 'This browser cannot hold a live connection. Pull to refresh instead.');
          return;
        }
        source = new EventSource(`${state.apiBase}${ticket.url}`);
        report('connecting');
        source.addEventListener('ready', () => {
          attempt = 0;
          report('live');
        });
        for (const name of EVENTS) {
          source.addEventListener(name, (event) => {
            let data = {};
            try {
              data = JSON.parse(event.data || '{}');
            } catch (e) {
              data = {};
            }
            if (onEvent) onEvent(name, data);
          });
        }
        source.onerror = () => {
          if (closed) return;
          report('reconnecting');
          try {
            source.close();
          } catch (e) {
            /* already closed */
          }
          scheduleReconnect();
        };
      } catch (err) {
        report('error', err.message);
        scheduleReconnect();
      }
    }

    function scheduleReconnect() {
      if (closed) return;
      attempt = Math.min(attempt + 1, 6);
      const delay = Math.min(30_000, 1200 * Math.pow(1.7, attempt));
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(open, delay);
    }

    function close() {
      closed = true;
      clearTimeout(reconnectTimer);
      if (source) {
        try {
          source.close();
        } catch (e) {
          /* noop */
        }
      }
      report('closed');
    }

    if (state.token) open();
    return { close, isOpen: () => Boolean(source && source.readyState === 1) };
  }

  window.RRRealtime = { connect };
})();
