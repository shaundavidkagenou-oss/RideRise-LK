'use strict';
// RideRise LK — test helper for the one real sign-in path.
//
// There is no demo or sandbox session in this application any more, so tests sign in the way
// a rider does: they mint a Firebase-shaped RS256 ID token with a throwaway key and point the
// server's verifier at the matching self-signed certificate through its documented test seam
// (`__setCertificateProvider`). Everything after that — signature, issuer, audience, expiry,
// verified-email gate, profile lookup, session minting — is the production code path.
//
// The fixtures live in tests/fixtures and are never loaded by the server, the web app or the
// Android build.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ID = 'riderise-lk-test';
const KID = 'test-kid';
const privateKey = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'firebase-test-key.pem'), 'utf8');
const certPem = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'firebase-test-cert.pem'), 'utf8');

// Firebase UIDs stored on the sample riders seeded with SEED_DEMO=1. A real Firebase project
// cannot issue these values, so the sample rows are inert outside the test suite.
const SAMPLE_RIDER_UIDS = {
  admin: 'demo-uid-admin-001',
  kasun: 'demo-uid-kasun-002',
  roshan: 'demo-uid-roshan-003',
  dilshan_minor: 'demo-uid-dilshan-004'
};

function useTestFirebaseEnv() {
  process.env.FIREBASE_PROJECT_ID = PROJECT_ID;
  process.env.FIREBASE_API_KEY = 'test-api-key-not-a-real-credential';
  process.env.FIREBASE_APP_ID = '1:000000000000:web:testfixture';
  process.env.FIREBASE_AUTH_DOMAIN = `${PROJECT_ID}.firebaseapp.com`;
}

function installTestCertificates(firebaseAuth) {
  firebaseAuth.__setCertificateProvider(() => ({ certs: { [KID]: certPem }, ttlMs: 60 * 60 * 1000 }));
}

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

/**
 * Mint a Firebase ID token. `overrides` lets a test corrupt a single claim (wrong audience,
 * expired, unverified email, missing subject…).
 */
function mintIdToken({ uid, email, emailVerified = true, projectId = PROJECT_ID, overrides = {}, key = privateKey, kid = KID } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', kid, typ: 'JWT' };
  const payload = Object.assign(
    {
      iss: `https://securetoken.google.com/${projectId}`,
      aud: projectId,
      auth_time: now,
      user_id: uid,
      sub: uid,
      iat: now,
      exp: now + 3600,
      email,
      email_verified: emailVerified,
      firebase: { identities: { email: [email] }, sign_in_provider: 'password' }
    },
    overrides
  );
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), key);
  return `${signingInput}.${signature.toString('base64url')}`;
}

let counter = 0;
function uniqueSuffix() {
  counter += 1;
  return `${process.pid}${Date.now().toString(36)}${counter}`;
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

/** Sign in as one of the SEED_DEMO=1 sample riders, through /api/auth/firebase/session. */
async function signInAsSampleRider(baseUrl, preset) {
  const uid = SAMPLE_RIDER_UIDS[preset];
  if (!uid) throw new Error(`unknown sample rider preset: ${preset}`);
  const idToken = mintIdToken({ uid, email: `${preset}.rider@example.com` });
  const res = await postJson(`${baseUrl}/api/auth/firebase/session`, { idToken });
  return { ...res, idToken, uid };
}

/**
 * Create a brand-new account through /api/auth/firebase/signup. Returns the session JSON plus
 * the minted `idToken` so a test can sign in again with the same Firebase identity (for
 * example to prove a suspension blocks sign-in).
 */
async function signUpFresh(baseUrl, { username, displayName = 'Test Rider', email } = {}) {
  const suffix = uniqueSuffix();
  const uid = `fb-test-uid-${suffix}`;
  const address = email || `rider.${suffix}@example.test`;
  const idToken = mintIdToken({ uid, email: address });
  const res = await postJson(`${baseUrl}/api/auth/firebase/signup`, {
    idToken,
    username: username || `rider_${suffix}`,
    displayName
  });
  return { ...res, idToken, uid, email: address };
}

/** Sign in again with an existing minted token (same Firebase identity). */
async function signInWithToken(baseUrl, idToken) {
  return postJson(`${baseUrl}/api/auth/firebase/session`, { idToken });
}

module.exports = {
  PROJECT_ID,
  KID,
  SAMPLE_RIDER_UIDS,
  certPem,
  useTestFirebaseEnv,
  installTestCertificates,
  mintIdToken,
  signInAsSampleRider,
  signUpFresh,
  signInWithToken
};
