// Offline license verification.
//
// Keys are ECDSA P-256 signatures over a small JSON payload, issued by
// tools/license.mjs and sold through Stripe. Verification happens entirely in
// the browser against the embedded public key: no license server, no phoning
// home, works on a plane. (A determined pirate can patch local code - every
// desktop product lives with that; honest customers get a key that just works.)

import { LICENSE_PUBLIC_JWK } from './license-key.js';

const b64uToBytes = s => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
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
    if (payload.v !== 1 || !payload.plan) return null;
    // Term keys expire (grace already baked in at issue time). Keys without
    // exp are perpetual (early/dev keys).
    if (payload.exp && new Date(payload.exp + 'T23:59:59') < new Date()) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

const STORE = 'cros:license';
const CHECK_STORE = 'cros:licenseCheck';
const CHECK_URL = 'https://materiallogix.com/api/license/check';
const CHECK_EVERY_H = 24;        // ping at most daily
export const GRACE_DAYS = 3;     // founder's spec: offline past this locks licensed features

async function revalidate(key) {
  /** Phone-home for keys minted with net:1. Sends the key and nothing else.
   * Grace window: a failed or unreachable check within GRACE_DAYS of the
   * last success (or first activation) keeps the license working. */
  let rec;
  try { rec = JSON.parse(localStorage.getItem(CHECK_STORE)) || {}; } catch { rec = {}; }
  const now = Date.now();
  if (!rec.first) { rec.first = now; }
  const due = !rec.okAt || (now - rec.okAt) > CHECK_EVERY_H * 3600e3;
  if (due && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
    try {
      const res = await fetch(CHECK_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }), signal: AbortSignal.timeout(6000)
      });
      if (res.ok) {
        const j = await res.json();
        if (j.ok === false) { rec.revoked = true; }
        else { rec.okAt = now; rec.revoked = false; }
      }
      // Non-200 or network error: treated as offline; grace applies.
    } catch { /* offline: grace applies */ }
  }
  try { localStorage.setItem(CHECK_STORE, JSON.stringify(rec)); } catch { /* full */ }
  if (rec.revoked) return { valid: false, reason: 'revoked' };
  const anchor = rec.okAt || rec.first;
  if ((now - anchor) > GRACE_DAYS * 86400e3) {
    return { valid: false, reason: 'offline' };
  }
  return { valid: true };
}

/** The active, verified license ({plan, email, iss}) or null. */
export async function activeLicense() {
  const key = localStorage.getItem(STORE);
  if (!key) return null;
  const payload = await verifyLicense(key);
  if (!payload) { localStorage.removeItem(STORE); return null; }
  if (payload.net === 1) {
    const check = await revalidate(key);
    if (!check.valid) {
      payload.suspended = check.reason;   // signature stands; features do not
      return { ...payload, plan: 'suspended:' + payload.plan, reason: check.reason };
    }
  }
  return payload;
}

/** Try to activate a key. Returns payload on success, null on bad key. */
export async function activate(key) {
  const payload = await verifyLicense(key);
  if (payload) localStorage.setItem(STORE, key.trim());
  return payload;
}

export function deactivate() { localStorage.removeItem(STORE); localStorage.removeItem(CHECK_STORE); }

/** Does the active license cover a product? complete covers everything. */
export function covers(payload, product) {
  if (!payload || String(payload.plan).startsWith('suspended:')) return false;
  return ['complete', 'pro', 'lite'].includes(payload.plan) || payload.plan === product;
}
