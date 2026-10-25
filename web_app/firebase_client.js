/* RideRise LK — Firebase Authentication client (email + password only).
 *
 * The SDK is bundled locally (web_app/vendor/firebase-compat.min.js) so the app and the APK
 * work with no CDN. This wrapper exists so the rest of the UI never touches the SDK directly
 * and so the failure modes (not configured, wrong password, disabled account, network down)
 * are translated into plain language once, in one place.
 */
(function () {
  'use strict';

  // Test seam: jsdom tests inject a stub SDK here. In the browser this is undefined and the
  // vendored SDK on window.firebase is used.
  function sdk() {
    return window.__RR_FIREBASE__ || window.firebase || null;
  }

  const PENDING_KEY = 'rr_pending_verification';

  let app = null;
  let auth = null;
  let config = null;
  let configured = false;
  let lastError = '';

  const AUTH_ERRORS = {
    'auth/invalid-email': 'That email address is not valid. Check it and try again.',
    'auth/missing-email': 'Enter your email address.',
    'auth/missing-password': 'Enter your password.',
    'auth/wrong-password': 'That email and password combination is not correct.',
    'auth/invalid-credential': 'That email and password combination is not correct.',
    'auth/invalid-login-credentials': 'That email and password combination is not correct.',
    'auth/user-not-found': 'No RideRise LK account uses that email address. Create one instead.',
    'auth/email-already-in-use': 'An account already exists for that email address. Sign in instead, or reset your password.',
    'auth/weak-password': 'That password is too weak. Use at least 10 characters with a letter and a number.',
    'auth/user-disabled': 'This account has been disabled by the studio. Email safety@shaundavidstudios.lk if you think this is a mistake.',
    'auth/too-many-requests': 'Too many attempts. Wait a few minutes before trying again.',
    'auth/network-request-failed': 'The network connection failed. Check your internet connection and try again.',
    'auth/operation-not-allowed':
      'Email/password sign-in is not enabled for this Firebase project yet. Enable it in Firebase Console → Authentication → Sign-in method.',
    'auth/unauthorized-domain': 'This domain is not authorised in Firebase. Add it in Firebase Console → Authentication → Settings → Authorized domains.',
    'auth/internal-error': 'Firebase returned an unexpected error. Try again in a moment.',
    'auth/timeout': 'Firebase did not respond in time. Check your connection and try again.'
  };

  function friendlyError(err) {
    const code = (err && err.code) || '';
    const message = AUTH_ERRORS[code] || (err && err.message) || 'Sign-in failed. Please try again.';
    const error = new Error(message);
    error.code = code || 'auth/unknown';
    error.original = err;
    return error;
  }

  /** True when the vendored SDK actually loaded in this environment. */
  function sdkAvailable() {
    const s = sdk();
    return Boolean(s && typeof s.initializeApp === 'function');
  }

  /**
   * Initialise from the server's public Firebase web config (/api/config → firebase.config).
   * Returns false — with `lastError` set — when Firebase is not configured, rather than
   * pretending sign-in is available.
   */
  function configure(webConfig) {
    if (!webConfig || !webConfig.apiKey || !webConfig.projectId) {
      configured = false;
      lastError = 'Firebase Authentication is not configured on this server.';
      return false;
    }
    if (!sdkAvailable()) {
      configured = false;
      lastError = 'The Firebase SDK could not be loaded in this build.';
      return false;
    }
    if (configured) return true;
    try {
      const s = sdk();
      app = s.apps && s.apps.length ? s.app() : s.initializeApp(webConfig);
      auth = s.auth(app);
      // "Remember me": survive refreshes, browser restarts and app restarts.
      if (s.auth && s.auth.Auth && s.auth.Auth.Persistence) {
        auth.setPersistence(s.auth.Auth.Persistence.LOCAL).catch(() => {});
      }
      config = webConfig;
      configured = true;
      lastError = '';
      return true;
    } catch (err) {
      // A repeated configure() with different keys throws app/duplicate-app; treat as ready.
      if (String(err && err.code) === 'app/duplicate-app') {
        configured = true;
        return true;
      }
      configured = false;
      lastError = (err && err.message) || 'Firebase could not be initialised.';
      return false;
    }
  }

  function isConfigured() {
    return configured;
  }

  function unavailableReason() {
    return lastError || 'Firebase Authentication is not available in this build.';
  }

  function currentUser() {
    return configured && auth ? auth.currentUser : null;
  }

  /** Client-side password policy, mirrored by the copy shown in the sign-up form. */
  function passwordProblem(password) {
    const value = String(password || '');
    if (value.length < 10) return 'Use at least 10 characters.';
    if (!/[A-Za-z]/.test(value)) return 'Include at least one letter.';
    if (!/[0-9]/.test(value)) return 'Include at least one number.';
    if (/^(password|1234567890|qwertyuiop|riderise|letmein123)$/i.test(value)) return 'That password is too common. Choose something unique.';
    return null;
  }

  function isEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value || '').trim());
  }

  function validateUsername(value) {
    const username = String(value || '').trim().toLowerCase();
    if (!username) return { ok: false, message: 'Choose a username.' };
    if (!/^[a-z0-9_]{3,24}$/.test(username)) {
      return { ok: false, message: 'Usernames are 3–24 characters: lowercase letters, numbers or underscores.' };
    }
    return { ok: true, username, message: '' };
  }

  /* --------------------------- pending verification ------------------------- */

  function rememberPendingVerification(email) {
    try {
      localStorage.setItem(PENDING_KEY, JSON.stringify({ email: String(email || ''), at: Date.now() }));
    } catch (e) {
      /* storage disabled — the gate is still shown for this session */
    }
  }

  function pendingVerification() {
    try {
      const raw = localStorage.getItem(PENDING_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      // Give up on stale pending states after a week so the app does not trap the user.
      if (!parsed || !parsed.email || Date.now() - Number(parsed.at || 0) > 7 * 24 * 3600 * 1000) {
        localStorage.removeItem(PENDING_KEY);
        return null;
      }
      return parsed;
    } catch (e) {
      return null;
    }
  }

  function clearPendingVerification() {
    try {
      localStorage.removeItem(PENDING_KEY);
    } catch (e) {
      /* ignore */
    }
  }

  /* ------------------------------- SDK actions ------------------------------ */

  async function signUp(email, password) {
    if (!configured) throw friendlyError({ code: 'auth/not-configured', message: unavailableReason() });
    try {
      const credential = await auth.createUserWithEmailAndPassword(String(email).trim(), password);
      return credential.user;
    } catch (err) {
      throw friendlyError(err);
    }
  }

  async function signIn(email, password) {
    if (!configured) throw friendlyError({ code: 'auth/not-configured', message: unavailableReason() });
    try {
      const credential = await auth.signInWithEmailAndPassword(String(email).trim(), password);
      return credential.user;
    } catch (err) {
      throw friendlyError(err);
    }
  }

  async function signOut() {
    if (!configured || !auth) return;
    try {
      await auth.signOut();
    } catch (err) {
      /* clearing the local RideRise token is what actually signs the rider out */
    }
  }

  async function sendVerificationEmail() {
    const user = currentUser();
    if (!user) throw friendlyError({ code: 'auth/no-current-user', message: 'Sign in again to request a verification email.' });
    try {
      await user.sendEmailVerification();
      rememberPendingVerification(user.email);
      return true;
    } catch (err) {
      throw friendlyError(err);
    }
  }

  async function sendPasswordReset(email) {
    if (!configured) throw friendlyError({ code: 'auth/not-configured', message: unavailableReason() });
    try {
      await auth.sendPasswordResetEmail(String(email).trim());
      return true;
    } catch (err) {
      throw friendlyError(err);
    }
  }

  /** Re-read the Firebase user record so `emailVerified` reflects reality. */
  async function reloadUser() {
    const user = currentUser();
    if (!user) return null;
    try {
      await user.reload();
      return user;
    } catch (err) {
      throw friendlyError(err);
    }
  }

  async function getIdToken(forceRefresh) {
    const user = currentUser();
    if (!user) return null;
    return user.getIdToken(Boolean(forceRefresh));
  }

  function onAuthStateChanged(callback) {
    if (!configured || !auth) return function () {};
    return auth.onAuthStateChanged(callback);
  }

  async function deleteAccount() {
    const user = currentUser();
    if (!user) return false;
    await user.delete();
    return true;
  }

  window.RRFirebase = {
    configure,
    isConfigured,
    sdkAvailable,
    unavailableReason,
    currentUser,
    signUp,
    signIn,
    signOut,
    sendVerificationEmail,
    sendPasswordReset,
    reloadUser,
    getIdToken,
    onAuthStateChanged,
    deleteAccount,
    passwordProblem,
    isEmail,
    validateUsername,
    friendlyError,
    rememberPendingVerification,
    pendingVerification,
    clearPendingVerification
  };
})();
