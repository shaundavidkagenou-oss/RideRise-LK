/* RideRise LK — Learning dashboard and lesson reader (Phase 2).
 * Structured pathways, prerequisite explanations, checklists and quizzes.
 * Nothing here certifies a rider: advanced lessons are references, not promises.
 */
(function () {
  'use strict';

  const { api, state, escapeHtml, toast, emptyState, errorState, skeletonList, timeAgo } = window.RR;

  const TRACK_LABEL = {
    beginner: 'Beginner',
    intermediate: 'Intermediate',
    advanced: 'Advanced',
    maintenance: 'Maintenance'
  };

  async function renderLearning(viewport) {
    if (!state.token) {
      location.hash = '#/welcome';
      return;
    }
    viewport.innerHTML = `<div class="skeleton" style="height:120px"></div><div class="skeleton"></div><div class="skeleton"></div>`;
    let data;
    try {
      data = await api('/api/learning/dashboard');
    } catch (err) {
      viewport.innerHTML = `<div class="section-head"><div><h2>Learning</h2></div></div>${errorState(err)}`;
      return;
    }

    const tracks = data.summary.tracks;
    viewport.innerHTML = `
      <div class="section-head">
        <div>
          <h2>Learning pathways</h2>
          <p class="muted">Structured from balance and inspection basics to advanced air. Every module is educational — none of them certify that a manoeuvre is safe for you.</p>
        </div>
        <span class="pill-badge pill-cyan">${data.summary.modules_completed}/${data.summary.modules_total} modules</span>
      </div>

      <div class="callout callout-warn" role="note">
        <strong>Before any practical attempt</strong>
        <p style="font-size:.86rem;margin-top:4px">${escapeHtml(data.safety_reminder)}</p>
      </div>

      <div class="learning-stats">
        ${tracks
          .map(
            (t) => `<div class="learning-stat">
              <div class="learning-stat-head"><span>${TRACK_LABEL[t.track]}</span><strong>${t.completed}/${t.total}</strong></div>
              <div class="progress-track"><div class="progress-fill" style="width:${t.percent}%"></div></div>
            </div>`
          )
          .join('')}
        <div class="learning-stat">
          <div class="learning-stat-head"><span>Quiz average</span><strong>${data.summary.quiz_average === null ? '—' : data.summary.quiz_average + '%'}</strong></div>
          <div class="progress-track"><div class="progress-fill" style="width:${data.summary.quiz_average || 0}%"></div></div>
        </div>
      </div>

      <div class="pathway-list">
        ${data.pathways
          .map(
            (p) => `<section class="pathway-card card">
              <div class="pathway-head">
                <div class="pathway-icon" aria-hidden="true">${p.icon}</div>
                <div style="flex:1">
                  <h3>${escapeHtml(p.title)}</h3>
                  <p class="muted" style="font-size:.84rem">${escapeHtml(p.description)}</p>
                </div>
                <div class="pathway-progress">
                  <span class="pill-badge ${p.completed_count === p.module_count && p.module_count ? 'pill-green' : 'pill-cyan'}">${p.completed_count}/${p.module_count}</span>
                  <div class="progress-track" style="width:110px"><div class="progress-fill" style="width:${p.percent}%"></div></div>
                  <small class="muted">${TRACK_LABEL[p.track] || p.track}</small>
                </div>
              </div>
              <ol class="module-steps">
                ${p.modules
                  .map(
                    (m, i) => `<li class="module-step ${m.completed ? 'is-done' : ''} ${m.locked ? 'is-locked' : ''}">
                      <span class="module-step-index">${m.completed ? '✓' : i + 1}</span>
                      <div class="module-step-text">
                        <strong>${escapeHtml(m.title)}</strong>
                        <small>${escapeHtml(m.difficulty)} · ${m.xp_reward} XP${m.requires_supervision ? ' · supervision recommended' : ''}${
                          m.locked ? ` · needs ${m.missing_prerequisites.length} prerequisite${m.missing_prerequisites.length === 1 ? '' : 's'}` : ''
                        }</small>
                      </div>
                      <button class="btn ${m.locked ? 'btn-secondary' : m.completed ? 'btn-secondary' : 'btn-primary'} btn-sm" data-module="${escapeHtml(
                        m.id
                      )}" ${m.locked ? 'data-locked="1"' : ''}>${m.completed ? 'Review' : m.locked ? 'Locked' : 'Start'}</button>
                    </li>`
                  )
                  .join('')}
              </ol>
            </section>`
          )
          .join('')}
      </div>`;

    viewport.querySelectorAll('[data-module]').forEach((btn) =>
      btn.addEventListener('click', () => {
        if (btn.dataset.locked === '1') {
          toast('Complete the prerequisite modules first — each builds a skill this lesson depends on.', 'info', 5000);
        }
        location.hash = `#/learning/module/${btn.dataset.module}`;
      })
    );
  }

  async function renderLesson(viewport, moduleId) {
    if (!state.token) {
      location.hash = '#/welcome';
      return;
    }
    viewport.innerHTML = `<div class="skeleton" style="height:120px"></div><div class="skeleton"></div>`;
    let data;
    try {
      data = await api(`/api/learning/modules/${moduleId}`);
    } catch (err) {
      viewport.innerHTML = `<div class="section-head"><div><h2>Lesson</h2></div></div>${errorState(err)}`;
      return;
    }
    const mod = data.module;
    const checks = new Set(data.checklist_checked || []);
    let quizState = null;

    viewport.innerHTML = `
      <div class="section-head">
        <div>
          <button class="btn btn-secondary btn-sm" id="backLearning" style="margin-bottom:8px">← Learning pathways</button>
          <h2>${escapeHtml(mod.title)}</h2>
          <p class="muted">${escapeHtml(mod.difficulty)} · ${escapeHtml(TRACK_LABEL[mod.track] || mod.track)} · ${mod.xp_reward} XP · version ${mod.version || 1}</p>
        </div>
        ${mod.completed ? '<span class="pill-badge pill-green">Completed</span>' : '<span class="pill-badge pill-cyan">In progress</span>'}
      </div>

      <div class="callout callout-warn" role="note">
        <strong>Practice reminder</strong>
        <p style="font-size:.86rem;margin-top:4px">${escapeHtml(data.practical_reminder)}</p>
      </div>

      <div class="lesson-grid">
        <div>
          <section class="card">
            <h3>Why this lesson exists</h3>
            <p>${escapeHtml(mod.coaching_reminder)}</p>
            <div class="lesson-objectives">
              ${(mod.learning_objectives || [])
                .map((o) => `<div class="objective-row"><span aria-hidden="true">◆</span><span>${escapeHtml(o)}</span></div>`)
                .join('') || '<p class="muted">No objectives recorded for this module yet.</p>'}
            </div>
          </section>

          <section class="card">
            <h3>Prerequisites</h3>
            ${
              data.prerequisites.length
                ? `<div class="prereq-list">${data.prerequisites
                    .map(
                      (p) => `<div class="prereq-row ${p.completed ? 'is-done' : ''}">
                        <span>${p.completed ? '✓' : '◻'}</span>
                        <strong>${escapeHtml(p.title)}</strong>
                        ${p.completed ? '' : '<button class="btn btn-secondary btn-sm" data-goto="' + escapeHtml(p.id) + '">Open</button>'}
                      </div>`
                    )
                    .join('')}</div>`
                : '<p class="muted">No prerequisites — this is an entry point.</p>'
            }
            ${
              (mod.why_prerequisites || []).length
                ? `<div class="why-list">${mod.why_prerequisites.map((w) => `<p class="hint">• ${escapeHtml(w)}</p>`).join('')}</div>`
                : '<p class="hint">Each prerequisite builds control, balance and braking judgement this lesson assumes. Skipping them is how preventable injuries happen.</p>'
            }
          </section>

          <section class="card">
            <h3>Safe environment</h3>
            <p>${escapeHtml(mod.safe_environment)}</p>
            <h4 style="margin-top:12px">Bike suitability</h4>
            <p class="muted">${escapeHtml(mod.bike_suitability)}</p>
            <h4 style="margin-top:12px">Protective gear</h4>
            <div class="tag-row">${(mod.protective_gear || []).map((g) => `<span class="tag">${escapeHtml(g)}</span>`).join('') || '<span class="muted">—</span>'}</div>
          </section>

          <section class="card">
            <h3>Learning stages</h3>
            <div class="stage-list">
              ${(mod.learning_stages || [])
                .map((s, i) => `<div class="stage-row"><span class="stage-num">${i + 1}</span><p>${escapeHtml(s)}</p></div>`)
                .join('') || '<p class="muted">—</p>'}
            </div>
          </section>

          ${
            data.media.length
              ? `<section class="card"><h3>Lesson media</h3>${data.media
                  .map((m) =>
                    m.kind === 'video'
                      ? `<video class="lesson-media" controls preload="metadata" src="${escapeHtml(m.url)}"></video><p class="hint">${escapeHtml(m.caption)}</p>`
                      : `<img class="lesson-media" src="${escapeHtml(m.url)}" alt="${escapeHtml(m.caption || 'Lesson illustration')}" loading="lazy" /><p class="hint">${escapeHtml(m.caption)}</p>`
                  )
                  .join('')}</section>`
              : ''
          }

          <section class="card">
            <h3>Common errors &amp; stop conditions</h3>
            <div class="grid-2" style="gap:12px">
              <div><h4 style="color:var(--warning-amber)">Common errors</h4><ul class="plain-list">${(mod.common_errors || [])
                .map((e) => `<li>${escapeHtml(e)}</li>`)
                .join('') || '<li class="muted">—</li>'}</ul></div>
              <div><h4 style="color:var(--danger-red)">Stop immediately if…</h4><ul class="plain-list">${(mod.stop_conditions || [])
                .map((e) => `<li>${escapeHtml(e)}</li>`)
                .join('') || '<li class="muted">—</li>'}</ul></div>
            </div>
          </section>
        </div>

        <aside class="lesson-side">
          <section class="card">
            <h3>Inspection checklist</h3>
            <p class="muted" style="font-size:.82rem">Tick every item before completing this module. This is about your equipment, not a formality.</p>
            <div class="checklist" id="lessonChecklist">
              ${(mod.inspection_checklist || [])
                .map(
                  (item, i) => `<label class="check-row">
                    <input type="checkbox" data-check-index="${i}" ${checks.has(i) ? 'checked' : ''} />
                    <span>${escapeHtml(item)}</span>
                  </label>`
                )
                .join('')}
            </div>
            <div class="checklist-progress" id="checklistProgress">${checks.size}/${(mod.inspection_checklist || []).length} complete</div>
          </section>

          <section class="card">
            <h3>Knowledge check</h3>
            <p class="muted" style="font-size:.82rem">All questions must be correct. Answers are graded on the server.</p>
            <div id="quizHost">
              ${data.quiz
                .map(
                  (q) => `<div class="quiz-question">
                    <p><strong>${q.index + 1}. ${escapeHtml(q.prompt)}</strong></p>
                    ${q.options
                      .map(
                        (opt, oi) => `<label class="check-row"><input type="radio" name="q${q.index}" value="${oi}" /> <span>${escapeHtml(opt)}</span></label>`
                      )
                      .join('')}
                  </div>`
                )
                .join('')}
            </div>
            <button class="btn btn-secondary" id="submitQuiz">Submit answers</button>
            <div id="quizResult" class="quiz-result" role="status"></div>
          </section>

          <section class="card">
            <h3>Complete module</h3>
            ${
              mod.requires_safety_ack
                ? `<label class="check-row" for="safetyAck"><input type="checkbox" id="safetyAck" /> <span>I acknowledge the supervision and controlled-environment notice for this module.</span></label>`
                : ''
            }
            <p class="hint">Completion records your progress. It does not certify you can perform the manoeuvre.</p>
            <button class="btn btn-primary" id="completeModule" ${mod.completed ? 'disabled' : ''}>${mod.completed ? 'Already completed' : 'Mark complete'}</button>
            <div id="completeResult" class="hint" role="status"></div>
          </section>
        </aside>
      </div>`;

    viewport.querySelector('#backLearning').addEventListener('click', () => (location.hash = '#/learning'));
    viewport.querySelectorAll('[data-goto]').forEach((b) =>
      b.addEventListener('click', () => (location.hash = `#/learning/module/${b.dataset.goto}`))
    );

    const checked = new Set(checks);
    viewport.querySelectorAll('[data-check-index]').forEach((box) =>
      box.addEventListener('change', async () => {
        const index = Number(box.dataset.checkIndex);
        try {
          const res = await api(`/api/learning/modules/${moduleId}/checklist`, {
            method: 'POST',
            body: { index, checked: box.checked }
          });
          if (box.checked) checked.add(index);
          else checked.delete(index);
          viewport.querySelector('#checklistProgress').textContent = `${res.checked.length}/${(mod.inspection_checklist || []).length} complete`;
        } catch (err) {
          toast(err.message, 'error');
          box.checked = !box.checked;
        }
      })
    );

    viewport.querySelector('#submitQuiz').addEventListener('click', async (e) => {
      e.target.disabled = true;
      const answers = data.quiz.map((q) => {
        const selected = viewport.querySelector(`input[name="q${q.index}"]:checked`);
        return selected ? Number(selected.value) : -1;
      });
      try {
        const res = await api(`/api/learning/modules/${moduleId}/quiz`, { method: 'POST', body: { answers } });
        quizState = res;
        const host = viewport.querySelector('#quizResult');
        host.innerHTML = `<div class="callout ${res.passed ? '' : 'callout-warn'}">
          <strong>${res.passed ? 'All knowledge checks passed' : `Score ${res.score}% — 100% required`}</strong>
          ${res.review
            .map((r) =>
              r.correct || !r.explanation ? '' : `<p class="hint">Q${r.index + 1}: ${escapeHtml(r.explanation)}</p>`
            )
            .join('')}
        </div>`;
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        e.target.disabled = false;
      }
    });

    viewport.querySelector('#completeModule').addEventListener('click', async (e) => {
      e.target.disabled = true;
      const ack = viewport.querySelector('#safetyAck');
      try {
        const res = await api(`/api/learning/modules/${moduleId}/complete`, {
          method: 'POST',
          body: {
            checklistCompleted: checked.size >= (mod.inspection_checklist || []).length,
            safetyAcknowledged: ack ? ack.checked : false,
            quizScore: quizState ? quizState.score : (data.progress && data.progress.quiz_score) || 0
          }
        });
        viewport.querySelector('#completeResult').textContent = res.message + ' ' + (res.disclaimer || '');
        toast(res.message, 'success', 6000);
        e.target.textContent = 'Completed';
      } catch (err) {
        viewport.querySelector('#completeResult').textContent = err.message;
        toast(err.message, 'error');
        e.target.disabled = false;
      }
    });
  }

  window.RRLearning = { renderLearning, renderLesson };
})();
