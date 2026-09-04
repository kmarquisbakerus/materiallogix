// Signed local licenses with mandatory first-use server verification.
// Previously verified customers retain a short offline grace period; a newly
// entered key never unlocks production features until the license service has
// confirmed that its database record is active.

import { LICENSE_PUBLIC_JWK } from './license-key.js';
import { apiUrl } from './api-root.js';

const b64uToBytes = s => {
  const normalized = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

let cachedKey = null;
async function publicKey() {
  if (!cachedKey) {
    cachedKey = await crypto.subtle.importKey(
      'jwk', LICENSE_PUBLIC_JWK,
      { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  }
  return cachedKey;
}

/** Parse + cryptographically verify a key. Returns payload or null. */
export async function verifyLicense(key) {
  try {
    const [tag, payloadB64, sigB64] = String(key || '').trim().split('.');
    if (tag !== 'ML1' || !payloadB64 || !sigB64) return null;
    const payloadBytes = b64uToBytes(payloadB64);
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      await publicKey(), b64uToBytes(sigB64), payloadBytes);
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes));
    if (payload.v !== 1 || payload.net !== 1 || !payload.plan || !/^lic_[A-Za-z0-9_-]{8,120}$/.test(String(payload.lid || ''))) return null;
    // Term keys expire (grace already baked in at issue time). Keys without
    // exp are perpetual (early/dev keys).
    const expiresAt = Number.isFinite(payload.exp_ts)
      ? payload.exp_ts * 1000
      : payload.exp ? new Date(payload.exp + 'T23:59:59Z').getTime() : null;
    if (expiresAt && expiresAt < Date.now()) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

const STORE = 'cros:license';
const CHECK_STORE = 'cros:licenseCheck';
const CHECK_URL = apiUrl('/api/license/check');
const CHECK_EVERY_H = 24;        // ping at most daily
export const GRACE_DAYS = 3;     // licensed features require verification after this offline grace period

let lastActivationFailure = null;

export function activationFailureReason() { return lastActivationFailure; }

// The stored check is the customer's own browser making a claim about a
// conversation it had with the license service, so it can never be the trust
// boundary; the boundary is the server, which sees the key on every
// authorizeOutbound and can refuse a revoked one there.
//
// Two things guard the record, and they are not equally strong. Be clear about
// which is which, because an overstated control is worse than a missing one:
//
//   - `tag` is an UNKEYED digest over values the holder already has, computed
//     by code that ships to their browser. It catches a corrupt or
//     half-written record and a record copied from another licence. It does
//     NOT resist anyone willing to recompute it, which is three lines in the
//     same console that did the edit. It is an integrity check, not a security
//     one, and it is not called one here.
//   - `assertion` is signed by the licence service with the key this module
//     already verifies licences against, so it cannot be minted in the
//     browser at all. When one is present it is authoritative: it fixes the
//     grace window, and a forged `okAt` beside it is ignored.
//
// Until the service issues assertions the honest position is that an offline
// grace window is extendable by anyone prepared to edit storage, and that what
// actually stops a revoked licence is the server refusing its next
// authorizeOutbound.
const TAG_V = 1;
// An `okAt` written by this code is always in the past. A little tolerance
// absorbs a clock the machine corrected between the write and the read;
// anything beyond it is a timestamp nobody here wrote.
const CLOCK_SKEW_MS = 5 * 60e3;
const TAGGED_FIELDS = ['okAt', 'revoked', 'reason', 'entitlements', 'replacedAt', 'assertion'];

async function recordTag(rec, key) {
  const canonical = JSON.stringify([TAG_V, key, ...TAGGED_FIELDS.map(field => rec[field] ?? null)]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * A grace assertion signed by the licence service: `MLA1.<payload>.<sig>`,
 * verified against the same public key as a licence, so the browser cannot
 * mint one. The payload binds the licence id it was issued for and the moment
 * the service confirmed it.
 */
export async function verifyGraceAssertion(assertion, licenceId) {
  try {
    const [tag, payloadB64, sigB64] = String(assertion || '').trim().split('.');
    if (tag !== 'MLA1' || !payloadB64 || !sigB64) return null;
    const payloadBytes = b64uToBytes(payloadB64);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' },
      await publicKey(), b64uToBytes(sigB64), payloadBytes);
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes));
    // An assertion for somebody else's licence is not an assertion for this one.
    if (!payload.lid || (licenceId && payload.lid !== licenceId)) return null;
    if (!Number.isFinite(payload.okAt)) return null;
    return payload;
  } catch {
    return null;
  }
}

async function readCheckRecord(key, now) {
  let stored;
  try { stored = JSON.parse(localStorage.getItem(CHECK_STORE)); } catch { return {}; }
  if (!stored || typeof stored !== 'object') return {};
  const { tag, ...rec } = stored;
  // An unverifiable record is no record: it forces the phone-home rather than
  // failing closed on its own, so a corrupt or half-written value costs a
  // paying customer one network call and not their license.
  if (typeof tag !== 'string' || tag !== await recordTag(rec, key)) return {};

  // A signed assertion outranks anything beside it. Where the service issues
  // one, editing `okAt` in storage buys nothing: the signature does not cover
  // the edited value and the assertion's own timestamp is the one that counts.
  if (rec.assertion) {
    const signed = await verifyGraceAssertion(rec.assertion, (await verifyLicense(key))?.lid);
    if (!signed) { delete rec.assertion; delete rec.okAt; return rec; }
    rec.okAt = signed.okAt;
    if (signed.revoked === true) rec.revoked = true;
  }
  if (rec.okAt !== undefined && (!Number.isFinite(rec.okAt) || rec.okAt > now + CLOCK_SKEW_MS)) delete rec.okAt;
  return rec;
}

async function writeCheckRecord(rec, key) {
  try { localStorage.setItem(CHECK_STORE, JSON.stringify({ ...rec, tag: await recordTag(rec, key) })); } catch { /* full */ }
}

export async function revalidateLicense(key, { requireFresh = false, now = Date.now() } = {}) {
  /** Phone-home for the stored key. Sends the key and nothing else.
   * Grace window: a failed or unreachable check within GRACE_DAYS of the
   * last successful check keeps an already-verified license working. */
  const rec = await readCheckRecord(key, now);
  let freshVerified = false;
  const due = requireFresh || !rec.okAt || (now - rec.okAt) > CHECK_EVERY_H * 3600e3;
  if (due && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
    try {
      const res = await fetch(CHECK_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }), signal: AbortSignal.timeout(6000)
      });
      if (res.ok) {
        const j = await res.json();
        if (j.ok === false) { rec.revoked = true; rec.reason = j.error || 'revoked'; }
        else {
          rec.okAt = now;
          freshVerified = true;
          rec.revoked = false;
          rec.reason = null;
          rec.entitlements = j.entitlements || {};
          // Store the service's signed assertion when it issues one; it is
          // what makes the grace window unforgeable rather than merely tidy.
          if (typeof j.assertion === 'string') rec.assertion = j.assertion;
          else delete rec.assertion;
          if (typeof j.replacementKey === 'string') {
            const replacement = await verifyLicense(j.replacementKey);
            if (replacement) {
              localStorage.setItem(STORE, j.replacementKey.trim());
              key = j.replacementKey.trim();
              rec.replacedAt = now;
            }
          }
        }
      } else if (requireFresh) {
        rec.reason = 'verification_unavailable';
      }
    } catch {
      if (requireFresh) rec.reason = 'verification_unavailable';
    }
  } else if (due && requireFresh) {
    rec.reason = 'online_verification_required';
  }
  await writeCheckRecord(rec, key);
  if (rec.revoked) return { valid: false, reason: rec.reason || 'revoked' };
  if (requireFresh && !freshVerified) return { valid: false, reason: rec.reason || 'verification_unavailable' };
  if (!rec.okAt) return { valid: false, reason: rec.reason || 'verification_required' };
  if ((now - rec.okAt) > GRACE_DAYS * 86400e3) {
    return { valid: false, reason: 'offline' };
  }
  return { valid: true, key, entitlements: rec.entitlements || {} };
}

/** The active, verified license ({plan, email, iss}) or null. */
export async function activeLicense() {
  const key = localStorage.getItem(STORE);
  if (!key) return null;
  const payload = await verifyLicense(key);
  if (!payload) { localStorage.removeItem(STORE); return null; }
  // Every key that verifies carries net:1 - verifyLicense refuses the rest - so
  // there is no such thing as a key that skips the server check.
  const check = await revalidateLicense(key);
  if (!check.valid) {
    payload.suspended = check.reason;   // signature stands; features do not
    return { ...payload, plan: 'suspended:' + payload.plan, reason: check.reason };
  }
  if (check.key && check.key !== key) {
    const replacement = await verifyLicense(check.key);
    if (replacement) return { ...replacement, entitlements: check.entitlements };
  }
  payload.entitlements = check.entitlements;
  return payload;
}

/** Try to activate a key. Returns payload on success, null on bad key. */
export async function activate(key) {
  lastActivationFailure = null;
  const payload = await verifyLicense(key);
  if (!payload) {
    lastActivationFailure = 'invalid_or_legacy_key';
    return null;
  }
  const check = await revalidateLicense(key.trim(), { requireFresh: true });
  if (!check.valid) {
    lastActivationFailure = check.reason || 'verification_unavailable';
    return null;
  }
  const verifiedKey = check.key || key.trim();
  const verifiedPayload = verifiedKey === key.trim() ? payload : await verifyLicense(verifiedKey);
  if (!verifiedPayload) {
    lastActivationFailure = 'replacement_key_invalid';
    return null;
  }
  localStorage.setItem(STORE, verifiedKey);
  return { ...verifiedPayload, entitlements: check.entitlements };
}

export function activeLicenseKey() {
  return localStorage.getItem(STORE);
}

export function deactivate() { localStorage.removeItem(STORE); localStorage.removeItem(CHECK_STORE); }

/** Does the active license cover a product? complete covers everything. */
const EVERY_PRODUCT = Object.freeze(['photo', 'video', 'voice']);

/** Plans that unlock every Studio, and plans that unlock the one they name. */
const COVERS_EVERYTHING = new Set(['full', 'pro', 'payg']);
const COVERS_ONE = new Set(['single', 'single_pro']);

export function covers(payload, product) {
  if (!payload || String(payload.plan).startsWith('suspended:')) return false;
  if (!EVERY_PRODUCT.includes(product)) return false;
  const plan = String(payload.plan);
  if (COVERS_EVERYTHING.has(plan)) return true;
  if (COVERS_ONE.has(plan)) return payload.selected_product === product || payload.selectedProduct === product;
  if (plan === 'voice_starter') return product === 'voice';
  return false;
}
