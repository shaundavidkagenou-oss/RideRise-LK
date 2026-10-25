// RideRise LK — the server address compiled into the Android app.
//
// These are static/unit checks (no Android SDK here): they prove that whatever address the
// studio configures is validated, injected into the string resource the shell reads, and
// cannot produce an APK that silently asks every rider for an HTTPS URL.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// APK-8 boots the real web app against a real server, so it needs a throwaway database.
// (This file runs in its own process; no other suite is affected.)
process.env.DB_PATH = `/tmp/riderise_apkconfig_${Date.now()}.sqlite`;
process.env.JWT_SECRET = 'apk-deployment-test-secret';

const { normaliseApiBase } = require('../scripts/configure_apk.js');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

/* ------------------------------------------------------------- validation ---- */

test('APK-1 — only a bare HTTPS address is accepted as the built-in server', () => {
  const ok = normaliseApiBase('https://api.riderise.lk');
  assert.equal(ok.ok, true);
  assert.equal(ok.url, 'https://api.riderise.lk');

  // Trailing slash, whitespace and an explicit port are normalised, not rejected.
  assert.equal(normaliseApiBase('  https://api.riderise.lk/  ').url, 'https://api.riderise.lk');
  assert.equal(normaliseApiBase('https://api.riderise.lk:8443').url, 'https://api.riderise.lk:8443');

  // Plain HTTP is refused: the app blocks cleartext and runs on a virtual HTTPS origin.
  const http = normaliseApiBase('http://api.riderise.lk');
  assert.equal(http.ok, false);
  assert.equal(http.reason, 'NOT_HTTPS');

  // A sub-path or query would break every /api call.
  assert.equal(normaliseApiBase('https://api.riderise.lk/riderise').reason, 'HAS_PATH');
  assert.equal(normaliseApiBase('https://api.riderise.lk/?x=1').reason, 'HAS_QUERY');
  assert.equal(normaliseApiBase('ftp://api.riderise.lk').ok, false);
  assert.equal(normaliseApiBase('').reason, 'EMPTY');
  assert.equal(normaliseApiBase('not a url').reason, 'INVALID_URL');
});

test('APK-2 — addresses a phone can never reach are rejected', () => {
  for (const host of ['https://localhost:3000', 'https://127.0.0.1:3000', 'https://192.168.1.5:3000', 'https://10.0.0.4', 'https://172.20.1.2', 'https://riderise.local']) {
    const res = normaliseApiBase(host);
    assert.equal(res.ok, false, `${host} must be refused`);
    assert.ok(
      ['UNREACHABLE_HOST', 'NO_HOST'].includes(res.reason),
      `${host} should report an unreachable host, got ${res.reason}`
    );
    assert.match(res.message, /cannot be reached|not a public host/, `${host} needs a message a human can act on`);
  }
  // A public tunnel host is fine — that is how you test on a phone before DNS exists.
  assert.equal(normaliseApiBase('https://random-words.trycloudflare.com').ok, true);
});

/* ------------------------------------------------------------- injection ---- */

test('APK-3 — the injector writes default_api_base and refuses a non-HTTPS value', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-inject-'));
  const res = path.join(tmp, 'res');
  fs.mkdirSync(path.join(res, 'values'), { recursive: true });

  // Empty config: the resource still exists (R.string.default_api_base must always compile).
  let out = execFileSync('python3', [path.join(ROOT, 'scripts', 'inject_api_base.py'), ROOT, res], { encoding: 'utf8' });
  assert.match(out, /none/);
  let xml = fs.readFileSync(path.join(res, 'values', 'deployment.xml'), 'utf8');
  assert.match(xml, /<string name="default_api_base"><\/string>/);

  // Configured address lands verbatim in the resource.
  const cfgPath = path.join(ROOT, 'config', 'deployment.config.json');
  const original = fs.readFileSync(cfgPath, 'utf8');
  try {
    fs.writeFileSync(cfgPath, JSON.stringify({ apiBaseUrl: 'https://api.riderise.lk/' }));
    out = execFileSync('python3', [path.join(ROOT, 'scripts', 'inject_api_base.py'), ROOT, res], { encoding: 'utf8' });
    assert.match(out, /https:\/\/api\.riderise\.lk/);
    xml = fs.readFileSync(path.join(res, 'values', 'deployment.xml'), 'utf8');
    assert.match(xml, /<string name="default_api_base">https:\/\/api\.riderise\.lk<\/string>/);

    // The build must fail loudly rather than ship an app that cannot connect.
    fs.writeFileSync(cfgPath, JSON.stringify({ apiBaseUrl: 'http://api.riderise.lk' }));
    assert.throws(
      () => execFileSync('python3', [path.join(ROOT, 'scripts', 'inject_api_base.py'), ROOT, res], { encoding: 'utf8', stdio: 'pipe' }),
      /https/
    );
  } finally {
    fs.writeFileSync(cfgPath, original);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('APK-4 — both build pipelines inject the same resource', () => {
  const sh = read('scripts', 'build_apk.sh');
  assert.match(sh, /scripts\/inject_api_base\.py/, 'the SDK-free pipeline must inject the address');
  assert.match(sh, /"\$AAPT2" compile --dir "\$RES_SRC"/, 'aapt2 must compile the prepared resource directory');
  assert.match(sh, /cp -R "\$ROOT\/android\/res" "\$RES_SRC"/, 'the prepared directory is a copy of the real resources');

  const gradle = read('android', 'app', 'build.gradle.kts');
  assert.match(gradle, /config\/deployment\.config\.json/, 'Gradle reads the same config file');
  assert.match(gradle, /resValue\("string", "default_api_base", builtInApiBase\)/);
  assert.match(gradle, /must start with https:\/\//, 'Gradle refuses a cleartext address too');
});

/* ------------------------------------------------------------ the shell ---- */

test('APK-5 — the shell prefers a saved address, then the built-in one, and can reset', () => {
  const java = read('android', 'app', 'src', 'main', 'java', 'lk', 'shaunstudios', 'riderise', 'MainActivity.java');

  // getApiBase(): saved preference first, built-in address as the fallback.
  assert.match(java, /public String getApiBase\(\)/, 'the bridge must expose getApiBase');
  assert.match(java, /if \(saved != null && saved\.trim\(\)\.length\(\) > 0\) return saved\.trim\(\);/, 'a rider override wins');
  assert.match(java, /return builtInApiBase\(\);/, 'the built-in address is the fallback');
  assert.match(java, /getString\(R\.string\.default_api_base\)/, 'the fallback reads the injected resource');

  // Settings needs both the built-in value and a way back to it.
  assert.match(java, /public String getDefaultApiBase\(\)/);
  assert.match(java, /public void resetApiBase\(\)/);
  assert.match(java, /remove\(KEY_API_BASE\)/, 'reset clears the override');
});

test('APK-6 — the web layer uses the built-in address and only asks when there is none', () => {
  const api = read('web_app', 'api.js');
  assert.match(api, /getDefaultApiBase/, 'the UI reads the compiled-in address');
  assert.match(api, /apiBaseBuiltIn/, 'the current value is exposed to the screens');

  // A built-in address means state.apiBase is non-empty, so the setup screen is skipped.
  const app = read('web_app', 'app.js');
  assert.match(app, /RR\.isAndroidShell\(\) && !state\.apiBase/, 'the setup screen only appears with no address at all');

  // Settings explains the built-in server and offers a one-tap reset.
  const profile = read('web_app', 'views_profile.js');
  assert.match(profile, /Use the built-in server/);
  assert.match(profile, /resetApiBase/);
});

test('APK-7 — the shipped config is empty until the studio sets a server', () => {
  const cfg = JSON.parse(read('config', 'deployment.config.json'));
  assert.equal(typeof cfg.apiBaseUrl, 'string');
  if (cfg.apiBaseUrl) {
    const res = normaliseApiBase(cfg.apiBaseUrl);
    assert.equal(res.ok, true, `config/deployment.config.json has an unusable address: ${res.message || res.reason}`);
  }
});

/* --------------------------------------------------- the finished APK ---- */

test('APK-8 — with a built-in server the app opens on sign-in, not a setup screen', async () => {
  const { JSDOM, VirtualConsole } = require('jsdom');
  const { server, db } = require('../backend/server.js');
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const builtIn = 'https://api.riderise.lk';

  const calls = [];
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (err) => {
    if (!/Could not parse CSS|Not implemented|Could not load img/.test(err.message)) errors.push(err.message);
  });

  let dom;
  try {
    dom = await JSDOM.fromURL(`${origin}/`, {
      runScripts: 'dangerously',
      resources: 'usable',
      pretendToBeVisual: true,
      virtualConsole,
      beforeParse(window) {
        // Exactly what MainActivity's NativeBridge exposes in a build with a server address.
        window.RRAndroid = {
          getApiBase: () => builtIn,
          getDefaultApiBase: () => builtIn,
          setApiBase: () => {},
          resetApiBase: () => {},
          shareText: () => {},
          requestNotificationPermission: () => {}
        };
        // Network calls are recorded, then served by the local test server (the phone would
        // reach the real https://api.riderise.lk instead).
        window.fetch = (input, init) => {
          const target = new URL(input, origin).toString();
          calls.push(target);
          const rewritten = target.replace(builtIn, origin);
          return fetch(rewritten, init);
        };
        window.AbortController = AbortController;
        window.scrollTo = () => {};
        window.HTMLElement.prototype.scrollIntoView = () => {};
        window.HTMLMediaElement.prototype.play = () => Promise.resolve();
      }
    });

    const { window, document } = dom.window;
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    for (let i = 0; i < 150 && !document.querySelector('.welcome-title'); i += 1) await wait(100);

    // A rider who installs this build lands on the sign-in screen immediately.
    assert.ok(document.querySelector('.welcome-title'), 'the welcome screen must render');
    assert.ok(document.getElementById('signInForm'), 'the email sign-in form must render');
    assert.doesNotMatch(document.body.textContent, /Connect your ride server/, 'no server setup screen');
    assert.ok(!document.getElementById('setupApiBase'), 'no API-base field is shown to a rider');

    // Every API call went to the address compiled into the app.
    const apiCalls = calls.filter((c) => c.includes('/api/'));
    assert.ok(apiCalls.length > 0, 'the app must call the API');
    for (const call of apiCalls) {
      assert.ok(call.startsWith(builtIn), `API call did not use the built-in server: ${call}`);
    }
    assert.equal(errors.length, 0, errors.join(' | '));
  } finally {
    if (dom) dom.window.close();
    await new Promise((resolve) => server.close(resolve));
    try {
      db.close();
    } catch {
      /* already closed */
    }
  }
});

/* ------------------------------------------------- server readiness check ---- */
// `npm run verify:server` is the gate between "I have a hosting panel" and "I baked an address
// into the APK". A panel URL, a parking page or a server without Firebase credentials all look
// like valid https:// links, so the command has to call the server and judge the answer.

const { verifyServer } = require('../scripts/verify_server.js');

const HEALTHY_HEALTH = {
  status: 'ok',
  app: 'RideRise LK',
  studio: 'Shaun David Studios',
  packageId: 'lk.shaunstudios.riderise',
  phase: 2,
  capabilities: { firebaseAuth: true, firebaseVerifier: 'ok', push: false, emailPasswordSignIn: true }
};

function fakeResponse({ status = 200, headers = {}, body = '' } = {}) {
  const store = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => store.get(String(name).toLowerCase()) ?? null },
    text: async () => text
  };
}

/** A fetch that answers like a correct RideRise server, with per-call overrides. */
function healthyFetch(overrides = {}) {
  return async (url) => {
    const target = String(url);
    if (overrides[target]) return overrides[target](target);
    if (target.endsWith('/api/health')) {
      return fakeResponse({
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'access-control-allow-origin': '*',
          'access-control-allow-headers': 'Content-Type, Authorization'
        },
        body: HEALTHY_HEALTH
      });
    }
    if (target.endsWith('/')) {
      return fakeResponse({ headers: { 'content-type': 'text/html' }, body: '<title>RideRise LK — By Shaun David Studios</title>' });
    }
    return fakeResponse({ status: 404, headers: { 'content-type': 'application/json' }, body: { error: 'NOT_FOUND' } });
  };
}
const trustedCert = async () => ({ ok: true, authorized: true, daysLeft: 60, validTo: '2030-01-01T00:00:00.000Z', issuer: "Let's Encrypt" });

test('APK-9 — the readiness check refuses anything that is not this app\u2019s server', async () => {
  // (a) The panel address the studio actually has. It is a control panel, never the API.
  const panel = await verifyServer({
    url: 'https://panel.enzonic.com',
    fetchImpl: healthyFetch(),
    tlsProbe: trustedCert
  });
  assert.equal(panel.ok, false);
  assert.match(panel.checks[0].detail, /control panel/i);

  const panelDeepLink = await verifyServer({
    url: 'https://panel.enzonic.com/server/de0c86d1-acd2-473f-9091-97d4a1d97e5f',
    fetchImpl: healthyFetch(),
    tlsProbe: trustedCert
  });
  assert.equal(panelDeepLink.ok, false, 'the /server/<uuid> panel page must never be baked in');

  // (b) A valid URL that serves a web page instead of JSON (parking page, proxy error page).
  const parking = await verifyServer({
    url: 'https://api.example.lk',
    tlsProbe: trustedCert,
    fetchImpl: async () => fakeResponse({ headers: { 'content-type': 'text/html' }, body: '<html>Welcome to nginx!</html>' })
  });
  assert.equal(parking.ok, false);
  assert.match(parking.checks.find((c) => c.id === 'health').detail, /not JSON/);

  // (c) JSON, but somebody else's app (a stray service on the same host).
  const otherApp = await verifyServer({
    url: 'https://api.example.lk',
    tlsProbe: trustedCert,
    fetchImpl: healthyFetch({
      'https://api.example.lk/api/health': () =>
        fakeResponse({ headers: { 'content-type': 'application/json' }, body: { status: 'ok', app: 'Minecraft Panel', phase: 2 } })
    })
  });
  assert.equal(otherApp.ok, false);
  assert.match(otherApp.checks.find((c) => c.id === 'health').detail, /not RideRise LK/);

  // (d) A self-signed certificate: Android refuses it, so the app cannot connect.
  const badCert = await verifyServer({
    url: 'https://api.example.lk',
    fetchImpl: healthyFetch(),
    tlsProbe: async () => ({ ok: false, error: 'DEPTH_ZERO_SELF_SIGNED_CERT' })
  });
  assert.equal(badCert.ok, false);
  assert.match(badCert.checks.find((c) => c.id === 'tls').detail, /certificate could not be verified/i);

  // (e) The Node process is not running behind the proxy.
  const down = await verifyServer({
    url: 'https://api.example.lk',
    tlsProbe: trustedCert,
    fetchImpl: async () => fakeResponse({ status: 502, headers: { 'content-type': 'text/html' }, body: 'Bad Gateway' })
  });
  assert.equal(down.ok, false);
  assert.match(down.checks.find((c) => c.id === 'health').detail, /HTTP 502/);
});

test('APK-10 — the readiness check passes only when a rider could actually sign in', async () => {
  const good = await verifyServer({ url: 'https://api.riderise.lk', fetchImpl: healthyFetch(), tlsProbe: trustedCert });
  assert.equal(good.ok, true, JSON.stringify(good.checks, null, 2));
  assert.equal(good.url, 'https://api.riderise.lk');
  for (const id of ['address', 'tls', 'health', 'cors', 'accounts', 'webapp']) {
    assert.ok(good.checks.some((c) => c.id === id), `missing check ${id}`);
  }

  // A proxy that strips CORS headers blocks every call the APK makes from its own origin.
  const noCors = await verifyServer({
    url: 'https://api.riderise.lk',
    tlsProbe: trustedCert,
    fetchImpl: healthyFetch({
      'https://api.riderise.lk/api/health': (target) =>
        target === 'https://api.riderise.lk/api/health'
          ? fakeResponse({ headers: { 'content-type': 'application/json' }, body: HEALTHY_HEALTH })
          : fakeResponse({ headers: { 'content-type': 'application/json' }, body: {} })
    })
  });
  // Both calls go to the same URL, so this fake removes the header for every response.
  assert.equal(noCors.ok, false);
  assert.match(noCors.checks.find((c) => c.id === 'cors').detail, /did not allow/);

  // A server with no Firebase credentials installs fine and cannot register anybody.
  const noFirebase = await verifyServer({
    url: 'https://api.riderise.lk',
    tlsProbe: trustedCert,
    fetchImpl: healthyFetch({
      'https://api.riderise.lk/api/health': () =>
        fakeResponse({
          headers: {
            'content-type': 'application/json',
            'access-control-allow-origin': '*',
            'access-control-allow-headers': 'Content-Type, Authorization'
          },
          body: { ...HEALTHY_HEALTH, capabilities: { ...HEALTHY_HEALTH.capabilities, firebaseAuth: false } }
        })
    })
  });
  assert.equal(noFirebase.ok, false);
  assert.match(noFirebase.checks.find((c) => c.id === 'accounts').detail, /no Firebase credentials/);

  // Configured, but the server cannot reach Google: a warning, not a hard failure —
  // egress can be fixed later without rebuilding the app.
  const unreachable = await verifyServer({
    url: 'https://api.riderise.lk',
    tlsProbe: trustedCert,
    fetchImpl: healthyFetch({
      'https://api.riderise.lk/api/health': () =>
        fakeResponse({
          headers: {
            'content-type': 'application/json',
            'access-control-allow-origin': '*',
            'access-control-allow-headers': 'Content-Type, Authorization'
          },
          body: { ...HEALTHY_HEALTH, capabilities: { ...HEALTHY_HEALTH.capabilities, firebaseVerifier: 'unreachable' } }
        })
    })
  });
  assert.equal(unreachable.ok, true);
  assert.equal(unreachable.checks.find((c) => c.id === 'accounts').status, 'warn');
});

test('APK-11 — the panel launcher and the deployment guide ship with the repo', () => {
  const start = read('deploy', 'panel', 'start.sh');
  // A panel allocates the port; a hard-coded 3000 would be unreachable.
  assert.match(start, /SERVER_PORT/);
  assert.match(start, /node --env-file-if-exists=\.env backend\/server\.js/);
  assert.match(start, /cloudflared tunnel/);
  // Fails loudly instead of starting an app that cannot open its database.
  assert.match(start, /node:sqlite/);
  // No credentials belong in a committed script.
  assert.doesNotMatch(start, /CLOUDFLARE_TUNNEL_TOKEN=[^\s"']+/);
  assert.doesNotMatch(start, /JWT_SECRET=[^\s"']+/);

  const guide = read('docs', 'DEPLOY_AND_BAKE.md');
  assert.match(guide, /npm run verify:server/);
  assert.match(guide, /npm run configure:apk/);
  assert.match(guide, /panel\.enzonic\.com/);

  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.scripts['verify:server'], 'verify:server must be runnable from npm');
  assert.equal(pkg.engines.node, '>=22.13.0', 'node:sqlite is only flag-free from 22.13');
});

test('APK-12 — the server upload bundle carries the app, never a secret', () => {
  const py = ['scripts/bundle_server.py'];
  const list = execFileSync('python3', [...py, '--list'], { cwd: ROOT, encoding: 'utf8' });
  // Exactly what backend/server.js reads at runtime.
  for (const needed of [
    'backend/server.js',
    'backend/schema.sql',
    'backend/phase2/index.js',
    'backend/firebase_auth.js',
    'config/brand.config.json',
    'web_app/index.html',
    'web_app/app.js',
    'deploy/panel/start.sh',
    'package.json'
  ]) {
    assert.match(list, new RegExp(`\\s${needed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm'), `${needed} must be in the bundle`);
  }
  // Nothing that only matters on a developer machine, and above all nothing secret.
  for (const forbidden of ['.env', 'google-services.json', 'KEYSTORE-CREDENTIALS.txt', '.keystore', '.sqlite', 'tests/api.test.js', 'android/app/build.gradle.kts']) {
    assert.doesNotMatch(list, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${forbidden} must never be uploaded`);
  }

  // And the real archive: small enough for a panel upload, and free of secrets by construction.
  const out = path.join(os.tmpdir(), `riderise-bundle-${Date.now()}.zip`);
  try {
    execFileSync('python3', [...py, '--out', out], { cwd: ROOT, encoding: 'utf8' });
    const size = fs.statSync(out).size;
    assert.ok(size > 500_000, `bundle looks empty (${size} bytes)`);
    assert.ok(size < 15 * 1024 * 1024, `bundle is too big for a panel upload (${size} bytes)`);
    const entries = execFileSync('python3', ['-c', 'import zipfile,sys;print("\\n".join(zipfile.ZipFile(sys.argv[1]).namelist()))', out], { encoding: 'utf8' });
    assert.match(entries, /^backend\/server\.js$/m);
    assert.doesNotMatch(entries, /(^|\/)\.env$|google-services\.json|\.keystore$|\.sqlite$/m);
  } finally {
    fs.rmSync(out, { force: true });
  }
});
