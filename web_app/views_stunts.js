/* RideRise LK — Stunt-learning library, module reader, checklist, quiz & progress */
(function () {
  'use strict';
  const { api, state, escapeHtml, toast, modal, closeModal, skeletonList, emptyState, errorState } = window.RR;

  const CATEGORY_META = {
    fundamentals: { label: 'Fundamentals', icon: '🧱', blurb: 'Bike fit, braking, balance, turning, front-wheel lift, bunny-hop prep.' },
    beginner_freestyle: { label: 'Beginner freestyle', icon: '🌀', blurb: 'Bunny hop progression, manuals, wheel lifts, low obstacles, fakie basics, park etiquette.' },
    intermediate: { label: 'Intermediate pathways', icon: '📈', blurb: 'Hop improvement, manual progression, small controlled drops, rotation concepts, drills.' },
    advanced: { label: 'Advanced (coach-supervised)', icon: '🎯', blurb: 'Advanced concepts and larger drops/rotations — only inside supervised, padded facilities.' }
  };

  let cache = null;

  async function fetchModules(force = false) {
    if (cache && !force) return cache;
    const data = await api('/api/stunts');
    cache = data.modules || [];
    return cache;
  }

  async function renderStunts(viewport) {
    if (!state.token) {
      location.hash = '#/welcome';
      return;
    }
    viewport.innerHTML = `
      <section class="safety-strip" role="note">
        <div>
          <strong>Learn control first — never chase risk.</strong>
          <div style="font-size:.78rem;color:var(--text-secondary)">Every module requires a helmet, an inspected bike and a legal, controlled practice area. Advanced skills require qualified in-person coaching.</div>
        </div>
        <button class="btn btn-safety btn-sm" id="stuntsSafetyBtn">Safety Centre</button>
      </section>
      <div class="section-head">
        <div>
          <h2>Stunt-learning library</h2>
          <p class="muted">21 modules across four pathways. Progress is saved on your profile with quiz verification.</p>
        </div>
        <button class="btn btn-secondary btn-sm" id="stuntsRefresh">↻ Refresh</button>
      </div>
      <div id="stuntLibrary">${skeletonList(4)}</div>`;
    viewport.querySelector('#stuntsSafetyBtn').addEventListener('click', () => (location.hash = '#/safety'));
    viewport.querySelector('#stuntsRefresh').addEventListener('click', () => loadLibrary(true));
    await loadLibrary();
  }

  async function loadLibrary(force = false) {
    const host = document.getElementById('stuntLibrary');
    if (!host) return;
    try {
      const modules = await fetchModules(force);
      const completed = modules.filter((m) => m.completed).length;
      host.innerHTML = `
        <div class="card card-accent" style="margin-bottom:16px">
          <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center">
            <div>
              <strong>Your learning progress</strong>
              <p class="muted" style="font-size:.82rem">${completed} of ${modules.length} modules completed and verified by quiz.</p>
            </div>
            <div class="pill-badge pill-green">${Math.round((completed / Math.max(1, modules.length)) * 100)}% complete</div>
          </div>
          <div class="xp-progress-track" style="margin-top:10px">
            <div class="xp-progress-fill" style="width:${Math.round((completed / Math.max(1, modules.length)) * 100)}%"></div>
          </div>
        </div>
        ${Object.keys(CATEGORY_META)
          .map((key) => {
            const meta = CATEGORY_META[key];
            const items = modules.filter((m) => m.category === key);
            return `<section class="stunt-group">
              <div class="stunt-group-head">
                <h3>${meta.icon} ${escapeHtml(meta.label)}</h3>
                <span class="pill-badge ${key === 'advanced' ? 'pill-red' : 'pill-cyan'}">${items.length} modules</span>
              </div>
              <p class="muted" style="font-size:.8rem;margin-bottom:10px">${escapeHtml(meta.blurb)}</p>
              <div class="grid-3">
                ${items
                  .map(
                    (m) => `<article class="card stunt-card ${m.locked ? 'locked' : ''}">
                      <div class="stunt-card-top">
                        <span class="pill-badge ${m.completed ? 'pill-green' : m.locked ? 'pill-red' : 'pill-orange'}">
                          ${m.completed ? '✓ Completed' : m.locked ? '🔒 Locked' : 'Ready'}
                        </span>
                        <span class="post-time">+${m.xp_reward} XP</span>
                      </div>
                      <h4>${escapeHtml(m.title)}</h4>
                      <p class="muted" style="font-size:.78rem">${escapeHtml(m.difficulty)}</p>
                      <p class="stunt-card-env">${escapeHtml(m.safe_environment.slice(0, 92))}…</p>
                      ${
                        m.requires_safety_ack
                          ? '<div class="pill-badge pill-red" style="margin-top:8px">Coach supervision required</div>'
                          : ''
                      }
                      <div class="stunt-card-foot">
                        <button class="btn ${m.locked ? 'btn-secondary' : 'btn-primary'} btn-sm" data-open-module="${escapeHtml(m.id)}">
                          ${m.locked ? 'View requirements' : m.completed ? 'Review module' : 'Open module'}
                        </button>
                      </div>
                    </article>`
                  )
                  .join('')}
              </div>
            </section>`;
          })
          .join('')}`;
      host.querySelectorAll('[data-open-module]').forEach((btn) =>
        btn.addEventListener('click', () => openModule(btn.dataset.openModule))
      );
    } catch (err) {
      host.innerHTML = errorState(err);
      const retry = host.querySelector('[data-retry]');
      if (retry) retry.addEventListener('click', () => loadLibrary(true));
    }
  }

  async function openModule(moduleId) {
    let module;
    try {
      const modules = await fetchModules();
      module = modules.find((m) => m.id === moduleId);
    } catch (err) {
      toast(err.message, 'error');
      return;
    }
    if (!module) return;
    const prereqNames = module.missing_prerequisites.map((pid) => {
      const found = (cache || []).find((m) => m.id === pid);
      return found ? found.title : pid;
    });

    if (module.locked) {
      modal({
        title: 'Prerequisites not met',
        size: '560px',
        body: `<p class="muted">Complete these modules first. Progression order exists so you build control before consequence.</p>
          <ul class="prereq-list">${prereqNames.map((n) => `<li>🔒 ${escapeHtml(n)}</li>`).join('')}</ul>
          <div class="callout callout-warn"><strong>Why?</strong> RideRise LK never rewards skipping foundations. Advanced skills on unprepared bike control is how riders get seriously hurt.</div>`,
        footer: '<button class="btn btn-secondary" data-modal-close="1">Back to library</button>',
        onMount(root) {
          root.querySelector('[data-modal-close]').addEventListener('click', closeModal);
        }
      });
      return;
    }

    const quizState = { answers: module.quiz_questions.map(() => null) };

    modal({
      title: module.title,
      size: '800px',
      body: `<div class="module-reader">
        <div class="module-meta-row">
          <span class="pill-badge pill-orange">${escapeHtml(module.difficulty)}</span>
          <span class="pill-badge pill-green">+${module.xp_reward} XP</span>
          ${module.requires_safety_ack ? '<span class="pill-badge pill-red">Coach-supervised pathway</span>' : ''}
          ${module.completed ? '<span class="pill-badge pill-green">✓ Completed</span>' : ''}
        </div>

        <section class="module-block">
          <h4>Bicycle suitability</h4>
          <p>${escapeHtml(module.bike_suitability)}</p>
        </section>

        <section class="module-block">
          <h4>Recommended protective equipment</h4>
          <ul>${module.protective_gear.map((g) => `<li>${escapeHtml(g)}</li>`).join('')}</ul>
        </section>

        <section class="module-block">
          <h4>Safe practice environment</h4>
          <p class="callout">${escapeHtml(module.safe_environment)}</p>
        </section>

        <section class="module-block">
          <h4>Preparation &amp; inspection checklist</h4>
          <div class="checklist">
            ${module.inspection_checklist
              .map(
                (item, i) => `<label class="check-row">
                  <input type="checkbox" data-module-check="${i}" />
                  <span>${escapeHtml(item)}</span>
                </label>`
              )
              .join('')}
          </div>
        </section>

        <section class="module-block">
          <h4>Structured learning stages</h4>
          ${module.learning_stages
            .map((stage, i) => `<div class="stage-row"><span class="stage-num">${i + 1}</span><p>${escapeHtml(stage)}</p></div>`)
            .join('')}
          <div class="module-diagram" aria-label="Technique diagram">
            ${diagramSvg(module.diagram_type)}
          </div>
        </section>

        <section class="module-block">
          <h4>Common errors &amp; how to avoid them</h4>
          <ul class="error-list">${module.common_errors.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>
        </section>

        <section class="module-block">
          <h4>Stop conditions</h4>
          <ul class="stop-list">${module.stop_conditions.map((s) => `<li>⛔ ${escapeHtml(s)}</li>`).join('')}</ul>
        </section>

        ${
          module.prerequisites.length
            ? `<section class="module-block"><h4>Prerequisite skills</h4><ul>${module.prerequisites
                .map((pid) => {
                  const p = (cache || []).find((m) => m.id === pid);
                  return `<li>✓ ${escapeHtml(p ? p.title : pid)}</li>`;
                })
                .join('')}</ul></section>`
            : ''
        }

        <section class="module-block">
          <div class="callout callout-warn"><strong>Coaching reminder:</strong> ${escapeHtml(module.coaching_reminder)}</div>
        </section>

        ${
          module.quiz_questions.length
            ? `<section class="module-block">
                <h4>Knowledge check (100% required)</h4>
                ${module.quiz_questions
                  .map(
                    (q, qi) => `<fieldset class="quiz-question">
                      <legend>${qi + 1}. ${escapeHtml(q.q)}</legend>
                      ${q.options
                        .map(
                          (opt, oi) => `<label class="check-row">
                            <input type="radio" name="quiz-${qi}" data-quiz="${qi}" data-option="${oi}" />
                            <span>${escapeHtml(opt)}</span>
                          </label>`
                        )
                        .join('')}
                    </fieldset>`
                  )
                  .join('')}
              </section>`
            : ''
        }

        ${
          module.requires_safety_ack
            ? `<label class="check-row check-ack">
                 <input type="checkbox" id="safetyAck" />
                 <span>I acknowledge that this advanced pathway must only be practised with qualified in-person coaching, full protective equipment, and in a controlled/padded facility. I will not attempt it on public roads, in traffic or near pedestrians.</span>
               </label>`
            : ''
        }
      </div>`,
      footer: `<button class="btn btn-secondary" data-modal-close="1">Close</button>
               <button class="btn btn-primary" id="completeModuleBtn">Mark module complete</button>`,
      onMount(root) {
        root.querySelector('[data-modal-close]').addEventListener('click', closeModal);
        root.querySelectorAll('[data-quiz]').forEach((input) =>
          input.addEventListener('change', () => {
            quizState.answers[Number(input.dataset.quiz)] = Number(input.dataset.option);
          })
        );
        root.querySelector('#completeModuleBtn').addEventListener('click', async () => {
          const checklist = Array.from(root.querySelectorAll('[data-module-check]'));
          const allChecked = checklist.every((c) => c.checked);
          if (!allChecked) {
            toast('Complete every inspection checklist item first.', 'error');
            return;
          }
          if (module.quiz_questions.length && quizState.answers.some((a) => a === null)) {
            toast('Answer every knowledge-check question.', 'error');
            return;
          }
          const safetyAck = root.querySelector('#safetyAck');
          if (module.requires_safety_ack && (!safetyAck || !safetyAck.checked)) {
            toast('Please acknowledge the coach-supervision safety notice.', 'error');
            return;
          }
          try {
            const result = await api(`/api/stunts/${module.id}/complete`, {
              method: 'POST',
              body: {
                checklistCompleted: true,
                safetyAcknowledged: !!(safetyAck && safetyAck.checked),
                quizAnswers: quizState.answers
              }
            });
            closeModal();
            toast(result.message, 'success', 5000);
            cache = null;
            await loadLibrary(true);
            window.RR.refreshSession().catch(() => {});
          } catch (err) {
            if (err.code === 'QUIZ_NOT_PASSED') {
              toast('One or more answers were incorrect. Review the module and try again.', 'error', 6000);
            } else {
              toast(err.message, 'error', 6000);
            }
          }
        });
      }
    });
  }

  function diagramSvg(type) {
    const common =
      'stroke="url(#diagGrad)" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"';
    const defs = `<defs><linearGradient id="diagGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#FF6B00"/><stop offset="100%" stop-color="#FFD13B"/></linearGradient></defs>`;
    let art = '';
    if (type === 'bunny_hop') {
      art = `
        <circle cx="62" cy="96" r="22" ${common}/><circle cx="150" cy="82" r="22" ${common}/>
        <path d="M62 96 L92 64 L132 66 L150 82" ${common}/>
        <path d="M92 64 L88 40 M132 66 L140 42" ${common}/>
        <path d="M196 100 Q224 62 250 96" ${common} stroke-dasharray="6 6"/>
        <text x="186" y="120" fill="#94A3B8" font-size="11">lift → scoop</text>`;
    } else if (type === 'braking_modulation') {
      art = `
        <circle cx="60" cy="92" r="20" ${common}/><circle cx="146" cy="92" r="20" ${common}/>
        <path d="M60 92 L96 66 L146 92" ${common}/>
        <path d="M96 66 L104 44" ${common}/>
        <path d="M176 92 L206 92 M206 84 L206 100" ${common}/>
        <text x="40" y="126" fill="#94A3B8" font-size="11">progressive rear squeeze · hips back</text>`;
    } else if (type === 'trackstand_balance') {
      art = `
        <circle cx="66" cy="94" r="20" ${common}/><circle cx="132" cy="94" r="20" ${common}/>
        <path d="M66 94 L100 68 L132 94" ${common}/>
        <path d="M100 68 L86 40" ${common}/>
        <path d="M138 44 A60 60 0 0 1 168 96" ${common} stroke-dasharray="5 6"/>
        <text x="148" y="122" fill="#94A3B8" font-size="11">front wheel 45°</text>`;
    } else if (type === 'safe_turning') {
      art = `
        <path d="M30 110 Q90 40 170 74 T250 96" ${common}/>
        <circle cx="70" cy="88" r="6" fill="#FFD13B"/>
        <path d="M96 72 L120 84" ${common}/>
        <text x="26" y="132" fill="#94A3B8" font-size="11">brake before · look through the exit</text>`;
    } else if (type === 'front_wheel_lift') {
      art = `
        <circle cx="58" cy="98" r="20" ${common}/><circle cx="142" cy="70" r="20" ${common}/>
        <path d="M58 98 L100 88 L142 70" ${common}/>
        <path d="M100 88 L110 62" ${common}/>
        <path d="M168 70 L196 60" ${common} stroke-dasharray="5 5"/>
        <text x="150" y="108" fill="#94A3B8" font-size="11">rear brake covers loop-out</text>`;
    } else {
      art = `
        <circle cx="60" cy="94" r="18" ${common}/><circle cx="140" cy="94" r="18" ${common}/>
        <path d="M60 94 L100 62 L140 94" ${common}/>
        <path d="M100 62 L100 40" ${common}/>
        <text x="60" y="128" fill="#94A3B8" font-size="11">snug fit · level pedals · eyes ahead</text>`;
    }
    return `<svg viewBox="0 0 260 140" role="img" aria-label="Technique illustration">${defs}${art}</svg>`;
  }

  window.RRStunts = { renderStunts };
})();
