// RideRise LK — studio administrator capability probe.
//
// Proves the studio credential can moderate and do everything an ordinary account can. It
// talks to a RUNNING server over HTTP, so it needs the credential that server actually uses:
//
//   ADMIN_PASSWORD='the-one-you-set' npm run probe:admin            # http://127.0.0.1:3210
//   PROBE_BASE=https://your-host ADMIN_USERNAME=… ADMIN_PASSWORD=… npm run probe:admin
//
// There is no demo or sandbox sign-in any more, so the probe cannot conjure a rider session
// for the "ordinary rider" checks. Those paths are covered by `npm test`, which signs in
// through the real Firebase verifier with locally-minted tokens. Where the probe cannot act,
// it prints SKIP with the reason instead of pretending to pass.
//
// Run it against a throwaway database so its bans/posts/news stay out of real data:
//
//   DB_PATH=/tmp/admincheck.sqlite ADMIN_PASSWORD='probe-password-123' npm start
'use strict';

const BASE = process.env.PROBE_BASE || 'http://127.0.0.1:3210';
const USERNAME = process.env.PROBE_ADMIN_USERNAME || process.env.ADMIN_USERNAME || 'studio-admin';
const PASSWORD = process.env.PROBE_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || '';

let pass = 0;
let fail = 0;
let skipped = 0;
const failures = [];

async function call(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let json = null;
  const text = await res.text();
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, json };
}

function check(name, condition, detail) {
  if (condition) {
    pass += 1;
    console.log(`  ok   ${name}`);
  } else {
    fail += 1;
    failures.push(name);
    console.log(`  FAIL ${name}${detail ? ` — ${JSON.stringify(detail).slice(0, 240)}` : ''}`);
  }
}

function skip(name, why) {
  skipped += 1;
  console.log(`  SKIP ${name} — ${why}`);
}

(async () => {
  if (!PASSWORD) {
    console.error(
      '\nThis probe needs the studio credential of a running server.\n' +
        '  Set ADMIN_PASSWORD (and ADMIN_USERNAME if you changed it) or PROBE_ADMIN_PASSWORD.\n' +
        '  It is the password you chose, or the one printed once in the server log at first boot.\n'
    );
    process.exit(2);
  }

  console.log('\n== sign-in ==');
  const login = await call('POST', '/api/admin/login', { username: USERNAME, password: PASSWORD });
  check('studio credential signs in', login.status === 200, login);
  if (login.status !== 200) {
    console.log(`\n${pass} passed, ${fail} failed, ${skipped} skipped`);
    process.exit(1);
  }
  check('no forced password change', login.json.must_change_password === false, login.json);
  check('role is admin', login.json.role === 'admin', login.json);
  const admin = login.json.token;

  const me = await call('GET', '/api/admin/me', undefined, admin);
  check('admin/me resolves the linked studio profile', me.status === 200 && me.json.user.role === 'admin', me);
  const overview = await call('GET', '/api/admin/overview2', undefined, admin);
  check('moderation overview loads', overview.status === 200 && Boolean(overview.json.metrics), overview);

  console.log('\n== ordinary account abilities ==');
  const post = await call('POST', '/api/posts', {
    title: 'Studio test post',
    body: 'Verifying that the administrator account can publish in the community feed like any account.',
    category: 'community_qa'
  }, admin);
  check('publishes a feed post', post.status === 201 || post.status === 200, post);

  const feed = await call('GET', '/api/posts?limit=5', undefined, admin);
  check('reads the feed', feed.status === 200 && Array.isArray(feed.json.posts), feed);

  const postId = post.json.id || post.json.post_id || (post.json.post && post.json.post.id);
  if (postId) {
    const like = await call('POST', `/api/posts/${postId}/like`, { type: 'like' }, admin);
    check('likes a post', like.status === 200 || like.status === 201, like);
    const comment = await call('POST', `/api/posts/${postId}/comments`, { body: 'Self-check comment from the studio admin account.' }, admin);
    check('comments on a post', comment.status === 201 || comment.status === 200, comment);
  }

  const guilds = await call('GET', '/api/guilds', undefined, admin);
  check('lists guilds', guilds.status === 200 && Array.isArray(guilds.json.guilds), guilds);

  const stunts = await call('GET', '/api/stunts', undefined, admin);
  check('reads the stunt library', stunts.status === 200 && stunts.json.modules.length >= 21, stunts);

  const learning = await call('GET', '/api/learning/dashboard', undefined, admin);
  check('opens learning pathways', learning.status === 200 && learning.json.pathways.length > 0, learning);

  const events = await call('GET', '/api/events', undefined, admin);
  check('opens the event calendar', events.status === 200 && Array.isArray(events.json.events), events);

  const catalog = await call('GET', '/api/catalog/search?q=chain', undefined, admin);
  check('searches the parts catalogue', catalog.status === 200, catalog);

  const safety = await call('GET', '/api/community/rules', undefined, admin);
  check('reads community rules', safety.status === 200 && Boolean(safety.json.community_guidelines), safety);

  console.log('\n== moderation powers ==');
  const users = await call('GET', '/api/admin/users', undefined, admin);
  check('lists accounts', users.status === 200 && Array.isArray(users.json.users), users);
  const target = (users.json.users || []).find((u) => u.role === 'rider') || null;
  if (target) {
    const ban = await call('POST', `/api/admin/users/${target.id}/ban`, { reason: 'Probe: temporary verification ban' }, admin);
    check('bans an account', ban.status === 200, ban);
    const unban = await call('POST', `/api/admin/users/${target.id}/unban`, { reason: 'Probe cleanup' }, admin);
    check('unbans the account', unban.status === 200, unban);
    const suspend = await call('POST', `/api/admin/users/${target.id}/suspend`, { reason: 'Probe', duration_hours: 1 }, admin);
    check('temporarily suspends', suspend.status === 200, suspend);
    const restore = await call('POST', `/api/admin/users/${target.id}/restore`, { reason: 'Probe cleanup' }, admin);
    check('restores the account', restore.status === 200, restore);
  } else {
    skip('ban / unban / suspend / restore', 'no rider account exists on this deployment yet (create one in the app, or start with SEED_DEMO=1)');
  }

  const reports = await call('GET', '/api/admin/reports', undefined, admin);
  check('receives the report queue', reports.status === 200 && Array.isArray(reports.json.reports), reports);
  const reportId = (reports.json.reports || [])[0] && reports.json.reports[0].id;
  if (reportId) {
    const resolve = await call('POST', `/api/admin/reports/${reportId}/action`, { action: 'dismiss', note: 'Probe review' }, admin);
    check('resolves a report', resolve.status === 200, resolve);
  } else {
    skip('resolving a report', 'the queue is empty');
  }

  const feedback = await call('GET', '/api/admin/feedback', undefined, admin);
  check('receives feedback', feedback.status === 200 && Array.isArray(feedback.json.feedback), feedback);

  console.log('\n== studio publishing ==');
  const news = await call('POST', '/api/admin/news', {
    title: 'Probe studio announcement',
    body: 'Verifying that the administrator credential can publish studio news.',
    pinned: true,
    notify: false
  }, admin);
  check('publishes studio news', news.status === 200, news);

  const official = await call('POST', '/api/admin/events', {
    title: 'Probe Official Studio Event',
    description: 'Verification entry created by the capability probe.',
    event_date: '2026-12-12',
    venue: 'Probe Arena',
    capacity: 30
  }, admin);
  check('publishes an official studio event', official.status === 201, official);

  const officialFlag = await call('GET', '/api/events?official=1', undefined, admin);
  check('official events are flagged', officialFlag.status === 200 && officialFlag.json.events.some((e) => e.is_official_studio_event), officialFlag);

  const broadcast = await call('POST', '/api/admin/broadcast', { title: 'Probe broadcast', body: 'Capability probe broadcast.', audience: 'all' }, admin);
  check('broadcasts to riders', [200, 201].includes(broadcast.status), broadcast);

  const audit = await call('GET', '/api/admin/audit', undefined, admin);
  check('audit trail records the actions', audit.status === 200 && (audit.json.logs || audit.json.audit || []).length > 0, audit);

  const push = await call('GET', '/api/admin/push/status', undefined, admin);
  check('push status reports what is configured', push.status === 200 && typeof push.json.configured === 'boolean', push);

  console.log('\n== isolation ==');
  const noAuth = await call('GET', '/api/admin/reports');
  check('unauthenticated console access is rejected', noAuth.status === 401, noAuth);
  const noAuthBan = await call('POST', '/api/admin/users/usr_studio/ban', { reason: 'should fail' });
  check('unauthenticated moderation is rejected', noAuthBan.status === 401, noAuthBan);
  skip(
    'ordinary rider is refused the console',
    'needs a real rider sign-in; covered by tests/auth.firebase.test.js FB 16 and FB 19'
  );
  skip(
    'deleted private message leaves a tombstone',
    'needs two real riders; covered by tests/api.test.js test 30'
  );

  console.log(`\n${pass} passed, ${fail} failed, ${skipped} skipped`);
  if (fail) console.log('failed:', failures.join('; '));
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error('probe crashed:', err);
  process.exit(2);
});
