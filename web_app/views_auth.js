/* RideRise LK — Sign up / sign in (Firebase email + password), onboarding wizard & legal documents */
(function () {
  'use strict';
  const { api, state, t, escapeHtml, toast, modal, closeModal, logo, skeletonList } = window.RR;

  let authMode = 'signin'; // 'signin' | 'signup' | 'complete-profile'
  let pendingSignup = null; // { username, displayName } kept only in memory for safe retries
  let availabilityTimer = null;

  function firebase() {
    return window.RRFirebase || null;
  }

  function firebaseReady() {
    return Boolean(firebase() && firebase().isConfigured());
  }

  function firebaseConfigFromState() {
    const cfg = state.config && state.config.firebase;
    return cfg && cfg.configured ? cfg.config : null;
  }

  /* --------------------------------- Welcome -------------------------------- */

  async function renderWelcome(viewport) {
    if (!state.config) {
      try {
        state.config = await api('/api/config');
      } catch (err) {
        /* the form still renders; submitting will surface the network error */
      }
    }
    if (firebase() && !firebase().isConfigured() && firebaseConfigFromState()) {
      firebase().configure(firebaseConfigFromState());
    }
    // A rider who signed up but has not clicked the verification link yet lands here.
    const pending = firebase() ? firebase().pendingVerification() : null;
    if (pending && !state.token) {
      renderVerifyGate(viewport, pending.email);
      return;
    }

    // The Firebase SDK runs in this browser, but the SERVER must reach Google to verify the
    // resulting ID token. A blocked egress route is a server problem, so say so up front
    // instead of letting it look like a wrong password.
    const firebaseServer = state.config && state.config.firebase ? state.config.firebase : null;
    const verifierBlocked = Boolean(firebaseServer && firebaseServer.verifier && firebaseServer.verifier.status === 'unreachable');
    viewport.innerHTML = `
      <section class="welcome-hero">
        <div class="welcome-badge-glow">${logo(196, 'welcome-badge')}</div>
        <div class="welcome-copy">
          <span class="pill-badge pill-orange">PHASE 2 · SRI LANKA</span>
          <h1 class="welcome-title">RIDERISE <span class="lk-gold">LK</span></h1>
          <p class="welcome-tagline">RIDE / STUNT / CONNECT</p>
          <p class="welcome-sub">A community, learning and bike-build platform for Sri Lankan bicycle stunt riders — built by <strong>Shaun David Studios</strong>.</p>

          <div class="auth-card" id="authCard">
            ${
              verifierBlocked
                ? `<div class="auth-notice auth-notice-error" role="alert">
                     <strong>This server cannot reach Google to verify sign-ins right now.</strong>
                     <p>Firebase Authentication is configured for project <code>${escapeHtml(firebaseServer.projectId || '')}</code>,
                     but this host has no outbound access to Google's token-verification endpoint
                     (<code>www.googleapis.com</code>). Creating an account here would still register it in
                     Firebase, yet the session could not be confirmed.</p>
                     <p>Run the app on a machine or host with normal internet access (the Windows/Chrome
                     setup in <code>docs/FIREBASE_AUTH.md</code>), then sign in there. Nothing about your
                     email address or password is wrong.</p>
                   </div>`
                : ''
            }
            <div class="auth-tabs" role="tablist" aria-label="Sign in or create an account">
              <button type="button" role="tab" class="auth-tab" data-auth-tab="signin" aria-selected="${authMode === 'signin'}">Sign in</button>
              <button type="button" role="tab" class="auth-tab" data-auth-tab="signup" aria-selected="${authMode === 'signup'}">Create account</button>
            </div>
            <div id="authFormHost" class="auth-form-host"></div>
            <p class="auth-status" id="authStatus" role="status" aria-live="polite"></p>
            <p class="auth-fineprint">
              Email and password accounts are secured by <strong>Firebase Authentication</strong>.
              RideRise LK never stores or logs your password. You must be <strong>at least 16 years old</strong>.
            </p>
          </div>

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

          <p class="welcome-fineprint">
            By continuing you accept the
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
          <div class="welcome-actions" style="margin-top:14px">
            <button type="button" class="btn btn-secondary" id="welcomeSafetyBtn">Safety Centre</button>
            <button type="button" class="btn btn-secondary" id="welcomeAdminBtn">Studio Admin</button>
          </div>
          <p class="welcome-fineprint" style="opacity:.75">
            Draft legal documents — subject to legal review by qualified Sri Lankan counsel.
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
    viewport.querySelectorAll('[data-auth-tab]').forEach((tab) =>
      tab.addEventListener('click', () => {
        authMode = tab.dataset.authTab;
        paintAuthTabs(viewport);
        mountAuthForm(viewport);
      })
    );
    paintAuthTabs(viewport);
    mountAuthForm(viewport);
  }

  function paintAuthTabs(viewport) {
    viewport.querySelectorAll('[data-auth-tab]').forEach((tab) => {
      const active = tab.dataset.authTab === authMode;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
  }

  function authStatus(viewport, message, kind) {
    const el = viewport.querySelector('#authStatus');
    if (!el) return;
    el.textContent = message || '';
    el.className = `auth-status${message ? ' is-visible' : ''}${kind ? ` is-${kind}` : ''}`;
  }

  function mountAuthForm(viewport) {
    const host = viewport.querySelector('#authFormHost');
    if (!host) return;
    authStatus(viewport, '');
    if (authMode === 'signup') renderSignUpForm(host, viewport);
    else renderSignInForm(host, viewport);
  }

  function firebaseUnavailableHtml() {
    const availability = state.config && state.config.firebase;
    const detail = availability && availability.message ? availability.message : 'Firebase Authentication is not available.';
    return `<div class="auth-notice" role="note">
        <strong>Email sign-in is not configured on this server yet.</strong>
        <p>${escapeHtml(detail)} The studio administrator must add the Firebase project keys
        (<code>FIREBASE_PROJECT_ID</code>, <code>FIREBASE_API_KEY</code>) — see
        <code>docs/FIREBASE_AUTH.md</code>. Nothing is simulated: sign-in stays disabled until a real
        Firebase project is connected.</p>
      </div>`;
  }

  function renderSignInForm(host, viewport) {
    const ready = firebaseReady();
    if (!ready && (!firebase() || !firebase().sdkAvailable())) {
      host.innerHTML = firebaseUnavailableHtml();
      return;
    }
    host.innerHTML = `
      ${ready ? '' : firebaseUnavailableHtml()}
      <fieldset class="auth-fieldset" ${ready ? '' : 'disabled'} style="border:0;padding:0;margin:0">
      <form id="signInForm" class="auth-form" novalidate>
        <div class="form-group">
          <label class="form-label" for="siEmail">Email address</label>
          <input class="form-input" id="siEmail" name="email" type="email" autocomplete="email" inputmode="email" required />
        </div>
        <div class="form-group">
          <label class="form-label" for="siPassword">Password</label>
          <div class="auth-password">
            <input class="form-input" id="siPassword" name="password" type="password" autocomplete="current-password" required />
            <button type="button" class="auth-pw-toggle" data-toggle-password="siPassword" aria-label="Show password">Show</button>
          </div>
        </div>
        <button class="btn btn-primary btn-block" id="siSubmit" type="submit">Sign in</button>
        <div class="auth-links">
          <button type="button" class="link-inline" id="forgotPasswordBtn">Forgot your password?</button>
          <button type="button" class="link-inline" id="toSignUpBtn">Create an account</button>
        </div>
      </form>
      </fieldset>`;

    host.querySelectorAll('[data-toggle-password]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const input = host.querySelector(`#${btn.dataset.togglePassword}`);
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        btn.textContent = show ? 'Hide' : 'Show';
        btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      });
    });
    host.querySelector('#forgotPasswordBtn').addEventListener('click', () => openForgotPassword(viewport));
    host.querySelector('#toSignUpBtn').addEventListener('click', () => {
      authMode = 'signup';
      paintAuthTabs(viewport);
      mountAuthForm(viewport);
    });
    host.querySelector('#signInForm').addEventListener('submit', (event) => {
      event.preventDefault();
      submitSignIn(viewport, event.currentTarget);
    });
  }

  function passwordPolicyHtml() {
    return `<p class="auth-hint" id="suPasswordHint">At least 10 characters, including a letter and a number.</p>`;
  }

  function renderSignUpForm(host, viewport) {
    const ready = firebaseReady();
    if (!ready && (!firebase() || !firebase().sdkAvailable())) {
      host.innerHTML = firebaseUnavailableHtml();
      return;
    }
    host.innerHTML = `
      ${ready ? '' : firebaseUnavailableHtml()}
      <fieldset class="auth-fieldset" ${ready ? '' : 'disabled'} style="border:0;padding:0;margin:0">
      <form id="signUpForm" class="auth-form" novalidate>
        <div class="form-group">
          <label class="form-label" for="suUsername">Username</label>
          <input class="form-input" id="suUsername" name="username" type="text" autocomplete="username"
                 spellcheck="false" maxlength="24" placeholder="e.g. kasun_bmx" required />
          <p class="auth-hint" id="suUsernameHint">3–24 characters: lowercase letters, numbers or underscores.</p>
        </div>
        <div class="form-group">
          <label class="form-label" for="suEmail">Email address</label>
          <input class="form-input" id="suEmail" name="email" type="email" autocomplete="email" inputmode="email" required />
          <p class="auth-hint">We email a verification link. Community features unlock once it is confirmed.</p>
        </div>
        <div class="form-group">
          <label class="form-label" for="suPassword">Password</label>
          <div class="auth-password">
            <input class="form-input" id="suPassword" name="password" type="password" autocomplete="new-password" required />
            <button type="button" class="auth-pw-toggle" data-toggle-password="suPassword" aria-label="Show password">Show</button>
          </div>
          ${passwordPolicyHtml()}
        </div>
        <div class="form-group">
          <label class="form-label" for="suConfirm">Confirm password</label>
          <div class="auth-password">
            <input class="form-input" id="suConfirm" name="confirm" type="password" autocomplete="new-password" required />
            <button type="button" class="auth-pw-toggle" data-toggle-password="suConfirm" aria-label="Show password">Show</button>
          </div>
        </div>
        <button class="btn btn-primary btn-block" id="suSubmit" type="submit">Create my account</button>
        <div class="auth-links">
          <button type="button" class="link-inline" id="toSignInBtn">I already have an account</button>
        </div>
      </form>
      </fieldset>`;

    const usernameInput = host.querySelector('#suUsername');
    usernameInput.addEventListener('input', () => scheduleUsernameCheck(host, viewport, usernameInput.value));
    host.querySelectorAll('[data-toggle-password]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const input = host.querySelector(`#${btn.dataset.togglePassword}`);
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        btn.textContent = show ? 'Hide' : 'Show';
      });
    });
    host.querySelector('#toSignInBtn').addEventListener('click', () => {
      authMode = 'signin';
      paintAuthTabs(viewport);
      mountAuthForm(viewport);
    });
    host.querySelector('#signUpForm').addEventListener('submit', (event) => {
      event.preventDefault();
      submitSignUp(viewport, event.currentTarget);
    });
  }

  function scheduleUsernameCheck(host, viewport, value) {
    if (availabilityTimer) clearTimeout(availabilityTimer);
    const hint = host.querySelector('#suUsernameHint');
    const username = String(value || '').trim().toLowerCase();
    if (!username) {
      hint.className = 'auth-hint';
      hint.textContent = '3–24 characters: lowercase letters, numbers or underscores.';
      return;
    }
    const local = firebase().validateUsername(username);
    if (!local.ok) {
      hint.className = 'auth-hint is-error';
      hint.textContent = local.message;
      return;
    }
    hint.className = 'auth-hint';
    hint.textContent = 'Checking availability…';
    availabilityTimer = setTimeout(async () => {
      try {
        const result = await api(`/api/auth/username-available?username=${encodeURIComponent(username)}`);
        if (result.available) {
          hint.className = 'auth-hint is-ok';
          hint.textContent = `@${result.username} is available.`;
        } else {
          hint.className = 'auth-hint is-error';
          hint.innerHTML = `@${escapeHtml(result.username)} is already taken.${
            (result.suggestions || []).length
              ? ` Try ${result.suggestions.map((s) => `<button type="button" class="link-inline" data-use-username="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join(', ')}.`
              : ''
          }`;
          hint.querySelectorAll('[data-use-username]').forEach((btn) =>
            btn.addEventListener('click', () => {
              const input = host.querySelector('#suUsername');
              input.value = btn.dataset.useUsername;
              scheduleUsernameCheck(host, viewport, input.value);
            })
          );
        }
      } catch (err) {
        hint.className = 'auth-hint';
        hint.textContent = 'Availability could not be checked right now — we will check again when you submit.';
      }
    }, 450);
  }

  /* ------------------------------ sign in / up ------------------------------ */

  function setBusy(viewport, busy, label) {
    const button = viewport.querySelector('#siSubmit, #suSubmit');
    if (!button) return;
    if (busy) {
      button.dataset.label = button.textContent;
      button.disabled = true;
      button.textContent = label || 'Please wait…';
    } else {
      button.disabled = false;
      if (button.dataset.label) button.textContent = button.dataset.label;
    }
  }

  async function submitSignIn(viewport, form) {
    const email = form.querySelector('#siEmail').value.trim();
    const password = form.querySelector('#siPassword').value;
    const fb = firebase();
    if (!fb.isEmail(email)) return authStatus(viewport, 'Enter a valid email address.', 'error');
    if (!password) return authStatus(viewport, 'Enter your password.', 'error');

    setBusy(viewport, true, 'Signing in…');
    authStatus(viewport, 'Contacting Firebase…');
    try {
      await fb.signIn(email, password);
      authStatus(viewport, 'Signing you in…');
      await exchangeFirebaseSession(viewport, { from: 'signin' });
    } catch (err) {
      authStatus(viewport, err.message || 'Sign-in failed.', 'error');
      setBusy(viewport, false);
    }
  }

  async function submitSignUp(viewport, form) {
    const fb = firebase();
    const username = form.querySelector('#suUsername').value.trim().toLowerCase();
    const email = form.querySelector('#suEmail').value.trim();
    const password = form.querySelector('#suPassword').value;
    const confirm = form.querySelector('#suConfirm').value;

    const usernameCheck = fb.validateUsername(username);
    if (!usernameCheck.ok) return authStatus(viewport, usernameCheck.message, 'error');
    if (!fb.isEmail(email)) return authStatus(viewport, 'Enter a valid email address.', 'error');
    const passwordIssue = fb.passwordProblem(password);
    if (passwordIssue) return authStatus(viewport, passwordIssue, 'error');
    if (password !== confirm) return authStatus(viewport, 'The two passwords do not match.', 'error');

    setBusy(viewport, true, 'Creating account…');
    authStatus(viewport, 'Checking that your username is free…');
    try {
      const availability = await api(`/api/auth/username-available?username=${encodeURIComponent(username)}`);
      if (!availability.available) {
        authStatus(viewport, availability.message || 'That username is taken.', 'error');
        setBusy(viewport, false);
        return;
      }
    } catch (err) {
      authStatus(viewport, 'Could not reach the server to check your username. Check your connection and try again.', 'error');
      setBusy(viewport, false);
      return;
    }

    authStatus(viewport, 'Creating your Firebase account…');
    try {
      await fb.signUp(email, password);
    } catch (err) {
      authStatus(viewport, err.message, 'error');
      setBusy(viewport, false);
      return;
    }

    // Best effort: a failed verification email must not lose the new Firebase account.
    try {
      await fb.sendVerificationEmail();
    } catch (err) {
      toast('Account created, but the verification email could not be sent yet. Use “Resend email” on the next screen.', 'error', 7000);
    }
    fb.rememberPendingVerification(email);
    pendingSignup = { username, email };

    authStatus(viewport, 'Saving your RideRise LK profile…');
    await createProfile(viewport, { username });
  }

  /** Create (or retry creating) the SQLite profile for the signed-in Firebase user. */
  async function createProfile(viewport, { username }) {
    const fb = firebase();
    let idToken;
    try {
      idToken = await fb.getIdToken(true);
    } catch (err) {
      authStatus(viewport, 'Your session could not be read. Sign in again to finish setting up.', 'error');
      setBusy(viewport, false);
      return;
    }
    try {
      const data = await api('/api/auth/firebase/signup', {
        method: 'POST',
        body: { idToken, username, displayName: username }
      });
      pendingSignup = null;
      fb.clearPendingVerification();
      await finishSession(data);
    } catch (err) {
      if (err.code === 'EMAIL_NOT_VERIFIED') {
        pendingSignup = { username };
        renderVerifyGate(viewport, err.payload && err.payload.email ? err.payload.email : (fb.currentUser() || {}).email || '');
        return;
      }
      if (err.code === 'USERNAME_TAKEN') {
        authStatus(viewport, err.message, 'error');
        setBusy(viewport, false);
        return;
      }
      if (err.code === 'PROFILE_CREATE_FAILED' || err.code === 'PROFILE_CONFLICT') {
        pendingSignup = { username };
        authStatus(
          viewport,
          `${err.message} Your username is reserved — press “Retry profile setup” to try again.`,
          'error'
        );
        showRetryProfileButton(viewport, username);
        setBusy(viewport, false);
        return;
      }
      if (err.code === 'ACCOUNT_LINK_REQUIRED') {
        authStatus(viewport, err.message, 'error');
        setBusy(viewport, false);
        return;
      }
      authStatus(viewport, err.message || 'Your profile could not be created.', 'error');
      setBusy(viewport, false);
    }
  }

  function showRetryProfileButton(viewport, username) {
    const host = viewport.querySelector('#authFormHost');
    if (!host || host.querySelector('#retryProfile')) return;
    const button = document.createElement('button');
    button.id = 'retryProfile';
    button.type = 'button';
    button.className = 'btn btn-primary btn-block';
    button.style.marginTop = '10px';
    button.textContent = 'Retry profile setup';
    button.addEventListener('click', () => {
      button.disabled = true;
      button.textContent = 'Retrying…';
      createProfile(viewport, { username: username || (pendingSignup && pendingSignup.username) || '' });
    });
    host.appendChild(button);
  }

  /** Exchange the current Firebase ID token for a RideRise session. */
  async function exchangeFirebaseSession(viewport, options = {}) {
    const fb = firebase();
    let idToken;
    try {
      idToken = await fb.getIdToken(true);
    } catch (err) {
      authStatus(viewport, 'Your Firebase session expired. Sign in again.', 'error');
      return null;
    }
    try {
      const data = await api('/api/auth/firebase/session', { method: 'POST', body: { idToken } });
      fb.clearPendingVerification();
      await finishSession(data);
      return data;
    } catch (err) {
      if (err.code === 'EMAIL_NOT_VERIFIED') {
        const email = (err.payload && err.payload.email) || (fb.currentUser() || {}).email || '';
        fb.rememberPendingVerification(email);
        renderVerifyGate(viewport, email);
        return null;
      }
      if (err.code === 'PROFILE_REQUIRED') {
        const email = (err.payload && err.payload.email) || (fb.currentUser() || {}).email || '';
        renderCompleteProfile(viewport, email);
        return null;
      }
      authStatus(viewport, err.message || 'Sign-in could not be completed.', 'error');
      setBusy(viewport, false);
      return null;
    }
  }

  function renderCompleteProfile(viewport, email) {
    viewport.innerHTML = `
      <section class="welcome-hero" style="grid-template-columns:1fr;max-width:640px;margin:0 auto">
        <div class="welcome-copy">
          <span class="pill-badge pill-orange">One more step</span>
          <h1 class="welcome-title" style="font-size:1.6rem">Finish your rider profile</h1>
          <p class="welcome-sub">Your Firebase account <strong>${escapeHtml(email)}</strong> does not have a RideRise LK profile yet.
          Choose the username riders will see. Nothing is duplicated: this completes the account you already created.</p>
          <div class="auth-card">
            <form id="completeForm" class="auth-form" novalidate>
              <div class="form-group">
                <label class="form-label" for="cpUsername">Username</label>
                <input class="form-input" id="cpUsername" type="text" maxlength="24" spellcheck="false" required />
                <p class="auth-hint">3–24 characters: lowercase letters, numbers or underscores.</p>
              </div>
              <button class="btn btn-primary btn-block" type="submit" id="cpSubmit">Create my profile</button>
            </form>
            <p class="auth-status" id="cpStatus" role="status" aria-live="polite"></p>
          </div>
        </div>
      </section>`;
    viewport.querySelector('#completeForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const status = viewport.querySelector('#cpStatus');
      const username = viewport.querySelector('#cpUsername').value.trim().toLowerCase();
      const check = firebase().validateUsername(username);
      if (!check.ok) {
        status.textContent = check.message;
        status.className = 'auth-status is-visible is-error';
        return;
      }
      viewport.querySelector('#cpSubmit').disabled = true;
      status.textContent = 'Creating your profile…';
      status.className = 'auth-status is-visible';
      await createProfile(viewport, { username });
    });
  }

  /* ----------------------------- verification gate -------------------------- */

  function renderVerifyGate(viewport, email) {
    const fb = firebase();
    const address = email || (fb && fb.currentUser() ? fb.currentUser().email : '') || '';
    viewport.innerHTML = `
      <section class="welcome-hero" style="grid-template-columns:1fr;max-width:640px;margin:0 auto">
        <div class="welcome-copy">
          <div class="verify-badge" aria-hidden="true">✉️</div>
          <h1 class="welcome-title" style="font-size:1.6rem">Verify your email</h1>
          <p class="welcome-sub">We sent a verification link to <strong>${escapeHtml(address)}</strong>.
          Open it, then come back here. Community features — the feed, guilds, messages and events — stay
          locked until your address is confirmed.</p>
          <div class="auth-card">
            <div class="verify-actions">
              <button class="btn btn-primary btn-block" id="verifyContinue">I've verified my email</button>
              <button class="btn btn-secondary btn-block" id="verifyResend">Resend verification email</button>
              <button class="btn btn-secondary btn-block" id="verifySignOut">Use a different account</button>
            </div>
            <p class="auth-status" id="verifyStatus" role="status" aria-live="polite"></p>
            <p class="auth-fineprint">The link can take a minute to arrive. Check spam if it does not.
              Email verification is required by Firebase Authentication and is enforced by the RideRise LK server.</p>
          </div>
        </div>
      </section>`;

    const status = (message, kind) => {
      const el = viewport.querySelector('#verifyStatus');
      el.textContent = message || '';
      el.className = `auth-status${message ? ' is-visible' : ''}${kind ? ` is-${kind}` : ''}`;
    };

    if (!fb || !fb.isConfigured() || !fb.currentUser()) {
      status('Sign in again to request another verification email.', 'error');
      viewport.querySelector('#verifyContinue').disabled = true;
      viewport.querySelector('#verifyResend').disabled = true;
    }

    viewport.querySelector('#verifyContinue').addEventListener('click', async () => {
      const button = viewport.querySelector('#verifyContinue');
      button.disabled = true;
      status('Checking with Firebase…');
      try {
        const user = await fb.reloadUser();
        if (!user || !user.emailVerified) {
          status('Not verified yet. Open the link in your inbox, then press this button again.', 'error');
          button.disabled = false;
          return;
        }
        await fb.getIdToken(true);
        status('Verified! Restoring your profile…');
        if (pendingSignup && pendingSignup.username) {
          await createProfile(viewport, { username: pendingSignup.username });
        } else {
          await exchangeFirebaseSession(viewport, { from: 'verify' });
        }
      } catch (err) {
        status(err.message || 'Verification could not be checked. Try again.', 'error');
        button.disabled = false;
      }
    });

    viewport.querySelector('#verifyResend').addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      status('Sending another verification email…');
      try {
        await fb.sendVerificationEmail();
        status(`Sent. Check ${address} (and the spam folder). You can resend again in 60 seconds.`);
        setTimeout(() => {
          if (button.isConnected) button.disabled = false;
        }, 60000);
      } catch (err) {
        status(err.message || 'The email could not be sent. Try again in a minute.', 'error');
        button.disabled = false;
      }
    });

    viewport.querySelector('#verifySignOut').addEventListener('click', async () => {
      if (fb) await fb.signOut();
      if (fb) fb.clearPendingVerification();
      pendingSignup = null;
      authMode = 'signin';
      renderWelcome(viewport);
    });
  }

  async function finishSession(data) {
    window.RR.setToken(data.token);
    state.account = data.account;
    state.profile = data.profile;
    try {
      await window.RR.refreshSession();
    } catch (err) {
      /* the session works; counters will catch up on the next poll */
    }
    toast(data.newAccount ? 'Welcome to RideRise LK. Check your inbox to verify your email.' : 'Signed in.', 'success');
    if (window.RRApp) window.RRApp.paintChrome();
    location.hash = data.onboardingRequired ? '#/onboarding' : '#/home';
    if (window.RRApp) window.RRApp.route();
  }

  /* ------------------------------- password reset --------------------------- */

  function openForgotPassword(viewport) {
    const fb = firebase();
    const prefilled = (viewport && viewport.querySelector && viewport.querySelector('#siEmail') ? viewport.querySelector('#siEmail').value : '').trim();
    modal({
      title: 'Reset your password',
      size: '520px',
      body: `<p class="muted" style="font-size:.88rem">Enter the email address you signed up with. Firebase emails you a secure reset link; RideRise LK never sees or stores your password.</p>
        <div class="form-group">
          <label class="form-label" for="fpEmail">Email address</label>
          <input class="form-input" id="fpEmail" type="email" autocomplete="email" value="${escapeHtml(prefilled)}" />
        </div>
        <p class="auth-status" id="fpStatus" role="status" aria-live="polite"></p>`,
      footer: '<button class="btn btn-secondary" data-modal-close="1">Cancel</button><button class="btn btn-primary" id="fpSend">Send reset link</button>',
      onMount(root) {
        const status = (message, kind) => {
          const el = root.querySelector('#fpStatus');
          el.textContent = message || '';
          el.className = `auth-status${message ? ' is-visible' : ''}${kind ? ` is-${kind}` : ''}`;
        };
        root.querySelector('[data-modal-close]').addEventListener('click', closeModal);
        root.querySelector('#fpSend').addEventListener('click', async () => {
          const email = root.querySelector('#fpEmail').value.trim();
          if (!fb || !fb.isEmail(email)) return status('Enter a valid email address.', 'error');
          const button = root.querySelector('#fpSend');
          button.disabled = true;
          status('Asking Firebase to send the reset email…');
          try {
            await fb.sendPasswordReset(email);
            status('Reset link sent. Check your inbox and spam folder.', 'ok');
            toast('Password reset email sent.', 'success');
          } catch (err) {
            status(err.message || 'The reset email could not be sent.', 'error');
            button.disabled = false;
          }
        });
      }
    });
  }

  /* ---------------------------------- entry points -------------------------- */

  function openSignIn() {
    authMode = 'signin';
    if (location.hash !== '#/welcome') {
      location.hash = '#/welcome';
      return;
    }
    const viewport = document.getElementById('mainViewport');
    if (viewport && document.getElementById('authCard')) {
      paintAuthTabs(viewport);
      mountAuthForm(viewport);
    } else if (viewport) {
      renderWelcome(viewport);
    }
  }

  function openSignUp() {
    authMode = 'signup';
    if (location.hash !== '#/welcome') {
      location.hash = '#/welcome';
      return;
    }
    const viewport = document.getElementById('mainViewport');
    if (viewport && document.getElementById('authCard')) {
      paintAuthTabs(viewport);
      mountAuthForm(viewport);
    } else if (viewport) {
      renderWelcome(viewport);
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
          <p class="hint" style="text-align:center">Signed in with email and password.
            <button class="link-inline" id="onboardingSignOut">Use a different account</button></p>
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

  window.RRAuth = {
    renderWelcome,
    renderVerifyGate,
    renderOnboarding,
    openSignIn,
    openSignUp,
    openForgotPassword,
    openLegalDocument,
    markdownToHtml,
    computeAge
  };
})();
