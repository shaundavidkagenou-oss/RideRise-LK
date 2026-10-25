// RideRise LK — end-to-end Firebase email/password UI flows (jsdom + real backend)
//
// The Firebase client SDK is replaced with a controllable stub (the documented
// `window.__RR_FIREBASE__` seam) but the ID tokens it returns are real RS256 tokens signed
// with the test fixture key, so the backend still performs full token verification. Nothing
// here talks to Google.
process.env.DB_PATH = `/tmp/riderise_ui_auth_${Date.now()}.sqlite`;
process.env.JWT_SECRET = 'ui-auth-test-secret-do-not-use-in-production';
process.env.FIREBASE_PROJECT_ID = 'riderise-lk-test';
process.env.FIREBASE_API_KEY = 'test-api-key-not-a-real-credential';
process.env.FIREBASE_APP_ID = '1:000000000000:web:testfixture';
// Opt-in fixture content: a taken username to collide with, and public posts for the feed.
process.env.SEED_DEMO = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const { server, db, firebaseAuth } = require('../backend/server.js');

const certPem = fs.readFileSync(path.join(__dirname, 'fixtures', 'firebase-test-cert.pem'), 'utf8');
const privateKey = fs.readFileSync(path.join(__dirname, 'fixtures', 'firebase-test-key.pem'), 'utf8');
firebaseAuth.__setCertificateProvider(() => ({ certs: { 'test-kid': certPem }, ttlMs: 60 * 60 * 1000 }));

let baseUrl = '';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, timeout = 15000, label = 'condition') {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      if (predicate()) return true;
    } catch {
      /* keep waiting */
    }
    await wait(60);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function mintToken({ uid, email, emailVerified }) {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = b64({ alg: 'RS256', kid: 'test-kid', typ: 'JWT' });
  const payload = b64({
    iss: 'https://securetoken.google.com/riderise-lk-test',
    aud: 'riderise-lk-test',
    auth_time: now,
    sub: uid,
    user_id: uid,
    iat: now,
    exp: now + 3600,
    email,
    email_verified: Boolean(emailVerified),
    firebase: { identities: { email: [email] }, sign_in_provider: 'password' }
  });
  const body = `${header}.${payload}`;
  return `${body}.${crypto.sign('RSA-SHA256', Buffer.from(body), privateKey).toString('base64url')}`;
}

/** Controllable stand-in for the Firebase JS SDK (compat API surface only). */
function makeSdk() {
  const state = {
    user: null,
    created: [],
    signedIn: [],
    resetEmails: [],
    verificationEmails: 0,
    wrongPassword: false,
    signUpError: null
  };

  function makeUser(email, password) {
    const uid = `ui-uid-${crypto.randomBytes(6).toString('hex')}`;
    return {
      uid,
      email,
      password,
      emailVerified: false,
      async reload() {
        return this;
      },
      async getIdToken() {
        return mintToken({ uid: this.uid, email: this.email, emailVerified: this.emailVerified });
      },
      async sendEmailVerification() {
        state.verificationEmails += 1;
      },
      async delete() {
        state.user = null;
      }
    };
  }

  const auth = {
    get currentUser() {
      return state.user;
    },
    async createUserWithEmailAndPassword(email, password) {
      if (state.signUpError) throw state.signUpError;
      const user = makeUser(email, password);
      state.user = user;
      state.created.push({ email, password });
      return { user };
    },
    async signInWithEmailAndPassword(email, password) {
      if (state.wrongPassword) throw { code: 'auth/wrong-password', message: 'The password is invalid.' };
      const user = makeUser(email, password);
      user.emailVerified = true;
      state.user = user;
      state.signedIn.push({ email, password });
      return { user };
    },
    async signOut() {
      state.user = null;
    },
    async sendPasswordResetEmail(email) {
      state.resetEmails.push(email);
    },
    onAuthStateChanged(callback) {
      callback(state.user);
      return () => {};
    },
    setPersistence() {
      return Promise.resolve();
    }
  };

  const app = { name: '[DEFAULT]' };
  const sdk = {
    apps: [],
    initializeApp() {
      sdk.apps.push(app);
      return app;
    },
    app() {
      return app;
    },
    auth() {
      return auth;
    }
  };
  sdk.auth.Auth = { Persistence: { LOCAL: 'local' } };
  return { sdk, state };
}

async function bootApp({ token = null, mock = null, patchConfig = null } = {}) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (err) => {
    if (!/Could not parse CSS|Not implemented/.test(err.message)) errors.push(err.message);
  });
  const { sdk } = mock || makeSdk();

  const dom = await JSDOM.fromURL(`${baseUrl}/`, {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      if (token) window.localStorage.setItem('rr_token', token);
      window.__RR_FIREBASE__ = sdk;
      window.fetch = async (input, init) => {
        const url = new URL(input, baseUrl).toString();
        const response = await fetch(url, init);
        if (patchConfig && url.endsWith('/api/config')) {
          const data = await response.clone().json();
          patchConfig(data);
          return new Response(JSON.stringify(data), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        return response;
      };
      window.AbortController = AbortController;
      window.scrollTo = () => {};
      window.HTMLElement.prototype.scrollIntoView = () => {};
    }
  });
  return { dom, window: dom.window, document: dom.window.document, errors, state: mock ? mock.state : null };
}

function click(window, element) {
  assert.ok(element, 'element to click should exist');
  element.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
}

function submit(window, form) {
  assert.ok(form, 'form should exist');
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
}

async function callApi(pathname, { method = 'GET', token = null, body = null } = {}) {
  const headers = { 'X-Forwarded-For': `198.51.100.${Math.floor(Math.random() * 200) + 1}` };
  if (body !== null) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: body !== null ? JSON.stringify(body) : undefined
  });
  return { status: res.status, json: await res.json() };
}

test.before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  try {
    db.close();
  } catch {
    /* already closed */
  }
  try {
    fs.unlinkSync(process.env.DB_PATH);
  } catch {
    /* gone */
  }
});

test('UI AUTH 1 — a new rider signs up, is gated on verification, then reaches onboarding', async () => {
  const mock = makeSdk();
  const { window, document, errors } = await bootApp({ mock });
  try {
    await waitFor(() => document.querySelector('[data-auth-tab="signup"]'), 15000, 'auth tabs');

    // The form is live because /api/config reports a configured Firebase project.
    click(window, document.querySelector('[data-auth-tab="signup"]'));
    await waitFor(() => document.getElementById('signUpForm'), 5000, 'sign-up form');

    const username = 'uitest' + Math.floor(Math.random() * 100000);
    const email = `${username}@example.test`;
    document.getElementById('suUsername').value = username;
    document.getElementById('suEmail').value = email;
    document.getElementById('suPassword').value = 'RideRise2026!';
    document.getElementById('suConfirm').value = 'RideRise2026!';
    submit(window, document.getElementById('signUpForm'));

    // The server creates the profile but refuses a session until the address is verified.
    await waitFor(() => document.getElementById('verifyContinue'), 15000, 'verification gate');
    assert.match(document.body.textContent, /Verify your email/);
    assert.ok(document.body.textContent.includes(email), 'the gate names the address');
    assert.equal(window.localStorage.getItem('rr_token'), null, 'no session before verification');
    assert.equal(mock.state.created.length, 1, 'exactly one Firebase account was created');
    assert.equal(mock.state.verificationEmails, 1, 'a verification email was requested');

    const row = db.prepare('SELECT id FROM users_private WHERE firebase_uid = ?').get(mock.state.user.uid);
    assert.ok(row, 'the profile row exists so the retry is safe');

    // Rider clicks the link in their inbox, then presses the gate button.
    mock.state.user.emailVerified = true;
    click(window, document.getElementById('verifyContinue'));
    await waitFor(() => window.location.hash === '#/onboarding', 15000, 'onboarding wizard');
    assert.ok(window.localStorage.getItem('rr_token'), 'a RideRise session token is stored');

    const profiles = db.prepare('SELECT COUNT(*) AS n FROM profiles WHERE user_id = ?').get(row.id).n;
    assert.equal(profiles, 1, 'verification never creates a second profile');
    assert.equal(errors.length, 0, `unexpected JS errors: ${errors.join(' | ')}`);
  } finally {
    window.close();
  }
});

test('UI AUTH 2 — a taken username is caught before any Firebase account is created', async () => {
  const mock = makeSdk();
  const { window, document } = await bootApp({ mock });
  try {
    await waitFor(() => document.querySelector('[data-auth-tab="signup"]'), 15000, 'auth tabs');
    click(window, document.querySelector('[data-auth-tab="signup"]'));
    await waitFor(() => document.getElementById('signUpForm'), 5000, 'sign-up form');

    document.getElementById('suUsername').value = 'kasun_bmx_lk'; // already used by a sample rider
    document.getElementById('suEmail').value = 'kasun.duplicate@example.test';
    document.getElementById('suPassword').value = 'RideRise2026!';
    document.getElementById('suConfirm').value = 'RideRise2026!';
    submit(window, document.getElementById('signUpForm'));

    await waitFor(() => /already taken/i.test(document.getElementById('authStatus').textContent), 15000, 'taken username message');
    assert.equal(mock.state.created.length, 0, 'no Firebase account is created for a taken username');
    assert.equal(window.localStorage.getItem('rr_token'), null);
  } finally {
    window.close();
  }
});

test('UI AUTH 3 — wrong password and weak passwords are explained in plain language', async () => {
  const mock = makeSdk();
  mock.state.wrongPassword = true;
  const { window, document } = await bootApp({ mock });
  try {
    await waitFor(() => document.getElementById('signInForm'), 15000, 'sign-in form');

    document.getElementById('siEmail').value = 'kasun.perera.demo@gmail.com';
    document.getElementById('siPassword').value = 'not-the-password';
    submit(window, document.getElementById('signInForm'));

    await waitFor(
      () => /email and password combination is not correct/i.test(document.getElementById('authStatus').textContent),
      15000,
      'friendly credential error'
    );
    assert.equal(window.localStorage.getItem('rr_token'), null);

    // Client-side password rules run before Firebase is contacted.
    click(window, document.querySelector('[data-auth-tab="signup"]'));
    await waitFor(() => document.getElementById('signUpForm'), 5000, 'sign-up form');
    document.getElementById('suUsername').value = 'weakpass' + Math.floor(Math.random() * 1000);
    document.getElementById('suEmail').value = 'weak@example.test';
    document.getElementById('suPassword').value = 'short1';
    document.getElementById('suConfirm').value = 'short1';
    submit(window, document.getElementById('signUpForm'));
    await waitFor(() => /at least 10 characters/i.test(document.getElementById('authStatus').textContent), 5000, 'password rule message');
    assert.equal(mock.state.created.length, 0);
  } finally {
    window.close();
  }
});

test('UI AUTH 4 — a remembered Firebase session restores after an app restart', async () => {
  // A rider with an existing, fully onboarded profile.
  const uid = `persist-${crypto.randomBytes(4).toString('hex')}`;
  const email = `${uid}@example.test`;
  const signup = await callApi('/api/auth/firebase/signup', {
    method: 'POST',
    body: { idToken: mintToken({ uid, email, emailVerified: true }), username: uid.replace(/-/g, '_') }
  });
  assert.equal(signup.status, 200, JSON.stringify(signup.json));
  db.prepare('UPDATE users_private SET onboarding_completed = 1, age_confirmed = 1 WHERE id = ?').run(signup.json.account.id);

  const mock = makeSdk();
  // The SDK restores its persisted user on launch — no RideRise token saved on this device.
  mock.state.user = {
    uid,
    email,
    emailVerified: true,
    async reload() {
      return this;
    },
    async getIdToken() {
      return mintToken({ uid, email, emailVerified: true });
    },
    async sendEmailVerification() {},
    async delete() {}
  };

  const { window, document, errors } = await bootApp({ mock });
  try {
    await waitFor(() => window.location.hash === '#/home' || document.querySelector('.post-card'), 20000, 'restored home feed');
    await waitFor(() => document.querySelectorAll('.post-card').length > 0, 20000, 'seeded posts');
    assert.ok(window.localStorage.getItem('rr_token'), 'a fresh RideRise session replaced the missing token');
    assert.ok(!document.body.textContent.includes('Administrator sign-in required'));
    assert.equal(errors.length, 0, `unexpected JS errors: ${errors.join(' | ')}`);
  } finally {
    window.close();
  }
});

test('UI AUTH 5 — signing out clears the RideRise token and the Firebase session', async () => {
  const uid = `signout-${crypto.randomBytes(4).toString('hex')}`;
  const email = `${uid}@example.test`;
  const signup = await callApi('/api/auth/firebase/signup', {
    method: 'POST',
    body: { idToken: mintToken({ uid, email, emailVerified: true }), username: uid.replace(/-/g, '_') }
  });
  assert.equal(signup.status, 200, JSON.stringify(signup.json));
  db.prepare('UPDATE users_private SET onboarding_completed = 1, age_confirmed = 1 WHERE id = ?').run(signup.json.account.id);

  const mock = makeSdk();
  mock.state.user = {
    uid,
    email,
    emailVerified: true,
    async reload() {
      return this;
    },
    async getIdToken() {
      return mintToken({ uid, email, emailVerified: true });
    },
    async sendEmailVerification() {},
    async delete() {}
  };

  const { window, document } = await bootApp({ token: signup.json.token, mock });
  try {
    await waitFor(() => document.querySelector('.post-card'), 20000, 'home feed');
    window.location.hash = '#/settings';
    await waitFor(() => document.getElementById('signOutBtn'), 20000, 'settings screen');

    click(window, document.getElementById('signOutBtn'));
    await waitFor(() => window.location.hash === '#/welcome', 15000, 'return to welcome');
    assert.equal(window.localStorage.getItem('rr_token'), null, 'the RideRise token is discarded');
    assert.equal(mock.state.user, null, 'the Firebase session is cleared too');
  } finally {
    window.close();
  }
});

test('UI AUTH 6 — settings shows the signed-in provider and offers a password reset', async () => {
  const uid = `settings-${crypto.randomBytes(4).toString('hex')}`;
  const email = `${uid}@example.test`;
  const signup = await callApi('/api/auth/firebase/signup', {
    method: 'POST',
    body: { idToken: mintToken({ uid, email, emailVerified: true }), username: uid.replace(/-/g, '_') }
  });
  assert.equal(signup.status, 200);
  db.prepare('UPDATE users_private SET onboarding_completed = 1, age_confirmed = 1 WHERE id = ?').run(signup.json.account.id);

  const mock = makeSdk();
  mock.state.user = {
    uid,
    email,
    emailVerified: true,
    async reload() {
      return this;
    },
    async getIdToken() {
      return mintToken({ uid, email, emailVerified: true });
    },
    async sendEmailVerification() {},
    async delete() {}
  };

  const { window, document } = await bootApp({ token: signup.json.token, mock });
  try {
    await waitFor(() => document.querySelector('.post-card'), 20000, 'home feed');
    window.location.hash = '#/settings';
    await waitFor(() => document.getElementById('sendResetBtn'), 20000, 'sign-in & security card');
    assert.match(document.getElementById('signInCard').textContent, /Firebase email & password/);
    assert.ok(document.getElementById('signInCard').textContent.includes(email));

    click(window, document.getElementById('sendResetBtn'));
    await waitFor(() => mock.state.resetEmails.length === 1, 10000, 'reset email request');
    assert.equal(mock.state.resetEmails[0], email);
  } finally {
    window.close();
  }
});

test('UI AUTH 7 — a server that cannot reach Google says so instead of blaming the password', async () => {
  const mock = makeSdk();
  const { window, document } = await bootApp({
    mock,
    patchConfig(data) {
      // Simulates a firewall / air-gapped host: configured project, unreachable verifier.
      data.firebase.verifier = { status: 'unreachable', detail: 'CERT_FETCH_FAILED' };
    }
  });
  try {
    await waitFor(() => document.querySelector('.auth-notice-error'), 15000, 'verifier banner');
    const banner = document.querySelector('.auth-notice-error');
    assert.match(banner.textContent, /cannot reach Google to verify sign-ins/i);
    assert.match(banner.textContent, /riderise-lk-test/, 'the banner names the project');
    assert.match(banner.textContent, /not a problem with|Nothing about your/i);

    // The form still renders — the failure is the server's network, not the rider's account.
    assert.ok(document.getElementById('signInForm'), 'sign-in form stays available');
    assert.equal(document.querySelector('fieldset[disabled]'), null, 'the form is not disabled by a server egress issue');
  } finally {
    window.close();
  }
});
