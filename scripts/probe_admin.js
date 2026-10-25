// RideRise LK — studio administrator capability probe.
//
// Proves the documented `admin$123$` credential can moderate AND do everything an ordinary
// rider can. Run it against a THROWAWAY database so the probe's bans/posts/news stay out of
// your real data:
//
//   PORT=3210 DB_PATH=/tmp/admincheck.sqlite node backend/server.js &
//   PROBE_BASE=http://127.0.0.1:3210 npm run probe:admin
//
// It is a script rather than a `node:test` suite because it mutates accounts and publishes
// content; the suites in tests/ stay read-only-ish and fast.
'use strict';


const BASE = process.env.PROBE_BASE || 'http://127.0.0.1:3210';
let pass = 0;
let fail = 0;
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

(async () => {
  console.log('\n== sign-in ==');
  const login = await call('POST', '/api/admin/login', { username: 'admin$123$', password: 'admin$123$' });
  check('admin$123$ signs in', login.status === 200, login);
  check('no forced password change on a fresh database', login.json.must_change_password === false, login.json);
  check('role is admin', login.json.role === 'admin', login.json);
  const admin = login.json.token;

  const me = await call('GET', '/api/admin/me', undefined, admin);
  check('admin/me resolves the studio profile', me.status === 200 && me.json.user.username === 'nethmi_sds', me);
  const overview = await call('GET', '/api/admin/overview2', undefined, admin);
  check('moderation overview loads', overview.status === 200 && Boolean(overview.json.metrics), overview);

  console.log('\n== ordinary rider abilities ==');
  const post = await call('POST', '/api/posts', {
    title: 'Studio test post',
    body: 'Verifying that the administrator account can publish in the community feed like any rider.',
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
  check('lists guilds', guilds.status === 200 && guilds.json.guilds.length > 0, guilds);

  const stunts = await call('GET', '/api/stunts', undefined, admin);
  check('reads the stunt library', stunts.status === 200 && stunts.json.modules.length === 21, stunts);

  const learning = await call('GET', '/api/learning/dashboard', undefined, admin);
  check('opens learning pathways', learning.status === 200 && learning.json.pathways.length > 0, learning);

  const events = await call('GET', '/api/events', undefined, admin);
  check('opens the event calendar', events.status === 200 && Array.isArray(events.json.events), events);
  const eventId = (events.json.events || [])[0] && (events.json.events[0].id || events.json.events[0].event_id);
  if (eventId) {
    const rsvp = await call('POST', `/api/events/${eventId}/register`, {}, admin);
    check('registers for an event', [200, 201, 409].includes(rsvp.status), rsvp);
  }

  const catalog = await call('GET', '/api/catalog/search?q=chain', undefined, admin);
  check('searches the parts catalogue', catalog.status === 200, catalog);

  const safety = await call('GET', '/api/community/rules', undefined, admin);
  check('reads community rules', safety.status === 200 && Boolean(safety.json.community_guidelines), safety);

  console.log('\n== messaging moderation ==');
  const kasunLogin = await call('POST', '/api/auth/google', { presetAccount: 'kasun' });
  check('seeded rider session available', kasunLogin.status === 200 && Boolean(kasunLogin.json.token), kasunLogin);
  const kasun = kasunLogin.json.token;

  const convo = await call('GET', '/api/dm/threads', undefined, admin);
  check('admin sees DM threads', convo.status === 200 && Array.isArray(convo.json.threads), convo);
  const friendId = 'usr_admin_nethmi';
  let messageId = null;
  if (friendId) {
    const sent = await call('POST', `/api/dm/threads/${friendId}`, { body: 'Message used to test moderator deletion.' }, kasun);
    messageId = sent.json && (sent.json.message && sent.json.message.id);
    check('rider can message the admin account', [200, 201].includes(sent.status) && Boolean(messageId), sent);
    if (messageId) {
      const del = await call('DELETE', `/api/dm/messages/${messageId}`, undefined, admin);
      check('admin deletes a private message', del.status === 200, del);
      const after = await call('GET', `/api/dm/threads/${friendId}`, undefined, kasun);
      const row = (after.json.messages || []).find((m) => m.id === messageId);
      check('deleted message is a tombstone, not a leak', !row || (row.body === '' || row.deleted === true), row);
    }
  } else {
    check('rider can message the admin account', false, convo);
  }

  console.log('\n== moderation powers ==');
  const users = await call('GET', '/api/admin/users?q=roshan', undefined, admin);
  check('searches accounts', users.status === 200 && Array.isArray(users.json.users), users);
  const roshanId = ((users.json.users || [])[0] || {}).id || 'usr_roshan';
  const roshanLogin = await call('POST', '/api/auth/google', { presetAccount: 'roshan' });
  const roshan = roshanLogin.json.token;

  const ban = await call('POST', `/api/admin/users/${roshanId}/ban`, { reason: 'Probe: temporary verification ban' }, admin);
  check('bans an account', ban.status === 200, ban);
  const afterBan = await call('GET', '/api/auth/session', undefined, roshan);
  check('banned session is terminated', afterBan.status === 401 || afterBan.status === 403, afterBan);
  const unban = await call('POST', `/api/admin/users/${roshanId}/unban`, { reason: 'Probe cleanup' }, admin);
  check('unbans the account', unban.status === 200, unban);

  const suspend = await call('POST', `/api/admin/users/${roshanId}/suspend`, { reason: 'Probe', duration_hours: 1 }, admin);
  check('temporarily suspends', suspend.status === 200, suspend);
  const restore = await call('POST', `/api/admin/users/${roshanId}/restore`, { reason: 'Probe cleanup' }, admin);
  check('restores the account', restore.status === 200, restore);

  const reports = await call('GET', '/api/admin/reports', undefined, admin);
  check('receives the report queue', reports.status === 200 && Array.isArray(reports.json.reports), reports);
  const reportId = (reports.json.reports || [])[0] && reports.json.reports[0].id;
  if (reportId) {
    const resolve = await call('POST', `/api/admin/reports/${reportId}/action`, { action: 'dismiss', note: 'Probe review' }, admin);
    check('resolves a report', resolve.status === 200, resolve);
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
  check('push status is honest about missing credentials', push.status === 200 && push.json.configured === false, push);

  console.log('\n== isolation ==');
  const riderAdmin = await call('GET', '/api/admin/reports', undefined, kasun);
  check('ordinary rider cannot reach the console', riderAdmin.status === 403 || riderAdmin.status === 401, riderAdmin);
  const noAuth = await call('POST', '/api/admin/users/usr_kasun/ban', { reason: 'should fail' });
  check('unauthenticated moderation is rejected', noAuth.status === 401, noAuth);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) console.log('failed:', failures.join('; '));
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error('probe crashed:', err);
  process.exit(2);
});
