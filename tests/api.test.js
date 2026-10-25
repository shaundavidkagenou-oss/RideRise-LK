// RideRise LK — Phase 1 automated test suite (node:test)
// Covers onboarding/auth, profiles & privacy, bike rating math, ranks/XP, feed,
// friendships, friend-only messaging, guilds, stunt library, parts catalog, events,
// moderation/RBAC, IDOR protection, rate limiting, uploads and account deletion.
process.env.DB_PATH = `/tmp/riderise_test_${Date.now()}.sqlite`;
process.env.JWT_SECRET = 'test-suite-secret-do-not-use-in-production';

const test = require('node:test');
const assert = require('node:assert/strict');

const { server, db } = require('../backend/server.js');
const { calculateBikeBuildRating } = require('../backend/services.js');

let baseUrl = '';
const tokens = {};

async function call(path, { method = 'GET', token = null, body = null, raw = false } = {}) {
  const headers = {};
  if (body !== null) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body !== null ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (raw) return { status: res.status, json, text };
  return { status: res.status, json };
}

async function signIn(presetAccount) {
  const res = await call('/api/auth/google', { method: 'POST', body: { presetAccount } });
  assert.equal(res.status, 200, `sign-in failed for ${presetAccount}`);
  return res.json.token;
}

test.before(async () => {
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
  tokens.kasun = await signIn('kasun');
  tokens.roshan = await signIn('roshan');
  tokens.admin = await signIn('admin');
  tokens.minor = await signIn('dilshan_minor');
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  try {
    db.close();
  } catch (e) {
    /* already closed */
  }
});

test('1. Health, brand config and seeded content are served', async () => {
  const health = await call('/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.json.app, 'RideRise LK');
  assert.equal(health.json.packageId, 'lk.shaunstudios.riderise');

  const config = await call('/api/config');
  assert.equal(config.status, 200);
  assert.equal(config.json.brand.studioName, 'Shaun David Studios');
  assert.equal(config.json.ranks.length, 7);
  assert.equal(config.json.ranks[0].name, 'Rookie Rider');
  assert.equal(config.json.ranks[6].name, 'Ride Legend');
  assert.ok(config.json.legalDocuments.some((d) => d.slug === 'safety_notice'));
  assert.match(config.json.draftSafetyNotice, /inherent risks, including serious injury/);
  assert.equal(config.json.brand.sriLankaDistricts.length, 25);
});

test('2. Google auth error states are explicit and never accept passwords', async () => {
  const cancelled = await call('/api/auth/google', { method: 'POST', body: { simulateError: 'cancelled' } });
  assert.equal(cancelled.status, 400);
  assert.equal(cancelled.json.error, 'AUTH_CANCELLED');

  const unavailable = await call('/api/auth/google', { method: 'POST', body: { simulateError: 'network_unavailable' } });
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.json.error, 'AUTH_UNAVAILABLE');

  const invalid = await call('/api/auth/google', { method: 'POST', body: { simulateError: 'invalid_credential' } });
  assert.equal(invalid.status, 401);

  const passwordAttempt = await call('/api/auth/google', {
    method: 'POST',
    body: { email: 'someone@example.com', password: 'hunter2' }
  });
  assert.equal(passwordAttempt.status, 400);
  assert.equal(passwordAttempt.json.error, 'PASSWORD_NOT_ALLOWED');
});

test('3. Session requires a valid token and rejects tampering', async () => {
  const anonymous = await call('/api/auth/session');
  assert.equal(anonymous.status, 401);

  const tampered = await call('/api/auth/session', { token: `${tokens.kasun.slice(0, -4)}abcd` });
  assert.equal(tampered.status, 401);

  const session = await call('/api/auth/session', { token: tokens.kasun });
  assert.equal(session.status, 200);
  assert.equal(session.json.profile.username, 'kasun_bmx_lk');
  assert.ok(session.json.account.email.endsWith('@example.com'));
});

test('4. Public profiles never expose private account fields', async () => {
  const profile = await call('/api/profiles/usr_kasun', { token: tokens.roshan });
  assert.equal(profile.status, 200);
  const serialized = JSON.stringify(profile.json);
  assert.ok(!serialized.includes('kasun.perera.private@example.com'), 'email leaked');
  assert.ok(!serialized.includes('2001-08-19'), 'date of birth leaked');
  assert.ok(!serialized.includes('google_oauth_sub'), 'OAuth subject leaked');
  assert.equal(profile.json.profile.email, undefined);
  assert.equal(profile.json.profile.dob, undefined);
});

test('5. Private and friends-only profiles return restricted cards', async () => {
  // Dilshan (16-17) defaults to friends-only visibility
  const minor = await call('/api/profiles/usr_dilshan_minor', { token: tokens.roshan });
  assert.equal(minor.status, 200);
  assert.equal(minor.json.profile.restricted_view, true);
  assert.equal(minor.json.profile.bicycles, undefined);

  // Owner still sees full profile
  const own = await call('/api/profiles/usr_dilshan_minor', { token: tokens.minor });
  assert.equal(own.json.profile.restricted_view, false);
});

test('6. Onboarding enforces age, legal acceptance and unique usernames', async () => {
  const fresh = await call('/api/auth/google', { method: 'POST', body: { email: 'new.rider@example.com' } });
  assert.equal(fresh.status, 200);
  assert.equal(fresh.json.onboardingRequired, true);
  const freshToken = fresh.json.token;

  const noAge = await call('/api/auth/onboarding', {
    method: 'POST',
    token: freshToken,
    body: {
      confirmAge16Plus: false,
      acceptTerms: true,
      acceptPrivacy: true,
      acceptGuidelines: true,
      acceptSafetyNotice: true,
      username: 'new_rider',
      displayName: 'New Rider'
    }
  });
  assert.equal(noAge.status, 400);
  assert.equal(noAge.json.error, 'AGE_ELIGIBILITY_REQUIRED');

  const underAge = await call('/api/auth/onboarding', {
    method: 'POST',
    token: freshToken,
    body: {
      confirmAge16Plus: true,
      dob: '2014-05-01',
      acceptTerms: true,
      acceptPrivacy: true,
      acceptGuidelines: true,
      acceptSafetyNotice: true,
      username: 'new_rider',
      displayName: 'New Rider'
    }
  });
  assert.equal(underAge.status, 403);
  assert.equal(underAge.json.error, 'UNDER_MINIMUM_AGE');

  const noLegal = await call('/api/auth/onboarding', {
    method: 'POST',
    token: freshToken,
    body: { confirmAge16Plus: true, acceptTerms: true, acceptPrivacy: false, username: 'new_rider', displayName: 'New Rider' }
  });
  assert.equal(noLegal.status, 400);
  assert.equal(noLegal.json.error, 'LEGAL_ACCEPTANCE_REQUIRED');

  const takenUsername = await call('/api/auth/onboarding', {
    method: 'POST',
    token: freshToken,
    body: {
      confirmAge16Plus: true,
      acceptTerms: true,
      acceptPrivacy: true,
      acceptGuidelines: true,
      acceptSafetyNotice: true,
      username: 'kasun_bmx_lk',
      displayName: 'Impostor'
    }
  });
  assert.equal(takenUsername.status, 409);
  assert.equal(takenUsername.json.error, 'USERNAME_TAKEN');

  const success = await call('/api/auth/onboarding', {
    method: 'POST',
    token: freshToken,
    body: {
      confirmAge16Plus: true,
      dob: '2010-02-02', // 16 years old -> minor safeguards
      acceptTerms: true,
      acceptPrivacy: true,
      acceptGuidelines: true,
      acceptSafetyNotice: true,
      username: 'new_rider',
      displayName: 'New Rider',
      district: 'Galle',
      preferredRidingArea: 'Galle court',
      profileVisibility: 'public'
    }
  });
  assert.equal(success.status, 200);
  assert.equal(success.json.isMinor, true);
  assert.equal(success.json.profile.profile_visibility, 'friends', 'minors default to friends-only');
  assert.equal(success.json.profile.hide_from_leaderboards, true, 'minors hidden from leaderboards by default');
});

test('7. Users cannot self-assign XP, rank or role', async () => {
  const attempt = await call('/api/profile', {
    method: 'PUT',
    token: tokens.minor,
    body: { xp: 99999, rank_id: 'rank_7', role: 'admin' }
  });
  assert.equal(attempt.status, 403);
  assert.equal(attempt.json.error, 'UNAUTHORIZED_RANK_MODIFICATION');

  const profile = await call('/api/profiles/usr_dilshan_minor', { token: tokens.minor });
  assert.equal(profile.json.profile.xp, 240);
  assert.equal(profile.json.profile.rank_id, 'rank_2');

  // Staff session confirms no privilege escalation happened
  const session = await call('/api/auth/session', { token: tokens.minor });
  assert.equal(session.json.account.role, 'rider');
});

test('8. Profile editing validates usernames and privacy settings', async () => {
  const invalid = await call('/api/profile', { method: 'PUT', token: tokens.kasun, body: { username: 'Bad Name!!' } });
  assert.equal(invalid.status, 400);

  const conflict = await call('/api/profile', { method: 'PUT', token: tokens.kasun, body: { username: 'roshan_dirtjump' } });
  assert.equal(conflict.status, 409);

  const ok = await call('/api/profile', {
    method: 'PUT',
    token: tokens.kasun,
    body: { bio: 'Updated bio for tests', preferred_riding_area: 'Bentota court', hide_from_leaderboards: true }
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.profile.bio, 'Updated bio for tests');
  assert.equal(ok.json.profile.hide_from_leaderboards, true);

  // Leaderboard exclusion
  const board = await call('/api/leaderboards?scope=overall');
  assert.ok(!board.json.leaders.some((l) => l.user_id === 'usr_kasun'), 'hidden rider must not appear');

  await call('/api/profile', { method: 'PUT', token: tokens.kasun, body: { hide_from_leaderboards: false } });
  const board2 = await call('/api/leaderboards?scope=overall');
  assert.ok(board2.json.leaders.some((l) => l.user_id === 'usr_kasun'));
});

test('9. Bike Build Rating math is transparent and safety-capped', () => {
  const complete = {
    bike_type: 'BMX',
    frame_material: 'Chromoly steel (4130 CrMo)',
    frame_brand: 'WeThePeople',
    frame_model: 'Justice',
    fork_spec: 'CrMo fork',
    tire_spec: '20 x 2.40',
    wheel_rim_spec: 'Double-wall 36H',
    handlebar_grip_spec: '9.25in bars + plugs',
    drivetrain_spec: '3-piece 25T-9T',
    brake_type: 'Rear U-Brake',
    maintenance_condition: 'Excellent',
    safety_defects: [],
    primary_use: 'Skatepark',
    photos: { frame: 'x', drivetrain: 'x', tires: 'x', brakes: 'x', complete: 'x' }
  };
  const clean = calculateBikeBuildRating(complete);
  assert.equal(clean.has_critical_safety_defect, 0);
  assert.ok(clean.build_score >= 90, `expected high score, got ${clean.build_score}`);
  assert.equal(
    clean.breakdown.safety_structural.score +
      clean.breakdown.maintenance_condition.score +
      clean.breakdown.use_case_compatibility.score +
      clean.breakdown.build_completeness.score +
      clean.breakdown.component_clarity.score,
    clean.build_score,
    'breakdown must add up to the total'
  );

  const expensiveButCracked = calculateBikeBuildRating({
    ...complete,
    frame_brand: 'Premium Carbon Flagship',
    frame_material: 'Carbon fibre',
    cosmetic_rating: 5,
    safety_defects: ['cracks'],
    maintenance_condition: 'Excellent'
  });
  assert.equal(expensiveButCracked.has_critical_safety_defect, 1);
  assert.ok(expensiveButCracked.build_score <= 39, 'critical defects must cap the score');
  assert.match(expensiveButCracked.safety_recommendation, /DO NOT RIDE FOR STUNTS/);
  assert.equal(expensiveButCracked.breakdown.safety_cap_applied, true);

  const cosmeticNeverRaised = calculateBikeBuildRating({ ...complete, cosmetic_rating: 1 });
  assert.equal(cosmeticNeverRaised.build_score, clean.build_score, 'cosmetic rating must not change build score');

  const brakeless = calculateBikeBuildRating({ ...complete, brake_type: 'Brakeless (skatepark only)' });
  assert.ok(brakeless.breakdown.safety_structural.score <= 18);
});

test('10. Bike questionnaire endpoints, preview, CRUD and IDOR protection', async () => {
  const preview = await call('/api/bicycles/preview-score', {
    method: 'POST',
    token: tokens.roshan,
    body: { bike_type: 'BMX', maintenance_condition: 'Poor', safety_defects: ['cracks'] }
  });
  assert.equal(preview.status, 200);
  assert.ok(preview.json.build_score <= 39);

  const created = await call('/api/bicycles', {
    method: 'POST',
    token: tokens.roshan,
    body: {
      name: 'Test DJ Build',
      bike_type: 'Dirt Jumper',
      frame_material: 'Aluminium',
      frame_brand: 'Dartmoor',
      frame_model: 'Hornet',
      fork_spec: '100mm air',
      tire_spec: '26 x 2.3',
      wheel_rim_spec: 'Double-wall 32H',
      handlebar_grip_spec: '780mm riser',
      drivetrain_spec: 'Single speed 32-14',
      brake_type: 'Rear Hydraulic Disc',
      maintenance_condition: 'Good',
      safety_defects: [],
      primary_use: 'Dirt trails',
      photos: { complete: 'x' }
    }
  });
  assert.equal(created.status, 201);
  assert.ok(created.json.rating.build_score > 50);

  const forbidden = await call(`/api/bicycles/${created.json.bikeId}`, {
    method: 'DELETE',
    token: tokens.kasun
  });
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.json.error, 'FORBIDDEN_OBJECT_ACCESS');

  const updated = await call(`/api/bicycles/${created.json.bikeId}`, {
    method: 'PUT',
    token: tokens.roshan,
    body: { name: 'Test DJ Build v2', maintenance_condition: 'Needs Service', safety_defects: ['loose_bolts'] }
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.json.rating.has_critical_safety_defect, 1);

  const list = await call('/api/bicycles', { token: tokens.roshan });
  assert.ok(list.json.bicycles.some((b) => b.id === created.json.bikeId));
  assert.ok(list.json.bicycles.every((b) => b.verification_status === 'unverified_user_reported'));
});

test('11. Safety checklist requires all 7 checks and prevents XP farming', async () => {
  const partial = await call('/api/safety/checklist', {
    method: 'POST',
    token: tokens.roshan,
    body: { checkedItems: ['1', '2'] }
  });
  assert.equal(partial.status, 400);
  assert.equal(partial.json.error, 'INCOMPLETE_SAFETY_CHECKLIST');

  const complete = await call('/api/safety/checklist', {
    method: 'POST',
    token: tokens.roshan,
    body: { checkedItems: ['0', '1', '2', '3', '4', '5', '6'] }
  });
  assert.equal(complete.status, 200);
  assert.ok(complete.json.xpAdded >= 0);

  const repeat = await call('/api/safety/checklist', {
    method: 'POST',
    token: tokens.roshan,
    body: { checkedItems: ['0', '1', '2', '3', '4', '5', '6'] }
  });
  assert.equal(repeat.status, 200);
  assert.equal(repeat.json.xpAdded, 0, 'same-day repeat must not award additional XP');
});

test('12. Stunt library exposes all four categories with safety content', async () => {
  const library = await call('/api/stunts', { token: tokens.kasun });
  assert.equal(library.status, 200);
  const modules = library.json.modules;
  assert.equal(modules.length, 21);
  for (const cat of ['fundamentals', 'beginner_freestyle', 'intermediate', 'advanced']) {
    assert.ok(modules.some((m) => m.category === cat), `missing category ${cat}`);
  }
  const advanced = modules.filter((m) => m.category === 'advanced');
  assert.ok(advanced.every((m) => m.requires_safety_ack), 'advanced modules must require acknowledgement');
  for (const m of modules) {
    assert.ok(m.protective_gear.length > 0);
    assert.ok(m.learning_stages.length > 0);
    assert.ok(m.stop_conditions.length > 0);
    assert.ok(m.coaching_reminder.length > 10);
    assert.ok(m.quiz_questions.length > 0);
  }
  const lockedAdvanced = modules.find((m) => m.category === 'advanced');
  assert.equal(lockedAdvanced.locked, true, 'advanced modules are locked behind prerequisites for this rider');
});

test('13. Stunt completion enforces prerequisites, checklist, safety ack and quiz', async () => {
  const prereqFail = await call('/api/stunts/mod_int_3/complete', {
    method: 'POST',
    token: tokens.roshan,
    body: { checklistCompleted: true, safetyAcknowledged: true, quizAnswers: [0] }
  });
  assert.equal(prereqFail.status, 400);
  assert.equal(prereqFail.json.error, 'PREREQUISITES_NOT_MET');

  const checklistFail = await call('/api/stunts/mod_fund_1/complete', {
    method: 'POST',
    token: tokens.roshan,
    body: { checklistCompleted: false, quizAnswers: [1, 1] }
  });
  assert.equal(checklistFail.status, 400);
  assert.equal(checklistFail.json.error, 'CHECKLIST_REQUIRED');

  const quizFail = await call('/api/stunts/mod_fund_1/complete', {
    method: 'POST',
    token: tokens.roshan,
    body: { checklistCompleted: true, quizAnswers: [0, 0] }
  });
  assert.equal(quizFail.status, 400);
  assert.equal(quizFail.json.error, 'QUIZ_NOT_PASSED');

  const pass = await call('/api/stunts/mod_fund_1/complete', {
    method: 'POST',
    token: tokens.roshan,
    body: { checklistCompleted: true, quizAnswers: [1, 1] }
  });
  assert.equal(pass.status, 200);
  assert.ok(pass.json.xpAdded > 0);
});

test('14. Community feed supports create, like, comment, bookmark, edit and delete', async () => {
  const created = await call('/api/posts', {
    method: 'POST',
    token: tokens.roshan,
    body: {
      category: 'maintenance_upgrade',
      title: 'Test maintenance guide',
      body: 'Checking brake pads and spoke tension before monsoon season.',
      tags: ['Maintenance', 'Safety']
    }
  });
  assert.equal(created.status, 201);

  const feed = await call('/api/posts?limit=30', { token: tokens.roshan });
  const post = feed.json.posts.find((p) => p.id === created.json.postId);
  assert.ok(post, 'created post should appear in the feed');
  assert.deepEqual(post.tags, ['Maintenance', 'Safety']);

  const like = await call(`/api/posts/${post.id}/like`, { method: 'POST', token: tokens.kasun });
  assert.equal(like.json.liked, true);
  const unlike = await call(`/api/posts/${post.id}/like`, { method: 'POST', token: tokens.kasun });
  assert.equal(unlike.json.liked, false);

  const bookmark = await call(`/api/posts/${post.id}/bookmark`, { method: 'POST', token: tokens.kasun });
  assert.equal(bookmark.json.bookmarked, true);
  const saved = await call('/api/posts?bookmarked=1', { token: tokens.kasun });
  assert.ok(saved.json.posts.some((p) => p.id === post.id));

  const comment = await call(`/api/posts/${post.id}/comments`, {
    method: 'POST',
    token: tokens.kasun,
    body: { body: 'Great checklist — bookmarking this.' }
  });
  assert.equal(comment.status, 201);
  const reply = await call(`/api/posts/${post.id}/comments`, {
    method: 'POST',
    token: tokens.roshan,
    body: { body: 'Thanks @kasun_bmx_lk!', parent_comment_id: comment.json.commentId }
  });
  assert.equal(reply.status, 201);

  const feedAfter = await call('/api/posts?limit=30', { token: tokens.kasun });
  const withComments = feedAfter.json.posts.find((p) => p.id === post.id);
  assert.equal(withComments.comments.length, 2);

  const editByOther = await call(`/api/posts/${post.id}`, {
    method: 'PUT',
    token: tokens.kasun,
    body: { title: 'Hijacked' }
  });
  assert.equal(editByOther.status, 403);

  const edit = await call(`/api/posts/${post.id}`, {
    method: 'PUT',
    token: tokens.roshan,
    body: { title: 'Test maintenance guide (updated)', body: 'Updated details.' }
  });
  assert.equal(edit.status, 200);

  const delByOther = await call(`/api/posts/${post.id}`, { method: 'DELETE', token: tokens.kasun });
  assert.equal(delByOther.status, 403);

  const del = await call(`/api/posts/${post.id}`, { method: 'DELETE', token: tokens.roshan });
  assert.equal(del.status, 200);
});

test('15. Dangerous road-stunt content is queued for moderation instead of published', async () => {
  const risky = await call('/api/posts', {
    method: 'POST',
    token: tokens.admin,
    body: {
      category: 'short_clip',
      title: 'Doing wheelies in busy road traffic',
      body: 'Filmed while swerving cars on the main road — no helmet traffic challenge.'
    }
  });
  assert.equal(risky.status, 201);
  assert.equal(risky.json.moderationStatus, 'pending_review');
  assert.equal(risky.json.gpsCoordinatesStripped, true);

  const feed = await call('/api/posts?limit=30', { token: tokens.kasun });
  assert.ok(!feed.json.posts.some((p) => p.id === risky.json.postId), 'pending content must not be public');
});

test('16. Reports are validated, stored and notifiable', async () => {
  const invalid = await call('/api/reports', {
    method: 'POST',
    token: tokens.kasun,
    body: { target_type: 'post', target_id: '', reason_category: 'other', details: 'x' }
  });
  assert.equal(invalid.status, 400);

  const ok = await call('/api/reports', {
    method: 'POST',
    token: tokens.kasun,
    body: {
      target_type: 'user',
      target_id: 'usr_roshan',
      reason_category: 'suspicious_pii_request',
      details: 'Asked for my home address and phone number in a private message.'
    }
  });
  assert.equal(ok.status, 201);
  assert.ok(ok.json.reportId);
});

test('17. Friend requests, self-request rejection and acceptance flow', async () => {
  const self = await call('/api/friends/request', {
    method: 'POST',
    token: tokens.minor,
    body: { targetUserId: 'usr_dilshan_minor' }
  });
  assert.equal(self.status, 400);

  const dup = await call('/api/friends/request', {
    method: 'POST',
    token: tokens.kasun,
    body: { targetUserId: 'usr_roshan' }
  });
  assert.equal(dup.status, 409);
  assert.equal(dup.json.error, 'ALREADY_FRIENDS');

  const request = await call('/api/friends/request', {
    method: 'POST',
    token: tokens.minor,
    body: { username: 'roshan_dirtjump' }
  });
  assert.equal(request.status, 201);

  const incoming = await call('/api/friends', { token: tokens.roshan });
  const pending = incoming.json.incoming.find((f) => f.username === 'dilshan_rides');
  assert.ok(pending);
  const accept = await call(`/api/friends/${pending.friendship_id}`, { method: 'POST', token: tokens.roshan, body: { action: 'accept' } });
  assert.equal(accept.status, 200);

  const after = await call('/api/friends', { token: tokens.roshan });
  assert.ok(after.json.accepted.some((f) => f.username === 'dilshan_rides'));
});

test('18. Private messaging is friends-only and blocked users cannot contact', async () => {
  const nonFriend = await call('/api/conversations/usr_admin_nethmi/messages', { token: tokens.minor });
  assert.equal(nonFriend.status, 403);
  assert.equal(nonFriend.json.error, 'FRIENDS_ONLY_MESSAGING');

  const friends = await call('/api/conversations/usr_kasun/messages', { token: tokens.roshan });
  assert.equal(friends.status, 200);
  assert.ok(friends.json.messages.length >= 2);

  const sent = await call('/api/conversations/usr_kasun/messages', {
    method: 'POST',
    token: tokens.roshan,
    body: { body: 'See you at the Bentota clinic.' }
  });
  assert.equal(sent.status, 201);
  assert.equal(sent.json.message.delivery_status, 'delivered');

  const convoList = await call('/api/conversations', { token: tokens.kasun });
  const convo = convoList.json.conversations.find((c) => c.friend.user_id === 'usr_roshan');
  assert.ok(convo);
  const mute = await call(`/api/conversations/${convo.conversation_id}/mute`, { method: 'POST', token: tokens.kasun });
  assert.equal(mute.status, 200);

  const block = await call('/api/blocks', { method: 'POST', token: tokens.kasun, body: { blockedUserId: 'usr_roshan' } });
  assert.equal(block.status, 200);

  const blockedDm = await call('/api/conversations/usr_kasun/messages', { token: tokens.roshan });
  assert.equal(blockedDm.status, 403);
  assert.equal(blockedDm.json.error, 'CONTACT_BLOCKED');

  const blockedProfile = await call('/api/profiles/usr_kasun', { token: tokens.roshan });
  assert.equal(blockedProfile.status, 404);

  const search = await call('/api/users/search?q=kasun', { token: tokens.roshan });
  assert.ok(!search.json.users.some((u) => u.user_id === 'usr_kasun'));

  const unblock = await call('/api/blocks/usr_roshan', { method: 'DELETE', token: tokens.kasun });
  assert.equal(unblock.status, 200);
  const restored = await call('/api/profiles/usr_kasun', { token: tokens.roshan });
  assert.equal(restored.status, 200);
});

test('19. Guild lifecycle: create, duplicate guard, join, chat, approval, roles, privacy', async () => {
  const created = await call('/api/guilds', {
    method: 'POST',
    token: tokens.minor,
    body: {
      name: 'Galle Youth Riders',
      category: 'Beginner Learning Crew',
      district: 'Galle',
      emblem: 'lotus-wheel',
      privacy_type: 'private',
      description: 'Beginner-focused guild practising fundamentals in a closed court.'
    }
  });
  assert.equal(created.status, 201);
  const guildId = created.json.guildId;

  const duplicate = await call('/api/guilds', {
    method: 'POST',
    token: tokens.roshan,
    body: { name: 'Galle Youth Riders' }
  });
  assert.equal(duplicate.status, 409);

  const joinRequest = await call(`/api/guilds/${guildId}/join`, { method: 'POST', token: tokens.roshan });
  assert.equal(joinRequest.json.status, 'pending_approval');

  const outsiderView = await call(`/api/guilds/${guildId}`, { token: tokens.roshan });
  assert.equal(outsiderView.json.canViewInternal, false);
  assert.equal(outsiderView.json.messages.length, 0);

  const chatDenied = await call(`/api/guilds/${guildId}/messages`, {
    method: 'POST',
    token: tokens.roshan,
    body: { body: 'Trying to sneak into a private guild chat.' }
  });
  assert.equal(chatDenied.status, 403);

  // Owner approves
  const approve = await call(`/api/guilds/${guildId}/members/usr_roshan`, {
    method: 'POST',
    token: tokens.minor,
    body: { memberAction: 'approve' }
  });
  assert.equal(approve.status, 200);

  const memberView = await call(`/api/guilds/${guildId}`, { token: tokens.roshan });
  assert.equal(memberView.json.canViewInternal, true);
  // Guild members see public profile fields only
  const serialized = JSON.stringify(memberView.json.members);
  assert.ok(!serialized.includes('@example.com'));

  const chatPost = await call(`/api/guilds/${guildId}/messages`, {
    method: 'POST',
    token: tokens.roshan,
    body: { body: 'Thanks for approving me — bringing cones on Saturday.' }
  });
  assert.equal(chatPost.status, 201);

  const promote = await call(`/api/guilds/${guildId}/members/usr_roshan`, {
    method: 'POST',
    token: tokens.minor,
    body: { memberAction: 'promote' }
  });
  assert.equal(promote.status, 200);

  // Moderator cannot promote anyone (owner-only action)
  const moderatorPromote = await call(`/api/guilds/${guildId}/members/usr_minor_fake`, {
    method: 'POST',
    token: tokens.roshan,
    body: { memberAction: 'promote' }
  });
  assert.notEqual(moderatorPromote.status, 200);

  // Private guild posts hidden from non-members in guild feed mode
  const privateFeed = await call(`/api/posts?guildId=${guildId}`, { token: tokens.kasun });
  assert.equal(privateFeed.status, 403);
});

test('20. Public guild join is immediate and non-members cannot post', async () => {
  const created = await call('/api/guilds', {
    method: 'POST',
    token: tokens.admin,
    body: {
      name: 'Colombo Test Collective',
      privacy_type: 'public',
      district: 'Colombo',
      category: 'Street & Flatground'
    }
  });
  assert.equal(created.status, 201);
  const guildId = created.json.guildId;

  const join = await call(`/api/guilds/${guildId}/join`, { method: 'POST', token: tokens.kasun });
  assert.equal(join.json.status, 'active');

  const detail = await call(`/api/guilds/${guildId}`, { token: tokens.kasun });
  assert.equal(detail.json.canViewInternal, true);

  const leave = await call(`/api/guilds/${guildId}/leave`, { method: 'POST', token: tokens.kasun });
  assert.equal(leave.status, 200);

  const postAfterLeave = await call(`/api/guilds/${guildId}/messages`, {
    method: 'POST',
    token: tokens.kasun,
    body: { body: 'Should be rejected after leaving.' }
  });
  assert.equal(postAfterLeave.status, 403);
});

test('21. Parts catalog marks unverified prices honestly and supports filtering', async () => {
  const all = await call('/api/parts');
  assert.equal(all.status, 200);
  const categories = new Set(all.json.parts.map((p) => p.category));
  for (const cat of [
    'frames_forks',
    'handlebars_stems_grips',
    'tires_wheels_hubs',
    'drivetrain_cranks_pedals',
    'brakes_cables_levers',
    'headsets_seats',
    'pegs_accessories',
    'protective_gear',
    'tools_maintenance'
  ]) {
    assert.ok(categories.has(cat), `catalog missing ${cat}`);
  }
  const unverified = all.json.parts.find((p) => !p.price_verified);
  assert.equal(unverified.price_display, 'Price not verified');
  assert.equal(unverified.price_lkr, null);

  const verifiedOnly = await call('/api/parts?verifiedOnly=1');
  assert.ok(verifiedOnly.json.parts.every((p) => p.price_verified === true));
  assert.ok(verifiedOnly.json.parts.every((p) => p.price_display.startsWith('LKR ')));

  const search = await call('/api/parts?search=helmet');
  assert.ok(search.json.parts.length >= 1);

  const fav = await call('/api/parts/part_2/favorite', { method: 'POST', token: tokens.kasun });
  assert.equal(fav.json.favorited, true);
  const favList = await call('/api/parts?favoritesOnly=1', { token: tokens.kasun });
  assert.ok(favList.json.parts.some((p) => p.id === 'part_2'));

  // Catalog entries always warn about compatibility
  assert.ok(all.json.parts.every((p) => p.compatibility_warning.length > 10));
});

test('22. Official events: registration, capacity, cancellation and attendee privacy', async () => {
  const events = await call('/api/events', { token: tokens.kasun });
  const official = events.json.events.filter((e) => e.is_official_studio_event);
  const community = events.json.events.filter((e) => !e.is_official_studio_event);
  assert.ok(official.length >= 3);
  assert.ok(community.length >= 1);
  const serialized = JSON.stringify(official);
  assert.ok(!serialized.includes('@example.com'), 'attendee emails must never be exposed');

  const register = await call('/api/events/evt_sds_2/register', { method: 'POST', token: tokens.kasun });
  assert.equal(register.status, 200);

  const again = await call('/api/events', { token: tokens.kasun });
  const ev = again.json.events.find((e) => e.id === 'evt_sds_2');
  assert.equal(ev.registered_by_me, true);

  const cancel = await call('/api/events/evt_sds_2/cancel', { method: 'POST', token: tokens.kasun });
  assert.equal(cancel.status, 200);

  const pastEvent = await call('/api/events/evt_sds_3/register', { method: 'POST', token: tokens.kasun });
  assert.equal(pastEvent.status, 400);
  assert.equal(pastEvent.json.error, 'EVENT_CLOSED');
});

test('23. Admin console is role-gated and audited', async () => {
  const denied = await call('/api/admin/overview', { token: tokens.kasun });
  assert.equal(denied.status, 403);
  assert.equal(denied.json.error, 'ADMIN_AUTHORIZATION_REQUIRED');

  const metrics = await call('/api/admin/overview', { token: tokens.admin });
  assert.equal(metrics.status, 200);
  assert.ok(metrics.json.metrics.totalRiders >= 4);
  assert.ok(metrics.json.metrics.pendingReports >= 1);

  const openReport = metrics.json.reports.find((r) => r.status === 'pending');
  const resolve = await call(`/api/admin/reports/${openReport.id}/resolve`, {
    method: 'POST',
    token: tokens.admin,
    body: { decision: 'dismissed', resolution_note: 'Reviewed — no violation found.' }
  });
  assert.equal(resolve.status, 200);

  const afterResolve = await call('/api/admin/overview', { token: tokens.admin });
  assert.ok(afterResolve.json.auditLogs.length >= 1);

  const rankUpdate = await call('/api/admin/ranks', {
    method: 'POST',
    token: tokens.admin,
    body: { id: 'rank_3', name: 'Balance Builder', min_xp: 350, description: 'Updated description for tests.' }
  });
  assert.equal(rankUpdate.status, 200);

  const newRank = await call('/api/admin/ranks', {
    method: 'POST',
    token: tokens.admin,
    body: { name: 'Test Elite', min_xp: 5000, description: 'Configurable administrator rank.' }
  });
  assert.equal(newRank.status, 201);

  // Moderators cannot publish official studio events (admin only)
  const moderatorEvent = await call('/api/admin/events', {
    method: 'POST',
    token: tokens.roshan,
    body: { title: 'Unauthorised official event' }
  });
  assert.equal(moderatorEvent.status, 403);
  assert.equal(moderatorEvent.json.error, 'OFFICIAL_STUDIO_ADMIN_ONLY');

  const adminEvent = await call('/api/admin/events', {
    method: 'POST',
    token: tokens.admin,
    body: { title: 'Official Test Clinic', event_date: '2026-12-12', registration_deadline: '2026-12-10', capacity: 30 }
  });
  assert.equal(adminEvent.status, 201);

  const partAdd = await call('/api/admin/parts', {
    method: 'POST',
    token: tokens.admin,
    body: {
      name: 'Test Unverified Peg Set',
      brand: 'Test Brand',
      category: 'pegs_accessories',
      retailer_name: 'Test Retailer',
      price_verified: false
    }
  });
  assert.equal(partAdd.status, 201);

  const parts = await call('/api/parts');
  const added = parts.json.parts.find((p) => p.id === partAdd.json.partId);
  assert.equal(added.price_display, 'Price not verified');
});

test('24. Uploads validate media type and size limits', async () => {
  const badType = await call('/api/upload/media', {
    method: 'POST',
    token: tokens.kasun,
    body: { dataUrl: 'data:text/html;base64,PHNjcmlwdD4=' }
  });
  assert.equal(badType.status, 400);
  assert.equal(badType.json.error, 'INVALID_MEDIA_TYPE');

  // 7,000,000 base64 chars decodes to ~5.25 MB — above the documented 5 MB limit
  const tooBig = await call('/api/upload/media', {
    method: 'POST',
    token: tokens.kasun,
    body: { dataUrl: `data:image/png;base64,${'A'.repeat(7000000)}` }
  });
  assert.equal(tooBig.status, 413);
  assert.equal(tooBig.json.error, 'FILE_TOO_LARGE');

  const okUpload = await call('/api/upload/media', {
    method: 'POST',
    token: tokens.kasun,
    body: { dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AF+3s1CAAAAAElFTkSuQmCC' }
  });
  assert.equal(okUpload.status, 200);
  assert.equal(okUpload.json.exifStripped, true);
  assert.equal(okUpload.json.gpsCoordinatesRemoved, true);
});

test('25. Posting is rate limited to 10 per minute per account', async () => {
  const fresh = await call('/api/auth/google', { method: 'POST', body: { email: 'ratelimit.rider@example.com' } });
  const token = fresh.json.token;
  await call('/api/auth/onboarding', {
    method: 'POST',
    token,
    body: {
      confirmAge16Plus: true,
      dob: '1996-01-01',
      acceptTerms: true,
      acceptPrivacy: true,
      acceptGuidelines: true,
      acceptSafetyNotice: true,
      username: 'ratelimit_rider',
      displayName: 'Rate Limit Rider',
      district: 'Kandy'
    }
  });

  let limited = 0;
  for (let i = 0; i < 12; i += 1) {
    const res = await call('/api/posts', {
      method: 'POST',
      token,
      body: { category: 'community_qa', title: `Rate limit probe ${i}`, body: 'Testing rate limiting behaviour.' }
    });
    if (res.status === 429) limited += 1;
  }
  assert.ok(limited >= 1, 'expected at least one 429 rate-limit response');
});

test('26. Account deletion removes profile, posts and access', async () => {
  const fresh = await call('/api/auth/google', { method: 'POST', body: { email: 'delete.me@example.com' } });
  const token = fresh.json.token;
  const onboard = await call('/api/auth/onboarding', {
    method: 'POST',
    token,
    body: {
      confirmAge16Plus: true,
      dob: '1999-03-03',
      acceptTerms: true,
      acceptPrivacy: true,
      acceptGuidelines: true,
      acceptSafetyNotice: true,
      username: 'delete_me_rider',
      displayName: 'Delete Me',
      district: 'Matara'
    }
  });
  assert.equal(onboard.status, 200);
  const userId = onboard.json.profile.user_id;

  const post = await call('/api/posts', {
    method: 'POST',
    token,
    body: { category: 'community_qa', title: 'Temporary post', body: 'This should disappear with my account.' }
  });
  assert.equal(post.status, 201);

  const del = await call('/api/account', { method: 'DELETE', token });
  assert.equal(del.status, 200);
  assert.equal(del.json.deleted, true);

  const session = await call('/api/auth/session', { token });
  assert.equal(session.status, 401);

  const profile = await call(`/api/profiles/${userId}`, { token: tokens.admin });
  assert.equal(profile.status, 404);

  const feed = await call('/api/posts?limit=30');
  assert.ok(!feed.json.posts.some((p) => p.id === post.json.postId));
});

test('27. Unauthenticated writes are rejected across the API', async () => {
  const endpoints = [
    ['/api/posts', 'POST', { category: 'community_qa', title: 'x', body: 'y' }],
    ['/api/bicycles', 'POST', { name: 'x', bike_type: 'BMX' }],
    ['/api/friends/request', 'POST', { targetUserId: 'usr_kasun' }],
    ['/api/reports', 'POST', { target_type: 'post', target_id: 'x', reason_category: 'other', details: 'x' }],
    ['/api/blocks', 'POST', { blockedUserId: 'usr_kasun' }],
    ['/api/events/evt_sds_1/register', 'POST', {}],
    ['/api/stunts/mod_fund_1/complete', 'POST', {}],
    ['/api/safety/checklist', 'POST', { checkedItems: [] }],
    ['/api/guilds', 'POST', { name: 'anon guild' }],
    ['/api/upload/media', 'POST', { dataUrl: 'data:image/png;base64,AA' }]
  ];
  for (const [path, method, body] of endpoints) {
    const res = await call(path, { method, body });
    assert.equal(res.status, 401, `${path} should require authentication`);
  }
});

test('28. Server-side XP engine rejects unknown or unsafe action types', () => {
  const { awardValidatedXp } = require('../backend/services.js');
  assert.throws(
    () =>
      awardValidatedXp(db, {
        userId: 'usr_kasun',
        actionType: 'dangerous_stunt_streak_bonus',
        xpDelta: 500,
        description: 'Should never be allowed'
      }),
    /Invalid or unsafe XP action type/
  );
  const before = db.prepare('SELECT xp FROM profiles WHERE user_id = ?').get('usr_kasun').xp;
  const clamped = awardValidatedXp(db, {
    userId: 'usr_kasun',
    actionType: 'safety_checklist_completed',
    xpDelta: 9999,
    description: 'Clamp test',
    referenceId: `clamp_${Date.now()}`
  });
  assert.equal(clamped.xpAdded, 25, 'XP delta clamped to the per-action maximum');
  const after = db.prepare('SELECT xp FROM profiles WHERE user_id = ?').get('usr_kasun').xp;
  assert.equal(after, before + 25);
});

test('29. Google ID-token path rejects unverifiable credentials when configured', async () => {
  // The sandbox server runs without GOOGLE_CLIENT_ID, so a real id-token request must be refused
  // rather than silently trusted. This protects against replaying an unverified JWT.
  const res = await call('/api/auth/google', {
    method: 'POST',
    body: { idToken: 'eyJhbGciOiJSUzI1NiIsImtpZCI6ImZha2UifQ.eyJpc3MiOiJhY2NvdW50cy5nb29nbGUuY29tIn0.c2ln' }
  });
  assert.equal(res.status, 503);
  assert.equal(res.json.error, 'GOOGLE_CLIENT_ID_NOT_CONFIGURED');

  // Malformed tokens are always rejected at the API surface, never mapped to a user.
  const malformed = await call('/api/auth/google', { method: 'POST', body: { idToken: 'not-a-jwt' } });
  assert.ok([401, 503].includes(malformed.status));
  assert.equal(malformed.json.token, undefined);
});

test('30. Guild invitations, mutual friends, video uploads and suspension lifecycle', async () => {
  // --- Owner invites a rider; invitee accepts -------------------------------------
  const invite = await call('/api/guilds/gld_southern_bmx/invite', {
    method: 'POST',
    token: tokens.kasun,
    body: { username: 'roshan_dirtjump' }
  });
  assert.equal(invite.status, 201);

  const invitedList = await call('/api/guilds', { token: tokens.roshan });
  const invitedGuild = invitedList.json.guilds.find((g) => g.id === 'gld_southern_bmx');
  assert.equal(invitedGuild.my_status, 'invited');

  // A non-moderator cannot invite
  const unauthorisedInvite = await call('/api/guilds/gld_southern_bmx/invite', {
    method: 'POST',
    token: tokens.roshan,
    body: { username: 'kasun_bmx_lk' }
  });
  assert.equal(unauthorisedInvite.status, 403);

  const accept = await call('/api/guilds/gld_southern_bmx/invite-response', {
    method: 'POST',
    token: tokens.roshan,
    body: { decision: 'accept' }
  });
  assert.equal(accept.status, 200);
  const afterAccept = await call('/api/guilds/gld_southern_bmx', { token: tokens.roshan });
  assert.equal(afterAccept.json.canViewInternal, true);

  // --- Mutual friends -------------------------------------------------------------
  // Establish a shared friend (admin) so the viewer shares a connection with the target.
  await call('/api/friends/request', { method: 'POST', token: tokens.roshan, body: { targetUserId: 'usr_admin_nethmi' } });
  const adminFriends = await call('/api/friends', { token: tokens.admin });
  const pendingFromRoshan = adminFriends.json.incoming.find((f) => f.user_id === 'usr_roshan');
  if (pendingFromRoshan) {
    await call(`/api/friends/${pendingFromRoshan.friendship_id}`, { method: 'POST', token: tokens.admin, body: { action: 'accept' } });
  }
  const mutual = await call('/api/profiles/usr_roshan', { token: tokens.kasun });
  assert.equal(mutual.status, 200);
  assert.ok(mutual.json.profile.mutual_friends.count >= 1, 'expected at least one mutual friend');
  assert.ok(Array.isArray(mutual.json.profile.mutual_friends.names));

  // --- Video uploads --------------------------------------------------------------
  const video = await call('/api/upload/media', {
    method: 'POST',
    token: tokens.kasun,
    body: { dataUrl: `data:video/mp4;base64,${'A'.repeat(4000)}` }
  });
  assert.equal(video.status, 200);
  assert.equal(video.json.mediaType, 'video');
  assert.equal(video.json.gpsCoordinatesRemoved, true);

  const oversizedClip = await call('/api/upload/media', {
    method: 'POST',
    token: tokens.kasun,
    body: { dataUrl: `data:video/mp4;base64,${'A'.repeat(12000000)}` }
  });
  assert.equal(oversizedClip.status, 413);

  // --- Warning + temporary suspension lifecycle -----------------------------------
  const warnTarget = await call('/api/auth/google', { method: 'POST', body: { email: 'warn.target@example.com' } });
  const warnToken = warnTarget.json.token;
  const onboard = await call('/api/auth/onboarding', {
    method: 'POST',
    token: warnToken,
    body: {
      confirmAge16Plus: true,
      dob: '1994-04-04',
      acceptTerms: true,
      acceptPrivacy: true,
      acceptGuidelines: true,
      acceptSafetyNotice: true,
      username: 'warn_target',
      displayName: 'Warn Target',
      district: 'Matale'
    }
  });
  assert.equal(onboard.status, 200);
  const targetId = onboard.json.profile.user_id;

  const report = await call('/api/reports', {
    method: 'POST',
    token: tokens.kasun,
    body: { target_type: 'user', target_id: targetId, reason_category: 'bullying_harassment', details: 'Repeated hostile comments.' }
  });
  assert.equal(report.status, 201);

  const warn = await call(`/api/admin/reports/${report.json.reportId}/resolve`, {
    method: 'POST',
    token: tokens.admin,
    body: { decision: 'action_taken', resolution_note: 'Warning issued for hostile language.', accountAction: 'warn' }
  });
  assert.equal(warn.status, 200);
  const warnedRow = db.prepare('SELECT account_status FROM users_private WHERE id = ?').get(targetId);
  assert.equal(warnedRow.account_status, 'warned');

  // Temporary suspension with a 1-day window, then simulate expiry
  const report2 = await call('/api/reports', {
    method: 'POST',
    token: tokens.kasun,
    body: { target_type: 'user', target_id: targetId, reason_category: 'threats_violence', details: 'Escalated after warning.' }
  });
  const suspend = await call(`/api/admin/reports/${report2.json.reportId}/resolve`, {
    method: 'POST',
    token: tokens.admin,
    body: { decision: 'action_taken', resolution_note: 'Temporary suspension for threats.', accountAction: 'suspend', suspensionDays: 1 }
  });
  assert.equal(suspend.status, 200);

  const suspendedLogin = await call('/api/auth/google', { method: 'POST', body: { email: 'warn.target@example.com' } });
  assert.equal(suspendedLogin.status, 403);
  assert.match(suspendedLogin.json.message, /suspended/i);

  // Expire the suspension and confirm automatic reinstatement
  db.prepare('UPDATE users_private SET suspension_until = ? WHERE id = ?').run(new Date(Date.now() - 60000).toISOString(), targetId);
  const reopened = await call('/api/auth/google', { method: 'POST', body: { email: 'warn.target@example.com' } });
  assert.equal(reopened.status, 200);
  assert.equal(reopened.json.account.email, 'warn.target@example.com');

  // --- Studio admin can adjust a guild member limit --------------------------------
  const limit = await call('/api/guilds/gld_colombo_builders', {
    method: 'PUT',
    token: tokens.admin,
    body: { member_limit: 25 }
  });
  assert.equal(limit.status, 200);
  assert.equal(limit.json.member_limit, 25);
  const guildRow = db.prepare('SELECT member_limit FROM guilds WHERE id = ?').get('gld_colombo_builders');
  assert.equal(guildRow.member_limit, 25);
});

test('31. Voice ICE config never claims a relay that is not configured', async () => {
  const k = await call('/api/auth/google', { method: 'POST', body: { presetAccount: 'kasun' } });
  assert.equal(k.status, 200);
  const ice = await call('/api/voice/ice', { token: k.json.token });
  assert.equal(ice.status, 200);
  const hasTurn = (ice.json.iceServers || []).some((s) => [].concat(s.urls).some((u) => String(u).startsWith('turn')));
  assert.equal(ice.json.turn_available, hasTurn, 'turn_available must reflect the servers actually returned');
  if (!hasTurn) {
    assert.match(ice.json.note, /No TURN relay configured/i);
    assert.doesNotMatch(ice.json.note, /^TURN relay configured/i);
  }
  assert.equal(ice.json.recording, false, 'voice must never record by default');
});

test('32. Public config advertises integrations without leaking secrets', async () => {
  const res = await call('/api/config');
  assert.equal(res.status, 200);
  assert.equal(typeof res.json.googleClientId, 'string', 'clients need to know whether Google sign-in is on');
  assert.equal(res.json.googleClientId, '', 'no Google client id is configured in the test environment');
  assert.equal(res.json.capabilities.googleSignIn, false);
  assert.equal(typeof res.json.capabilities.push, 'boolean');
  assert.equal(typeof res.json.capabilities.turnRelay, 'boolean');
  const raw = JSON.stringify(res.json);
  assert.ok(!/JWT_SECRET|private_key|service_account/i.test(raw), 'public config must never contain server secrets');
});
