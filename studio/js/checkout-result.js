import { activate } from './license.js';
import { apiUrl } from './api-root.js';

const params = new URLSearchParams(location.search);
let sessionId = params.get('session_id');
let claim = params.get('claim');
let hasPending = false;
if (!sessionId || !claim) {
  try {
    const pending = JSON.parse(sessionStorage.getItem('materiallogix:pending-checkout'));
    hasPending = Boolean(pending);
    sessionId = pending?.sessionId || null;
    claim = pending?.claim || null;
  } catch { /* unavailable */ }
}

if ((params.get('checkout') === 'success' || hasPending) && sessionId && claim) {
  // Drop the one-time claim from the address bar without discarding the rest
  // of the query: the page the customer lands on may be carrying a project id,
  // a demo flag or an entry hint that the Studio reads a moment later.
  const cleanUrl = new URL(location.href);
  for (const key of ['checkout', 'session_id', 'claim']) cleanUrl.searchParams.delete(key);
  history.replaceState({}, '', cleanUrl);
  try {
    const response = await fetch(apiUrl(`/api/checkout/result?session_id=${encodeURIComponent(sessionId)}&claim=${encodeURIComponent(claim)}`), {
      headers: { Accept: 'application/json' },
      // This module is evaluated before the page finishes booting, so an
      // unanswered request must not hold the Studio open indefinitely.
      signal: AbortSignal.timeout(10000)
    });
    const result = await response.json();
    if (!response.ok || !result.licenseKey) throw new Error(result.error || 'fulfillment_pending');
    const license = await activate(result.licenseKey);
    if (!license) throw new Error('activation_failed');
    try { sessionStorage.removeItem('materiallogix:pending-checkout'); } catch { /* unavailable */ }
    fetch(apiUrl('/api/analytics/event'), {
      method: 'POST',
      body: JSON.stringify({ event: 'license_activated', operationId: `activation:${sessionId}` }),
      keepalive: true
    }).catch(() => {});
    globalThis.dispatchEvent(new CustomEvent('materiallogix:license-activated', { detail: { plan: license.plan } }));
    globalThis.refreshMaterialLogixLicense?.();
  } catch {
    // Webhook delivery can briefly trail the redirect. Keep the one-time claim
    // in session storage so the user can retry without exposing it in history.
    try { sessionStorage.setItem('materiallogix:pending-checkout', JSON.stringify({ sessionId, claim })); } catch { /* unavailable */ }
  }
}
