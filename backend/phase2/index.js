// RideRise LK Phase 2 — router assembly. Applies the additive schema, runs
// migrations and seeds defaults, then dispatches to feature modules.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const core = require('./core');
const { seedPhase2 } = require('./seed2');

const registerLive = require('./live');
const registerVoice = require('./voice');
const registerGuilds2 = require('./guilds2');
const registerSocial2 = require('./social2');
const registerLearning = require('./learning');
const registerCatalog = require('./catalog2');
const registerEvents2 = require('./events2');
const registerAdmin = require('./admin');
const registerAppeals = require('./appeals');

function applySchema(db) {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(sql);
  core.migrate(db);
}

function createRouter(ctx) {
  applySchema(ctx.db);
  seedPhase2(ctx.db);

  const auditAdmin =
    ctx.auditAdmin ||
    ((adminId, action, targetType, targetId, reason, metadata = {}) => {
      ctx.db
        .prepare(
          `INSERT INTO admin_action_log (id, admin_id, action, target_type, target_id, reason, metadata_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(crypto.randomUUID ? crypto.randomUUID() : `aal_${Date.now()}`, adminId, action, targetType, targetId, String(reason || '').slice(0, 1000), JSON.stringify(metadata), new Date().toISOString());
    });

  const enriched = { ...ctx, auditAdmin };
  const handlers = [
    registerAdmin(enriched),
    registerLive(enriched),
    registerVoice(enriched),
    registerGuilds2(enriched),
    registerSocial2(enriched),
    registerLearning(enriched),
    registerCatalog(enriched),
    registerEvents2(enriched),
    registerAppeals(enriched)
  ];

  return async function handle(req, res, pathname, parsedUrl) {
    for (const handler of handlers) {
      const handled = await handler(req, res, pathname, parsedUrl);
      if (handled) return true;
    }
    return false;
  };
}

module.exports = { createRouter, core, applySchema };
