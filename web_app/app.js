/* RideRise LK — Application shell: boot, splash, routing, bottom navigation & chrome */
(function () {
  'use strict';
  const RR = window.RR;
  const { state, t, escapeHtml, logo, toast } = RR;

  const MAIN_TABS = ['home', 'explore', 'stunts', 'guilds', 'profile'];

  function paintChrome() {
    const headerActions = document.getElementById('headerActionsBar');
    if (!headerActions) return;
    const isAuthed = !!state.token;
    headerActions.innerHTML = isAuthed
      ? `
        <button class="btn btn-secondary btn-sm" data-nav="#/notifications" aria-label="Notifications">
          🔔 ${state.unreadNotifications ? `<span class="badge-counter">${state.unreadNotifications}</span>` : ''}
        </button>
        <button class="btn btn-secondary btn-sm" data-nav="#/messages" aria-label="Messages">
          💬 ${state.unreadMessages ? `<span class="badge-counter">${state.unreadMessages}</span>` : ''}
        </button>
        <button class="btn btn-secondary btn-sm hide-xs" data-nav="#/learning" aria-label="Learning pathways">🎓 <span class="hide-sm">Learn</span></button>
        <button class="btn btn-secondary btn-sm hide-xs" data-nav="#/news" aria-label="Studio news">📰</button>
        <button class="btn btn-safety btn-sm" data-nav="#/safety" aria-label="Safety Centre">🛡️ <span class="hide-sm">${escapeHtml(t('safetyCentreBtn'))}</span></button>
        <button class="btn btn-secondary btn-sm hide-xs" data-nav="#/parts" aria-label="Parts catalog">🛒 <span class="hide-sm">Parts</span></button>
        <button class="btn btn-secondary btn-sm hide-xs" data-nav="#/events" aria-label="Studio events">📅 <span class="hide-sm">Events</span></button>
        ${state.account && ['admin', 'moderator'].includes(state.account.role) ? '<button class="btn btn-secondary btn-sm" data-nav="#/admin">🛠️ Admin</button>' : ''}
        <button class="btn btn-secondary btn-sm" data-nav="#/settings" aria-label="Settings">⚙</button>
        <button class="btn btn-secondary btn-sm" id="headerSignOut" aria-label="Sign out">Sign out</button>`
      : `<button class="btn btn-primary btn-sm" id="headerSignIn">Sign in</button>
         <button class="btn btn-safety btn-sm" data-nav="#/safety">🛡️ Safety</button>`;

    headerActions.querySelectorAll('[data-nav]').forEach((b) =>
      b.addEventListener('click', () => (location.hash = b.dataset.nav))
    );
    const signOut = headerActions.querySelector('#headerSignOut');
    if (signOut)
      signOut.addEventListener('click', async () => {
        if (window.RRFirebase && window.RRFirebase.isConfigured && window.RRFirebase.isConfigured()) {
          await window.RRFirebase.signOut();
        }
        RR.setToken('');
        state.account = null;
        state.profile = null;
        toast('Signed out. Session cleared from this device.', 'success');
        location.hash = '#/welcome';
      });
    const signIn = headerActions.querySelector('#headerSignIn');
    if (signIn) signIn.addEventListener('click', () => window.RRAuth.openSignIn());

    // i18n labels
    const setText = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };
    setText('i18nStudioBy', t('studioBy'));
    setText('navLabelHome', t('navHome'));
    setText('navLabelExplore', t('navExplore'));
    setText('navLabelStunts', t('navStunts'));
    setText('navLabelGuilds', t('navGuilds'));
    setText('navLabelProfile', t('navProfile'));
    document.title = `${t('appName')} — ${t('studioBy')}`;
  }

  function selectBottomTab(tab) {
    document.querySelectorAll('.bottom-nav-item').forEach((item) => {
      const active = item.dataset.tab === tab;
      item.classList.toggle('active', active);
      item.setAttribute('aria-current', active ? 'page' : 'false');
    });
  }

  function renderServerSetup(viewport) {
    viewport.innerHTML = `
      <section class="welcome-hero" style="grid-template-columns:1fr;max-width:720px;margin:0 auto">
        <div class="welcome-copy">
          <div style="display:flex;align-items:center;gap:14px;margin-bottom:10px">
            ${logo(56)}
            <div><div class="welcome-tagline">RIDE / STUNT / CONNECT</div>
            <div class="muted" style="font-size:.76rem">BY SHAUN DAVID STUDIOS</div></div>
          </div>
          <h1 class="welcome-title" style="font-size:1.7rem">Connect your ride server</h1>
          <p class="welcome-sub">This Android build talks to the RideRise LK backend for accounts, feeds, guilds and moderation. Enter the HTTPS address of your deployment once — it is saved on this device.</p>
          <div class="card" style="margin-top:16px">
            <div class="form-group">
              <label class="form-label" for="setupApiBase">RideRise LK API base URL</label>
              <input class="form-input" id="setupApiBase" placeholder="https://your-riderise-api.example" value="${escapeHtml(state.apiBase || '')}" autocomplete="url" />
              <div class="hint">Test it in a browser first: <code>/api/health</code> should return JSON.</div>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="btn btn-primary" id="setupConnect">Save &amp; test connection</button>
              <button class="btn btn-safety" data-nav-safety>Safety Centre</button>
            </div>
            <div id="setupResult" class="hint" style="margin-top:10px"></div>
          </div>
          <div class="callout callout-warn" style="margin-top:14px">
            <strong>Never ride stunts on public roads, in traffic or near pedestrians.</strong>
            Wear a certified helmet and inspect your bike before every session.
          </div>
          <p class="welcome-fineprint">Deployment steps are in <code>docs/BUILD_INSTRUCTIONS.md</code>. Nothing is uploaded until you connect and sign in.</p>
        </div>
      </section>`;

    viewport.querySelector('[data-nav-safety]').addEventListener('click', () => (location.hash = '#/safety'));
    viewport.querySelector('#setupConnect').addEventListener('click', async () => {
      const input = viewport.querySelector('#setupApiBase');
      const result = viewport.querySelector('#setupResult');
      const url = input.value.trim().replace(/\/$/, '');
      if (!/^https?:\/\//.test(url)) {
        result.textContent = 'Enter a full URL starting with https://';
        result.style.color = 'var(--danger-red)';
        return;
      }
      result.textContent = 'Testing connection…';
      result.style.color = 'var(--text-secondary)';
      try {
        const res = await fetch(`${url}/api/health`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const health = await res.json();
        if (window.RRAndroid && window.RRAndroid.setApiBase) window.RRAndroid.setApiBase(url);
        localStorage.setItem(RR.STORAGE_API_BASE, url);
        state.apiBase = url;
        result.textContent = `Connected to ${health.app} · Phase ${health.phase} ✓`;
        result.style.color = 'var(--success-green)';
        toast('Server connected. Sign in to continue.', 'success');
        await RR.refreshSession().catch(() => {});
        setTimeout(() => (location.hash = '#/welcome'), 700);
      } catch (err) {
        result.textContent = `Connection failed: ${err.message}. Check the address, TLS certificate and that the server is running.`;
        result.style.color = 'var(--danger-red)';
      }
    });
  }

  function route() {
    const viewport = document.getElementById('mainViewport');
    const hash = location.hash.replace(/^#/, '') || '/home';
    const [pathPart, query = ''] = hash.split('?');
    const segments = pathPart.split('/').filter(Boolean);
    const root = segments[0] || 'home';

    // Stop live sessions (location pings, audio, timers) owned by the previous screen.
    RR.runRouteCleanups();
    if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: state.reducedMotion ? 'auto' : 'smooth' });
    paintChrome();

    // Fresh Android install with no configured backend: onboarding-first experience.
    if (RR.isAndroidShell() && !state.apiBase && root !== 'safety' && root !== 'settings') {
      selectBottomTab('');
      renderServerSetup(viewport);
      return;
    }

    if (!state.token && !['welcome', 'safety', 'admin'].includes(root)) {
      selectBottomTab('home');
      window.RRAuth.renderWelcome(viewport);
      return;
    }

    if (MAIN_TABS.includes(root)) {
      selectBottomTab(root);
    } else {
      selectBottomTab('');
    }

    switch (root) {
      case 'welcome':
        window.RRAuth.renderWelcome(viewport);
        break;
      case 'onboarding':
        window.RRAuth.renderOnboarding(viewport);
        break;
      case 'home':
        window.RRFeed.renderHome(viewport);
        break;
      case 'explore':
        window.RRExplore.renderExplore(viewport);
        break;
      case 'stunts':
        window.RRStunts.renderStunts(viewport);
        break;
      case 'guilds':
        window.RRGuilds.renderGuilds(viewport);
        break;
      case 'guild':
        if (segments[2] === 'hub') window.RRGuildHub.renderGuildHub(viewport, segments[1], query);
        else if (segments[2] === 'voice') {
          if (segments[3]) window.RRVoice.renderVoiceRoom(viewport, segments[1], segments[3]);
          else window.RRVoice.renderGuildVoice(viewport, segments[1]);
        } else if (segments[2] === 'map') window.RRLive.renderGuildMap(viewport, segments[1]);
        else window.RRGuilds.renderGuildDetail(viewport, segments[1]);
        break;
      case 'learning':
        if (segments[1] === 'module' && segments[2]) window.RRLearning.renderLesson(viewport, segments[2]);
        else window.RRLearning.renderLearning(viewport);
        break;
      case 'catalog':
        window.RRCatalog.renderCatalog(viewport);
        break;
      case 'messages':
        if (segments[1]) window.RRMessages.renderThread(viewport, segments[1]);
        else window.RRMessages.renderThreads(viewport);
        break;
      case 'news':
        window.RRMessages.renderNews(viewport);
        break;
      case 'profile':
        window.RRProfile.renderProfile(viewport);
        break;
      case 'user':
        window.RRProfile.renderProfile(viewport, segments[1]);
        break;
      case 'settings':
        window.RRProfile.renderSettings(viewport);
        break;
      case 'friends':
        window.RRSocial.renderFriends(viewport, query);
        break;
      case 'parts':
        window.RRExplore.renderParts(viewport);
        break;
      case 'events':
        window.RREvents.renderEvents(viewport);
        break;
      case 'safety':
        window.RRExplore.renderSafety(viewport);
        break;
      case 'notifications':
        window.RRMessages.renderNotifications(viewport);
        break;
      case 'admin':
        if (segments[1] === 'legacy') window.RRAdmin.renderAdmin(viewport);
        else window.RRAdminConsole.renderAdminConsole(viewport, query);
        break;
      default:
        viewport.innerHTML = `<div class="card">${RR.emptyState({
          icon: '🧭',
          title: 'Page not found',
          body: 'That route does not exist in RideRise LK.',
          actionHtml: '<button class="btn btn-primary" onclick="location.hash=\'#/home\'">Back to the feed</button>'
        })}</div>`;
    }
  }

  function wireShell() {
    document.querySelectorAll('.bottom-nav-item').forEach((item) =>
      item.addEventListener('click', () => {
        location.hash = `#/${item.dataset.tab}`;
        selectBottomTab(item.dataset.tab);
      })
    );

    if (RR.isAndroidShell()) {
      // The web bundle is already installed on the device — hide download links.
      document.querySelectorAll('.apk-download').forEach((el) => {
        el.hidden = true;
        el.style.display = 'none';
      });
    }

    const localeSelect = document.getElementById('localeSelect');
    if (localeSelect) {
      localeSelect.value = state.locale;
      localeSelect.addEventListener('change', async () => {
        RR.setLocale(localeSelect.value);
        paintChrome();
        if (state.token) {
          try {
            await RR.api('/api/profile', { method: 'PUT', body: { locale: localeSelect.value } });
          } catch (e) {
            /* offline is fine — preference is stored locally */
          }
        }
        route();
      });
    }

    const motionBtn = document.getElementById('toggleReducedMotionBtn');
    if (motionBtn) {
      const paint = () => {
        motionBtn.textContent = state.reducedMotion ? 'Motion: Reduced' : 'Motion: Standard';
        motionBtn.classList.toggle('btn-primary', state.reducedMotion);
      };
      paint();
      motionBtn.addEventListener('click', () => {
        RR.setReducedMotion(!state.reducedMotion);
        paint();
        toast(state.reducedMotion ? 'Reduced motion enabled.' : 'Standard motion enabled.', 'info', 2200);
      });
    }

    const contrastBtn = document.getElementById('toggleContrastBtn');
    if (contrastBtn)
      contrastBtn.addEventListener('click', () => {
        RR.setHighContrast(!state.highContrast);
        toast(state.highContrast ? 'High contrast enabled.' : 'Standard contrast enabled.', 'info', 2200);
      });

    const brandHome = document.getElementById('headerBrandHome');
    const goHome = () => (location.hash = state.token ? '#/home' : '#/welcome');
    brandHome.addEventListener('click', goHome);
    brandHome.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') goHome();
    });

    window.addEventListener('hashchange', route);

    if (window.RRAndroid && window.RRAndroid.onBackPressed) {
      // Native back button handled by the Android shell: it calls history.back() or exits.
    }
  }

  async function boot() {
    RR.setLocale(state.locale);
    RR.setReducedMotion(state.reducedMotion);
    RR.setHighContrast(state.highContrast);
    wireShell();
    paintChrome();

    // Load public config once (branding, ranks, legal docs, Firebase web config)
    try {
      state.config = await RR.api('/api/config');
    } catch (e) {
      /* App still works; screens that need config will retry. */
    }

    // Firebase Authentication: initialise from the server's public web config. When it is not
    // configured the sign-in screen says so instead of pretending to work.
    if (window.RRFirebase && state.config && state.config.firebase && state.config.firebase.configured) {
      window.RRFirebase.configure(state.config.firebase.config);
    }

    if (state.token) {
      try {
        await RR.refreshSession();
      } catch (err) {
        /* keep token; screens will surface the network error with retry */
      }
      if (!state.account) await restoreSessionFromFirebase();
      registerPushToken();
    } else {
      // "Remember me": the Firebase SDK persists the account, so a returning rider can get a
      // fresh RideRise session without typing a password again.
      await restoreSessionFromFirebase();
    }

    if (!location.hash) location.hash = state.token ? '#/home' : '#/welcome';
    route();
    if (state.account && state.account.onboarding_completed === false) {
      location.hash = '#/onboarding';
    }

    // Hide the animated launch splash after first paint
    const splash = document.getElementById('splashScreen');
    if (splash) {
      setTimeout(() => splash.classList.add('hidden'), state.reducedMotion ? 350 : 1900);
    }
    state.booted = true;

    // Poll unread counters periodically (cheap, keeps badges honest)
    if (state.token) {
      setInterval(() => {
        RR.refreshSession()
          .then(() => {
            if (state.account) paintChrome();
          })
          .catch(() => {});
      }, 60000);
    }
  }

  /**
   * Native push registration. Only the Gradle build (with Firebase Messaging) implements the
   * bridge; the SDK-free APK and the web build simply skip this. The native side fetches an
   * FCM token and hands it back through window.RR.onPushToken.
   */
  window.RR.onPushToken = async function (token) {
    if (!token || !state.token) return;
    try {
      await RR.api('/api/devices', {
        method: 'POST',
        body: { token, platform: 'android', app_version: (state.config && state.config.brand && state.config.brand.versionName) || '' }
      });
      if (window.RRAndroid && window.RRAndroid.requestNotificationPermission) {
        window.RRAndroid.requestNotificationPermission();
      }
    } catch (err) {
      /* Push is optional: a failure here must never block the app. */
    }
  };

  function registerPushToken() {
    if (!window.RRAndroid || !window.RRAndroid.requestPushToken) return;
    try {
      window.RRAndroid.requestPushToken();
    } catch (err) {
      /* bridge present but unavailable */
    }
  }

  let restoringSession = false;

  /**
   * Re-establish the RideRise session from a persisted Firebase sign-in. This is what makes
   * "remember me" work across browser restarts and app launches, and it is also how a
   * disabled/expired Firebase account loses access: the server re-verifies the ID token.
   */
  async function restoreSessionFromFirebase() {
    const fb = window.RRFirebase;
    if (restoringSession || !fb || !fb.isConfigured || !fb.isConfigured()) return false;
    if (!fb.currentUser()) return false;
    restoringSession = true;
    try {
      const idToken = await fb.getIdToken(false);
      if (!idToken) return false;
      const data = await RR.api('/api/auth/firebase/session', { method: 'POST', body: { idToken } });
      RR.setToken(data.token);
      state.account = data.account;
      state.profile = data.profile;
      return true;
    } catch (err) {
      if (err.code === 'EMAIL_NOT_VERIFIED') {
        const user = fb.currentUser();
        fb.rememberPendingVerification(user ? user.email : '');
      }
      return false;
    } finally {
      restoringSession = false;
    }
  }

  // Re-verify with Firebase periodically so a disabled account or an unverified address
  // cannot ride an old session for days.
  if (window.RRFirebase && window.RRFirebase.isConfigured && window.RRFirebase.isConfigured()) {
    setInterval(() => {
      if (!state.token) return;
      restoreSessionFromFirebase()
        .then((restored) => {
          if (!restored && window.RRFirebase.currentUser() === null) {
            RR.setToken('');
            state.account = null;
            state.profile = null;
            paintChrome();
          }
        })
        .catch(() => {});
    }, 45 * 60 * 1000);
  }

  window.RRApp = { paintChrome, route, boot, restoreSessionFromFirebase };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
