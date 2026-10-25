# Test fixtures

These files exist **only** so `tests/auth.firebase.test.js` can mint Firebase ID tokens
offline, without contacting Google.

| File | Purpose |
| --- | --- |
| `firebase-test-cert.pem` | Throwaway self-signed certificate (CN=securetoken.test). Stands in for Google's `securetoken@system.gserviceaccount.com` certificates. |
| `firebase-test-key.pem` | The private key paired with the certificate above. **Not** a credential for any real service. |

They are injected through the verifier's test seam (`__setCertificateProvider`) and are never
loaded by `backend/server.js`, by the browser bundle, or by any deployed environment. The
project they can "sign" for does not exist; a token signed with this key is only accepted when
a test explicitly injects the provider.

Regenerate with:

```bash
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout firebase-test-key.pem -out firebase-test-cert.pem \
  -days 3650 -subj "/CN=securetoken.test/O=RideRise LK test fixture"
```
