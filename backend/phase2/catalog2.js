// RideRise LK Phase 2 — Parts catalogue: search, comparison, compatibility,
// saved builds, administrator-maintained pricing with an honest history trail.
'use strict';

const { nowIso, newId, clamp, parseJson } = require('./core');

module.exports = function registerCatalog(ctx) {
  const { db, sendJson, readJsonBody, getAuthUser, checkRateLimit, auditAdmin } = ctx;

  const BIKE_SPEC_TO_PART = {
    wheel_rim_spec: 'wheel_size',
    tire_spec: 'tire_size',
    drivetrain_spec: 'drivetrain',
    brake_type: 'brake_type',
    fork_spec: 'steerer',
    handlebar_grip_spec: 'bar_diameter',
    bike_type: 'bike_type'
  };

  function partRow(part, viewerId) {
    const retailers = db
      .prepare(
        `SELECT r.id, r.name, r.url, r.phone, r.district, r.verification_note, r.verified_at,
                l.product_url, l.last_checked_at, l.is_primary
         FROM part_retailer_links l JOIN part_retailers r ON r.id = l.retailer_id
         WHERE l.part_id = ? ORDER BY l.is_primary DESC, r.name ASC`
      )
      .all(part.id);
    const favorites = viewerId
      ? Boolean(db.prepare('SELECT 1 FROM user_part_favorites WHERE user_id = ? AND part_id = ?').get(viewerId, part.id))
      : false;
    const history = db
      .prepare('SELECT price_lkr, source_label, recorded_at, note FROM part_price_history WHERE part_id = ? ORDER BY recorded_at DESC LIMIT 8')
      .all(part.id);
    return {
      id: part.id,
      name: part.name,
      brand: part.brand,
      manufacturer: part.manufacturer || part.brand,
      model: part.model || '',
      category: part.category,
      compatible_bike_types: part.compatible_bike_types,
      description: part.description,
      image_url: part.image_url,
      // Prices are only rendered when an administrator has verified them.
      price_lkr: part.price_verified ? part.price_lkr : null,
      price_verified: Boolean(part.price_verified),
      price_display: part.price_verified && part.price_lkr ? `LKR ${Number(part.price_lkr).toLocaleString('en-LK')}` : 'Price not verified',
      retailer_name: part.retailer_name,
      source_contact: part.source_contact,
      availability: part.availability_status || part.availability,
      compatibility_warning: part.compatibility_warning,
      last_verified_date: part.last_verified_date,
      data_source_label: part.data_source_label,
      data_updated_at: part.data_updated_at,
      spec: parseJson(part.spec_json, {}),
      weight_g: part.weight_g,
      retailers,
      price_history: history,
      favorite: favorites,
      is_listed: Boolean(part.is_listed)
    };
  }

  function compatibilityFor(partId, bike) {
    const rows = db.prepare('SELECT * FROM part_compatibility WHERE part_id = ?').all(partId);
    if (!bike) {
      return {
        overall: 'unknown',
        verdicts: rows.map((r) => ({ ...r })),
        summary: 'Add a bicycle to your profile to check compatibility against your own build.'
      };
    }
    if (!rows.length) {
      return {
        overall: 'check',
        verdicts: [],
        summary: 'No compatibility data is recorded for this part yet. Check compatibility with the retailer before ordering.'
      };
    }
    const verdicts = [];
    for (const row of rows) {
      const bikeValue = String(bike[row.spec_key === 'bike_type' ? 'bike_type' : row.spec_key] || '').toLowerCase();
      let verdict = row.verdict;
      if (row.verdict !== 'no_fit') {
        if (!bikeValue) verdict = 'check';
        else if (
          bikeValue.includes(String(row.expected_value).toLowerCase()) ||
          String(row.expected_value).toLowerCase().includes(bikeValue)
        )
          verdict = 'fits';
        else verdict = row.verdict === 'fits' ? 'check' : row.verdict;
      }
      verdicts.push({
        spec_key: row.spec_key,
        expected_value: row.expected_value,
        bike_value: bikeValue || 'not recorded',
        verdict,
        notes: row.notes
      });
    }
    const overall = verdicts.some((v) => v.verdict === 'no_fit')
      ? 'no_fit'
      : verdicts.every((v) => v.verdict === 'fits')
      ? 'fits'
      : 'check';
    return {
      overall,
      verdicts,
      summary:
        overall === 'fits'
          ? 'Recorded specifications match your bicycle. Always confirm with the retailer before paying.'
          : overall === 'no_fit'
          ? 'Recorded specifications do not match your bicycle. This part is likely incompatible.'
          : 'Some specifications are uncertain — check compatibility with the retailer.'
    };
  }

  function primaryBike(userId) {
    return db.prepare('SELECT * FROM bicycles WHERE user_id = ? ORDER BY is_primary DESC, created_at DESC LIMIT 1').get(userId);
  }

  return async function handle(req, res, pathname, parsedUrl) {
    /* -------------------------------- search -------------------------------- */
    if (pathname === '/api/catalog/search' && req.method === 'GET') {
      const user = getAuthUser(req);
      const q = (parsedUrl.searchParams.get('q') || '').trim().toLowerCase();
      const category = parsedUrl.searchParams.get('category') || '';
      const manufacturer = (parsedUrl.searchParams.get('manufacturer') || '').trim();
      const bikeType = (parsedUrl.searchParams.get('bike_type') || '').trim().toLowerCase();
      const minPrice = Number(parsedUrl.searchParams.get('min_price') || 0);
      const maxPrice = Number(parsedUrl.searchParams.get('max_price') || 0);
      const verifiedOnly = parsedUrl.searchParams.get('verified') === '1';
      const sort = parsedUrl.searchParams.get('sort') || 'relevance';
      const page = clamp(parsedUrl.searchParams.get('page') || 1, 1, 1000);
      const pageSize = clamp(parsedUrl.searchParams.get('page_size') || 20, 1, 60);

      let parts = db.prepare('SELECT * FROM parts_catalog WHERE is_listed = 1').all();
      if (category) parts = parts.filter((p) => p.category === category);
      if (manufacturer) {
        const m = manufacturer.toLowerCase();
        parts = parts.filter(
          (p) => String(p.manufacturer || '').toLowerCase().includes(m) || String(p.brand || '').toLowerCase().includes(m)
        );
      }
      if (bikeType) {
        parts = parts.filter((p) => String(p.compatible_bike_types || '').toLowerCase().includes(bikeType));
      }
      if (q) {
        parts = parts.filter((p) =>
          [p.name, p.brand, p.manufacturer, p.model, p.description, p.category]
            .join(' ')
            .toLowerCase()
            .includes(q)
        );
      }
      if (verifiedOnly) parts = parts.filter((p) => p.price_verified);
      if (minPrice || maxPrice) {
        parts = parts.filter((p) => {
          if (!p.price_verified || !p.price_lkr) return false;
          if (minPrice && p.price_lkr < minPrice) return false;
          if (maxPrice && p.price_lkr > maxPrice) return false;
          return true;
        });
      }
      if (sort === 'price_asc') parts.sort((a, b) => (a.price_verified ? a.price_lkr : Infinity) - (b.price_verified ? b.price_lkr : Infinity));
      if (sort === 'price_desc') parts.sort((a, b) => (b.price_verified ? b.price_lkr : -1) - (a.price_verified ? a.price_lkr : -1));
      if (sort === 'updated') parts.sort((a, b) => String(b.data_updated_at || '').localeCompare(String(a.data_updated_at || '')));

      const total = parts.length;
      const sliced = parts.slice((page - 1) * pageSize, page * pageSize);
      const manufacturers = [...new Set(db.prepare('SELECT manufacturer FROM parts_catalog WHERE is_listed = 1').all().map((r) => r.manufacturer).filter(Boolean))];
      return sendJson(res, 200, {
        parts: sliced.map((p) => partRow(p, user ? user.id : null)),
        total,
        page,
        page_size: pageSize,
        has_more: page * pageSize < total,
        manufacturers,
        price_note:
          'Prices are administrator-maintained LKR records with a last-verified date. They may change without notice. RideRise LK never generates or guesses prices, and price or brand is never a measure of safety.',
        compatibility_note: 'Compatibility is based on recorded specifications. “Check compatibility” means we cannot confirm the fit.'
      }), true;
    }

    /* ----------------------------- part detail ------------------------------ */
    const partMatch = pathname.match(/^\/api\/catalog\/parts\/([^/]+)$/);
    if (partMatch && req.method === 'GET') {
      const user = getAuthUser(req);
      const part = db.prepare('SELECT * FROM parts_catalog WHERE id = ?').get(decodeURIComponent(partMatch[1]));
      if (!part) return sendJson(res, 404, { error: 'PART_NOT_FOUND' }), true;
      const bike = user ? primaryBike(user.id) : null;
      return sendJson(res, 200, {
        part: partRow(part, user ? user.id : null),
        compatibility: compatibilityFor(part.id, bike),
        comparison_bike: bike || null
      }), true;
    }

    /* ------------------------------- compare -------------------------------- */
    if (pathname === '/api/catalog/compare' && req.method === 'POST') {
      const user = getAuthUser(req);
      const body = await readJsonBody(req);
      const ids = Array.isArray(body.part_ids) ? body.part_ids.slice(0, 4) : [];
      if (ids.length < 2) return sendJson(res, 400, { error: 'COMPARE_TOO_FEW', message: 'Choose at least two components to compare.' }), true;
      const parts = ids
        .map((id) => db.prepare('SELECT * FROM parts_catalog WHERE id = ? AND is_listed = 1').get(String(id)))
        .filter(Boolean)
        .map((p) => partRow(p, user ? user.id : null));
      if (parts.length < 2) return sendJson(res, 400, { error: 'COMPARE_NOT_FOUND', message: 'One of those components is no longer listed.' }), true;
      const allSpecKeys = [...new Set(parts.flatMap((p) => Object.keys(p.spec || {})))];
      const bike = user ? primaryBike(user.id) : null;
      return sendJson(res, 200, {
        parts: parts.map((p) => ({ ...p, compatibility: compatibilityFor(p.id, bike) })),
        spec_keys: allSpecKeys,
        note:
          'Comparison uses administrator-entered specifications only. Missing rows mean the specification is not recorded — never assume it matches.'
      }), true;
    }

    /* ---------------------------- compatibility ----------------------------- */
    if (pathname === '/api/catalog/compatibility' && req.method === 'POST') {
      const user = getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'UNAUTHENTICATED' }), true;
      const body = await readJsonBody(req);
      const partId = String(body.part_id || '');
      const part = db.prepare('SELECT * FROM parts_catalog WHERE id = ?').get(partId);
      if (!part) return sendJson(res, 404, { error: 'PART_NOT_FOUND' }), true;
      const bike = body.bike_id
        ? db.prepare('SELECT * FROM bicycles WHERE id = ? AND user_id = ?').get(String(body.bike_id), user.id)
        : primaryBike(user.id);
      const result = compatibilityFor(partId, bike);
      return sendJson(res, 200, {
        part: { id: part.id, name: part.name },
        bike: bike ? { id: bike.id, name: bike.name, bike_type: bike.bike_type } : null,
        ...result,
        disclaimer: 'Compatibility guidance is informational. Confirm the fit with a qualified mechanic or the retailer before purchasing.'
      }), true;
    }

    /* ------------------------------ saved builds ---------------------------- */
    if (pathname === '/api/catalog/builds' && req.method === 'GET') {
      const user = getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'UNAUTHENTICATED' }), true;
      const builds = db.prepare('SELECT * FROM saved_bike_builds WHERE user_id = ? ORDER BY updated_at DESC').all(user.id).map((b) => ({
        ...b,
        parts: parseJson(b.parts_json, [])
      }));
      return sendJson(res, 200, { builds }), true;
    }

    if (pathname === '/api/catalog/builds' && req.method === 'POST') {
      const user = getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'UNAUTHENTICATED' }), true;
      if (!checkRateLimit(`catalog:build:${user.id}`, 30, 60)) {
        return sendJson(res, 429, { error: 'RATE_LIMITED' }), true;
      }
      const body = await readJsonBody(req);
      const name = String(body.name || '').trim().slice(0, 80);
      if (name.length < 2) return sendJson(res, 400, { error: 'NAME_REQUIRED' }), true;
      const partsInput = Array.isArray(body.parts) ? body.parts.slice(0, 40) : [];
      const enriched = [];
      let estimate = 0;
      let hasUnverified = false;
      for (const p of partsInput) {
        const row = db.prepare('SELECT * FROM parts_catalog WHERE id = ?').get(String(p.part_id || p.id || ''));
        if (!row) continue;
        enriched.push({
          part_id: row.id,
          name: row.name,
          brand: row.brand,
          price_lkr: row.price_verified ? row.price_lkr : null,
          price_verified: Boolean(row.price_verified),
          last_verified_date: row.last_verified_date
        });
        if (row.price_verified && row.price_lkr) estimate += row.price_lkr;
        else hasUnverified = true;
      }
      const id = newId('sbb');
      const now = nowIso();
      db.prepare(
        `INSERT INTO saved_bike_builds (id, user_id, name, base_bike_id, parts_json, notes, total_estimate_lkr, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        user.id,
        name,
        body.base_bike_id || null,
        JSON.stringify(enriched),
        String(body.notes || '').slice(0, 1000),
        enriched.length ? estimate : null,
        now,
        now
      );
      return sendJson(res, 201, {
        id,
        message: hasUnverified
          ? 'Build saved. Some components have no verified price, so the estimate excludes them.'
          : 'Build saved with verified component prices.',
        estimate_lkr: estimate,
        includes_unverified_parts: hasUnverified
      }), true;
    }

    const buildMatch = pathname.match(/^\/api\/catalog\/builds\/([^/]+)$/);
    if (buildMatch && req.method === 'DELETE') {
      const user = getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'UNAUTHENTICATED' }), true;
      db.prepare('DELETE FROM saved_bike_builds WHERE id = ? AND user_id = ?').run(decodeURIComponent(buildMatch[1]), user.id);
      return sendJson(res, 200, { message: 'Build removed.' }), true;
    }

    /* ---------------------------- retailer directory ------------------------ */
    if (pathname === '/api/catalog/retailers' && req.method === 'GET') {
      const rows = db.prepare('SELECT * FROM part_retailers ORDER BY name ASC').all();
      return sendJson(res, 200, {
        retailers: rows,
        note: 'Retailer records are administrator-verified contacts. RideRise LK does not scrape retailer sites and does not guarantee stock or pricing.'
      }), true;
    }

    /* ---------------------------- admin catalogue --------------------------- */
    if (pathname.startsWith('/api/admin/catalog')) {
      const user = getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'UNAUTHENTICATED' }), true;
      if (user.role !== 'admin') return sendJson(res, 403, { error: 'FORBIDDEN', message: 'Catalogue edits require a studio administrator.' }), true;

      if (pathname === '/api/admin/catalog/parts' && req.method === 'GET') {
        const parts = db.prepare('SELECT * FROM parts_catalog ORDER BY brand ASC, name ASC').all().map((p) => partRow(p, null));
        return sendJson(res, 200, { parts }), true;
      }

      if (pathname === '/api/admin/catalog/parts' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const id = body.id || newId('prt');
        const existing = body.id ? db.prepare('SELECT * FROM parts_catalog WHERE id = ?').get(body.id) : null;
        const name = String(body.name || (existing && existing.name) || '').trim();
        if (name.length < 2) return sendJson(res, 400, { error: 'NAME_REQUIRED' }), true;
        const priceVerified = body.price_verified === true;
        const price = priceVerified ? Number(body.price_lkr) : null;
        if (priceVerified && (!Number.isFinite(price) || price < 0)) {
          return sendJson(res, 400, { error: 'INVALID_PRICE', message: 'Enter the verified LKR price or mark the price unverified.' }), true;
        }
        const values = [
          name,
          String(body.brand || (existing && existing.brand) || '').trim(),
          String(body.manufacturer || (existing && existing.manufacturer) || body.brand || ''),
          String(body.model || (existing && existing.model) || ''),
          String(body.category || (existing && existing.category) || 'pegs_accessories'),
          String(body.compatible_bike_types || (existing && existing.compatible_bike_types) || 'BMX'),
          String(body.description || (existing && existing.description) || ''),
          String(body.image_url || (existing && existing.image_url) || ''),
          price,
          priceVerified ? 1 : 0,
          String(body.retailer_name || (existing && existing.retailer_name) || ''),
          String(body.source_contact || (existing && existing.source_contact) || ''),
          String(body.availability || (existing && existing.availability) || 'Unverified — Contact Retailer'),
          String(body.compatibility_warning || (existing && existing.compatibility_warning) || 'Check compatibility before ordering.'),
          priceVerified ? nowIso().slice(0, 10) : null,
          JSON.stringify(body.spec || (existing ? parseJson(existing.spec_json, {}) : {})),
          body.weight_g === undefined ? (existing ? existing.weight_g : null) : Number(body.weight_g) || null,
          String(body.data_source_label || (existing && existing.data_source_label) || 'Administrator-maintained record'),
          nowIso()
        ];
        if (existing) {
          db.prepare(
            `UPDATE parts_catalog SET name = ?, brand = ?, manufacturer = ?, model = ?, category = ?, compatible_bike_types = ?,
               description = ?, image_url = ?, price_lkr = ?, price_verified = ?, retailer_name = ?, source_contact = ?,
               availability = ?, compatibility_warning = ?, last_verified_date = ?, spec_json = ?, weight_g = ?,
               data_source_label = ?, data_updated_at = ?, updated_by_admin_id = ? WHERE id = ?`
          ).run(...values, user.id, id);
        } else {
          db.prepare(
            `INSERT INTO parts_catalog (id, name, brand, manufacturer, model, category, compatible_bike_types, description,
               image_url, price_lkr, price_verified, retailer_name, source_contact, availability, compatibility_warning,
               last_verified_date, spec_json, weight_g, data_source_label, data_updated_at, updated_by_admin_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(id, ...values, user.id);
        }
        if (priceVerified && price !== null) {
          db.prepare(
            'INSERT INTO part_price_history (id, part_id, price_lkr, source_label, recorded_at, recorded_by, note) VALUES (?, ?, ?, ?, ?, ?, ?)'
          ).run(newId('pph'), id, price, String(body.source_label || 'Administrator verification'), nowIso(), user.id, String(body.note || '').slice(0, 300));
        }
        auditAdmin(user.id, existing ? 'catalog_part_updated' : 'catalog_part_created', 'part', id, name, { price_verified: priceVerified });
        return sendJson(res, 200, { id, message: `Catalogue entry ${existing ? 'updated' : 'created'}.` }), true;
      }

      const partAdminMatch = pathname.match(/^\/api\/admin\/catalog\/parts\/([^/]+)\/(price|unlist|relist|retailer)$/);
      if (partAdminMatch && req.method === 'POST') {
        const partId = decodeURIComponent(partAdminMatch[1]);
        const action = partAdminMatch[2];
        const part = db.prepare('SELECT * FROM parts_catalog WHERE id = ?').get(partId);
        if (!part) return sendJson(res, 404, { error: 'PART_NOT_FOUND' }), true;
        const body = await readJsonBody(req);
        if (action === 'price') {
          const price = Number(body.price_lkr);
          if (!Number.isFinite(price) || price < 0) return sendJson(res, 400, { error: 'INVALID_PRICE' }), true;
          db.prepare('UPDATE parts_catalog SET price_lkr = ?, price_verified = 1, last_verified_date = ?, data_updated_at = ?, availability = ?, updated_by_admin_id = ? WHERE id = ?').run(
            price,
            nowIso().slice(0, 10),
            nowIso(),
            String(body.availability || part.availability),
            user.id,
            partId
          );
          db.prepare(
            'INSERT INTO part_price_history (id, part_id, price_lkr, source_label, recorded_at, recorded_by, note) VALUES (?, ?, ?, ?, ?, ?, ?)'
          ).run(newId('pph'), partId, price, String(body.source_label || 'Administrator verification'), nowIso(), user.id, String(body.note || '').slice(0, 300));
          auditAdmin(user.id, 'catalog_price_verified', 'part', partId, part.name, { price_lkr: price });
          return sendJson(res, 200, { message: 'Price recorded with a verification date.', last_verified_date: nowIso().slice(0, 10) }), true;
        }
        if (action === 'unlist' || action === 'relist') {
          const listed = action === 'relist' ? 1 : 0;
          db.prepare('UPDATE parts_catalog SET is_listed = ?, data_updated_at = ?, updated_by_admin_id = ? WHERE id = ?').run(
            listed,
            nowIso(),
            user.id,
            partId
          );
          auditAdmin(user.id, action === 'unlist' ? 'catalog_part_unlisted' : 'catalog_part_relisted', 'part', partId, part.name, {});
          return sendJson(res, 200, { is_listed: Boolean(listed), message: `Entry ${listed ? 'relisted' : 'removed from public listing'}.` }), true;
        }
        if (action === 'retailer') {
          let retailerId = body.retailer_id;
          if (!retailerId) {
            const name = String(body.name || '').trim();
            if (name.length < 2) return sendJson(res, 400, { error: 'RETAILER_NAME_REQUIRED' }), true;
            retailerId = newId('rtl');
            db.prepare(
              'INSERT INTO part_retailers (id, name, url, phone, district, verification_note, verified_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
            ).run(
              retailerId,
              name,
              String(body.url || ''),
              String(body.phone || ''),
              String(body.district || ''),
              String(body.verification_note || ''),
              nowIso(),
              nowIso()
            );
          }
          db.prepare(
            `INSERT INTO part_retailer_links (part_id, retailer_id, product_url, last_checked_at, is_primary)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(part_id, retailer_id) DO UPDATE SET product_url = excluded.product_url, last_checked_at = excluded.last_checked_at`
          ).run(partId, retailerId, String(body.product_url || ''), nowIso(), body.is_primary ? 1 : 0);
          auditAdmin(user.id, 'catalog_retailer_linked', 'part', partId, part.name, { retailer_id: retailerId });
          return sendJson(res, 200, { retailer_id: retailerId, message: 'Retailer link saved.' }), true;
        }
      }
    }

    return false;
  };
};
