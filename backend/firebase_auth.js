// RideRise LK — Firebase Authentication (email/password) server-side verifier.
//
// The browser gets an ID token from the Firebase client SDK. This module proves that token
// really came from our Firebase project before any RideRise session exists:
//
//   * RS256 signature checked against Google's published secure-token certificates
//   * `iss` must be https://securetoken.google.com/<project id>
//   * `aud` must be the project id
//   * `exp` / `iat` / `auth_time` are validated with a small clock-skew allowance
//   * `sub` (the Firebase UID) must be present
//
// If no project is configured every call fails closed with FIREBASE_NOT_CONFIGURED. There is
// deliberately no built-in project id, key or "development bypass": a server that is not
// configured cannot authenticate anybody.
'use strict';

const crypto = require('node:crypto');

const CERT_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const CLOCK_SKEW_SECONDS = 60;
const DEFAULT_CERT_TTL_MS = 60 * 60 * 1000;
const MAX_TOKEN_BYTES = 8192;

class FirebaseAuthError extends Error {
  constructor(code, message, extra) {
    super(message || code);
    this.name = 'FirebaseAuthError';
    this.code = code;
    Object.assign(this, extra || {});
  }
}

/** Parse `max-age=NNNN` out of a Cache-Control header. */
function parseMaxAge(header) {
  const match = /max-age=(\d+)/i.exec(String(header || ''));
  return match ? Number(match[1]) * 1000 : DEFAULT_CERT_TTL_MS;
}

function decodeSegment(segment) {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
}

function createVerifier({ projectId, certProvider, now = () => Date.now() }) {
  let cache = { certs: null, expiresAt: 0, source: '' };

  async function defaultCertProvider() {
    const res = await fetch(CERT_URL, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new FirebaseAuthError('CERT_FETCH_FAILED', `Secure-token certificates unavailable (HTTP ${res.status}).`);
    const body = await res.json();
    return { certs: body, ttlMs: parseMaxAge(res.headers.get('cache-control')) };
  }

  async function getCert(kid) {
    if (!kid) throw new FirebaseAuthError('TOKEN_MALFORMED', 'The Firebase token has no key id.');
    if (cache.certs && cache.certs[kid] && cache.expiresAt > now()) return cache.certs[kid];
    if (certProvider) {
      const provided = await certProvider(kid);
      if (!provided) throw new FirebaseAuthError('UNKNOWN_KEY', 'The Firebase token was signed with an unknown key.');
      // Test/explicit providers may return a PEM string or a {certs, ttlMs} object.
      if (typeof provided === 'string') return provided;
      cache = { certs: provided.certs, expiresAt: now() + (provided.ttlMs || DEFAULT_CERT_TTL_MS), source: 'injected' };
      const cert = cache.certs[kid];
      if (!cert) throw new FirebaseAuthError('UNKNOWN_KEY', 'The Firebase token was signed with an unknown key.');
      return cert;
    }
    const fetched = await defaultCertProvider();
    cache = { certs: fetched.certs, expiresAt: now() + fetched.ttlMs, source: 'google' };
    const cert = cache.certs[kid];
    if (!cert) throw new FirebaseAuthError('UNKNOWN_KEY', 'The Firebase token was signed with an unknown key.');
    return cert;
  }

  async function verifyIdToken(idToken) {
    if (!projectId) {
      throw new FirebaseAuthError(
        'FIREBASE_NOT_CONFIGURED',
        'Firebase Authentication is not configured on this server. Set FIREBASE_PROJECT_ID and the Firebase web app keys (see docs/FIREBASE_AUTH.md).'
      );
    }
    if (!idToken || typeof idToken !== 'string') {
      throw new FirebaseAuthError('TOKEN_MISSING', 'A Firebase ID token is required.');
    }
    if (idToken.length > MAX_TOKEN_BYTES) {
      throw new FirebaseAuthError('TOKEN_MALFORMED', 'The Firebase token is too large.');
    }
    const parts = idToken.split('.');
    if (parts.length !== 3) throw new FirebaseAuthError('TOKEN_MALFORMED', 'The Firebase token is not a valid JWT.');

    let header;
    let payload;
    try {
      header = decodeSegment(parts[0]);
      payload = decodeSegment(parts[1]);
    } catch {
      throw new FirebaseAuthError('TOKEN_MALFORMED', 'The Firebase token could not be decoded.');
    }
    if (header.alg !== 'RS256') throw new FirebaseAuthError('TOKEN_ALGORITHM', 'The Firebase token must use RS256.');
    if (header.typ && header.typ !== 'JWT') throw new FirebaseAuthError('TOKEN_TYPE', 'Unexpected token type.');

    const certPem = await getCert(header.kid);
    let publicKey;
    try {
      publicKey = new crypto.X509Certificate(certPem).publicKey;
    } catch {
      throw new FirebaseAuthError('CERT_INVALID', 'The secure-token certificate could not be parsed.');
    }
    const signatureOk = crypto.verify(
      'RSA-SHA256',
      Buffer.from(`${parts[0]}.${parts[1]}`),
      publicKey,
      Buffer.from(parts[2], 'base64url')
    );
    if (!signatureOk) throw new FirebaseAuthError('TOKEN_SIGNATURE', 'The Firebase token signature is invalid.');

    const seconds = Math.floor(now() / 1000);
    if (payload.aud !== projectId) {
      throw new FirebaseAuthError('TOKEN_AUDIENCE', 'The Firebase token was issued for a different project.');
    }
    if (payload.iss !== `https://securetoken.google.com/${projectId}`) {
      throw new FirebaseAuthError('TOKEN_ISSUER', 'The Firebase token was not issued by this project.');
    }
    if (typeof payload.exp !== 'number' || payload.exp + CLOCK_SKEW_SECONDS < seconds) {
      throw new FirebaseAuthError('TOKEN_EXPIRED', 'The Firebase session has expired. Sign in again.');
    }
    if (typeof payload.iat !== 'number' || payload.iat - CLOCK_SKEW_SECONDS > seconds) {
      throw new FirebaseAuthError('TOKEN_ISSUED_IN_FUTURE', 'The Firebase token is not valid yet.');
    }
    if (payload.auth_time !== undefined && (typeof payload.auth_time !== 'number' || payload.auth_time - CLOCK_SKEW_SECONDS > seconds)) {
      throw new FirebaseAuthError('TOKEN_AUTH_TIME', 'The Firebase token has an invalid authentication time.');
    }
    const uid = payload.sub || payload.user_id;
    if (!uid || typeof uid !== 'string' || uid.length > 128) {
      throw new FirebaseAuthError('TOKEN_SUBJECT', 'The Firebase token has no valid subject.');
    }

    const signInProvider =
      (payload.firebase && payload.firebase.sign_in_provider) || payload.sign_in_provider || 'unknown';
    const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
    return {
      uid,
      email,
      // Only the verified token may state this; a request body value is never trusted.
      emailVerified: payload.email_verified === true,
      displayName: typeof payload.name === 'string' ? payload.name : '',
      photoUrl: typeof payload.picture === 'string' ? payload.picture : '',
      signInProvider,
      provider: 'firebase',
      issuedAt: payload.iat,
      expiresAt: payload.exp,
      authTime: payload.auth_time
    };
  }

  return {
    projectId,
    verifyIdToken,
    /** Test seam: replace the certificate source. Never used in production paths. */
    __setCertificateProvider(provider) {
      certProvider = provider;
      cache = { certs: null, expiresAt: 0, source: '' };
    },
    __clearCache() {
      cache = { certs: null, expiresAt: 0, source: '' };
    },
    __cacheInfo() {
      return { keys: cache.certs ? Object.keys(cache.certs).length : 0, source: cache.source, expiresAt: cache.expiresAt };
    }
  };
}

/**
 * Read the Firebase configuration from the environment.
 *
 * Client keys (apiKey, authDomain, appId…) are public identifiers — Firebase requires them in
 * the browser. Server credentials (service account JSON for push) are separate and never
 * leave the backend.
 */
function readFirebaseEnv(env = process.env) {
  let projectId = (env.FIREBASE_PROJECT_ID || '').trim();

  // A configured FCM service account already tells us the project id.
  if (!projectId) {
    const inline = env.FCM_SERVICE_ACCOUNT_JSON || '';
    const file = env.FCM_SERVICE_ACCOUNT_FILE || '';
    try {
      let raw = inline;
      if (!raw && file) {
        const fs = require('node:fs');
        if (fs.existsSync(file)) raw = fs.readFileSync(file, 'utf8');
      }
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.project_id) projectId = String(parsed.project_id).trim();
      }
    } catch {
      /* an unreadable service account simply means no derived project id */
    }
  }

  const apiKey = (env.FIREBASE_API_KEY || env.FIREBASE_WEB_API_KEY || '').trim();
  const authDomain = (env.FIREBASE_AUTH_DOMAIN || '').trim() || (projectId ? `${projectId}.firebaseapp.com` : '');
  const appId = (env.FIREBASE_APP_ID || '').trim();
  const messagingSenderId = (env.FIREBASE_MESSAGING_SENDER_ID || '').trim();
  const measurementId = (env.FIREBASE_MEASUREMENT_ID || '').trim();

  return {
    projectId,
    // The browser SDK is only usable when we can hand it a project + API key.
    configured: Boolean(projectId && apiKey),
    projectOnly: Boolean(projectId && !apiKey),
    webConfig: {
      apiKey,
      authDomain,
      projectId,
      appId,
      messagingSenderId,
      measurementId
    }
  };
}

function createFirebaseAuth(options = {}) {
  const env = options.env || process.env;
  const cfg = readFirebaseEnv(env);
  const verifier = createVerifier({ projectId: cfg.projectId, certProvider: options.certProvider });

  return {
    get configured() {
      return cfg.configured;
    },
    get projectId() {
      return cfg.projectId;
    },
    /**
     * Public configuration for the browser. Firebase web API keys identify the project; they
     * are not secrets, and Firebase expects them to be public. Rules, not secrecy, protect data.
     */
    webConfig() {
      return {
        configured: cfg.configured,
        projectId: cfg.projectId || '',
        emailVerificationRequired: true,
        config: cfg.configured ? cfg.webConfig : null,
        // Actionable message instead of a silent failure.
        message: cfg.configured
          ? 'Firebase Authentication is configured.'
          : cfg.projectOnly
          ? 'FIREBASE_PROJECT_ID is set but FIREBASE_API_KEY is missing, so the browser cannot sign in yet.'
          : 'Firebase Authentication is not configured on this server yet.'
      };
    },
    verifyIdToken: verifier.verifyIdToken,
    __setCertificateProvider: verifier.__setCertificateProvider,
    __clearCache: verifier.__clearCache,
    __cacheInfo: verifier.__cacheInfo
  };
}

module.exports = { createFirebaseAuth, createVerifier, readFirebaseEnv, FirebaseAuthError };
