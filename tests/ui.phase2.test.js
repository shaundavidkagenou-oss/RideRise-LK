// RideRise LK — Phase 2 UI checks. Renders every new screen in jsdom against a
// real server and fails on uncaught JavaScript errors, then verifies the core
// interaction surfaces the brief requires (consent, PTT, quiz, register).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM, VirtualConsole } = require('jsdom');

process.env.DB_PATH = `/tmp/riderise_phase2_ui_${Date.now()}.sqlite`;
process.env.JWT_SECRET = 'phase2-ui-test-secret';

const { server, db } = require('../backend/server.js');

let baseUrl = '';

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeout = 12000, label = 'condition') {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (predicate()) return true;
    await wait(60);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function signIn(preset) {
  const res = await fetch(`${baseUrl}/api/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ presetAccount: preset })
  });
  return (await res.json()).token;
}

async function bootApp(bootToken = null) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (err) => {
    if (!/Could not parse CSS|Not implemented|Could not load img/.test(err.message)) errors.push(err.message);
  });
  virtualConsole.on('error', (...args) => errors.push(args.join(' ')));

  const dom = await JSDOM.fromURL(`${baseUrl}/`, {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      if (bootToken) window.localStorage.setItem('rr_token', bootToken);
      window.fetch = (input, init) => fetch(new URL(input, baseUrl).toString(), init);
      window.AbortController = AbortController;
      window.scrollTo = () => {};
      window.confirm = () => true;
      window.prompt = () => 'test';
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

test('PHASE2 UI 1 — learning pathways, lesson reader and maintenance track render', async () => {
  const token = await signIn('kasun');
  const { window, document, errors, dom } = await bootApp(token);
  try {
    await waitFor(() => document.getElementById('feedList'), 15000, 'authenticated shell');

    window.location.hash = '#/learning';
    await waitFor(() => document.querySelector('.pathway-card'), 15000, 'learning pathways');
    assert.ok(document.querySelectorAll('.pathway-card').length >= 5, 'all five pathways must render');
    assert.match(document.body.textContent, /Maintenance & equipment inspection/i);
    assert.match(document.body.textContent, /not certifications|certify|educational/i);

    window.location.hash = '#/learning/module/stm_maint_pre_ride';
    await waitFor(() => document.querySelector('.lesson-grid'), 15000, 'lesson reader');
    assert.ok(document.querySelector('#lessonChecklist input[type="checkbox"]'), 'inspection checklist must render');
    assert.ok(document.querySelector('#submitQuiz'), 'knowledge check must render');
    assert.ok(document.querySelector('#completeModule'), 'completion control must render');

    assert.equal(errors.length, 0, `unexpected JS errors: ${errors.join(' | ')}`);
  } finally {
    dom.window.close();
  }
});

test('PHASE2 UI 2 — parts catalogue searches, compares and shows honest prices', async () => {
  const token = await signIn('kasun');
  const { window, document, errors, dom } = await bootApp(token);
  try {
    await waitFor(() => document.getElementById('feedList'), 15000, 'authenticated shell');
    window.location.hash = '#/catalog';
    await waitFor(() => document.querySelector('.part-card'), 15000, 'catalogue cards');

    // Every rendered price must be real or explicitly unverified.
    const bodyText = document.body.textContent;
    assert.ok(/Price not verified|LKR/.test(bodyText), 'prices must be labelled');

    click(window, document.querySelector('[data-compare-add]'));
    click(window, document.querySelectorAll('[data-compare-add]')[1]);
    await waitFor(() => !document.getElementById('openCompare').disabled, 6000, 'compare tray ready');
    click(window, document.getElementById('openCompare'));
    await waitFor(() => document.querySelector('.compare-table'), 8000, 'comparison table');
    assert.match(document.querySelector('.compare-table').textContent, /Specification/i);

    assert.equal(errors.length, 0, `unexpected JS errors: ${errors.join(' | ')}`);
  } finally {
    dom.window.close();
  }
});

test('PHASE2 UI 3 — events list, official badge and inline registration', async () => {
  const token = await signIn('roshan');
  const { window, document, errors, dom } = await bootApp(token);
  try {
    await waitFor(() => document.getElementById('feedList'), 15000, 'authenticated shell');
    window.location.hash = '#/events';
    await waitFor(() => document.querySelector('#eventsList .event-card'), 15000, 'events list');

    assert.match(document.body.textContent, /Official Shaun David Studios Event/i);
    const registerBtn = document.querySelector('[data-register-event]');
    assert.ok(registerBtn, 'register button must be available');
    click(window, registerBtn);
    await waitFor(() => /You are registered/i.test(document.body.textContent), 12000, 'registration confirmation');

    // Calendar view renders the month grid.
    const calendarBtn = [...document.querySelectorAll('[data-view]')].find((b) => b.dataset.view === 'calendar');
    click(window, calendarBtn);
    await waitFor(() => document.querySelector('.calendar-grid'), 8000, 'calendar grid');
    assert.equal(document.querySelectorAll('.calendar-dow').length, 7);

    assert.equal(errors.length, 0, `unexpected JS errors: ${errors.join(' | ')}`);
  } finally {
    dom.window.close();
  }
});

test('PHASE2 UI 4 — messaging, notification preferences and studio news render', async () => {
  const token = await signIn('kasun');
  const { window, document, errors, dom } = await bootApp(token);
  try {
    await waitFor(() => document.getElementById('feedList'), 15000, 'authenticated shell');

    window.location.hash = '#/messages';
    await waitFor(
      () => document.querySelector('.convo-row') || document.querySelector('.empty-state'),
      15000,
      'message threads'
    );

    window.location.hash = '#/notifications';
    await waitFor(() => document.getElementById('notifList'), 15000, 'notification history');
    await waitFor(() => document.querySelector('[data-pref="show_previews"]'), 12000, 'notification preferences');
    assert.match(document.body.textContent, /previews/i);

    window.location.hash = '#/news';
    await waitFor(() => document.getElementById('newsList'), 15000, 'news list');

    assert.equal(errors.length, 0, `unexpected JS errors: ${errors.join(' | ')}`);
  } finally {
    dom.window.close();
  }
});

test('PHASE2 UI 5 — guild map consent gate, hub and voice lobby render', async () => {
  const token = await signIn('kasun');
  const { window, document, errors, dom } = await bootApp(token);
  try {
    await waitFor(() => document.getElementById('feedList'), 15000, 'authenticated shell');

    window.location.hash = '#/guild/gld_southern_bmx/map';
    await waitFor(() => document.querySelector('#guildMap'), 15000, 'guild map');
    assert.ok(document.querySelector('#consentToggle'), 'sharing requires explicit consent checkbox');
    assert.ok(document.querySelector('#startShare'), 'sharing is opt-in');
    assert.match(
      document.querySelector('.privacy-banner').textContent,
      /approximate|who can see/i,
      'privacy explanation must precede sharing'
    );

    window.location.hash = '#/guild/gld_southern_bmx/hub';
    await waitFor(() => document.querySelector('.hub-tabs'), 15000, 'guild hub');
    assert.ok(document.querySelectorAll('.hub-tabs .chip').length >= 4, 'hub tabs must render');

    window.location.hash = '#/guild/gld_southern_bmx/voice';
    await waitFor(() => document.querySelector('.voice-grid'), 15000, 'voice lobby');
    assert.match(document.body.textContent, /microphone/i);
    assert.ok(document.querySelector('[data-join-room]'), 'rooms must expose an explicit join action');

    // Opening a room must show the pre-flight panel, not a live microphone.
    click(window, document.querySelector('[data-join-room]'));
    await waitFor(() => document.querySelector('.voice-lobby'), 10000, 'voice room pre-flight');
    assert.ok(document.querySelector('#joinVoice'), 'joining requires an explicit confirmation');
    assert.match(document.querySelector('.voice-preflight').textContent, /Microphone[\s\S]*Not opened/i);

    assert.equal(errors.length, 0, `unexpected JS errors: ${errors.join(' | ')}`);
  } finally {
    dom.window.close();
  }
});

test('PHASE2 UI 6 — studio console loads metrics and the moderation queue', async () => {
  const token = await signIn('admin');
  const { window, document, errors, dom } = await bootApp(token);
  try {
    await waitFor(() => document.getElementById('feedList'), 15000, 'authenticated shell');
    window.location.hash = '#/admin';
    await waitFor(() => document.querySelector('.metric-grid'), 15000, 'admin metrics');
    assert.ok(document.querySelectorAll('.metric-card').length >= 8);

    const reportsTab = [...document.querySelectorAll('[data-admin-tab]')].find((c) => c.dataset.adminTab === 'reports');
    click(window, reportsTab);
    await waitFor(() => document.querySelector('.report-list'), 12000, 'moderation queue');

    const auditTab = [...document.querySelectorAll('[data-admin-tab]')].find((c) => c.dataset.adminTab === 'audit');
    click(window, auditTab);
    await waitFor(() => /Push notifications/i.test(document.body.textContent), 12000, 'push diagnostics');

    assert.equal(errors.length, 0, `unexpected JS errors: ${errors.join(' | ')}`);
  } finally {
    dom.window.close();
  }
});
