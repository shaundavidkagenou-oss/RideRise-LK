// Bundle entry for the vendored Firebase compat build.
// scripts/bundle_firebase.sh compiles this to web_app/vendor/firebase-compat.min.js so the
// app (and the APK) can load Firebase Auth with no CDN and no network at build time.
import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';

window.firebase = firebase;
