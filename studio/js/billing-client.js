import { activeLicenseKey } from './license.js';
import { apiUrl } from './api-root.js';
const PENDING_RELEASES_STORE = 'materiallogix:pending-usage-releases';
const MAX_PENDING_RELEASES = 48;
let releaseFlushPromise = null;

function storage() {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

function normalizedRelease(value) {
  if (!value || typeof value !== 'object' || !/^[A-Za-z0-9_-]{8,160}$/.test(String(value.authorizationId || ''))) return null;
  return {
    authorizationId: String(value.authorizationId),
    reason: typeof value.reason === 'string' ? value.reason.slice(0, 64) : 'client_failure',
    queuedAt: Number.isFinite(Number(value.queuedAt)) ? Number(value.queuedAt) : Date.now(),
    attempts: Math.max(0, Math.floor(Number(value.attempts) || 0)),
    lastAttemptAt: Number.isFinite(Number(value.lastAttemptAt)) ? Number(value.lastAttemptAt) : null
  };
}

export function pendingUsageReleases() {
  const target = storage();
  if (!target) return [];
  try {
    const parsed = JSON.parse(target.getItem(PENDING_RELEASES_STORE) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizedRelease).filter(Boolean).slice(-MAX_PENDING_RELEASES);
  } catch { return []; }
}

function writePendingUsageReleases(entries) {
  const target = storage();
  if (!target) return false;
  try {
    target.setItem(PENDING_RELEASES_STORE, JSON.stringify(entries.slice(-MAX_PENDING_RELEASES)));
    return true;
  } catch { return false; }
}

function queueUsageRelease(authorizationId, reason) {
  const queued = pendingUsageReleases();
  const existing = queued.find(entry => entry.authorizationId === authorizationId);
  if (existing) existing.reason = reason || existing.reason;
  else queued.push(normalizedRelease({ authorizationId, reason, queuedAt: Date.now() }));
  return writePendingUsageReleases(queued.filter(Boolean));
}

function removePendingUsageRelease(authorizationId) {
  const queued = pendingUsageReleases();
  if (!queued.some(entry => entry.authorizationId === authorizationId)) return true;
  return writePendingUsageReleases(queued.filter(entry => entry.authorizationId !== authorizationId));
}

export function stagePendingUsageRelease(authorizationId, reason = 'interrupted_before_settlement') {
  if (!/^[A-Za-z0-9_-]{8,160}$/.test(String(authorizationId || ''))) {
    throw new Error('invalid_authorization_id');
  }
  if (!queueUsageRelease(String(authorizationId), reason)) {
    throw new Error('usage_release_persistence_failed');
  }
  return pendingUsageReleases().find(entry => entry.authorizationId === authorizationId) || null;
}

function queuedReleaseError(cause) {
  const error = new Error('usage_release_queued');
  error.cause = cause;
  return error;
}

async function billingRequest(path, body, idempotencyKey) {
  const response = await fetch(apiUrl(path), {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {})
    },
    body: JSON.stringify(body)
  });
  let result = {};
  try { result = await response.json(); } catch { /* structured fallback below */ }
  if (!response.ok) throw new Error(result.error || 'billing_request_failed');
  return result;
}

export async function authorizeOutbound({ product, artifactKind, quantity, operationId = crypto.randomUUID() }) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { ok: false, reason: 'online_authorization_required' };
  }
  const licenseKey = activeLicenseKey();
  if (!licenseKey) return { ok: false, reason: 'license_required' };
  try {
    return await billingRequest('outbound/authorize', {
      licenseKey, product, artifactKind, quantity
    }, `outbound:${operationId}`);
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'authorization_failed' };
  }
}

export async function settleOutbound(authorizationId, evidenceHash = null) {
  const licenseKey = activeLicenseKey();
  if (!licenseKey) throw new Error('license_required');
  const result = await billingRequest('outbound/settle', { licenseKey, authorizationId, evidenceHash });
  if (result.authorization?.status !== 'settled') throw new Error('usage_settlement_unconfirmed');
  if (!removePendingUsageRelease(authorizationId)) throw new Error('usage_settlement_local_confirmation_failed');
  return result;
}

export async function settleOutboundBeforeDelivery(authorizationId, evidenceHash, deliver) {
  if (typeof deliver !== 'function') throw new Error('delivery_callback_required');
  stagePendingUsageRelease(authorizationId);
  const result = await settleOutbound(authorizationId, evidenceHash);
  await deliver();
  return result;
}

export async function voidOutbound(authorizationId, reason = 'client_failure') {
  const licenseKey = activeLicenseKey();
  if (!licenseKey) {
    queueUsageRelease(authorizationId, reason);
    throw queuedReleaseError(new Error('license_required'));
  }
  try {
    const result = await billingRequest('outbound/void', { licenseKey, authorizationId, reason },
      `outbound-release:${authorizationId}`);
    if (result.authorization?.status === 'settled') {
      if (!removePendingUsageRelease(authorizationId)) throw new Error('usage_release_local_confirmation_failed');
      throw new Error('usage_already_settled');
    }
    if (result.authorization?.status !== 'voided') throw new Error('usage_release_unconfirmed');
    removePendingUsageRelease(authorizationId);
    return result;
  } catch (error) {
    if (error instanceof Error && error.message === 'usage_already_settled') throw error;
    queueUsageRelease(authorizationId, reason);
    throw queuedReleaseError(error);
  }
}

async function flushPendingUsageReleasesOnce() {
  const queued = pendingUsageReleases();
  if (!queued.length) return { confirmed: 0, pending: 0 };
  if ((typeof navigator !== 'undefined' && navigator.onLine === false) || !activeLicenseKey()) {
    return { confirmed: 0, pending: queued.length };
  }
  let confirmed = 0;
  const terminal = new Set();
  const attempted = new Map();
  for (const entry of queued) {
    try {
      const result = await billingRequest('outbound/void', {
        licenseKey: activeLicenseKey(), authorizationId: entry.authorizationId, reason: entry.reason
      }, `outbound-release:${entry.authorizationId}`);
      if (result.authorization?.status === 'voided' || result.authorization?.status === 'settled') {
        terminal.add(entry.authorizationId);
        confirmed += 1;
      } else attempted.set(entry.authorizationId, { ...entry, attempts: entry.attempts + 1, lastAttemptAt: Date.now() });
    } catch {
      attempted.set(entry.authorizationId, { ...entry, attempts: entry.attempts + 1, lastAttemptAt: Date.now() });
    }
  }
  const remaining = pendingUsageReleases()
    .filter(entry => !terminal.has(entry.authorizationId))
    .map(entry => attempted.get(entry.authorizationId) || entry);
  if (!writePendingUsageReleases(remaining)) return { confirmed: 0, pending: remaining.length };
  return { confirmed, pending: remaining.length };
}

export function flushPendingUsageReleases() {
  if (!releaseFlushPromise) {
    releaseFlushPromise = flushPendingUsageReleasesOnce().finally(() => { releaseFlushPromise = null; });
  }
  return releaseFlushPromise;
}

export async function openBillingPortal() {
  const licenseKey = activeLicenseKey();
  if (!licenseKey) throw new Error('license_required');
  const result = await billingRequest('billing/portal', { licenseKey });
  location.assign(result.url);
}

export async function authorizeLocalUnits(license, quantity, operationId = crypto.randomUUID()) {
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error('invalid_quantity');
  return authorizeOutbound({ product: 'photo', artifactKind: 'clean_export', quantity, operationId });
}
