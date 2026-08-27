# MaterialLogix Zero-Trust Baseline

MaterialLogix uses **never trust, always verify** as an engineering requirement,
not a marketing certification. Public pages and demo code are untrusted clients.
They must never be allowed to authorize licenses, charges, cloud jobs, access to
customer media, or administrative actions.

## Enforced in this repository

- No username, password, signing secret, provider key, or administrative bypass
  may be embedded in browser assets.
- Production Studio access fails closed unless `/api/session` returns an
  authenticated same-origin session. Local execution and the explicit `?demo=1`
  workspace are the only unauthenticated modes.
- GitHub Actions use explicit least-privilege permissions.
- Secret scanning, private vulnerability reporting, Dependabot alerts, and
  CodeQL scanning are enabled.
- Cloud prices shown in the browser are quotes only. The future cloud service
  must independently authenticate, authorize, meter, and price every job.

## Required before production cloud or paid licensing

1. Put production Studio, account, API, and administrative routes behind an
   identity-aware edge. Require phishing-resistant MFA for administrators.
2. Issue secure, `HttpOnly`, `Secure`, `SameSite` session cookies with short
   lifetimes. Rotate sessions after authentication and privilege changes.
3. Validate license entitlement and device authorization on the server. Offline
   desktop grants must be signed, narrowly scoped, expiring capabilities—not a
   reusable bearer key stored in browser storage.
4. Authorize each cloud job against account, product, balance, job type, maximum
   duration, and an idempotency key. Recalculate price server-side before capture.
5. Give workers single-job, short-lived access to isolated object paths. Workers
   must not receive customer account credentials or broad storage keys.
6. Encrypt uploads and outputs in transit and at rest. Apply retention limits and
   verified deletion to originals, intermediate frames, voice references, logs,
   and outputs.
7. Keep payment credentials with the payment processor. Verify signed webhooks,
   reject replays, and reconcile credit changes in an append-only ledger.
8. Centralize security events for sign-in, device changes, license decisions,
   balance changes, job submission, data access, export, and deletion. Never log
   secrets or raw customer media.
9. Separate production, staging, and development identities, secrets, storage,
   queues, and databases. Default every service-to-service policy to deny.
10. Test account isolation, authorization bypass, webhook replay, upload parsing,
    job-package traversal, rate limiting, revocation, backup recovery, and incident
    response before release.

## Current boundary

The static website and local demo cannot, by themselves, provide production
authentication or enforce paid entitlements. Until the account/license/cloud
backend and identity-aware edge exist, production Studio access intentionally
fails closed and cloud charging must remain disabled.
