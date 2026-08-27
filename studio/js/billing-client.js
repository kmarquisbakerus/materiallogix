import { activeLicenseKey } from './license.js';
import { planRemaining, recordExport } from './pricing.js';

async function billingRequest(path, body, idempotencyKey) {
  const response = await fetch(`/api/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {})
    },
    body: JSON.stringify(body)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'billing_request_failed');
  return result;
}

export async function beginAddOnCheckout(sku = 'units_100') {
  const licenseKey = activeLicenseKey();
  if (!licenseKey) throw new Error('license_required');
  const result = await billingRequest('checkout/session', { sku, licenseKey }, crypto.randomUUID());
  location.assign(result.url);
}

export async function openBillingPortal() {
  const licenseKey = activeLicenseKey();
  if (!licenseKey) throw new Error('license_required');
  const result = await billingRequest('billing/portal', { licenseKey });
  location.assign(result.url);
}

export async function authorizeLocalUnits(license, quantity, operationId = crypto.randomUUID()) {
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error('invalid_quantity');
  const includedRemaining = planRemaining(license);
  const purchasedNeeded = Math.max(0, quantity - includedRemaining);
  if (purchasedNeeded) {
    const licenseKey = activeLicenseKey();
    if (!licenseKey) return { ok: false, reason: 'license_required' };
    try {
      await billingRequest('entitlements/consume', {
        licenseKey,
        entitlement: 'local_units',
        quantity: purchasedNeeded
      }, `local-units:${operationId}`);
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : 'insufficient_entitlement' };
    }
  }
  recordExport(quantity);
  return { ok: true, purchasedUsed: purchasedNeeded };
}
