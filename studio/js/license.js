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

export async function revalidateLicense(key, { requireFresh = false, now = Date.now() } = {}) {
  /** Phone-home for keys minted with net:1. Sends the key and nothing else.
   * Grace window: a failed or unreachable check within GRACE_DAYS of the
   * last successful check keeps an already-verified license working. */
  let rec;
  try { rec = JSON.parse(localStorage.getItem(CHECK_STORE)) || {}; } catch { rec = {}; }
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
  try { localStorage.setItem(CHECK_STORE, JSON.stringify(rec)); } catch { /* full */ }
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
  if (payload.net === 1) {
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
  }
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
export function covers(payload, product) {
  if (!payload || String(payload.plan).startsWith('suspended:')) return false;
  if (payload.plan === 'full') return ['photo', 'video', 'voice'].includes(product);
  if (payload.plan === 'voice_starter') return product === 'voice';
  if (payload.plan === 'single') return payload.selected_product === product || payload.selectedProduct === product;
  if (payload.plan === 'payg') return ['photo', 'video', 'voice'].includes(product);
  return false;
}
