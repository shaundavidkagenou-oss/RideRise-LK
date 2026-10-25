/* RideRise LK — API client, state store, UI primitives & localization binding */
(function () {
  'use strict';

  const STORAGE_TOKEN = 'rr_token';
  const STORAGE_LOCALE = 'rr_locale';
  const STORAGE_API_BASE = 'rr_api_base';
  const STORAGE_MOTION = 'rr_reduced_motion';
  const STORAGE_CONTRAST = 'rr_high_contrast';

  const isAndroidShell = () => typeof window.RRAndroid !== 'undefined' && !!window.RRAndroid;

  function resolveApiBase() {
    if (isAndroidShell()) {
      try {
        const bridged = window.RRAndroid.getApiBase() || '';
        if (bridged) return bridged.replace(/\/$/, '');
      } catch (e) {
        /* bridge unavailable */
      }
      return (localStorage.getItem(STORAGE_API_BASE) || '').replace(/\/$/, '');
    }
    // Web build served by the same Node backend: same-origin relative requests
    return '';
  }

  const state = {
    token: localStorage.getItem(STORAGE_TOKEN) || '',
    apiBase: resolveApiBase(),
    account: null,
    profile: null,
    config: null,
    locale: localStorage.getItem(STORAGE_LOCALE) || 'en',
    reducedMotion: localStorage.getItem(STORAGE_MOTION) === '1',
    highContrast: localStorage.getItem(STORAGE_CONTRAST) === '1',
    unreadNotifications: 0,
    unreadMessages: 0,
    booted: false,
    tab: 'home'
  };

  class ApiError extends Error {
    constructor(message, code, status, payload) {
      super(message);
      this.name = 'ApiError';
      this.code = code || 'API_ERROR';
      this.status = status || 0;
      this.payload = payload || null;
    }
  }

  async function api(path, options = {}) {
    const opts = Object.assign({ method: 'GET', body: null, timeout: 15000 }, options);
    if (!state.apiBase && isAndroidShell()) {
      throw new ApiError(
        'No backend server configured yet. Open Settings → Server Connection and enter the RideRise LK API URL.',
        'API_BASE_MISSING',
        0
      );
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeout);
    const headers = { Accept: 'application/json' };
    if (opts.body !== null) headers['Content-Type'] = 'application/json';
    if (state.token) headers.Authorization = `Bearer ${state.token}`;

    let response;
    try {
      response = await fetch(`${state.apiBase}${path}`, {
        method: opts.method,
        headers,
        body: opts.body !== null ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal
      });
    } catch (err) {
      clearTimeout(timer);
      const aborted = err && err.name === 'AbortError';
      throw new ApiError(
        aborted
          ? 'The server took too long to respond. Check your connection and tap Retry.'
          : 'Network unreachable. Check your internet connection or the API server address, then tap Retry.',
        'NETWORK_ERROR',
        0
      );
    }
    clearTimeout(timer);

    let data = null;
    const text = await response.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (e) {
        data = { message: text.slice(0, 240) };
      }
    }

    if (!response.ok) {
      const message = (data && data.message) || `Request failed (HTTP ${response.status}).`;
      throw new ApiError(message, (data && data.error) || 'HTTP_ERROR', response.status, data);
    }
    return data;
  }

  function setToken(token) {
    state.token = token || '';
    if (token) localStorage.setItem(STORAGE_TOKEN, token);
    else localStorage.removeItem(STORAGE_TOKEN);
  }

  async function refreshSession() {
    if (!state.token) return null;
    try {
      const data = await api('/api/auth/session');
      state.account = data.account;
      state.profile = data.profile;
      state.unreadNotifications = data.unreadNotifications || 0;
      state.unreadMessages = data.unreadMessages || 0;
      return data;
    } catch (err) {
      if (err.status === 401) {
        setToken('');
        state.account = null;
        state.profile = null;
        return null;
      }
      throw err;
    }
  }

  /* ---------------------------------- i18n --------------------------------- */
  function t(key) {
    const dict = (window.RIDERISE_I18N || {})[state.locale] || window.RIDERISE_I18N.en;
    return dict[key] !== undefined ? dict[key] : window.RIDERISE_I18N.en[key] !== undefined ? window.RIDERISE_I18N.en[key] : key;
  }

  function setLocale(locale) {
    state.locale = ['en', 'si', 'ta'].includes(locale) ? locale : 'en';
    localStorage.setItem(STORAGE_LOCALE, state.locale);
    document.documentElement.lang = state.locale;
  }

  function setReducedMotion(on) {
    state.reducedMotion = !!on;
    localStorage.setItem(STORAGE_MOTION, on ? '1' : '0');
    document.body.classList.toggle('reduced-motion', state.reducedMotion);
  }

  function setHighContrast(on) {
    state.highContrast = !!on;
    localStorage.setItem(STORAGE_CONTRAST, on ? '1' : '0');
    document.body.classList.toggle('high-contrast', state.highContrast);
  }

  /* ------------------------------- UI helpers ------------------------------ */
  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function money(lkr, verified) {
    if (!verified || !lkr) return 'Price not verified';
    return `LKR ${Number(lkr).toLocaleString('en-LK')}`;
  }

  function timeAgo(iso) {
    if (!iso) return '';
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return '';
    const diff = Math.max(0, Date.now() - then);
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function dateLabel(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function avatar(url, name, size = 44) {
    const initials = (name || 'R')
      .replace(/[^A-Za-z\u0D80-\u0DFF\u0B80-\u0BFF ]/g, '')
      .trim()
      .slice(0, 2)
      .toUpperCase() || 'RR';
    if (url && !url.includes('riderise_logo')) {
      return `<img class="rr-avatar" style="width:${size}px;height:${size}px" src="${escapeHtml(url)}" alt="${escapeHtml(name || 'Rider')} avatar" loading="lazy" />`;
    }
    return `<div class="rr-avatar rr-avatar-fallback" style="width:${size}px;height:${size};font-size:${Math.round(
      size / 2.6
    )}px" aria-hidden="true">${escapeHtml(initials)}</div>`;
  }

  function logo(size = 48, extraClass = '') {
    return `<img src="assets/brand/riderise_logo.png" width="${size}" height="${size}" class="brand-logo-img ${extraClass}" style="width:${size}px;height:${size}px" alt="RideRise LK badge" />`;
  }

  function toast(message, type = 'info', ms = 4200) {
    const root = document.getElementById('toastRoot');
    if (!root) return;
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.textContent = message;
    root.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(-6px)';
      setTimeout(() => el.remove(), 220);
    }, ms);
  }

  function closeModal() {
    const root = document.getElementById('modalRoot');
    if (!root) return;
    root.style.display = 'none';
    root.innerHTML = '';
    document.body.style.overflow = '';
  }

  function modal({ title, body, footer = '', size = '680px', onMount = null, dismissible = true }) {
    const root = document.getElementById('modalRoot');
    root.style.display = 'block';
    root.innerHTML = `
      <div class="modal-backdrop" ${dismissible ? 'data-modal-dismiss="1"' : ''}>
        <div class="modal-card" style="max-width:${size}" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
          <div class="modal-head">
            <h2>${escapeHtml(title)}</h2>
            ${
              dismissible
                ? '<button type="button" class="icon-btn" aria-label="Close dialog" data-modal-close="1">✕</button>'
                : ''
            }
          </div>
          <div class="modal-body">${body}</div>
          ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
        </div>
      </div>`;
    document.body.style.overflow = 'hidden';
    if (dismissible) {
      root.querySelectorAll('[data-modal-dismiss], [data-modal-close]').forEach((el) => {
        el.addEventListener('click', (e) => {
          if (e.target === el || el.dataset.modalClose) closeModal();
        });
      });
    }
    if (onMount) onMount(root);
    return root;
  }

  function skeletonList(count = 3) {
    return Array.from({ length: count }).map(() => '<div class="skeleton"></div>').join('');
  }

  function emptyState({ icon = '🚲', title, body, actionHtml = '' }) {
    return `<div class="empty-state">
      <div class="empty-icon" aria-hidden="true">${icon}</div>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(body)}</p>
      ${actionHtml}
    </div>`;
  }

  function errorState(err, retryAttr = 'data-retry="1"') {
    const isPermission = err && (err.status === 403 || err.code === 'FORBIDDEN');
    return `<div class="card card-danger" role="alert">
      <h3 style="margin-bottom:8px">${isPermission ? 'Permission denied' : 'Something went wrong'}</h3>
      <p style="color:var(--text-secondary);font-size:.88rem">${escapeHtml(
        (err && err.message) || 'Unexpected error.'
      )}</p>
      ${
        err && err.code
          ? `<p style="margin-top:6px;font-size:.72rem;color:var(--text-muted)">Error code: ${escapeHtml(err.code)}</p>`
          : ''
      }
      <button type="button" class="btn btn-secondary btn-sm" style="margin-top:12px" ${retryAttr}>↻ Retry</button>
    </div>`;
  }

  function xpProgress(profile) {
    if (!profile) return '';
    const next = profile.next_rank;
    const currentMin = (profile.rank_min_xp ?? 0);
    const target = next ? next.min_xp : profile.xp;
    const span = Math.max(1, target - currentMin);
    const pct = next ? Math.min(100, Math.max(0, Math.round(((profile.xp - currentMin) / span) * 100))) : 100;
    return `<div class="xp-block">
      <div class="xp-row">
        <span class="pill-badge" style="background:${escapeHtml(profile.rank_color || '#FF6B00')}22;color:${escapeHtml(
      profile.rank_color || '#FF6B00'
    )};border:1px solid ${escapeHtml(profile.rank_color || '#FF6B00')}66">${escapeHtml(profile.rank_name || 'Rookie Rider')}</span>
        <span class="xp-count">${profile.xp || 0} XP</span>
      </div>
      <div class="xp-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="Progress to next rank">
        <div class="xp-progress-fill" style="width:${pct}%"></div>
      </div>
      <div class="xp-next">${
        next
          ? `${Math.max(0, next.min_xp - profile.xp)} XP to <strong>${escapeHtml(next.name)}</strong>`
          : 'Top rank reached — Ride Legend!'
      }</div>
    </div>`;
  }

  function requireAuthOrPrompt() {
    if (state.token) return true;
    location.hash = '#/welcome';
    return false;
  }

  window.RR = {
    api,
    ApiError,
    state,
    t,
    setLocale,
    setReducedMotion,
    setHighContrast,
    setToken,
    refreshSession,
    escapeHtml,
    money,
    timeAgo,
    dateLabel,
    avatar,
    logo,
    toast,
    modal,
    closeModal,
    skeletonList,
    emptyState,
    errorState,
    xpProgress,
    requireAuthOrPrompt,
    isAndroidShell,
    STORAGE_API_BASE
  };
})();
