// RideRise LK Phase 2 — Learning pathways, lesson progress, quizzes and a
// content-management interface for studio editors. Nothing here guarantees a
// rider can perform a manoeuvre: modules are educational resources only.
'use strict';

const { nowIso, newId, parseJson } = require('./core');
const { awardValidatedXp } = require('../services');

module.exports = function registerLearning(ctx) {
  const { db, sendJson, readJsonBody, getAuthUser, checkRateLimit, auditAdmin } = ctx;

  function progressRows(userId) {
    if (!userId) return new Map();
    const rows = db.prepare('SELECT * FROM user_stunt_progress WHERE user_id = ?').all(userId);
    return new Map(rows.map((r) => [r.module_id, r]));
  }

  function pathwayModules(pathwayId) {
    return db
      .prepare(
        `SELECT m.*, pm.display_order AS pathway_order FROM learning_pathway_modules pm
         JOIN stunt_modules m ON m.id = pm.module_id
         WHERE pm.pathway_id = ? AND m.status = 'published'
         ORDER BY pm.display_order ASC`
      )
      .all(pathwayId);
  }

  function decorate(module, progress) {
    const prereqs = parseJson(module.prerequisites_json, []);
    const missing = prereqs.filter((pid) => {
      const p = progress.get(pid);
      return !p || p.status !== 'completed';
    });
    const prog = progress.get(module.id) || null;
    return {
      id: module.id,
      slug: module.slug,
      title: module.title,
      category: module.category,
      track: module.track,
      difficulty: module.difficulty,
      xp_reward: module.xp_reward,
      coaching_reminder: module.coaching_reminder,
      requires_supervision: Boolean(module.requires_supervision),
      requires_safety_ack: Boolean(module.requires_safety_ack),
      display_order: module.display_order,
      completed: prog ? prog.status === 'completed' : false,
      in_progress: prog ? prog.status === 'in_progress' : false,
      quiz_score: prog ? prog.quiz_score : null,
      locked: missing.length > 0,
      missing_prerequisites: missing,
      prerequisite_count: prereqs.length
    };
  }

  function dashboard(userId) {
    const progress = progressRows(userId);
    const pathways = db
      .prepare('SELECT * FROM learning_pathways WHERE is_published = 1 ORDER BY display_order ASC')
      .all()
      .map((pathway) => {
        const modules = pathwayModules(pathway.id).map((m) => decorate(m, progress));
        const completed = modules.filter((m) => m.completed).length;
        return {
          ...pathway,
          modules,
          module_count: modules.length,
          completed_count: completed,
          percent: modules.length ? Math.round((completed / modules.length) * 100) : 0,
          next_module: modules.find((m) => !m.completed && !m.locked) || null
        };
      });

    const allModules = db.prepare("SELECT * FROM stunt_modules WHERE status = 'published'").all();
    const completedTotal = allModules.filter((m) => (progress.get(m.id) || {}).status === 'completed').length;
    const quizAverage = db
      .prepare('SELECT AVG(quiz_score) AS avg FROM user_stunt_progress WHERE user_id = ? AND status = ?')
      .get(userId, 'completed').avg;
    const byTrack = ['beginner', 'intermediate', 'advanced', 'maintenance'].map((track) => {
      const mods = allModules.filter((m) => (m.track || 'beginner') === track);
      const done = mods.filter((m) => (progress.get(m.id) || {}).status === 'completed').length;
      return { track, total: mods.length, completed: done, percent: mods.length ? Math.round((done / mods.length) * 100) : 0 };
    });

    return {
      pathways,
      summary: {
        modules_total: allModules.length,
        modules_completed: completedTotal,
        quiz_average: quizAverage ? Math.round(quizAverage) : null,
        tracks: byTrack
      },
      safety_reminder:
        'Educational content only. Practise in a legal, controlled area with certified protective equipment and qualified in-person coaching for advanced skills. RideRise LK never guarantees that completing a lesson makes a manoeuvre safe for you.',
      practical_reminder_shown: true
    };
  }

  function moduleDetail(moduleId, userId) {
    const mod = db.prepare('SELECT * FROM stunt_modules WHERE id = ?').get(moduleId);
    if (!mod) return null;
    const progress = progressRows(userId);
    const media = db
      .prepare('SELECT * FROM learning_lesson_media WHERE module_id = ? ORDER BY display_order ASC')
      .all(moduleId);
    const checks = userId
      ? db.prepare('SELECT item_index FROM learning_checklist_progress WHERE user_id = ? AND module_id = ?').all(userId, moduleId).map((r) => r.item_index)
      : [];
    const prerequisites = parseJson(mod.prerequisites_json, []).map((pid) => {
      const p = db.prepare('SELECT id, title, category FROM stunt_modules WHERE id = ?').get(pid);
      const done = (progress.get(pid) || {}).status === 'completed';
      return { id: pid, title: p ? p.title : pid, completed: done };
    });
    const prog = userId ? db.prepare('SELECT * FROM user_stunt_progress WHERE user_id = ? AND module_id = ?').get(userId, moduleId) : null;
    const quiz = parseJson(mod.quiz_questions_json, []).map((q, index) => ({
      index,
      prompt: q.prompt || q.question || `Knowledge check ${index + 1}`,
      options: q.options || []
      // correctIndex intentionally withheld from the client
    }));
    return {
      module: {
        ...mod,
        protective_gear: parseJson(mod.protective_gear_json, []),
        inspection_checklist: parseJson(mod.inspection_checklist_json, []),
        learning_stages: parseJson(mod.learning_stages_json, []),
        common_errors: parseJson(mod.common_errors_json, []),
        stop_conditions: parseJson(mod.stop_conditions_json, []),
        learning_objectives: parseJson(mod.learning_objectives_json, []),
        why_prerequisites: parseJson(mod.why_prerequisites_json, []),
        quiz_question_count: quiz.length
      },
      prerequisites,
      progress: prog || null,
      checklist_checked: checks,
      media,
      quiz,
      practical_reminder:
        'Before any practical attempt: use a legal, suitable area away from traffic and pedestrians, wear a helmet and the listed protective gear, inspect your bike, and get qualified in-person coaching for advanced techniques.'
    };
  }

  return async function handle(req, res, pathname, parsedUrl) {
    /* -------------------------------- dashboard ----------------------------- */
    if (pathname === '/api/learning/dashboard' && req.method === 'GET') {
      const user = getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'UNAUTHENTICATED' }), true;
      return sendJson(res, 200, dashboard(user.id)), true;
    }

    if (pathname === '/api/learning/pathways' && req.method === 'GET') {
      const user = getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'UNAUTHENTICATED' }), true;
      const progress = progressRows(user.id);
      const pathways = db
        .prepare('SELECT * FROM learning_pathways WHERE is_published = 1 ORDER BY display_order ASC')
        .all()
        .map((p) => {
          const modules = pathwayModules(p.id).map((m) => decorate(m, progress));
          return { ...p, modules, module_count: modules.length, completed_count: modules.filter((m) => m.completed).length };
        });
      return sendJson(res, 200, { pathways }), true;
    }

    const moduleMatch = pathname.match(/^\/api\/learning\/modules\/([^/]+)(?:\/([a-z-]+))?$/);
    if (moduleMatch) {
      const moduleId = decodeURIComponent(moduleMatch[1]);
      const action = moduleMatch[2] || '';
      const user = getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'UNAUTHENTICATED' }), true;
      const mod = db.prepare('SELECT * FROM stunt_modules WHERE id = ?').get(moduleId);
      if (!mod) return sendJson(res, 404, { error: 'MODULE_NOT_FOUND' }), true;

      if (!action && req.method === 'GET') {
        return sendJson(res, 200, moduleDetail(moduleId, user.id)), true;
      }

      if (action === 'start' && req.method === 'POST') {
        const existing = db.prepare('SELECT * FROM user_stunt_progress WHERE user_id = ? AND module_id = ?').get(user.id, moduleId);
        if (!existing) {
          db.prepare(
            "INSERT INTO user_stunt_progress (user_id, module_id, status, checklist_completed, quiz_score, started_at) VALUES (?, ?, 'in_progress', 0, 0, ?)"
          ).run(user.id, moduleId, nowIso());
        }
        return sendJson(res, 200, { message: 'Lesson started. Work through the inspection checklist first.' }), true;
      }

      if (action === 'checklist' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const checklist = parseJson(mod.inspection_checklist_json, []);
        const index = Number(body.index);
        if (!Number.isInteger(index) || index < 0 || index >= checklist.length) {
          return sendJson(res, 400, { error: 'INVALID_CHECKLIST_INDEX', message: 'That checklist item does not exist.' }), true;
        }
        if (body.checked === false) {
          db.prepare('DELETE FROM learning_checklist_progress WHERE user_id = ? AND module_id = ? AND item_index = ?').run(
            user.id,
            moduleId,
            index
          );
        } else {
          db.prepare(
            'INSERT OR REPLACE INTO learning_checklist_progress (user_id, module_id, item_index, checked_at) VALUES (?, ?, ?, ?)'
          ).run(user.id, moduleId, index, nowIso());
        }
        const checked = db
          .prepare('SELECT item_index FROM learning_checklist_progress WHERE user_id = ? AND module_id = ?')
          .all(user.id, moduleId)
          .map((r) => r.item_index);
        return sendJson(res, 200, {
          checked,
          complete: checked.length >= checklist.length,
          message: checked.length >= checklist.length ? 'Inspection checklist complete.' : 'Item updated.'
        }), true;
      }

      if (action === 'quiz' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const questions = parseJson(mod.quiz_questions_json, []);
        if (!Array.isArray(body.answers) || body.answers.length !== questions.length) {
          return sendJson(res, 400, {
            error: 'QUIZ_INCOMPLETE',
            message: `Answer all ${questions.length} questions before submitting.`
          }), true;
        }
        let correct = 0;
        const review = questions.map((q, i) => {
          const ok = Number(body.answers[i]) === Number(q.correctIndex);
          if (ok) correct++;
          return { index: i, correct: ok, explanation: q.explanation || '' };
        });
        const score = questions.length ? Math.round((correct / questions.length) * 100) : 100;
        const existing = db.prepare('SELECT * FROM user_stunt_progress WHERE user_id = ? AND module_id = ?').get(user.id, moduleId);
        if (existing) {
          db.prepare(
            'UPDATE user_stunt_progress SET quiz_attempts = quiz_attempts + 1, last_quiz_score = ?, quiz_score = ? WHERE user_id = ? AND module_id = ?'
          ).run(score, Math.max(score, existing.quiz_score || 0), user.id, moduleId);
        } else {
          db.prepare(
            "INSERT INTO user_stunt_progress (user_id, module_id, status, checklist_completed, quiz_attempts, last_quiz_score, quiz_score, started_at) VALUES (?, ?, 'in_progress', 0, 1, ?, ?, ?)"
          ).run(user.id, moduleId, score, score, nowIso());
        }
        return sendJson(res, 200, {
          score,
          passed: score === 100,
          review,
          message: score === 100 ? 'All knowledge checks passed.' : 'Review the explanations and try again — 100% is required before completion.'
        }), true;
      }

      if (action === 'complete' && req.method === 'POST') {
        if (!checkRateLimit(`learning:complete:${user.id}`, 30, 60)) {
          return sendJson(res, 429, { error: 'RATE_LIMITED' }), true;
        }
        const prereqs = parseJson(mod.prerequisites_json, []);
        const missing = prereqs.filter(
          (pid) =>
            !db
              .prepare("SELECT 1 FROM user_stunt_progress WHERE user_id = ? AND module_id = ? AND status = 'completed'")
              .get(user.id, pid)
        );
        if (missing.length) {
          const names = missing.map((pid) => (db.prepare('SELECT title FROM stunt_modules WHERE id = ?').get(pid) || {}).title || pid);
          return sendJson(res, 400, {
            error: 'PREREQUISITES_NOT_MET',
            message: `Complete these first: ${names.join(', ')}. Each builds a skill this lesson depends on.`
          }), true;
        }

        const checklist = parseJson(mod.inspection_checklist_json, []);
        const checked = db
          .prepare('SELECT COUNT(*) AS c FROM learning_checklist_progress WHERE user_id = ? AND module_id = ?')
          .get(user.id, moduleId).c;
        const body = await readJsonBody(req);
        if (checked < checklist.length && !body.checklistCompleted) {
          return sendJson(res, 400, {
            error: 'CHECKLIST_REQUIRED',
            message: 'Tick every preparation and equipment inspection item before completing this module.'
          }), true;
        }

        const prog = db.prepare('SELECT * FROM user_stunt_progress WHERE user_id = ? AND module_id = ?').get(user.id, moduleId);
        if (mod.requires_safety_ack && !(prog && prog.safety_ack_at) && !body.safetyAcknowledged) {
          return sendJson(res, 400, {
            error: 'SAFETY_ACK_REQUIRED',
            message: 'Acknowledge the supervision and controlled-environment notice before completing this module.'
          }), true;
        }
        const score = body.quizScore !== undefined ? Number(body.quizScore) : prog ? prog.quiz_score : 0;
        if (score < 100) {
          return sendJson(res, 400, {
            error: 'QUIZ_NOT_PASSED',
            score,
            message: 'Pass every knowledge check (100%) before completing this module.'
          }), true;
        }

        const wasCompleted = prog && prog.status === 'completed';
        db.prepare(
          `INSERT INTO user_stunt_progress (user_id, module_id, status, checklist_completed, safety_ack_at, quiz_score, completed_at, started_at)
           VALUES (?, ?, 'completed', 1, ?, ?, ?, ?)
           ON CONFLICT(user_id, module_id) DO UPDATE SET status = 'completed', checklist_completed = 1,
             quiz_score = excluded.quiz_score, completed_at = excluded.completed_at,
             safety_ack_at = COALESCE(user_stunt_progress.safety_ack_at, excluded.safety_ack_at)`
        ).run(user.id, moduleId, body.safetyAcknowledged ? nowIso() : prog ? prog.safety_ack_at : null, score, nowIso(), nowIso());

        let xpAdded = 0;
        if (!wasCompleted) {
          const result = awardValidatedXp(db, {
            userId: user.id,
            actionType: 'stunt_module_completed',
            xpDelta: mod.xp_reward,
            description: `Completed learning module: ${mod.title}`,
            referenceId: moduleId
          });
          xpAdded = result ? result.xpAdded : 0;
        }
        return sendJson(res, 200, {
          message: wasCompleted
            ? `“${mod.title}” was already completed. Review any time.`
            : `Module complete: “${mod.title}”. +${xpAdded} XP.`,
          xp_added: xpAdded,
          already_completed: Boolean(wasCompleted),
          disclaimer: 'Completing this module does not certify that you can perform the manoeuvre. Practise with supervision in a legal, controlled area.'
        }), true;
      }

      if (action === 'ack' && req.method === 'POST') {
        const body = await readJsonBody(req);
        if (body.acknowledged !== true) return sendJson(res, 400, { error: 'ACK_REQUIRED' }), true;
        db.prepare(
          `INSERT INTO user_stunt_progress (user_id, module_id, status, checklist_completed, safety_ack_at, quiz_score, started_at)
           VALUES (?, ?, 'in_progress', 0, ?, 0, ?)
           ON CONFLICT(user_id, module_id) DO UPDATE SET safety_ack_at = excluded.safety_ack_at`
        ).run(user.id, moduleId, nowIso(), nowIso());
        return sendJson(res, 200, { acknowledged_at: nowIso() }), true;
      }
    }

    /* ------------------------------- admin CMS ------------------------------ */
    if (pathname.startsWith('/api/admin/learning')) {
      const user = getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'UNAUTHENTICATED' }), true;
      if (user.role !== 'admin') {
        return sendJson(res, 403, { error: 'FORBIDDEN', message: 'Tutorial editing requires a studio administrator account.' }), true;
      }
      if (pathname === '/api/admin/learning/modules' && req.method === 'GET') {
        const modules = db.prepare('SELECT * FROM stunt_modules ORDER BY display_order ASC').all().map((m) => ({
          ...m,
          prerequisites: parseJson(m.prerequisites_json, []),
          quiz_questions: parseJson(m.quiz_questions_json, [])
        }));
        return sendJson(res, 200, { modules }), true;
      }
      if (pathname === '/api/admin/learning/modules' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const id = body.id || newId('stm');
        const existing = body.id ? db.prepare('SELECT * FROM stunt_modules WHERE id = ?').get(body.id) : null;
        const title = String(body.title || (existing && existing.title) || '').trim();
        if (title.length < 3) return sendJson(res, 400, { error: 'TITLE_REQUIRED' }), true;
        const payload = {
          slug: String(body.slug || (existing && existing.slug) || title.toLowerCase().replace(/[^a-z0-9]+/g, '-')).slice(0, 80),
          category: ['fundamentals', 'beginner_freestyle', 'intermediate', 'advanced'].includes(body.category)
            ? body.category
            : existing
            ? existing.category
            : 'fundamentals',
          track: ['beginner', 'intermediate', 'advanced', 'maintenance'].includes(body.track)
            ? body.track
            : existing
            ? existing.track
            : 'beginner',
          difficulty: String(body.difficulty || (existing && existing.difficulty) || 'Beginner'),
          xp_reward: Number(body.xp_reward || (existing && existing.xp_reward) || 40),
          prerequisites_json: JSON.stringify(body.prerequisites || (existing ? parseJson(existing.prerequisites_json, []) : [])),
          bike_suitability: String(body.bike_suitability || (existing && existing.bike_suitability) || 'BMX / dirt jump bicycle'),
          protective_gear_json: JSON.stringify(body.protective_gear || (existing ? parseJson(existing.protective_gear_json, []) : [])),
          safe_environment: String(body.safe_environment || (existing && existing.safe_environment) || ''),
          inspection_checklist_json: JSON.stringify(
            body.inspection_checklist || (existing ? parseJson(existing.inspection_checklist_json, []) : [])
          ),
          learning_stages_json: JSON.stringify(body.learning_stages || (existing ? parseJson(existing.learning_stages_json, []) : [])),
          common_errors_json: JSON.stringify(body.common_errors || (existing ? parseJson(existing.common_errors_json, []) : [])),
          stop_conditions_json: JSON.stringify(body.stop_conditions || (existing ? parseJson(existing.stop_conditions_json, []) : [])),
          coaching_reminder: String(body.coaching_reminder || (existing && existing.coaching_reminder) || ''),
          diagram_type: String(body.diagram_type || (existing && existing.diagram_type) || 'bunny_hop'),
          quiz_questions_json: JSON.stringify(body.quiz_questions || (existing ? parseJson(existing.quiz_questions_json, []) : [])),
          requires_safety_ack: body.requires_safety_ack ? 1 : 0,
          requires_supervision: body.requires_supervision ? 1 : 0,
          learning_objectives_json: JSON.stringify(
            body.learning_objectives || (existing ? parseJson(existing.learning_objectives_json, []) : [])
          ),
          why_prerequisites_json: JSON.stringify(body.why_prerequisites || (existing ? parseJson(existing.why_prerequisites_json, []) : [])),
          video_url: String(body.video_url || (existing && existing.video_url) || ''),
          status: body.publish === true ? 'published' : 'draft',
          display_order: Number(body.display_order || (existing && existing.display_order) || 99)
        };
        if (existing) {
          db.prepare(
            `UPDATE stunt_modules SET slug = ?, category = ?, track = ?, title = ?, difficulty = ?, xp_reward = ?,
               prerequisites_json = ?, bike_suitability = ?, protective_gear_json = ?, safe_environment = ?,
               inspection_checklist_json = ?, learning_stages_json = ?, common_errors_json = ?, stop_conditions_json = ?,
               coaching_reminder = ?, diagram_type = ?, quiz_questions_json = ?, requires_safety_ack = ?,
               requires_supervision = ?, learning_objectives_json = ?, why_prerequisites_json = ?, video_url = ?,
               status = ?, display_order = ?, version = version + 1, updated_at = ?, updated_by = ?
             WHERE id = ?`
          ).run(
            payload.slug, payload.category, payload.track, title, payload.difficulty, payload.xp_reward,
            payload.prerequisites_json, payload.bike_suitability, payload.protective_gear_json, payload.safe_environment,
            payload.inspection_checklist_json, payload.learning_stages_json, payload.common_errors_json, payload.stop_conditions_json,
            payload.coaching_reminder, payload.diagram_type, payload.quiz_questions_json, payload.requires_safety_ack,
            payload.requires_supervision, payload.learning_objectives_json, payload.why_prerequisites_json, payload.video_url,
            payload.status, payload.display_order, nowIso(), user.id, id
          );
        } else {
          db.prepare(
            `INSERT INTO stunt_modules (id, slug, category, track, title, difficulty, xp_reward, prerequisites_json, bike_suitability,
               protective_gear_json, safe_environment, inspection_checklist_json, learning_stages_json, common_errors_json,
               stop_conditions_json, coaching_reminder, diagram_type, quiz_questions_json, requires_safety_ack,
               requires_supervision, learning_objectives_json, why_prerequisites_json, video_url, status, display_order,
               version, updated_at, updated_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
          ).run(
            id, payload.slug, payload.category, payload.track, title, payload.difficulty, payload.xp_reward,
            payload.prerequisites_json, payload.bike_suitability, payload.protective_gear_json, payload.safe_environment,
            payload.inspection_checklist_json, payload.learning_stages_json, payload.common_errors_json, payload.stop_conditions_json,
            payload.coaching_reminder, payload.diagram_type, payload.quiz_questions_json, payload.requires_safety_ack,
            payload.requires_supervision, payload.learning_objectives_json, payload.why_prerequisites_json, payload.video_url,
            payload.status, payload.display_order, nowIso(), user.id
          );
        }
        auditAdmin(user.id, existing ? 'learning_module_updated' : 'learning_module_created', 'stunt_module', id, title, {
          status: payload.status
        });
        return sendJson(res, 200, { id, message: `Module ${existing ? 'updated' : 'created'} (${payload.status}).` }), true;
      }

      const publishMatch = pathname.match(/^\/api\/admin\/learning\/modules\/([^/]+)\/(publish|unpublish|review)$/);
      if (publishMatch && req.method === 'POST') {
        const moduleId = decodeURIComponent(publishMatch[1]);
        const action = publishMatch[2];
        const row = db.prepare('SELECT * FROM stunt_modules WHERE id = ?').get(moduleId);
        if (!row) return sendJson(res, 404, { error: 'MODULE_NOT_FOUND' }), true;
        const body = await readJsonBody(req);
        if (action === 'review') {
          const decision = body.decision === 'approved' ? 'approved' : 'changes_requested';
          db.prepare(
            'INSERT INTO learning_module_reviews (id, module_id, reviewer_id, decision, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)'
          ).run(newId('lmr'), moduleId, user.id, decision, String(body.notes || '').slice(0, 1000), nowIso());
          auditAdmin(user.id, `learning_module_review_${decision}`, 'stunt_module', moduleId, String(body.notes || '').slice(0, 200), {});
          return sendJson(res, 200, { decision }), true;
        }
        const status = action === 'publish' ? 'published' : 'draft';
        db.prepare('UPDATE stunt_modules SET status = ?, updated_at = ?, updated_by = ? WHERE id = ?').run(status, nowIso(), user.id, moduleId);
        auditAdmin(user.id, `learning_module_${action}`, 'stunt_module', moduleId, row.title, {});
        return sendJson(res, 200, { status, message: `Module ${status}.` }), true;
      }

      if (pathname === '/api/admin/learning/media' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const moduleId = String(body.module_id || '');
        const url = String(body.url || '').trim();
        if (!db.prepare('SELECT 1 FROM stunt_modules WHERE id = ?').get(moduleId)) {
          return sendJson(res, 404, { error: 'MODULE_NOT_FOUND' }), true;
        }
        if (!/^https:\/\//.test(url) && !url.startsWith('/assets/')) {
          return sendJson(res, 400, { error: 'INVALID_MEDIA_URL', message: 'Lesson media must be an HTTPS URL or a bundled asset path.' }), true;
        }
        const id = newId('lmd');
        db.prepare(
          'INSERT INTO learning_lesson_media (id, module_id, kind, url, caption, display_order) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(id, moduleId, ['image', 'video', 'diagram'].includes(body.kind) ? body.kind : 'image', url, String(body.caption || '').slice(0, 200), Number(body.display_order) || 1);
        auditAdmin(user.id, 'learning_media_added', 'stunt_module', moduleId, url, {});
        return sendJson(res, 201, { id, message: 'Lesson media attached.' }), true;
      }
    }

    return false;
  };
};
