import { activate } from './license.js';

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
  const cleanUrl = new URL(location.href);
  cleanUrl.search = '';
  history.replaceState({}, '', cleanUrl);
  try {
    const response = await fetch(`/api/checkout/result?session_id=${encodeURIComponent(sessionId)}&claim=${encodeURIComponent(claim)}`, {
      headers: { Accept: 'application/json' }
    });
    const result = await response.json();
    if (!response.ok || !result.licenseKey) throw new Error(result.error || 'fulfillment_pending');
    const license = await activate(result.licenseKey);
    if (!license) throw new Error('activation_failed');
    try { sessionStorage.removeItem('materiallogix:pending-checkout'); } catch { /* unavailable */ }
    fetch('/api/analytics/event', {
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
