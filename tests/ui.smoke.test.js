// RideRise LK — headless UI smoke test (jsdom)
// Boots the real backend + the real web application, signs in, and walks every
// primary route asserting that screens render and no uncaught JS errors occur.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

process.env.DB_PATH = `/tmp/riderise_ui_test_${Date.now()}.sqlite`;
process.env.JWT_SECRET = 'ui-test-secret';
// UI 4 creates a throwaway rider through the dev-only demo bridge, which requires an
// explicit opt-in now that Google sign-in has been removed.
process.env.ALLOW_DEMO_SIGNIN = '1';

const { server, db } = require('../backend/server.js');

let baseUrl = '';

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeout = 10000, label = 'condition') {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (predicate()) return true;
    await wait(60);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

test.before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  try {
    db.close();
  } catch (e) {
    /* ignore */
  }
});

async function bootApp(bootToken = null) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (err) => {
    if (!/Could not parse CSS|Not implemented/.test(err.message)) errors.push(err.message);
  });
  virtualConsole.on('error', (...args) => errors.push(args.join(' ')));

  const dom = await JSDOM.fromURL(`${baseUrl}/`, {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      const seededToken = typeof bootToken !== 'undefined' && bootToken ? bootToken : null;
      if (seededToken) window.localStorage.setItem('rr_token', seededToken);
      window.fetch = (input, init) => fetch(new URL(input, baseUrl).toString(), init);
      window.AbortController = AbortController;
      window.scrollTo = () => {};
      window.HTMLElement.prototype.scrollIntoView = () => {};
      window.HTMLMediaElement.prototype.play = () => Promise.resolve();
    }
  });
  return { dom, window: dom.window, document: dom.window.document, errors };
}

function click(window, el) {
  assert.ok(el, 'element to click should exist');
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
}

test('UI 1 — launch splash, welcome hero and the email sign-in form render', async () => {
  const { window, document, errors, dom } = await bootApp();
  try {
    await waitFor(() => document.getElementById('splashScreen'), 8000, 'splash screen');
    const splash = document.getElementById('splashScreen');
    assert.match(splash.textContent, /RIDERISE LK/);
    assert.match(splash.textContent, /RIDE \/ STUNT \/ CONNECT/);
    assert.ok(splash.querySelector('img[alt*="RideRise LK"]'), 'official badge must be displayed');

    await waitFor(() => document.querySelector('.welcome-title'), 12000, 'welcome screen');
    assert.match(document.querySelector('.welcome-title').textContent, /RIDERISE/);
    assert.match(document.body.textContent, /at least 16 years old/);
    assert.match(document.body.textContent, /Never ride stunts on public roads/i);

    // Sign-in is email + password (Firebase). With no Firebase project in the test
    // environment the form must say so instead of pretending to work.
    assert.ok(document.getElementById('authCard'), 'auth card must render');
    assert.ok(document.getElementById('signInForm'), 'email sign-in form must render');
    assert.match(document.body.textContent, /Firebase Authentication/);
    assert.match(document.body.textContent, /not configured on this server/i);

    // The demo-account sheet is still available for evaluation builds.
    click(window, document.getElementById('demoSignInBtn'));
    await waitFor(() => document.querySelector('.oauth-accounts'), 4000, 'demo account sheet');
    assert.match(document.querySelector('.oauth-sub').textContent, /not\s+Firebase Authentication|legacy sandbox bridge/i);
    assert.ok(document.querySelectorAll('.oauth-account').length >= 4);
    assert.equal(errors.length, 0, `unexpected JS errors: ${errors.join(' | ')}`);
  } finally {
    dom.window.close();
  }
});

test('UI 2 — sign in, feed renders with seeded community content', async () => {
  const { window, document, errors, dom } = await bootApp();
  try {
    await waitFor(() => document.getElementById('demoSignInBtn'), 12000, 'demo sign-in button');
    click(window, document.getElementById('demoSignInBtn'));
    await waitFor(() => document.querySelector('[data-preset="kasun"]'), 4000, 'preset account');
    click(window, document.querySelector('[data-preset="kasun"]'));

    await waitFor(() => locationHash(window) === '#/home' || document.querySelector('.post-card'), 12000, 'home feed');
    await waitFor(() => document.querySelectorAll('.post-card').length > 0, 12000, 'posts to render');

    const cards = document.querySelectorAll('.post-card');
    assert.ok(cards.length >= 3, `expected seeded posts, found ${cards.length}`);
    assert.match(document.body.textContent, /Riderise|RideRise LK|RIDERISE/i);
    assert.ok(document.querySelector('.safety-strip'), 'permanent safety strip must be present');
    assert.ok(document.querySelector('.xp-progress-track'), 'rank progress bar must render');
    assert.ok(document.querySelector('.bottom-nav'), 'bottom navigation must exist');
    assert.equal(document.querySelectorAll('.bottom-nav-item').length, 5);
    assert.equal(errors.length, 0, `unexpected JS errors: ${errors.join(' | ')}`);
  } finally {
    dom.window.close();
  }
});

test('UI 3 — every primary route renders without runtime errors', async () => {
  const adminAuth = await fetch(`${baseUrl}/api/auth/demo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ presetAccount: 'admin' })
  }).then((r) => r.json());
  const { window, document, errors, dom } = await bootApp(adminAuth.token);
  try {
    // The admin session token was injected in beforeParse; wait for the feed first
    await waitFor(() => document.querySelector('#feedList'), 15000, 'authenticated shell');

    const routes = [
      ['#/home', '#feedList'],
      ['#/explore', '.explore-grid'],
      ['#/stunts', '#stuntLibrary'],
      ['#/guilds', '#guildList'],
      ['#/profile', '.profile-hero'],
      ['#/parts', '#partsList'],
      ['#/events', '#eventsList'],
      ['#/friends', '#socialBody'],
      ['#/safety', '.safety-rule'],
      ['#/notifications', '#notifList'],
      ['#/settings', '.account-grid'],
      ['#/welcome', '.welcome-title']
    ];
    for (const [route, selector] of routes) {
      window.location.hash = route;
      await waitFor(() => document.querySelector(selector), 12000, `${route} → ${selector}`);
      assert.ok(document.querySelector(selector), `${route} should render ${selector}`);
    }

    // Admin console (admin account signed in)
    window.location.hash = '#/admin';
    await waitFor(() => document.querySelector('.metric-grid'), 12000, 'admin metrics');
    assert.ok(document.querySelectorAll('.metric-card').length >= 8);

    // Guild detail
    window.location.hash = '#/guild/gld_southern_bmx';
    await waitFor(() => document.querySelector('.guild-hero'), 12000, 'guild detail');
    assert.match(document.body.textContent, /Southern Coast BMX/);

    // Public rider profile
    window.location.hash = '#/user/usr_kasun';
    await waitFor(() => document.querySelector('.profile-hero'), 12000, 'public profile');
    assert.match(document.body.textContent, /Kasun Perera/);

    assert.equal(errors.length, 0, `unexpected JS errors: ${errors.join(' | ')}`);
  } finally {
    dom.window.close();
  }
});

test('UI 4 — onboarding wizard blocks under-16 and unlocks social features', async () => {
  const { window, document, errors, dom } = await bootApp();
  try {
    const auth = await fetch(`${baseUrl}/api/auth/demo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'ui.onboarding@example.com' })
    }).then((r) => r.json());
    assert.equal(auth.onboardingRequired, true);
    window.localStorage.setItem('rr_token', auth.token);

    window.location.hash = '#/onboarding';
    await waitFor(() => document.querySelector('.wizard-shell'), 12000, 'onboarding wizard');
    assert.match(document.querySelector('.wizard-panel h2').textContent, /Confirm your age/i);

    // Try to continue without confirming age
    click(window, document.getElementById('wizardNext'));
    await waitFor(() => document.querySelector('.toast'), 4000, 'validation toast');
    assert.match(document.querySelector('.toast').textContent, /at least 16 years old/i);

    // Confirm age and continue through the wizard
    const ageCheckbox = document.getElementById('ageConfirm');
    ageCheckbox.checked = true;
    ageCheckbox.dispatchEvent(new window.Event('change', { bubbles: true }));
    click(window, document.getElementById('wizardNext'));
    await waitFor(() => document.querySelector('[data-legal-accept="acceptTerms"]'), 5000, 'legal step');
    document.querySelectorAll('[data-legal-accept]').forEach((checkbox) => {
      checkbox.checked = true;
      checkbox.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    click(window, document.getElementById('wizardNext'));
    await waitFor(() => document.getElementById('usernameInput'), 5000, 'profile step');
    const username = document.getElementById('usernameInput');
    username.value = 'ui_test_rider';
    username.dispatchEvent(new window.Event('input', { bubbles: true }));
    document.getElementById('displayNameInput').value = 'UI Test Rider';
    document.getElementById('displayNameInput').dispatchEvent(new window.Event('input', { bubbles: true }));
    click(window, document.getElementById('wizardNext'));
    await waitFor(() => document.getElementById('visibilitySelect'), 5000, 'privacy step');
    click(window, document.getElementById('wizardNext'));

    await waitFor(() => window.location.hash === '#/home', 12000, 'redirect to home after onboarding');
    await waitFor(() => document.querySelector('.post-card'), 12000, 'feed after onboarding');
    assert.equal(errors.length, 0, `unexpected JS errors: ${errors.join(' | ')}`);
  } finally {
    dom.window.close();
  }
});

function locationHash(window) {
  return window.location.hash;
}
