#!/usr/bin/env node
'use strict';
// RideRise LK — sets the server address that is compiled into the Android app.
//
//   npm run configure:apk -- --url https://api.yourdomain.lk
//   npm run configure:apk -- --show
//   npm run configure:apk -- --clear
//
// The value is stored in config/deployment.config.json (committed) and injected at build
// time as the Android string resource `default_api_base`. The shell then reports that address
// through RRAndroid.getApiBase(), so a fresh install goes straight to the welcome screen
// instead of asking for an HTTPS URL.
//
// A rider can still override it in Settings → Server connection (stored in SharedPreferences),
// and reset back to the built-in value there.
//
// Only HTTPS is accepted: the APK sets android:usesCleartextTraffic="false" and serves its
// bundled UI from the virtual origin https://appassets.androidplatform.net, so a plain-HTTP
// API is blocked as mixed content. Accepting http:// here would produce an app that cannot
// connect while claiming to be configured.

const fs = require('node:fs');
const path = require('node:path');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'deployment.config.json');

/** Hosts that can never be reached from another device's phone. */
const UNREACHABLE_HOSTS = [
  { test: (h) => h === 'localhost' || h === '0.0.0.0' || h === '::1' || h === '127.0.0.1', why: 'localhost is the phone itself' },
  { test: (h) => /^10\./.test(h), why: 'a 10.x address is private to your network' },
  { test: (h) => /^192\.168\./.test(h), why: 'a 192.168.x.x address is private to your network' },
  { test: (h) => /^172\.(1[6-9]|2\d|3[01])\./.test(h), why: 'a 172.16–31.x address is private to your network' },
  { test: (h) => /\.local$/.test(h), why: '.local names only resolve on your own network' }
];

/**
 * Validate and normalise a URL for the app.
 * Returns { ok: true, url } or { ok: false, reason }.
 */
function normaliseApiBase(raw, options = {}) {
  const value = String(raw == null ? '' : raw).trim();
  if (!value) return { ok: false, reason: 'EMPTY' };

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, reason: 'INVALID_URL', message: `"${value}" is not a URL. It should look like https://api.yourdomain.lk` };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, reason: 'INVALID_SCHEME', message: 'Use https:// — the app cannot open ftp, ws or other schemes.' };
  }
  if (!parsed.hostname || !parsed.hostname.includes('.')) {
    return { ok: false, reason: 'NO_HOST', message: `"${parsed.hostname || value}" is not a public host name.` };
  }
  if (parsed.search || parsed.hash) {
    return { ok: false, reason: 'HAS_QUERY', message: 'Remove the ?query and #fragment: only the base address is used.' };
  }
  if (parsed.pathname && parsed.pathname !== '/') {
    return {
      ok: false,
      reason: 'HAS_PATH',
      message: `Remove "${parsed.pathname}" — the app calls /api/... on the host root, so the base must be just https://${parsed.host}.`
    };
  }

  const host = parsed.hostname.toLowerCase();
  for (const rule of UNREACHABLE_HOSTS) {
    if (rule.test(host)) {
      return { ok: false, reason: 'UNREACHABLE_HOST', message: `${host} cannot be reached from a rider's phone (${rule.why}).` };
    }
  }

  if (parsed.protocol === 'http:' && !options.allowHttp) {
    return {
      ok: false,
      reason: 'NOT_HTTPS',
      message:
        'The app only talks to HTTPS. Point a domain/proxy at the server (or use a tunnel) and use that https:// address.'
    };
  }

  const url = `${parsed.protocol}//${parsed.host}`;
  return { ok: true, url, insecure: parsed.protocol === 'http:' };
}

function readConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const data = JSON.parse(raw);
    return { apiBaseUrl: typeof data.apiBaseUrl === 'string' ? data.apiBaseUrl : '', raw };
  } catch {
    return { apiBaseUrl: '', raw: null };
  }
}

function writeConfig(url) {
  const data = {
    _comment:
      'Server address compiled into the Android app. Edit it with:  npm run configure:apk -- --url https://api.example.lk   (then npm run apk). Empty string = the app asks the user for a server on first launch.',
    apiBaseUrl: url
  };
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(data, null, 2)}\n`);
}

function usage() {
  console.log(`
RideRise LK — server address for the Android app

  npm run configure:apk -- --url https://api.yourdomain.lk   compile this address into the app
  npm run configure:apk -- --show                            print the current address
  npm run configure:apk -- --clear                           remove it (app asks on first launch)
  npm run configure:apk -- --url <address> --allow-http      accept http:// (only for a proxy
                                                             that terminates HTTPS elsewhere)

After setting it:  npm run apk
`);
}

function main(argv) {
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

  if (has('--show')) {
    const { apiBaseUrl } = readConfig();
    console.log(apiBaseUrl ? `Built-in server: ${apiBaseUrl}` : 'No built-in server: the app asks for one on first launch.');
    return 0;
  }

  if (has('--clear')) {
    writeConfig('');
    console.log('Built-in server removed. The app will show the server setup screen on first launch.');
    return 0;
  }

  const raw = getFlag('--url');
  if (!raw) {
    console.error('Missing --url. Run with --help to see the options.');
    return 2;
  }

  const result = normaliseApiBase(raw, { allowHttp: has('--allow-http') });
  if (!result.ok) {
    console.error(`\n✖ ${result.message || result.reason}\n`);
    if (result.reason === 'NOT_HTTPS') {
      console.error('  For a quick phone test without a domain, tunnel the running server and use the tunnel URL:');
      console.error('    cloudflared tunnel --url http://localhost:3000\n');
    }
    return 1;
  }

  writeConfig(result.url);
  console.log(`\n✔ Built-in server set to ${result.url}`);
  if (result.insecure) {
    console.warn('⚠ http:// was accepted because you passed --allow-http. Most phones will block it as mixed content.');
  }
  console.log('\nNext steps:');
  console.log('  1. npm run apk                     rebuild the signed APKs with this address');
  console.log(`  2. open ${result.url}/api/health   in a browser — it must return JSON`);
  console.log('  3. Firebase → Authentication → Settings → Authorized domains must list');
  console.log('     appassets.androidplatform.net (one-time, for every build)');
  return 0;
}

module.exports = { normaliseApiBase, readConfig, writeConfig, CONFIG_PATH };

if (require.main === module) {
  process.exitCode = main(process.argv);
}
