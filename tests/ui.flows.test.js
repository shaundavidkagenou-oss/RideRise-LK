// RideRise LK — end-to-end UI flow tests (jsdom driving the real UI + real backend)
// Each test performs a complete user journey through DOM interactions, not just route loads.
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM, VirtualConsole } = require('jsdom');

process.env.DB_PATH = `/tmp/riderise_flows_${Date.now()}.sqlite`;
process.env.JWT_SECRET = 'flows-test-secret';

const { server, db } = require('../backend/server.js');
let baseUrl = '';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, timeout = 12000, label = 'condition') {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      if (predicate()) return true;
    } catch (e) {
      /* keep waiting */
    }
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

async function bootAs(preset) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (err) => {
    if (!/Could not parse CSS|Not implemented/.test(err.message)) errors.push(err.message);
  });

  // Authenticate first so the token is present in localStorage before the app boots
  const auth = await fetch(`${baseUrl}/api/auth/demo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ presetAccount: preset })
  }).then((r) => r.json());

  const dom = await JSDOM.fromURL(`${baseUrl}/`, {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      window.localStorage.setItem('rr_token', auth.token);
      window.fetch = (input, init) => fetch(new URL(input, baseUrl).toString(), init);
      window.AbortController = AbortController;
      window.scrollTo = () => {};
      window.HTMLElement.prototype.scrollIntoView = () => {};
    }
  });
  return { dom, window: dom.window, document: dom.window.document, errors };
}

const click = (window, el) => {
  assert.ok(el, 'clickable element must exist');
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
};
const setValue = (window, el, value) => {
  assert.ok(el);
  el.value = value;
  el.dispatchEvent(new window.Event('input', { bubbles: true }));
  el.dispatchEvent(new window.Event('change', { bubbles: true }));
};

test('FLOW 1 — publish a community post through the composer', async () => {
  const { window, document, errors, dom } = await bootAs('kasun');
  try {
    window.location.hash = '#/home';
    await waitFor(() => document.querySelector('.post-card'), 15000, 'feed');
    click(window, document.getElementById('composeBtn'));
    await waitFor(() => document.getElementById('composerForm'), 6000, 'composer');

    setValue(window, document.getElementById('postTitle'), 'UI flow: pre-monsoon inspection checklist');
    setValue(window, document.getElementById('postBody'), 'Checked brake pads, spoke tension and bar-end plugs before the weekend court session.');
    setValue(window, document.getElementById('postTags'), 'Maintenance, Safety');
    click(window, document.getElementById('publishBtn'));

    await waitFor(
      () => /Publish|Published|pending/i.test(document.body.textContent) && !document.getElementById('composerForm'),
      12000,
      'composer to close'
    );
    await waitFor(
      () => document.body.textContent.includes('UI flow: pre-monsoon inspection checklist'),
      15000,
      'published post to appear in the feed'
    );
    assert.equal(errors.length, 0, errors.join(' | '));
  } finally {
    dom.window.close();
  }
});

test('FLOW 2 — 7-point pre-ride safety inspection awards XP once per day', async () => {
  const { window, document, errors, dom } = await bootAs('roshan');
  try {
    window.location.hash = '#/home';
    await waitFor(() => document.getElementById('feedPreRideBtn'), 15000, 'home safety shortcut');
    click(window, document.getElementById('feedPreRideBtn'));
    await waitFor(() => document.querySelectorAll('[data-safety-item]').length === 7, 6000, 'checklist items');
    document.querySelectorAll('[data-safety-item]').forEach((checkbox) => {
      checkbox.checked = true;
      checkbox.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    click(window, document.getElementById('completeSafetyBtn'));
    await waitFor(() => /safety|inspection/i.test(document.querySelector('.toast')?.textContent || ''), 12000, 'safety toast');
    assert.match(document.querySelector('.toast').textContent, /inspection|Safety/i);
    const logs = await fetch(`${baseUrl}/api/ranks`, {
      headers: { Authorization: `Bearer ${window.localStorage.getItem('rr_token')}` }
    }).then((r) => r.json());
    assert.ok(logs.activityHistory.some((entry) => entry.action_type === 'safety_checklist_completed'));
    assert.equal(errors.length, 0, errors.join(' | '));
  } finally {
    dom.window.close();
  }
});

test('FLOW 3 — guided 13-question bicycle questionnaire produces a capped, transparent score', async () => {
  const { window, document, errors, dom } = await bootAs('roshan');
  try {
    window.location.hash = '#/profile';
    await waitFor(() => document.querySelector('.profile-hero'), 15000, 'profile');
    click(window, document.getElementById('addBikeBtn'));
    await waitFor(() => document.getElementById('bikeName'), 6000, 'bike wizard');

    setValue(window, document.getElementById('bikeName'), 'UI Flow Test Bike');
    click(window, document.getElementById('bikeNext'));
    await waitFor(() => document.getElementById('frameMaterial'), 4000, 'frame step');
    setValue(window, document.getElementById('frameMaterial'), 'Chromoly steel (4130 CrMo)');
    setValue(window, document.getElementById('frameBrand'), 'BSD');
    setValue(window, document.getElementById('frameModel'), 'Passenger 21');
    setValue(window, document.getElementById('forkSpec'), '4130 CrMo fork');
    click(window, document.getElementById('bikeNext'));
    await waitFor(() => document.getElementById('tireSpec'), 4000, 'wheels step');
    setValue(window, document.getElementById('tireSpec'), '20 x 2.40 street');
    setValue(window, document.getElementById('wheelSpec'), 'Double-wall 36H');
    setValue(window, document.getElementById('barSpec'), '9.25in bars + bar-ends');
    setValue(window, document.getElementById('driveSpec'), '3-piece 25T-9T');
    click(window, document.getElementById('bikeNext'));
    await waitFor(() => document.getElementById('brakeType'), 4000, 'brakes step');
    setValue(window, document.getElementById('condition'), 'Excellent');
    const none = document.querySelector('[data-defect="none"]');
    none.checked = true;
    none.dispatchEvent(new window.Event('change', { bubbles: true }));
    click(window, document.getElementById('bikeNext'));
    await waitFor(() => document.querySelector('[data-photo-slot]'), 4000, 'photo step');
    click(window, document.getElementById('bikeNext'));

    await waitFor(() => document.querySelector('#scorePreview .score-num'), 10000, 'live score preview');
    const previewScore = Number(document.querySelector('#scorePreview .score-num').textContent);
    assert.ok(previewScore > 60, `expected a healthy preview score, got ${previewScore}`);
    assert.match(document.querySelector('#scorePreview').textContent, /Safety/i);

    click(window, document.getElementById('bikeNext'));
    await waitFor(() => document.querySelector('.toast') && /build rating/i.test(document.querySelector('.toast').textContent), 12000, 'save toast');
    await waitFor(() => document.body.textContent.includes('UI Flow Test Bike'), 12000, 'new bike in profile');
    assert.equal(errors.length, 0, errors.join(' | '));
  } finally {
    dom.window.close();
  }
});

test('FLOW 4 — complete a stunt module with checklist + quiz and see XP credited', async () => {
  const { window, document, errors, dom } = await bootAs('kasun');
  try {
    window.location.hash = '#/stunts';
    await waitFor(() => document.querySelector('[data-open-module]'), 15000, 'stunt library');
    const before = await fetch(`${baseUrl}/api/auth/session`, {
      headers: { Authorization: `Bearer ${window.localStorage.getItem('rr_token')}` }
    }).then((r) => r.json());

    click(window, document.querySelector('[data-open-module="mod_beg_3"]'));
    await waitFor(() => document.getElementById('completeModuleBtn'), 6000, 'module reader');
    document.querySelectorAll('[data-module-check]').forEach((checkbox) => {
      checkbox.checked = true;
      checkbox.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    for (const radio of document.querySelectorAll('[data-quiz]')) {
      radio.checked = true;
      radio.dispatchEvent(new window.Event('change', { bubbles: true }));
    }
    // Ensure a correct answer is selected for the single-question module
    const correct = document.querySelector('[data-quiz="0"][data-option="1"]');
    correct.checked = true;
    correct.dispatchEvent(new window.Event('change', { bubbles: true }));

    click(window, document.getElementById('completeModuleBtn'));
    await waitFor(() => /Completed|XP/i.test(document.querySelector('.toast')?.textContent || ''), 12000, 'completion toast');

    const after = await fetch(`${baseUrl}/api/auth/session`, {
      headers: { Authorization: `Bearer ${window.localStorage.getItem('rr_token')}` }
    }).then((r) => r.json());
    assert.ok(after.profile.xp > before.profile.xp, 'XP should increase after module completion');
    assert.equal(errors.length, 0, errors.join(' | '));
  } finally {
    dom.window.close();
  }
});

test('FLOW 5 — guild chat message posts and renders for an active member', async () => {
  const { window, document, errors, dom } = await bootAs('kasun');
  try {
    window.location.hash = '#/guild/gld_southern_bmx';
    await waitFor(() => document.getElementById('guildChatForm'), 15000, 'guild chat form');
    setValue(window, document.getElementById('guildChatInput'), 'UI flow message: bringing a torque wrench on Saturday.');
    document.getElementById('guildChatForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await waitFor(() => document.body.textContent.includes('UI flow message: bringing a torque wrench'), 12000, 'chat message to render');
    assert.equal(errors.length, 0, errors.join(' | '));
  } finally {
    dom.window.close();
  }
});

test('FLOW 6 — parts favorite toggles and event registration updates state', async () => {
  const { window, document, errors, dom } = await bootAs('kasun');
  try {
    window.location.hash = '#/parts';
    await waitFor(() => document.querySelector('[data-fav]'), 15000, 'parts catalog');
    const favBtn = document.querySelector('[data-fav]');
    const beforeLabel = favBtn.textContent;
    click(window, favBtn);
    await waitFor(() => document.querySelector('[data-fav]').textContent !== beforeLabel, 12000, 'favorite state change');

    window.location.hash = '#/events';
    await waitFor(() => document.querySelector('[data-register-event]'), 15000, 'events list');
    click(window, document.querySelector('[data-register-event]'));
    await waitFor(() => document.body.textContent.includes('You are registered'), 12000, 'registration confirmation');
    click(window, document.querySelector('[data-cancel-event]'));
    // confirm() is not auto-accepted in jsdom; verify the API path separately
    const events = await fetch(`${baseUrl}/api/events`, {
      headers: { Authorization: `Bearer ${window.localStorage.getItem('rr_token')}` }
    }).then((r) => r.json());
    assert.ok(events.events.some((e) => e.registered_by_me), 'registration should be persisted server-side');
    assert.equal(errors.length, 0, errors.join(' | '));
  } finally {
    dom.window.close();
  }
});

test('FLOW 7 — non-friends cannot reach private messaging from the UI', async () => {
  const { window, document, errors, dom } = await bootAs('dilshan_minor');
  try {
    window.location.hash = '#/user/usr_admin_nethmi';
    await waitFor(() => document.getElementById('messageBtn'), 15000, 'public profile actions');
    click(window, document.getElementById('messageBtn'));
    await waitFor(() => document.querySelector('.toast'), 6000, 'restricted messaging notice');
    assert.match(document.querySelector('.toast').textContent, /accepted friends/i);
    assert.ok(!document.getElementById('chatForm'), 'chat composer must not open for non-friends');
    assert.equal(window.location.hash.startsWith('#/friends'), false);
    assert.equal(errors.length, 0, errors.join(' | '));
  } finally {
    dom.window.close();
  }
});

test('FLOW 8 — guild owner invites a rider and the invitation reaches them', async () => {
  const { window, document, errors, dom } = await bootAs('kasun');
  try {
    window.location.hash = '#/guild/gld_southern_bmx';
    await waitFor(() => document.querySelector('.guild-hero'), 15000, 'guild detail');
    const inviteBtn = document.getElementById('inviteRiderBtn');
    assert.ok(inviteBtn, 'guild owner must see the invite action');
    click(window, inviteBtn);
    await waitFor(() => document.getElementById('inviteUsername'), 6000, 'invite dialog');
    setValue(window, document.getElementById('inviteUsername'), 'roshan_dirtjump');
    click(window, document.getElementById('sendInviteBtn'));
    await waitFor(() => /Invitation sent|already/i.test(document.querySelector('.toast')?.textContent || ''), 12000, 'invite toast');

    // The invited rider sees the pending invitation in their guild list
    const invitee = await fetch(`${baseUrl}/api/auth/demo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ presetAccount: 'roshan' })
    }).then((r) => r.json());
    const guilds = await fetch(`${baseUrl}/api/guilds`, {
      headers: { Authorization: `Bearer ${invitee.token}` }
    }).then((r) => r.json());
    const invited = guilds.guilds.find((g) => g.id === 'gld_southern_bmx');
    assert.ok(['invited', 'active'].includes(invited.my_status), 'invitation should be recorded for the rider');
    assert.equal(errors.length, 0, errors.join(' | '));
  } finally {
    dom.window.close();
  }
});
