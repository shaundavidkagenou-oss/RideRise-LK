#!/usr/bin/env node
'use strict';
// RideRise LK — proves a hosted address is really this app's server before we compile it
// into the Android build.
//
//   npm run verify:server -- --url https://api.riderise.lk
//   npm run verify:server -- --url https://api.riderise.lk --bake   (verify, then compile it in)
//
// Why this exists: `configure:apk` can only check that an address *looks* right. A panel URL,
// a parking page, a server with no Firebase credentials or a host that is down all look like
// a perfectly valid https:// link. Baking one of those in produces an app that opens on a
// sign-in screen that can never work — exactly the failure we are trying to remove. So we
// call the real server and check the six things the first launch depends on:
//
//   1. address    bare https://host[:port], not the hosting control panel
//   2. tls        certificate trusted by Android, not close to expiry
//   3. health     /api/health answers with THIS app's JSON, not a placeholder page
//   4. cors       a preflight from https://appassets.androidplatform.net (the APK's origin) is allowed
//   5. accounts   Firebase sign-in is configured here and the server can reach Google
//   6. webapp     / serves the bundled UI, so the same address can be checked in a phone browser
//
// Exit code 0 = ready to bake, 1 = not ready, 2 = bad arguments.

const tls = require('node:tls');
const path = require('node:path');
const fs = require('node:fs');

const { normaliseApiBase, readConfig, writeConfig } = require('./configure_apk.js');

const APP_ORIGIN = 'https://appassets.androidplatform.net';
const BRAND = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'brand.config.json'), 'utf8'));
  } catch {
    return { appName: 'RideRise LK', studioName: 'Shaun David Studios' };
  }
})();

/** Hosts that are never the API, with the sentence we want the operator to read. */
const NOT_THE_API = [
  {
    test: (host) => host === 'panel.enzonic.com' || host === 'cloud.enzonic.com' || host === 'enzonic.com',
    why: 'this is the hosting company\u2019s control panel / website, not your server. The page you use to press Start is not an API.'
  },
  {
    test: (host) => /^panel\./.test(host),
    why: 'this looks like a control panel. The panel manages the server; the app needs the address of the server itself.'
  },
  {
    test: (host) => /^127\.|^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(host) || host === 'localhost',
    why: 'this address only exists on your own computer/network.'
  }
];

function looksLikePanel(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (parsed.pathname && parsed.pathname.includes('/server/')) {
      return 'the address still contains /server/... \u2014 that is the panel page for one server. Use the server\u2019s own hostname.';
    }
    for (const rule of NOT_THE_API) {
      if (rule.test(host)) return rule.why;
    }
    return null;
  } catch {
    return null;
  }
}

/** Read the certificate the way Android will: trusted chain, real hostname, not expiring. */
function defaultTlsProbe(url, timeoutMs = 15000) {
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      resolve({ ok: false, error: 'INVALID_URL' });
      return;
    }
    const port = Number(parsed.port || 443);
    const socket = tls.connect(
      { host: parsed.hostname, port, servername: parsed.hostname, timeout: timeoutMs, ALPNProtocols: ['http/1.1'] },
      () => {
        const cert = socket.getPeerCertificate();
        const authorized = socket.authorized;
        socket.end();
        if (!cert || !cert.valid_to) {
          resolve({ ok: false, error: 'NO_CERTIFICATE' });
          return;
        }
        const expiresAt = new Date(cert.valid_to);
        const daysLeft = Math.floor((expiresAt.getTime() - Date.now()) / 86400000);
        resolve({
          ok: Boolean(authorized),
          authorized,
          authorizationError: authorized ? null : socket.authorizationError || 'CERT_NOT_TRUSTED',
          validTo: expiresAt.toISOString(),
          daysLeft,
          issuer: (cert.issuer && (cert.issuer.O || cert.issuer.CN)) || null,
          subject: cert.subject ? cert.subject.CN : null,
          protocol: socket.getProtocol ? socket.getProtocol() : null
        });
      }
    );
    socket.on('error', (err) => resolve({ ok: false, error: err.code || err.message }));
    socket.on('timeout', () => {
      socket.destroy();
      resolve({ ok: false, error: 'TIMEOUT' });
    });
  });
}

function headerValue(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : null;
}

function originAllowed(allowOrigin, origin) {
  if (!allowOrigin) return false;
  const value = String(allowOrigin).trim();
  if (value === '*') return true;
  return value.split(',').map((part) => part.trim()).includes(origin);
}

function headerListAllows(list, wanted) {
  if (!list) return false;
  const value = String(list).toLowerCase();
  if (value.trim() === '*') return true;
  const parts = value.split(',').map((part) => part.trim());
  return wanted.every((name) => parts.includes(name.toLowerCase()));
}

function result(id, label, status, detail) {
  return { id, label, status, detail };
}

/**
 * Run every check. Fetch and the TLS probe are injectable so the test suite can exercise this
 * without any network access.
 */
async function verifyServer({
  url,
  fetchImpl = globalThis.fetch,
  tlsProbe = defaultTlsProbe,
  timeoutMs = 15000,
  allowHttp = false
} = {}) {
  const checks = [];
  const add = (id, label, status, detail) => checks.push(result(id, label, status, detail));

  // 1. address ---------------------------------------------------------------
  const normalised = normaliseApiBase(url, { allowHttp });
  if (!normalised.ok) {
    add('address', 'Address', 'fail', normalised.message || normalised.reason);
    return { ok: false, url: '', base: '', checks, health: null };
  }
  const base = normalised.url;
  const panelReason = looksLikePanel(base);
  if (panelReason) {
    add('address', 'Address', 'fail', `That is not the API: ${panelReason}`);
    return { ok: false, url: base, base, checks, health: null };
  }
  add('address', 'Address', 'pass', `${base} (HTTPS, bare host)`);
  if (normalised.insecure) {
    add('address-https', 'HTTPS', 'warn', 'http:// was accepted because of --allow-http. The APK blocks cleartext, so riders will not be able to connect.');
  }

  // 2. TLS -------------------------------------------------------------------
  const cert = await tlsProbe(base, timeoutMs);
  if (cert.ok) {
    const days = typeof cert.daysLeft === 'number' ? cert.daysLeft : null;
    const detail = [
      cert.issuer ? `issued by ${cert.issuer}` : 'certificate trusted',
      cert.validTo ? `valid until ${cert.validTo.slice(0, 10)}` : null,
      days !== null ? `${days} days left` : null
    ].filter(Boolean).join(' \u00b7 ');
    add('tls', 'Certificate', days !== null && days < 14 ? 'warn' : 'pass',
      days !== null && days < 14 ? `${detail} \u2014 renew soon or riders will be locked out` : detail);
  } else {
    add('tls', 'Certificate', 'fail',
      `The certificate could not be verified (${cert.error || cert.authorizationError || 'unknown error'}). Android refuses an untrusted certificate, so the app would show a connection error. ` +
      'Use the hostname on the certificate (not the raw IP) and make sure the certificate is a real one (Let\u2019s Encrypt / Cloudflare), not self-signed. If you are on an office/school network, a proxy may be intercepting TLS \u2014 try another network, or test from the phone.');
  }

  // 3. health ----------------------------------------------------------------
  let health = null;
  const healthUrl = `${base}/api/health`;
  try {
    const res = await fetchImpl(healthUrl, {
      headers: { accept: 'application/json', 'user-agent': 'RideRise-LK-verify/1.0' },
      signal: AbortSignal.timeout(timeoutMs)
    });
    const contentType = headerValue(res.headers, 'content-type') || '';
    const body = await res.text();
    if (res.status !== 200) {
      add('health', 'Server health', 'fail',
        `${healthUrl} answered HTTP ${res.status}. If this is a 502/503 the Node process is not running or is not on the panel's allocated port.`);
    } else if (!contentType.includes('json')) {
      add('health', 'Server health', 'fail',
        `${healthUrl} returned ${contentType || 'no content type'}, not JSON. That address is serving a web page (parking page, panel or proxy error), not the API.`);
    } else {
      try {
        health = JSON.parse(body);
      } catch {
        health = null;
      }
      if (!health) {
        add('health', 'Server health', 'fail', `${healthUrl} returned JSON that could not be parsed.`);
      } else if (health.status !== 'ok' || !String(health.app || '').includes(BRAND.appName)) {
        add('health', 'Server health', 'fail',
          `The server at ${base} is not RideRise LK (it calls itself ${JSON.stringify(health.app || health.status || 'unknown')}). Check you pointed the domain at the right server.`);
      } else {
        add('health', 'Server health', 'pass', `${health.app} \u00b7 phase ${health.phase} \u00b7 ${health.packageId || 'no package id'}`);
      }
    }
  } catch (err) {
    const code = err && (err.name === 'TimeoutError' ? 'TIMEOUT' : err.cause && err.cause.code);
    add('health', 'Server health', 'fail',
      `Could not reach ${healthUrl} (${code || err.message}). Either the service is stopped, the domain does not point at it, or the port is blocked.`);
  }

  // 4. CORS from the APK's origin -------------------------------------------
  if (health) {
    try {
      const res = await fetchImpl(healthUrl, {
        method: 'OPTIONS',
        headers: {
          origin: APP_ORIGIN,
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'authorization,content-type',
          'user-agent': 'RideRise-LK-verify/1.0'
        },
        signal: AbortSignal.timeout(timeoutMs)
      });
      const allowOrigin = headerValue(res.headers, 'access-control-allow-origin');
      const allowHeaders = headerValue(res.headers, 'access-control-allow-headers');
      if (!allowOrigin || !originAllowed(allowOrigin, APP_ORIGIN)) {
        add('cors', 'App origin allowed', 'fail',
          `The server did not allow ${APP_ORIGIN} (Access-Control-Allow-Origin: ${allowOrigin || 'missing'}). A proxy is probably stripping CORS headers \u2014 the app's own requests would be blocked.`);
      } else if (!headerListAllows(allowHeaders, ['authorization', 'content-type'])) {
        add('cors', 'App origin allowed', 'warn',
          `CORS allows the app origin but not both Authorization and Content-Type headers (got ${JSON.stringify(allowHeaders)}).`);
      } else {
        add('cors', 'App origin allowed', 'pass', `${APP_ORIGIN} \u2192 ${allowOrigin}`);
      }
    } catch (err) {
      add('cors', 'App origin allowed', 'fail', `Preflight request failed (${err.message}).`);
    }
  } else {
    add('cors', 'App origin allowed', 'skip', 'skipped \u2014 the health check has to pass first');
  }

  // 5. Firebase accounts -----------------------------------------------------
  if (health && health.capabilities) {
    const caps = health.capabilities;
    if (!caps.firebaseAuth) {
      add('accounts', 'Accounts', 'fail',
        'The server has no Firebase credentials, so nobody can register or sign in on it. Set FIREBASE_PROJECT_ID and FIREBASE_API_KEY in .env on the server and restart.');
    } else if (caps.firebaseVerifier === 'unreachable') {
      add('accounts', 'Accounts', 'warn',
        'Firebase is configured but the server cannot reach Google to verify ID tokens. Sign-in will fail with a "server cannot reach Google" banner \u2014 allow outbound HTTPS on the server.');
    } else {
      add('accounts', 'Accounts', 'pass',
        `email/password enabled \u00b7 token verifier ${caps.firebaseVerifier || 'unknown'}${caps.push ? ' \u00b7 push configured' : ''}`);
    }
  } else if (health) {
    add('accounts', 'Accounts', 'fail', 'The health response has no capabilities block \u2014 that is not a RideRise LK server.');
  } else {
    add('accounts', 'Accounts', 'skip', 'skipped \u2014 the health check has to pass first');
  }

  // 6. Bundled web app -------------------------------------------------------
  if (health) {
    try {
      const res = await fetchImpl(`${base}/`, { headers: { 'user-agent': 'RideRise-LK-verify/1.0' }, signal: AbortSignal.timeout(timeoutMs) });
      const body = await res.text();
      if (res.status === 200 && body.includes('<title>RideRise LK')) {
        add('webapp', 'Web app', 'pass', `${base}/ serves the app in a browser (handy for a phone sanity check)`);
      } else {
        add('webapp', 'Web app', 'warn',
          `${base}/ did not serve the bundled UI (HTTP ${res.status}). The API still works, but upload the web_app/ folder to check the app in a phone browser.`);
      }
    } catch (err) {
      add('webapp', 'Web app', 'warn', `Could not load ${base}/ (${err.message}).`);
    }
  } else {
    add('webapp', 'Web app', 'skip', 'skipped \u2014 the health check has to pass first');
  }

  const ok = !checks.some((check) => check.status === 'fail');
  return { ok, url: base, base, checks, health, insecure: Boolean(normalised.insecure) };
}

const ICON = { pass: '\u2714', warn: '\u26a0', fail: '\u2716', skip: '\u2022' };

function printReport(report, { currentConfig } = {}) {
  console.log(`\nRideRise LK \u2014 server readiness check\n`);
  for (const check of report.checks) {
    console.log(`  ${ICON[check.status] || '\u2022'} ${check.label}: ${check.detail}`);
  }

  if (report.checks.some((c) => c.id === 'address' && c.status === 'fail')) {
    console.log('\nWhere to find the right address: docs/DEPLOY_AND_BAKE.md \u00a71.\n');
    return;
  }

  if (!report.ok) {
    console.log('\n\u2716 Not ready to compile into the app. Fix the items marked \u2716, then run this again.');
    console.log('  The app would install and open, but riders would land on a screen that cannot connect.\n');
    return;
  }

  console.log(`\n\u2714 Ready. ${report.url} is a working RideRise LK server.`);
  if (report.insecure) {
    console.log('  \u26a0 It is http://, which the app blocks. Only use --allow-http behind a proxy you control.');
  }
  if (currentConfig && currentConfig === report.url) {
    console.log(`  Already compiled in: ${currentConfig}. Rebuild only if the APK predates it: npm run apk`);
  }
  console.log('\nNext steps:');
  console.log(`  npm run configure:apk -- --url ${report.url}    # writes config/deployment.config.json`);
  console.log('  npm run apk                                              # rebuilds the signed APKs');
  console.log('  Firebase \u2192 Authentication \u2192 Settings \u2192 Authorized domains must list');
  console.log('    appassets.androidplatform.net');
  console.log('');
}

function usage() {
  console.log(`
RideRise LK \u2014 is this address ready to be built into the app?

  npm run verify:server -- --url https://api.yourdomain.lk
  npm run verify:server -- --url https://api.yourdomain.lk --bake    also compile it in

Options
  --url <address>     the address to test (required)
  --bake              write it to config/deployment.config.json when every check passes
  --timeout <ms>      per-request timeout, default 15000
  --json              machine-readable output
  --allow-http        test an http:// address as well (the APK will still block it)
`);
}

async function main(argv) {
  const args = argv.slice(2);
  const getFlag = (name) => {
    const i = args.indexOf(name);
    return i === -1 ? null : args[i + 1];
  };
  const has = (name) => args.includes(name);

  if (has('--help') || has('-h') || args.length === 0) {
    usage();
    return 0;
  }

  const url = getFlag('--url');
  if (!url) {
    console.error('Missing --url. Run with --help to see the options.');
    return 2;
  }
  const timeoutMs = Number(getFlag('--timeout') || 15000);
  const currentConfig = readConfig().apiBaseUrl;

  const report = await verifyServer({ url, timeoutMs, allowHttp: has('--allow-http') });

  if (has('--json')) {
    console.log(JSON.stringify({ ...report, currentConfig }, null, 2));
  } else {
    printReport(report, { currentConfig });
  }

  if (has('--bake') && report.ok) {
    writeConfig(report.url);
    if (!has('--json')) console.log(`Built-in server written to config/deployment.config.json: ${report.url}\n`);
  }

  return report.ok ? 0 : 1;
}

module.exports = { verifyServer, defaultTlsProbe, looksLikePanel, originAllowed, headerListAllows, APP_ORIGIN };

if (require.main === module) {
  main(process.argv).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      console.error(`Verification crashed: ${err && err.stack ? err.stack : err}`);
      process.exitCode = 1;
    }
  );
}
