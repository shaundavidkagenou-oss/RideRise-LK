// RideRise LK Phase 2 — rider-facing appeals against moderation decisions.
'use strict';

const { nowIso, newId, clamp } = require('./core');

module.exports = function registerAppeals(ctx) {
  const { db, sendJson, readJsonBody, getAuthUser, checkRateLimit, notifier } = ctx;

  return async function handle(req, res, pathname) {
    if (pathname === '/api/appeals' && req.method === 'GET') {
      const user = getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'UNAUTHENTICATED' }), true;
      const rows = db
        .prepare('SELECT * FROM moderation_appeals WHERE user_id = ? ORDER BY created_at DESC LIMIT 50')
        .all(user.id);
      return sendJson(res, 200, {
        appeals: rows,
        guidance:
          'Appeals are reviewed by a human moderator. Include dates, context and any relevant report reference. Abusive appeals can be closed without review.'
      }), true;
    }

    if (pathname === '/api/appeals' && req.method === 'POST') {
      const user = getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'UNAUTHENTICATED' }), true;
      if (!checkRateLimit(`appeal:${user.id}`, 3, 3600)) {
        return sendJson(res, 429, { error: 'RATE_LIMITED', message: 'You can submit up to 3 appeals per hour.' }), true;
      }
      const body = await readJsonBody(req);
      const message = String(body.message || '').trim().slice(0, 3000);
      if (message.length < 20) {
        return sendJson(res, 400, {
          error: 'APPEAL_TOO_SHORT',
          message: 'Please explain what happened in at least 20 characters so a moderator can review it.'
        }), true;
      }
      const scope = ['platform', 'guild', 'event', 'voice'].includes(body.scope) ? body.scope : 'platform';
      const id = newId('map');
      db.prepare(
        `INSERT INTO moderation_appeals (id, user_id, action_ref, scope, message, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?)`
      ).run(id, user.id, String(body.action_ref || '').slice(0, 120), scope, message, nowIso());
      const admins = db.prepare("SELECT id FROM users_private WHERE role IN ('admin','moderator') AND account_status = 'active'").all();
      for (const a of admins) {
        notifier.notify({
          userId: a.id,
          type: 'moderation',
          title: 'New moderation appeal',
          body: `@${user.username} · ${scope}`,
          referenceType: 'appeal',
          referenceId: id,
          deepLink: '#/admin?tab=reports'
        });
      }
      return sendJson(res, 201, {
        id,
        message: 'Appeal submitted. A moderator will review it; you will be notified in the app.'
      }), true;
    }

    if (pathname === '/api/community/rules' && req.method === 'GET') {
      const doc = db.prepare("SELECT * FROM legal_documents WHERE slug = 'community-guidelines'").get();
      const safety = db.prepare("SELECT * FROM legal_documents WHERE slug = 'safety-notice'").get();
      return sendJson(res, 200, {
        community_guidelines: doc || null,
        safety_notice: safety || null,
        contact: {
          safety: 'safety@shaundavidstudios.lk',
          privacy: 'privacy@shaundavidstudios.lk',
          support: 'support@shaundavidstudios.lk'
        },
        escalation:
          'Report in-app first. If a report is not resolved within 72 hours, or involves an immediate risk to a person, email safety@shaundavidstudios.lk. For emergencies contact Sri Lanka Police (119) or the emergency ambulance service (1990).'
      }), true;
    }

    return false;
  };
};
