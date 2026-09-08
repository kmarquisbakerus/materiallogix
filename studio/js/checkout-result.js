// Turning a completed Stripe payment into an active licence.
//
// This module is the only thing that does it, and it runs on every page a
// customer can be returned to, because the billing service - not this
// repository - decides the success URL.
//
// Two failure modes drive the shape of it. Fulfilment routinely trails the
// redirect by a few seconds, so the first lookup often legitimately fails;
// and the claim is one-time, so losing it means the payment is stranded until
// a human intervenes. The claim therefore leaves the address bar immediately,
// is held in localStorage rather than sessionStorage so closing the tab does
// not discard it, and is retried on this visit and on every later one until it
// is spent. Whatever happens, the customer is told - silence after a payment
// is the worst of the available outcomes.

import { activate } from './license.js';
import { apiUrl } from './api-root.js';

const HELD = 'materiallogix:pending-checkout';
// A claim the service has never honoured is not worth retrying forever, and a
// stale one must not follow a customer around indefinitely.
const HOLD_MS = 24 * 60 * 60 * 1000;
// The webhook usually lands within seconds. Three tries across ~20s covers the
// common case without leaving a customer watching a spinner.
const RETRY_DELAYS_MS = [3000, 8000];

const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key, value) => { try { localStorage.setItem(key, value); } catch { /* full or blocked */ } };
const drop = key => { try { localStorage.removeItem(key); } catch { /* unavailable */ } };

function heldClaim() {
  // sessionStorage was the original home. Anything still there belongs to a
  // customer mid-purchase, so it is migrated rather than dropped.
  let raw = read(HELD);
  if (!raw) {
    try {
      raw = sessionStorage.getItem(HELD);
      if (raw) { write(HELD, raw); sessionStorage.removeItem(HELD); }
    } catch { /* unavailable */ }
  }
  if (!raw) return null;
  try {
    const held = JSON.parse(raw);
    if (!held?.sessionId || !held?.claim) { drop(HELD); return null; }
    if (held.heldAt && Date.now() - held.heldAt > HOLD_MS) { drop(HELD); return null; }
    return held;
  } catch { drop(HELD); return null; }
}

/**
 * A self-contained status line. This module runs on the marketing page as well
 * as the four Studio pages, so it cannot reach for any one page's toast.
 */
function notice(message, tone) {
  let box = document.getElementById('materiallogixCheckoutNotice');
  if (!box) {
    box = document.createElement('div');
    box.id = 'materiallogixCheckoutNotice';
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    box.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:16px;z-index:2147483647;'
      + 'max-width:min(680px,calc(100vw - 32px));padding:12px 16px;border-radius:12px;'
      + 'font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;'
      + 'box-shadow:0 8px 28px rgba(0,0,0,.22);border:1px solid rgba(0,0,0,.12)';
    (document.body || document.documentElement).append(box);
  }
  box.style.background = tone === 'done' ? '#0f5132' : tone === 'stuck' ? '#5c3c00' : '#1f2937';
  box.style.color = '#fff';
  box.textContent = message;
  return box;
}

async function redeem({ sessionId, claim }) {
  const response = await fetch(
    apiUrl(`/api/checkout/result?session_id=${encodeURIComponent(sessionId)}&claim=${encodeURIComponent(claim)}`),
    {
      headers: { Accept: 'application/json' },
      // This module is evaluated while the page is still booting, so an
      // unanswered request must not hold it open.
      signal: AbortSignal.timeout(10000)
    }
  );
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.licenseKey) throw new Error(result.error || 'fulfillment_pending');
  const license = await activate(result.licenseKey);
  if (!license) throw new Error('activation_failed');
  return license;
}

const params = new URLSearchParams(location.search);
const returning = params.get('checkout') === 'success';
const fromUrl = params.get('session_id') && params.get('claim')
  ? { sessionId: params.get('session_id'), claim: params.get('claim'), heldAt: Date.now() }
  : null;

if (returning && fromUrl) {
  // Hold it before anything can fail, and get it out of the address bar and
  // out of history straight away - but keep the rest of the query, which may
  // carry a project id, a demo flag or an entry hint the Studio reads next.
  write(HELD, JSON.stringify(fromUrl));
  const clean = new URL(location.href);
  for (const key of ['checkout', 'session_id', 'claim']) clean.searchParams.delete(key);
  history.replaceState({}, '', clean);
}

const pending = fromUrl || heldClaim();

if (pending) {
  if (returning) notice('Payment received. Issuing your licence…', 'working');

  (async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        const license = await redeem(pending);
        drop(HELD);
        notice('Your licence is active. Thank you.', 'done');
        setTimeout(() => document.getElementById('materiallogixCheckoutNotice')?.remove(), 6000);
        fetch(apiUrl('/api/analytics/event'), {
          method: 'POST',
          body: JSON.stringify({ event: 'license_activated', operationId: `activation:${pending.sessionId}` }),
          keepalive: true
        }).catch(() => {});
        globalThis.dispatchEvent(new CustomEvent('materiallogix:license-activated', { detail: { plan: license.plan } }));
        globalThis.refreshMaterialLogixLicense?.();
        return;
      } catch {
        if (attempt < RETRY_DELAYS_MS.length) {
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
          continue;
        }
        // Out of tries for this visit. The claim stays held, so the next visit
        // in this browser picks it up; say so rather than leaving the customer
        // to wonder whether the payment took.
        notice('Payment received. Your licence is still being issued — reopen this page in a moment and it will finish automatically. '
          + 'If it does not, contact admin@materiallogix.com and we will activate it.', 'stuck');
        return;
      }
    }
  })();
}
