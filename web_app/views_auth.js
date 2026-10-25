/* RideRise LK — Welcome, Google authentication (OAuth integration point), Onboarding wizard & legal documents */
(function () {
  'use strict';
  const { api, state, t, escapeHtml, toast, modal, closeModal, logo, skeletonList } = window.RR;

  const SAMPLE_IDENTITIES = [
    { key: 'kasun', email: 'kasun.perera.demo@gmail.com', name: 'Kasun Perera', note: 'Rider demo · Stunt Specialist' },
    { key: 'roshan', email: 'roshan.fernando.demo@gmail.com', name: 'Roshan Fernando', note: 'Rider demo · Guild moderator' },
    { key: 'dilshan_minor', email: 'dilshan.student.demo@gmail.com', name: 'Dilshan S.', note: '16–17 demo · minor safeguards on' },
    { key: 'admin', email: 'nethmi.admin@shaundavidstudios.lk', name: 'Nethmi Jayawardena', note: 'Studio admin · moderation tools' }
  ];

  async function renderWelcome(viewport) {
    let legalVersions = { terms: '1.0-draft', privacy: '1.0-draft', guidelines: '1.0' };
    viewport.innerHTML = `
      <section class="welcome-hero">
        <div class="welcome-badge-glow">${logo(196, 'welcome-badge')}</div>
        <div class="welcome-copy">
          <span class="pill-badge pill-orange">PHASE 2 · SRI LANKA</span>
          <h1 class="welcome-title">RIDERISE <span class="lk-gold">LK</span></h1>
          <p class="welcome-tagline">RIDE / STUNT / CONNECT</p>
          <p class="welcome-sub">A community, learning and bike-build platform for Sri Lankan bicycle stunt riders — built by <strong>Shaun David Studios</strong>.</p>
          <ul class="welcome-features">
            <li><span>🛡️</span> Server-validated rider ranks &amp; safe progression</li>
            <li><span>⚡</span> 21-module stunt learning library with quizzes</li>
            <li><span>🔧</span> Transparent Bike Build Rating (0–100)</li>
            <li><span>🛒</span> Sri Lankan parts catalog with verification labels</li>
            <li><span>📅</span> Official Shaun David Studios events</li>
            <li><span>🗺️</span> Opt-in guild live map with approximate sharing</li>
            <li><span>🎙️</span> Guild voice rooms and press-to-talk walkie-talkie</li>
            <li><span>🎓</span> Structured pathways plus a maintenance track</li>
          </ul>
          <div class="welcome-actions">
            <button type="button" class="btn btn-google" id="googleSignInBtn">
              <span class="google-g" aria-hidden="true">G</span> Continue with Google
            </button>
            <button type="button" class="btn btn-secondary" id="welcomeSafetyBtn">Safety Centre</button>
            <button type="button" class="btn btn-secondary" id="welcomeAdminBtn">Studio Admin</button>
          </div>
          <p class="welcome-fineprint">
            You must be <strong>at least 16 years old</strong>. RideRise LK never asks for your Google password —
            authentication uses Google's OAuth consent screen. By continuing you accept the
            <button class="link-inline" data-legal="terms_of_service">Terms</button>,
            <button class="link-inline" data-legal="privacy_policy">Privacy Policy</button>,
            <button class="link-inline" data-legal="community_guidelines">Community Guidelines</button> and
            <button class="link-inline" data-legal="safety_notice">Safety Notice</button>.
          </p>
          <div class="safety-strip" style="margin-top:18px">
            <div>
              <strong>Never ride stunts on public roads, in traffic, or near pedestrians.</strong>
              <div style="font-size:.78rem;color:var(--text-secondary)">Wear a fitted helmet, inspect your bike, and practise only in legal, controlled areas.</div>
            </div>
            <button class="btn btn-safety btn-sm" data-legal="safety_notice">Read the full notice</button>
          </div>
          <p class="welcome-fineprint" style="opacity:.75">
            Draft legal documents v${escapeHtml(legalVersions.terms)} — subject to legal review by qualified Sri Lankan counsel.
          </p>
        </div>
      </section>`;

    viewport.querySelector('#welcomeSafetyBtn').addEventListener('click', () => {
      location.hash = '#/safety';
    });
    viewport.querySelector('#welcomeAdminBtn').addEventListener('click', () => {
      location.hash = '#/admin';
    });
    viewport.querySelectorAll('[data-legal]').forEach((el) =>
      el.addEventListener('click', () => openLegalDocument(el.dataset.legal))
    );
    viewport.querySelector('#googleSignInBtn').addEventListener('click', openGoogleSignIn);
  }

  /* -------- Google OAuth integration point (production: Google Identity Services) ------- */
  function loadGoogleIdentityServices() {
    if (window.google && window.google.accounts && window.google.accounts.id) {
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      const existing = document.getElementById('gsiClient');
      if (existing) {
        existing.addEventListener('load', () => resolve(!!(window.google && window.google.accounts)));
        existing.addEventListener('error', () => resolve(false));
        return;
      }
      const script = document.createElement('script');
      script.id = 'gsiClient';
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = () => resolve(!!(window.google && window.google.accounts));
      script.onerror = () => resolve(false);
      document.head.appendChild(script);
      setTimeout(() => resolve(!!(window.google && window.google.accounts)), 6000);
    });
  }

  function openGoogleSignIn() {
    const configured = !!(window.RR_GOOGLE_CLIENT_ID && String(window.RR_GOOGLE_CLIENT_ID).trim());
    if (configured) {
      openRealGoogleSignIn();
      return;
    }
    modal({
      title: 'Sign in with Google',
      size: '560px',
      body: `
        <div class="oauth-sheet">
          <div class="oauth-brand"><span class="google-g">G</span><span>Sign in with Google</span></div>
          <p class="oauth-sub">Choose an account to continue to <strong>RideRise LK</strong>. RideRise LK will receive your name, email address and profile picture to create your rider profile. Your password is never shared with this app.</p>
          <div class="oauth-accounts">
            ${SAMPLE_IDENTITIES.map(
              (id) => `<button type="button" class="oauth-account" data-email="${escapeHtml(id.email)}" data-preset="${id.key}">
                <span class="oauth-avatar">${escapeHtml(id.name.slice(0, 1))}</span>
                <span class="oauth-account-text">
                  <strong>${escapeHtml(id.name)}</strong>
                  <small>${escapeHtml(id.email)}</small>
                  <em>${escapeHtml(id.note)}</em>
                </span>
              </button>`
            ).join('')}
          </div>
          <div class="oauth-divider"><span>or use another Google address</span></div>
          <form id="oauthCustomForm" class="oauth-form">
            <label class="form-label" for="oauthEmail">Google account email</label>
            <input class="form-input" id="oauthEmail" type="email" placeholder="you@gmail.com" autocomplete="email" required />
            <button class="btn btn-primary" type="submit" style="margin-top:10px">Continue</button>
          </form>
          <div class="oauth-error-cases">
            <span>Test authentication states:</span>
            <button type="button" class="link-inline" data-sim="cancelled">Cancel</button> ·
            <button type="button" class="link-inline" data-sim="network_unavailable">Network failure</button> ·
            <button type="button" class="link-inline" data-sim="invalid_credential">Invalid credential</button>
          </div>
          <p class="oauth-note">
            ${
              configured
                ? 'Google Identity Services client ID detected. Production builds exchange a Google ID token through the backend verifier.'
                : 'No <code>GOOGLE_CLIENT_ID</code> is configured for this deployment, so the sandbox OAuth bridge issues the same server-side session a real ID-token exchange would. See <code>docs/EXTERNAL_CONFIG.md</code>.'
            }
          </p>
        </div>`,
      onMount(root) {
        root.querySelectorAll('[data-preset]').forEach((btn) =>
          btn.addEventListener('click', () => completeSignIn({ email: btn.dataset.email, presetAccount: btn.dataset.preset }))
        );
        root.querySelector('#oauthCustomForm').addEventListener('submit', (e) => {
          e.preventDefault();
          const email = root.querySelector('#oauthEmail').value.trim();
          if (!email) return;
          completeSignIn({ email });
        });
        root.querySelectorAll('[data-sim]').forEach((btn) =>
          btn.addEventListener('click', () => completeSignIn({ simulateError: btn.dataset.sim }))
        );
      }
    });
  }

  async function openRealGoogleSignIn() {
    modal({
      title: 'Sign in with Google',
      size: '520px',
      body: `<div class="oauth-sheet">
          <div class="oauth-brand"><span class="google-g">G</span><span>Google Identity Services</span></div>
          <p class="oauth-sub">RideRise LK uses Google's official consent screen. Your password is entered only on Google's domain and is never seen by this app.</p>
          <div id="gsiButtonHost" style="min-height:48px;display:flex;justify-content:center"></div>
          <div id="gsiStatus" class="hint">Connecting to Google…</div>
        </div>`,
      onMount(root) {
        const host = root.querySelector('#gsiButtonHost');
        const status = root.querySelector('#gsiStatus');
        loadGoogleIdentityServices().then((available) => {
          if (!available || !window.google || !window.google.accounts) {
            status.innerHTML =
              'Google Identity Services could not be reached from this environment. Configure <code>GOOGLE_CLIENT_ID</code> and host the app over HTTPS — see <code>docs/GOOGLE_SIGNIN.md</code>.';
            return;
          }
          window.google.accounts.id.initialize({
            client_id: String(window.RR_GOOGLE_CLIENT_ID).trim(),
            callback: async (response) => {
              try {
                status.textContent = 'Verifying Google credential with the RideRise LK server…';
                const data = await api('/api/auth/google', { method: 'POST', body: { idToken: response.credential } });
                window.RR.setToken(data.token);
                state.account = data.account;
                state.profile = data.profile;
                closeModal();
                toast(`Signed in as ${data.account.email}`, 'success');
                if (data.onboardingRequired) location.hash = '#/onboarding';
                else {
                  await window.RR.refreshSession();
                  location.hash = '#/home';
                }
              } catch (err) {
                status.textContent = err.message;
                toast(err.message, 'error', 6000);
              }
            }
          });
          window.google.accounts.id.renderButton(host, {
            theme: 'filled_black',
            size: 'large',
            shape: 'pill',
            text: 'continue_with',
            width: 320
          });
          status.textContent = 'Choose your Google account to continue.';
        });
      }
    });
  }

  async function completeSignIn(payload) {
    const buttons = document.querySelectorAll('#modalRoot button');
    buttons.forEach((b) => (b.disabled = true));
    try {
      const data = await api('/api/auth/google', { method: 'POST', body: payload });
      window.RR.setToken(data.token);
      state.account = data.account;
      state.profile = data.profile;
      closeModal();
      toast(`Signed in as ${data.account.email}`, 'success');
      if (data.onboardingRequired) {
        location.hash = '#/onboarding';
      } else {
        await window.RR.refreshSession();
        location.hash = '#/home';
      }
    } catch (err) {
      closeModal();
      if (err.code === 'AUTH_CANCELLED') {
        toast(err.message, 'info');
      } else {
        modal({
          title: err.code === 'AUTH_UNAVAILABLE' ? 'Google sign-in unavailable' : 'Sign-in failed',
          size: '520px',
          body: `<p style="color:var(--text-secondary);font-size:.9rem">${escapeHtml(err.message)}</p>
            <p class="oauth-note" style="margin-top:10px">Nothing was charged or created. You can retry whenever you are ready.</p>`,
          footer: `<button class="btn btn-primary" id="retryGoogle">Retry sign-in</button>
                   <button class="btn btn-secondary" data-modal-close="1">Close</button>`,
          onMount(root) {
            root.querySelector('#retryGoogle').addEventListener('click', () => {
              closeModal();
              openGoogleSignIn();
            });
            root.querySelector('[data-modal-close]').addEventListener('click', closeModal);
          }
        });
      }
    }
  }

  /* --------------------------------- Onboarding -------------------------------- */
  async function renderOnboarding(viewport) {
    if (!state.token) {
      location.hash = '#/welcome';
      return;
    }
    let step = 1;
    const draft = {
      confirmAge16Plus: false,
      dob: '',
      ageBracket: '',
      acceptTerms: false,
      acceptPrivacy: false,
      acceptGuidelines: false,
      acceptSafetyNotice: false,
      username: '',
      displayName: '',
      district: '',
      preferredRidingArea: '',
      bio: '',
      profileVisibility: 'public',
      hideFromLeaderboards: false
    };
    let districts = ['Colombo', 'Gampaha', 'Kalutara (incl. Bentota)', 'Kandy', 'Galle', 'Matara', 'Kurunegala', 'Jaffna'];

    try {
      if (!state.config) state.config = await api('/api/config');
      districts = state.config.brand.sriLankaDistricts || districts;
      draft.district = districts[0];
      draft.displayName = (state.account && state.account.email ? state.account.email.split('@')[0] : '').slice(0, 30);
      draft.username = draft.displayName.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20);
    } catch (err) {
      viewport.innerHTML = window.RR.errorState(err);
      viewport.querySelector('[data-retry]').addEventListener('click', () => renderOnboarding(viewport));
      return;
    }

    function stepHeader() {
      return `<div class="wizard-steps" aria-label="Onboarding progress">
        ${[1, 2, 3, 4]
          .map(
            (n) =>
              `<div class="wizard-step ${n === step ? 'active' : ''} ${n < step ? 'done' : ''}"><span>${n < step ? '✓' : n}</span><em>${
                ['Age & safety', 'Legal consent', 'Rider profile', 'Privacy defaults'][n - 1]
              }</em></div>`
          )
          .join('')}
      </div>`;
    }

    function renderStep() {
      const body = (() => {
        if (step === 1) {
          return `<div class="wizard-panel">
            <h2>Confirm your age</h2>
            <p class="muted">RideRise LK is intended for riders aged <strong>16 and above</strong>. Your date of birth is private, stored separately from your public profile, never shown to other riders, and used only to apply youth safety defaults.</p>
            <label class="check-row">
              <input type="checkbox" id="ageConfirm" ${draft.confirmAge16Plus ? 'checked' : ''} />
              <span>I confirm that I am at least <strong>16 years old</strong>.</span>
            </label>
            <div class="form-group" style="margin-top:14px">
              <label class="form-label" for="dobInput">Date of birth (optional, private)</label>
              <input class="form-input" type="date" id="dobInput" value="${escapeHtml(draft.dob)}" max="2026-10-25" />
              <div class="hint">Providing it lets us apply 16–17 safety defaults automatically. A self-declaration is not identity verification — we enforce moderation and abuse-prevention safeguards regardless.</div>
            </div>
            <div class="callout callout-warn">
              <strong>Honest age note:</strong> a simple declaration cannot reliably verify age. RideRise LK layers rate limits, reporting, moderator review and restricted messaging on top of this declaration.
            </div>
          </div>`;
        }
        if (step === 2) {
          const docs = [
            ['acceptTerms', 'Terms of Service', 'terms_of_service'],
            ['acceptPrivacy', 'Privacy Policy', 'privacy_policy'],
            ['acceptGuidelines', 'Community Guidelines', 'community_guidelines'],
            ['acceptSafetyNotice', 'Mandatory Safety Notice (draft — subject to legal review)', 'safety_notice']
          ];
          return `<div class="wizard-panel">
            <h2>Read and accept before social features</h2>
            <p class="muted">Social features stay locked until all four documents are accepted. Tap any document to read it in full.</p>
            ${docs
              .map(
                ([key, label, slug]) => `<label class="check-row legal-row">
                  <input type="checkbox" data-legal-accept="${key}" ${draft[key] ? 'checked' : ''} />
                  <span>${escapeHtml(label)} <button type="button" class="link-inline" data-legal="${slug}">Read</button></span>
                </label>`
              )
              .join('')}
          </div>`;
        }
        if (step === 3) {
          return `<div class="wizard-panel">
            <h2>Create your rider profile</h2>
            <p class="muted">Only the minimum needed. You can add more later from your profile.</p>
            <div class="form-group">
              <label class="form-label" for="usernameInput">Unique username</label>
              <input class="form-input" id="usernameInput" value="${escapeHtml(draft.username)}" maxlength="24" pattern="[a-z0-9_]{3,24}" />
              <div class="hint" id="usernameHint">3–24 characters: lowercase letters, numbers, underscores. Displayed as @username.</div>
            </div>
            <div class="form-group">
              <label class="form-label" for="displayNameInput">Display name</label>
              <input class="form-input" id="displayNameInput" value="${escapeHtml(draft.displayName)}" maxlength="50" />
            </div>
            <div class="form-group">
              <label class="form-label" for="districtSelect">District</label>
              <select class="form-select" id="districtSelect">${districts
                .map((d) => `<option value="${escapeHtml(d)}" ${d === draft.district ? 'selected' : ''}>${escapeHtml(d)}</option>`)
                .join('')}</select>
              <div class="hint">District only — never your home address or GPS coordinates.</div>
            </div>
            <div class="form-group">
              <label class="form-label" for="ridingAreaInput">Preferred riding area (optional)</label>
              <input class="form-input" id="ridingAreaInput" value="${escapeHtml(draft.preferredRidingArea)}" placeholder="e.g. Bentota coastal practice court" maxlength="100" />
            </div>
            <div class="form-group">
              <label class="form-label" for="bioInput">Short biography (optional)</label>
              <textarea class="form-textarea" id="bioInput" maxlength="240" rows="3">${escapeHtml(draft.bio)}</textarea>
            </div>
          </div>`;
        }
        return `<div class="wizard-panel">
          <h2>Privacy defaults</h2>
          <p class="muted">Privacy-friendly by default. You can change all of this at any time in Settings.</p>
          <div class="form-group">
            <label class="form-label" for="visibilitySelect">Profile visibility</label>
            <select class="form-select" id="visibilitySelect">
              <option value="public" ${draft.profileVisibility === 'public' ? 'selected' : ''}>Public — riders can find me</option>
              <option value="friends" ${draft.profileVisibility === 'friends' ? 'selected' : ''}>Friends only — full profile hidden</option>
              <option value="private" ${draft.profileVisibility === 'private' ? 'selected' : ''}>Private — minimal card only</option>
            </select>
          </div>
          <label class="check-row">
            <input type="checkbox" id="hideLeaderboard" ${draft.hideFromLeaderboards ? 'checked' : ''} />
            <span>Hide me from public leaderboards</span>
          </label>
          <div class="callout">
            <strong>Fixed safety defaults:</strong> messages are restricted to accepted friends, friend requests can be turned off, nobody can see your email, date of birth, phone number or exact location, and blocking instantly stops all contact.
          </div>
          <div class="callout callout-warn">
            <strong>Stunt safety:</strong> RideRise LK will never reward dangerous riding, road stunts or escalating risk. Progression comes from learning modules, bike inspections and positive community help.
          </div>
        </div>`;
      })();

      viewport.innerHTML = `
        <div class="wizard-shell">
          <div class="wizard-brand">${logo(64)}<div><strong>RIDE RISE LK</strong><small>Onboarding · ${state.account ? escapeHtml(state.account.email) : ''}</small></div></div>
          ${stepHeader()}
          ${body}
          <div class="wizard-footer">
            <button type="button" class="btn btn-secondary" id="wizardBack" ${step === 1 ? 'disabled' : ''}>Back</button>
            <button type="button" class="btn btn-primary" id="wizardNext">${step === 4 ? 'Create my rider account' : 'Continue'}</button>
          </div>
          <p class="hint" style="text-align:center">Signed in with Google. <button class="link-inline" id="onboardingSignOut">Use a different account</button></p>
        </div>`;

      // wire step inputs
      if (step === 1) {
        viewport.querySelector('#ageConfirm').addEventListener('change', (e) => (draft.confirmAge16Plus = e.target.checked));
        viewport.querySelector('#dobInput').addEventListener('change', (e) => (draft.dob = e.target.value));
      }
      if (step === 2) {
        viewport.querySelectorAll('[data-legal-accept]').forEach((el) =>
          el.addEventListener('change', () => {
            draft[el.dataset.legalAccept] = el.checked;
          })
        );
      }
      if (step === 3) {
        const usernameInput = viewport.querySelector('#usernameInput');
        const hint = viewport.querySelector('#usernameHint');
        usernameInput.addEventListener('input', () => {
          draft.username = usernameInput.value.trim().toLowerCase();
          const valid = /^[a-z0-9_]{3,24}$/.test(draft.username);
          hint.textContent = valid
            ? 'Looks good — usernames are unique and checked on save.'
            : '3–24 characters: lowercase letters, numbers, underscores only.';
          hint.style.color = valid ? 'var(--success-green)' : 'var(--warning-amber)';
        });
        viewport.querySelector('#displayNameInput').addEventListener('input', (e) => (draft.displayName = e.target.value));
        viewport.querySelector('#districtSelect').addEventListener('change', (e) => (draft.district = e.target.value));
        viewport.querySelector('#ridingAreaInput').addEventListener('input', (e) => (draft.preferredRidingArea = e.target.value));
        viewport.querySelector('#bioInput').addEventListener('input', (e) => (draft.bio = e.target.value));
      }
      if (step === 4) {
        viewport.querySelector('#visibilitySelect').addEventListener('change', (e) => (draft.profileVisibility = e.target.value));
        viewport.querySelector('#hideLeaderboard').addEventListener('change', (e) => (draft.hideFromLeaderboards = e.target.checked));
      }
      viewport.querySelectorAll('[data-legal]').forEach((el) =>
        el.addEventListener('click', () => openLegalDocument(el.dataset.legal))
      );
      viewport.querySelector('#wizardBack').addEventListener('click', () => {
        if (step > 1) {
          step -= 1;
          renderStep();
        }
      });
      viewport.querySelector('#onboardingSignOut').addEventListener('click', async () => {
        window.RR.setToken('');
        state.account = null;
        state.profile = null;
        location.hash = '#/welcome';
      });
      viewport.querySelector('#wizardNext').addEventListener('click', onSubmit);
    }

    async function onSubmit() {
      if (step === 1) {
        if (!draft.confirmAge16Plus) {
          toast('You must confirm you are at least 16 years old to continue.', 'error');
          return;
        }
        if (draft.dob) {
          const age = computeAge(draft.dob);
          if (age !== null && age < 16) {
            toast('RideRise LK accounts require riders aged 16 or older.', 'error');
            return;
          }
        }
        step = 2;
        return renderStep();
      }
      if (step === 2) {
        if (!draft.acceptTerms || !draft.acceptPrivacy || !draft.acceptGuidelines || !draft.acceptSafetyNotice) {
          toast('Please read and accept all four documents to unlock social features.', 'error');
          return;
        }
        step = 3;
        return renderStep();
      }
      if (step === 3) {
        if (!/^[a-z0-9_]{3,24}$/.test(draft.username)) {
          toast('Choose a username with 3–24 lowercase letters, numbers or underscores.', 'error');
          return;
        }
        if (!draft.displayName.trim()) {
          toast('Please add a display name.', 'error');
          return;
        }
        step = 4;
        return renderStep();
      }

      const btn = viewport.querySelector('#wizardNext');
      btn.disabled = true;
      btn.textContent = 'Creating account…';
      try {
        const result = await api('/api/auth/onboarding', { method: 'POST', body: draft });
        await window.RR.refreshSession();
        toast(result.message || 'Welcome to RideRise LK!', 'success');
        if (result.isMinor) {
          toast('Youth safeguards applied: profile defaults to friends-only and hidden from public leaderboards.', 'info', 7000);
        }
        location.hash = '#/home';
      } catch (err) {
        toast(err.message, 'error', 6000);
        btn.disabled = false;
        btn.textContent = 'Create my rider account';
      }
    }

    renderStep();
  }

  function computeAge(dobStr) {
    const dob = new Date(dobStr);
    if (Number.isNaN(dob.getTime())) return null;
    const now = new Date();
    let age = now.getFullYear() - dob.getFullYear();
    const m = now.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age -= 1;
    return age;
  }

  /* ------------------------------- Legal documents ------------------------------ */
  async function openLegalDocument(slug) {
    modal({
      title: 'Loading document…',
      size: '760px',
      body: skeletonList(3)
    });
    try {
      const data = state.config && state.config.legalDocuments ? state.config.legalDocuments : (await api('/api/config')).legalDocuments;
      state.config = state.config || (await api('/api/config'));
      const doc = (data || []).find((d) => d.slug === slug);
      if (!doc) throw new Error('Document unavailable.');
      modal({
        title: doc.title,
        size: '760px',
        body: `<div class="legal-meta">Version ${escapeHtml(doc.version)} · Updated ${escapeHtml(
          new Date(doc.updated_at).toLocaleDateString('en-GB')
        )} · Shaun David Studios</div>
        <article class="legal-body">${markdownToHtml(doc.content_markdown)}</article>
        <div class="callout callout-warn" style="margin-top:14px">
          These documents are working drafts and require review by qualified Sri Lankan legal counsel before commercial release.
        </div>`,
        footer: '<button class="btn btn-secondary" data-modal-close="1">Close</button>',
        onMount(root) {
          root.querySelector('[data-modal-close]').addEventListener('click', closeModal);
        }
      });
    } catch (err) {
      modal({
        title: 'Document unavailable',
        body: `<p style="color:var(--text-secondary)">${escapeHtml(err.message)}</p>`,
        footer: '<button class="btn btn-secondary" data-modal-close="1">Close</button>',
        onMount(root) {
          root.querySelector('[data-modal-close]').addEventListener('click', closeModal);
        }
      });
    }
  }

  function markdownToHtml(md) {
    const esc = escapeHtml(md || '');
    return esc
      .split(/\n{2,}/)
      .map((block) => {
        const trimmed = block.trim();
        if (!trimmed) return '';
        if (trimmed.startsWith('### ')) return `<h3>${trimmed.slice(4)}</h3>`;
        if (trimmed.startsWith('## ')) return `<h2>${trimmed.slice(3)}</h2>`;
        if (trimmed.startsWith('# ')) return `<h2>${trimmed.slice(2)}</h2>`;
        if (trimmed.startsWith('> ')) {
          return `<blockquote>${trimmed
            .split('\n')
            .map((l) => l.replace(/^>\s?/, ''))
            .join(' ')}</blockquote>`;
        }
        if (/^\d+\.\s/m.test(trimmed) && trimmed.split('\n').every((l) => /^\d+\.\s/.test(l.trim()))) {
          return `<ol>${trimmed
            .split('\n')
            .map((l) => `<li>${l.replace(/^\d+\.\s*/, '')}</li>`)
            .join('')}</ol>`;
        }
        if (trimmed.split('\n').every((l) => /^[-*]\s/.test(l.trim()))) {
          return `<ul>${trimmed
            .split('\n')
            .map((l) => `<li>${l.replace(/^[-*]\s*/, '')}</li>`)
            .join('')}</ul>`;
        }
        return `<p>${trimmed
          .split('\n')
          .map((l) => l.replace(/^[-*]\s*/, ''))
          .join('<br/>')
          .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
          .replace(/`(.+?)`/g, '<code>$1</code>')}</p>`;
      })
      .join('');
  }

  window.RRAuth = { renderWelcome, renderOnboarding, openGoogleSignIn, openLegalDocument, markdownToHtml, computeAge };
})();
