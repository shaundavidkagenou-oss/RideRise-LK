/* RideRise LK — Parts catalogue (Phase 2): search, filters, comparison,
 * compatibility checks and saved builds. Prices appear only when an
 * administrator has verified them, always with the verification date. */
(function () {
  'use strict';

  const { api, state, escapeHtml, toast, emptyState, errorState, skeletonList, modal, closeModal } = window.RR;

  const CATEGORIES = [
    ['', 'All categories'],
    ['frames_forks', 'Frames & forks'],
    ['handlebars_stems_grips', 'Handlebars, stems & grips'],
    ['tires_wheels_hubs', 'Tyres, wheels & hubs'],
    ['drivetrain_cranks_pedals', 'Drivetrain, cranks & pedals'],
    ['brakes_cables_levers', 'Brakes, cables & levers'],
    ['headsets_seats', 'Headsets & seats'],
    ['pegs_accessories', 'Pegs & accessories'],
    ['protective_gear', 'Protective gear'],
    ['tools_maintenance', 'Tools & maintenance']
  ];

  const VERDICT = {
    fits: ['pill-green', 'Fits recorded specs'],
    check: ['pill-orange', 'Check compatibility'],
    no_fit: ['pill-red', 'Likely incompatible'],
    unknown: ['pill-cyan', 'Add your bike to check']
  };

  function priceLine(part) {
    if (!part.price_verified || !part.price_lkr) {
      return `<span class="part-price unverified">Price not verified</span>`;
    }
    return `<span class="part-price">LKR ${Number(part.price_lkr).toLocaleString('en-LK')}</span>
      <small class="price-date">Verified ${escapeHtml(part.last_verified_date || 'date not recorded')}</small>`;
  }

  async function renderCatalog(viewport) {
    let filters = { q: '', category: '', manufacturer: '', min_price: '', max_price: '', verified: false, bike_type: '', sort: 'relevance', page: 1 };
    const compare = new Set();
    let currentParts = [];
    let builds = [];

    viewport.innerHTML = `
      <div class="section-head">
        <div>
          <h2>Parts &amp; builds</h2>
          <p class="muted">Sri Lankan component directory. Prices are administrator-maintained, dated records — never guessed or scraped. Brand and price are not safety ratings.</p>
        </div>
        <span class="pill-badge pill-orange">Price honesty policy</span>
      </div>

      <div class="catalog-toolbar card">
        <div class="catalog-search">
          <input class="form-input" id="catQuery" placeholder="Search brand, model or part…" aria-label="Search parts" />
          <button class="btn btn-primary" id="catSearchBtn">Search</button>
        </div>
        <div class="catalog-filters">
          <select class="form-select" id="catCategory" aria-label="Category">${CATEGORIES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
          <select class="form-select" id="catBikeType" aria-label="Bicycle type">
            <option value="">Any bicycle</option><option value="bmx">BMX</option><option value="dirt jump">Dirt jump</option><option value="mtb">Mountain bike</option><option value="freestyle">Freestyle</option>
          </select>
          <input class="form-input" id="catManufacturer" placeholder="Manufacturer" aria-label="Manufacturer" />
          <input class="form-input" id="catMin" type="number" min="0" placeholder="Min LKR" aria-label="Minimum price" />
          <input class="form-input" id="catMax" type="number" min="0" placeholder="Max LKR" aria-label="Maximum price" />
          <select class="form-select" id="catSort" aria-label="Sort">
            <option value="relevance">Best match</option><option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option><option value="updated">Recently updated</option>
          </select>
          <label class="check-row" style="white-space:nowrap"><input type="checkbox" id="catVerified" /> <span>Verified price only</span></label>
        </div>
      </div>

      <div class="catalog-layout">
        <div>
          <div class="catalog-meta" id="catalogMeta"></div>
          <div id="catalogResults">${skeletonList(3)}</div>
        </div>
        <aside class="catalog-side">
          <section class="card">
            <h3>Compare tray</h3>
            <p class="muted" style="font-size:.8rem">Pick 2–4 components to compare recorded specifications.</p>
            <div id="compareTray" class="compare-tray"><span class="muted" style="font-size:.82rem">Nothing selected yet.</span></div>
            <button class="btn btn-primary btn-sm" id="openCompare" disabled>Compare selected</button>
          </section>
          <section class="card">
            <h3>Saved builds</h3>
            <div id="buildList">${skeletonList(1)}</div>
            <button class="btn btn-secondary btn-sm" id="newBuildBtn" style="margin-top:8px">+ Build from compare tray</button>
          </section>
        </aside>
      </div>`;

    const results = viewport.querySelector('#catalogResults');

    function updateCompareTray() {
      const tray = viewport.querySelector('#compareTray');
      tray.innerHTML = compare.size
        ? [...compare]
            .map((id) => {
              const part = currentParts.find((p) => p.id === id);
              return `<span class="compare-chip">${escapeHtml(part ? part.name : id)}<button class="icon-btn" data-uncompare="${escapeHtml(id)}" aria-label="Remove">✕</button></span>`;
            })
            .join('')
        : '<span class="muted" style="font-size:.82rem">Nothing selected yet.</span>';
      viewport.querySelector('#openCompare').disabled = compare.size < 2;
      tray.querySelectorAll('[data-uncompare]').forEach((b) =>
        b.addEventListener('click', () => {
          compare.delete(b.dataset.uncompare);
          updateCompareTray();
        })
      );
    }

    async function loadParts() {
      results.innerHTML = skeletonList(3);
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([k, v]) => {
        if (v !== '' && v !== false && v !== null) params.set(k, v === true ? '1' : v);
      });
      try {
        const data = await api(`/api/catalog/search?${params.toString()}`);
        currentParts = data.parts;
        viewport.querySelector('#catalogMeta').innerHTML = `<span>${data.total} component${data.total === 1 ? '' : 's'}</span>
          <span class="muted" style="font-size:.78rem">${escapeHtml(data.price_note)}</span>`;
        results.innerHTML = data.parts.length
          ? `<div class="part-grid">${data.parts.map(partCard).join('')}</div>`
          : emptyState({ icon: '🔧', title: 'No matching components', body: 'Try a different search, clear the price filters, or ask an administrator to add this part with a verified price.' });
        viewport.querySelectorAll('[data-part-detail]').forEach((b) =>
          b.addEventListener('click', () => openDetail(b.dataset.partDetail))
        );
        viewport.querySelectorAll('[data-compare-add]').forEach((b) =>
          b.addEventListener('click', () => {
            if (compare.size >= 4) {
              toast('Compare up to four components at a time.', 'info');
              return;
            }
            compare.add(b.dataset.compareAdd);
            updateCompareTray();
          })
        );
      } catch (err) {
        results.innerHTML = errorState(err);
      }
    }

    function partCard(p) {
      return `<article class="card part-card">
        <div class="part-head">
          <div><h4>${escapeHtml(p.name)}</h4><small>${escapeHtml(p.manufacturer || p.brand)}${p.model ? ' · ' + escapeHtml(p.model) : ''}</small></div>
          ${p.favorite ? '<span class="pill-badge pill-orange">★</span>' : ''}
        </div>
        <p class="part-desc">${escapeHtml((p.description || '').slice(0, 150))}</p>
        <div class="part-price-row">${priceLine(p)}</div>
        <div class="part-meta">
          <span class="tag">${escapeHtml((CATEGORIES.find((c) => c[0] === p.category) || [, p.category])[1])}</span>
          <span class="tag">${escapeHtml(p.compatible_bike_types || 'Compatibility unrecorded')}</span>
        </div>
        <div class="part-actions">
          <button class="btn btn-secondary btn-sm" data-part-detail="${escapeHtml(p.id)}">Details</button>
          <button class="btn btn-secondary btn-sm" data-compare-add="${escapeHtml(p.id)}">Compare</button>
        </div>
      </article>`;
    }

    async function openDetail(partId) {
      modal({
        title: 'Component details',
        size: '760px',
        body: '<div class="skeleton"></div>',
        onMount: async (root) => {
          try {
            const data = await api(`/api/catalog/parts/${partId}`);
            const p = data.part;
            const verdict = VERDICT[data.compatibility.overall] || VERDICT.check;
            root.querySelector('.modal-body').innerHTML = `
              <h3 style="margin-bottom:4px">${escapeHtml(p.name)}</h3>
              <p class="muted" style="font-size:.84rem">${escapeHtml(p.manufacturer || p.brand)}${p.model ? ' · ' + escapeHtml(p.model) : ''} · ${escapeHtml(p.category)}</p>
              <div class="detail-price">${priceLine(p)}</div>
              <div class="callout ${data.compatibility.overall === 'fits' ? '' : 'callout-warn'}" style="margin:12px 0">
                <span class="pill-badge ${verdict[0]}">${verdict[1]}</span>
                <p style="font-size:.85rem;margin-top:6px">${escapeHtml(data.compatibility.summary)}</p>
                ${
                  data.compatibility.verdicts.length
                    ? `<div class="spec-grid">${data.compatibility.verdicts
                        .map(
                          (v) => `<div class="spec-row"><span>${escapeHtml(v.spec_key)}</span><strong>${escapeHtml(v.expected_value)}</strong><small>your bike: ${escapeHtml(v.bike_value)}</small></div>`
                        )
                        .join('')}</div>`
                    : ''
                }
              </div>
              <p>${escapeHtml(p.description)}</p>
              <div class="spec-grid">
                ${Object.entries(p.spec || {})
                  .map(([k, v]) => `<div class="spec-row"><span>${escapeHtml(k.replace(/_/g, ' '))}</span><strong>${escapeHtml(String(v))}</strong></div>`)
                  .join('') || '<p class="muted" style="font-size:.84rem">No structured specifications recorded.</p>'}
              </div>
              <h4 style="margin-top:14px">Retailers</h4>
              ${
                p.retailers.length
                  ? p.retailers
                      .map(
                        (r) => `<div class="retailer-row"><strong>${escapeHtml(r.name)}</strong><span>${escapeHtml(r.district || '')}</span>
                          ${r.product_url ? `<a class="link-inline" href="${escapeHtml(r.product_url)}" target="_blank" rel="noopener noreferrer">Product page</a>` : ''}
                          ${r.phone ? `<span class="muted">${escapeHtml(r.phone)}</span>` : ''}
                          <small class="muted">Checked ${escapeHtml((r.last_checked_at || '').slice(0, 10) || 'not recorded')}</small></div>`
                      )
                      .join('')
                  : `<p class="hint">No verified retailer recorded. The directory entry lists “${escapeHtml(p.retailer_name || 'unknown retailer')}” — contact them directly and confirm price, stock and fit.</p>`
              }
              <h4 style="margin-top:14px">Price history</h4>
              ${
                p.price_history.length
                  ? `<div class="price-history">${p.price_history
                      .map(
                        (h) => `<div class="price-history-row"><span>${escapeHtml(h.recorded_at.slice(0, 10))}</span><strong>LKR ${Number(h.price_lkr).toLocaleString('en-LK')}</strong><small>${escapeHtml(h.source_label)}</small></div>`
                      )
                      .join('')}</div>`
                  : '<p class="hint">No verified price history. RideRise LK never invents price movements.</p>'
              }
              <p class="hint" style="margin-top:12px">${escapeHtml(p.data_source_label || 'Administrator-maintained record')} · last updated ${escapeHtml(
                (p.data_updated_at || '').slice(0, 10) || 'unknown'
              )}. ${escapeHtml(data.disclaimer || '')}</p>`;
          } catch (err) {
            root.querySelector('.modal-body').innerHTML = errorState(err);
          }
        }
      });
    }

    async function loadBuilds() {
      if (!state.token) {
        viewport.querySelector('#buildList').innerHTML = '<p class="hint">Sign in to save builds.</p>';
        return;
      }
      try {
        const data = await api('/api/catalog/builds');
        builds = data.builds;
        viewport.querySelector('#buildList').innerHTML = builds.length
          ? builds
              .map(
                (b) => `<div class="build-row">
                  <div><strong>${escapeHtml(b.name)}</strong><small class="muted">${b.parts.length} parts · ${
                    b.total_estimate_lkr ? `LKR ${Number(b.total_estimate_lkr).toLocaleString('en-LK')} verified subtotal` : 'no verified subtotal'
                  }</small></div>
                  <button class="icon-btn" data-del-build="${escapeHtml(b.id)}" title="Delete">🗑️</button>
                </div>`
              )
              .join('')
          : '<p class="hint">No saved builds yet.</p>';
        viewport.querySelectorAll('[data-del-build]').forEach((b) =>
          b.addEventListener('click', async () => {
            if (!window.confirm('Delete this saved build?')) return;
            try {
              await api(`/api/catalog/builds/${b.dataset.delBuild}`, { method: 'DELETE' });
              loadBuilds();
            } catch (err) {
              toast(err.message, 'error');
            }
          })
        );
      } catch (err) {
        viewport.querySelector('#buildList').innerHTML = `<p class="hint">${escapeHtml(err.message)}</p>`;
      }
    }

    viewport.querySelector('#catSearchBtn').addEventListener('click', () => {
      filters = {
        ...filters,
        q: viewport.querySelector('#catQuery').value,
        category: viewport.querySelector('#catCategory').value,
        manufacturer: viewport.querySelector('#catManufacturer').value,
        min_price: viewport.querySelector('#catMin').value,
        max_price: viewport.querySelector('#catMax').value,
        verified: viewport.querySelector('#catVerified').checked,
        bike_type: viewport.querySelector('#catBikeType').value,
        sort: viewport.querySelector('#catSort').value,
        page: 1
      };
      loadParts();
    });
    viewport.querySelector('#catQuery').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') viewport.querySelector('#catSearchBtn').click();
    });

    viewport.querySelector('#openCompare').addEventListener('click', async () => {
      try {
        const data = await api('/api/catalog/compare', { method: 'POST', body: { part_ids: [...compare] } });
        modal({
          title: 'Component comparison',
          size: '900px',
          body: `<div class="table-wrap"><table class="compare-table">
            <thead><tr><th>Specification</th>${data.parts.map((p) => `<th>${escapeHtml(p.name)}<br><small>${escapeHtml(p.manufacturer || p.brand)}</small></th>`).join('')}</tr></thead>
            <tbody>
              <tr><td>Verified price</td>${data.parts.map((p) => `<td>${p.price_verified ? 'LKR ' + Number(p.price_lkr).toLocaleString('en-LK') : 'Not verified'}</td>`).join('')}</tr>
              <tr><td>Compatibility</td>${data.parts
                .map((p) => {
                  const v = VERDICT[p.compatibility.overall] || VERDICT.check;
                  return `<td><span class="pill-badge ${v[0]}">${v[1]}</span></td>`;
                })
                .join('')}</tr>
              ${data.spec_keys
                .map((key) => `<tr><td>${escapeHtml(key.replace(/_/g, ' '))}</td>${data.parts.map((p) => `<td>${escapeHtml(p.spec && p.spec[key] !== undefined ? String(p.spec[key]) : '—')}</td>`).join('')}</tr>`)
                .join('')}
              <tr><td>Weight</td>${data.parts.map((p) => `<td>${p.weight_g ? p.weight_g + ' g' : '—'}</td>`).join('')}</tr>
              <tr><td>Last verified</td>${data.parts.map((p) => `<td>${escapeHtml(p.last_verified_date || 'not recorded')}</td>`).join('')}</tr>
            </tbody>
          </table></div>
          <p class="hint" style="margin-top:10px">${escapeHtml(data.note)}</p>`
        });
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    viewport.querySelector('#newBuildBtn').addEventListener('click', async () => {
      if (!state.token) {
        toast('Sign in to save a build.', 'error');
        return;
      }
      if (!compare.size) {
        toast('Add components to the compare tray first.', 'info');
        return;
      }
      const name = window.prompt('Name this build', 'My build ' + new Date().toLocaleDateString('en-GB'));
      if (!name) return;
      try {
        const res = await api('/api/catalog/builds', {
          method: 'POST',
          body: { name, parts: [...compare].map((id) => ({ part_id: id })) }
        });
        toast(res.message, 'success');
        loadBuilds();
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    loadParts();
    loadBuilds();
  }

  window.RRCatalog = { renderCatalog };
})();
