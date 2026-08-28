import { apiUrl } from './api-root.js';

const status = document.querySelector('#opsStatus');
const cards = document.querySelector('#opsCards');
const periodFilter = document.querySelector('#periodFilter');
const productFilter = document.querySelector('#productFilter');
const statusFilter = document.querySelector('#statusFilter');
const privacyStatusFilter = document.querySelector('#privacyStatusFilter');
const privacyTicketReference = document.querySelector('#privacyTicketReference');
const privacyReason = document.querySelector('#privacyReason');
const privacySupportStatus = document.querySelector('#privacySupportStatus');
const privacyRequestTable = document.querySelector('#privacyRequestTable');
const cloudPhotoTable = document.querySelector('#cloudPhotoTable');
const careLookup = document.querySelector('#careLookup');
const careLookupButton = document.querySelector('#careLookupButton');
const customerCareStatus = document.querySelector('#customerCareStatus');
const customerCareResults = document.querySelector('#customerCareResults');
const creditForm = document.querySelector('#creditForm');
const refundForm = document.querySelector('#refundForm');
const safe = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[character]));
const renderTable = (headings, rows) => `<table class="ops-table"><thead><tr>${headings.map(value => `<th>${safe(value)}</th>`).join('')}</tr></thead><tbody>${rows.join('') || `<tr><td colspan="${headings.length}">No matching activity.</td></tr>`}</tbody></table>`;

let snapshot = null;
let filteredProducts = [];
let privacyQueue = [];
let customerCareSnapshot = null;

function render() {
  if (!snapshot) return;
  const totals = snapshot.totals || {};
  const voidRate = Number(totals.operations) ? Number(totals.voided || 0) / Number(totals.operations) : 0;
  cards.innerHTML = [
    ['Operations', totals.operations], ['Billable units', totals.billable_units],
    ['Unlimited proofs', totals.proof_artifacts], ['Void rate', `${(voidRate * 100).toFixed(1)}%`],
    ['Pending', totals.pending], ['Expired pending', totals.expired_pending],
    ['Add-on units', totals.purchased_units], ['Avg. settlement', `${Math.round(Number(totals.average_settlement_seconds || 0))}s`]
  ].map(([label,value]) => `<div class="ops-card"><span class="eyebrow">${safe(label)}</span><b>${typeof value === 'number' ? value.toLocaleString() : safe(value ?? 0)}</b></div>`).join('');
  const products = (snapshot.products || []).filter(item =>
    (!productFilter.value || item.product === productFilter.value) &&
    (!statusFilter.value || item.status === statusFilter.value));
  filteredProducts = products;
  const previous = snapshot.previous || {};
  document.querySelector('#comparisonTable').innerHTML = renderTable(
    ['Period','Operations','Artifacts','Billable units','Voided'],
    [[snapshot.period, totals], [snapshot.previousPeriod, previous]].map(([period, item]) => `<tr><td>${safe(period)}</td><td>${Number(item.operations||0)}</td><td>${Number(item.artifacts||0)}</td><td>${Number(item.billable_units||0)}</td><td>${Number(item.voided||0)}</td></tr>`));
  const anomalies = snapshot.anomalies || [];
  document.querySelector('#anomalyList').innerHTML = anomalies.length
    ? anomalies.map(item => `<p class="ops-alert"><strong>${safe(item.severity)}</strong> · ${safe(item.code).replaceAll('_',' ')} · ${Number(item.count)}</p>`).join('')
    : '<p class="note">No configured anomaly threshold was crossed in this period.</p>';
  const reconciliation = snapshot.reconciliation || {};
  document.querySelector('#reconciliationTable').innerHTML = renderTable(
    ['Net purchases','Wallet ledger net','Failed Stripe events','Failed cloud jobs'],
    [`<tr><td>${Number(reconciliation.net_purchase_cents||0)/100}</td><td>${Number(reconciliation.wallet_ledger_net_cents||0)/100}</td><td>${Number(reconciliation.failed_stripe_events||0)}</td><td>${Number(reconciliation.failed_cloud_jobs||0)}</td></tr>`]);
  const cloudPhoto = snapshot.cloudPhoto || {};
  const dollars = cents => `$${(Number(cents || 0) / 100).toFixed(2)}`;
  const microDollars = value => `$${(Number(value || 0) / 1_000_000).toFixed(4)}`;
  document.querySelector('#cloudPhotoState').textContent = cloudPhoto.execution_available
    ? 'Execution enabled — production activation must be blocked until every release gate is accepted.'
    : `${Number(cloudPhoto.active_prices || 0) ? 'Price row active; execution remains disabled.' : 'No active customer price; execution remains disabled.'}`;
  cloudPhotoTable.innerHTML = renderTable(
    ['Quotes','Quoted','Reserved','Settled','Voided','Expired','Quoted value','Reserved value','Settled value','Provider cost','Stale quotes','Stale reserves','Cost-cap breaches','Active prices'],
    [`<tr><td>${Number(cloudPhoto.quotes||0)}</td><td>${Number(cloudPhoto.quoted||0)}</td><td>${Number(cloudPhoto.reserved||0)}</td><td>${Number(cloudPhoto.settled||0)}</td><td>${Number(cloudPhoto.voided||0)}</td><td>${Number(cloudPhoto.expired||0)}</td><td>${dollars(cloudPhoto.quoted_cents)}</td><td>${dollars(cloudPhoto.reserved_cents)}</td><td>${dollars(cloudPhoto.settled_cents)}</td><td>${microDollars(cloudPhoto.provider_cost_microusd)}</td><td>${Number(cloudPhoto.stale_quotes||0)}</td><td>${Number(cloudPhoto.stale_reserves||0)}</td><td>${Number(cloudPhoto.cost_cap_breaches||0)}</td><td>${Number(cloudPhoto.active_prices||0)}</td></tr>`]);
  document.querySelector('#productTable').innerHTML = renderTable(
    ['Product','Activity','Status','Operations','Artifacts','Billable units'],
    products.map(item => `<tr><td>${safe(item.product)}</td><td>${safe(item.artifact_kind)}</td><td>${safe(item.status)}</td><td>${Number(item.operations)}</td><td>${Number(item.artifacts)}</td><td>${Number(item.billable_units)}</td></tr>`));
  document.querySelector('#failureTable').innerHTML = renderTable(
    ['Reason','Product','Activity','Operations','Artifacts'],
    (snapshot.failures || []).map(item => `<tr><td>${safe(item.reason)}</td><td>${safe(item.product)}</td><td>${safe(item.artifact_kind)}</td><td>${Number(item.operations)}</td><td>${Number(item.artifacts)}</td></tr>`));
  document.querySelector('#accountTable').innerHTML = renderTable(
    ['Account','Account status','Plan','License','Period units','Last activity'],
    (snapshot.accounts || []).map(item => `<tr><td>${safe(item.account_id)}</td><td>${safe(item.account_status)}</td><td>${safe(item.plan || '—')}</td><td>${safe(item.license_status || '—')}</td><td>${Number(item.period_units||0)}</td><td>${item.last_activity_at ? new Date(Number(item.last_activity_at)*1000).toLocaleString() : '—'}</td></tr>`));
}

async function load() {
  try {
    status.textContent = 'Loading privacy-minimized operational data…';
    const query = periodFilter.value ? `?period=${encodeURIComponent(periodFilter.value)}` : '';
    const response = await fetch(apiUrl(`/api/admin/usage${query}`), { credentials: 'include', headers: { Accept: 'application/json' } });
    const data = response.headers.get('Content-Type')?.includes('application/json') ? await response.json() : {};
    if (!response.ok) throw new Error(data.error || 'operations_unavailable');
    snapshot = data;
    periodFilter.value = data.period;
    status.textContent = `${data.period} · identifiers are pseudonymous; no media, prompts, filenames, keys, or raw emails are collected here.`;
    render();
  } catch (error) {
    status.textContent = `Operations access unavailable: ${error.message}. This view requires the team Access policy and admin allowlist.`;
  }
}

const privacyActionLabel = value => String(value || '').replaceAll('_', ' ');
const privacyAge = requestedAt => {
  const days = Math.max(0, Math.floor((Date.now() / 1000 - Number(requestedAt || 0)) / 86400));
  return days === 0 ? 'Today' : `${days} day${days === 1 ? '' : 's'}`;
};

function privacyButtons(item) {
  if (item.status === 'open') return '<button class="btn" data-privacy-action="start_review">Start review</button>';
  if (item.status === 'in_review' && Number(item.hold_active)) {
    return '<button class="btn" data-privacy-action="annotate">Add annotation</button><button class="btn" data-privacy-action="release_hold">Release hold</button>';
  }
  if (item.status === 'in_review') {
    return '<button class="btn" data-privacy-action="annotate">Add annotation</button><button class="btn" data-privacy-action="place_hold">Place legal hold</button><button class="btn" data-privacy-action="complete">Mark complete</button><button class="btn" data-privacy-action="deny">Deny</button>';
  }
  return '<button class="btn" data-privacy-action="reopen">Reopen</button>';
}

function renderPrivacyQueue() {
  privacyRequestTable.innerHTML = renderTable(
    ['Request', 'Account', 'Type', 'State', 'Age', 'History', 'Actions'],
    privacyQueue.map(item => {
      const history = (item.actions || []).slice(0, 3).map(action => `${privacyActionLabel(action.action)} · ${privacyActionLabel(action.reasonCode)}`).join('; ') || 'No actions yet';
      const state = Number(item.hold_active) ? `${privacyActionLabel(item.status)} · ${privacyActionLabel(item.hold_reason_code)}` : privacyActionLabel(item.status);
      return `<tr data-privacy-request-id="${safe(item.id)}"><td>${safe(item.id)}</td><td>${safe(item.account_id)}</td><td>${safe(item.request_type)}</td><td>${safe(state)}</td><td>${safe(privacyAge(item.requested_at))}</td><td class="privacy-history">${safe(history)}</td><td><div class="privacy-actions">${privacyButtons(item)}</div></td></tr>`;
    })
  );
}

async function loadPrivacyQueue() {
  try {
    privacySupportStatus.textContent = 'Loading the privacy request queue…';
    const query = `?status=${encodeURIComponent(privacyStatusFilter.value)}`;
    const response = await fetch(apiUrl(`/api/admin/privacy-requests${query}`), {
      credentials: 'include', headers: { Accept: 'application/json' }
    });
    const data = response.headers.get('Content-Type')?.includes('application/json') ? await response.json() : {};
    if (!response.ok) throw new Error(data.error || 'privacy_support_unavailable');
    privacyQueue = data.requests || [];
    privacySupportStatus.textContent = `${privacyQueue.length} privacy request${privacyQueue.length === 1 ? '' : 's'} · pseudonymous identifiers and structured actions only.`;
    renderPrivacyQueue();
  } catch (error) {
    privacyQueue = [];
    renderPrivacyQueue();
    privacySupportStatus.textContent = `Privacy support unavailable: ${error.message}. This queue requires the team Access policy and admin allowlist.`;
  }
}

function renderCustomerCare() {
  if (!customerCareSnapshot) {
    customerCareResults.innerHTML = renderTable(['Record', 'Type', 'Status', 'Amount', 'Remaining or balance'], []);
    return;
  }
  const dollars = cents => Number.isFinite(Number(cents)) ? `$${(Number(cents) / 100).toFixed(2)}` : '—';
  const purchaseRows = (customerCareSnapshot.purchases || []).map(item => {
    const remaining = Math.max(0, Number(item.amount_total || 0) - Number(item.amount_refunded || 0));
    return `<tr><td>${safe(item.source_id)}</td><td>${safe(item.kind)}</td><td>${safe(item.status)}</td><td>${dollars(item.amount_total)}</td><td>${dollars(remaining)}</td></tr>`;
  });
  const licenseRows = (customerCareSnapshot.licenses || []).map(item => {
    const balance = customerCareSnapshot.balances?.[item.id] || {};
    return `<tr><td>${safe(item.id)}</td><td>${safe(item.plan)} ${safe(item.selected_product || 'studio')}</td><td>${safe(item.status)}</td><td>—</td><td>${dollars(balance.cloudBalanceCents)}</td></tr>`;
  });
  const actionRows = (customerCareSnapshot.actions || []).map(item =>
    `<tr><td>${safe(item.id)}</td><td>${safe(item.action_type)}</td><td>${safe(item.status)}</td><td>${item.amount_cents == null ? Number(item.quantity || 0).toLocaleString() : dollars(item.amount_cents)}</td><td>${safe(item.reason_code)}${item.linkedTicket ? ' · ticket linked' : ''}</td></tr>`);
  customerCareResults.innerHTML = renderTable(
    ['Record', 'Type', 'Status', 'Amount', 'Remaining or balance'],
    [...purchaseRows, ...licenseRows, ...actionRows]
  );
}

async function loadCustomerCare() {
  const query = careLookup.value.trim();
  if (!query) {
    customerCareStatus.textContent = 'Enter an ID to review customer-care options.';
    customerCareSnapshot = null;
    renderCustomerCare();
    return;
  }
  try {
    customerCareStatus.textContent = 'Looking up the customer-care record…';
    const response = await fetch(apiUrl(`/api/admin/customer-care?query=${encodeURIComponent(query)}`), {
      credentials: 'include', headers: { Accept: 'application/json' }
    });
    const data = response.headers.get('Content-Type')?.includes('application/json') ? await response.json() : {};
    if (!response.ok) throw new Error(data.error || 'customer_care_lookup_failed');
    customerCareSnapshot = data;
    const firstLicense = data.licenses?.[0]?.id || data.purchases?.find(item => item.license_id)?.license_id || '';
    const firstPurchase = data.purchases?.[0] || null;
    if (firstLicense && !creditForm.elements.licenseId.value) creditForm.elements.licenseId.value = firstLicense;
    if (firstPurchase) {
      if (!refundForm.elements.purchaseSourceId.value) refundForm.elements.purchaseSourceId.value = firstPurchase.source_id || '';
      if (!refundForm.elements.stripePaymentIntentId.value) refundForm.elements.stripePaymentIntentId.value = firstPurchase.stripe_payment_intent_id || '';
    }
    customerCareStatus.textContent = `${(data.licenses || []).length} license record(s), ${(data.purchases || []).length} purchase record(s), ${(data.actions || []).length} prior action(s).`;
    renderCustomerCare();
  } catch (error) {
    customerCareSnapshot = null;
    renderCustomerCare();
    customerCareStatus.textContent = `Customer care unavailable: ${error.message}. This requires the team Access policy and admin allowlist.`;
  }
}

async function submitCareForm(form, path, buildPayload, successLabel) {
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  customerCareStatus.textContent = `${successLabel} in progress…`;
  try {
    const response = await fetch(apiUrl(path), {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify(buildPayload(new FormData(form)))
    });
    const data = response.headers.get('Content-Type')?.includes('application/json') ? await response.json() : {};
    if (!response.ok) throw new Error(data.error || 'customer_care_action_failed');
    customerCareStatus.textContent = `${successLabel} recorded. Refresh the lookup before taking another action.`;
    form.elements.confirm.checked = false;
    await loadCustomerCare();
  } catch (error) {
    customerCareStatus.textContent = `${successLabel} failed: ${error.message}. Nothing is assumed; check the record before retrying.`;
  } finally {
    button.disabled = false;
  }
}

const privacyActionPayload = (action, item) => {
  const reasonCode = action === 'start_review' ? 'identity_verification'
    : action === 'annotate' ? privacyReason.value
    : action === 'place_hold' ? 'legal_hold'
    : action === 'release_hold' ? (item.hold_reason_code || 'legal_hold')
    : action === 'complete' ? 'request_fulfilled'
    : action === 'deny' ? 'request_not_verified' : 'owner_reopened';
  return { action, reasonCode, ticketReference: privacyTicketReference.value.trim() || null };
};

privacyRequestTable.addEventListener('click', async event => {
  const target = event.target instanceof Element ? event.target : null;
  const button = target?.closest('[data-privacy-action]');
  const row = button?.closest('[data-privacy-request-id]');
  if (!button || !row) return;
  const item = privacyQueue.find(candidate => candidate.id === row.dataset.privacyRequestId);
  if (!item) return;
  const action = button.dataset.privacyAction;
  if (['place_hold', 'complete', 'deny'].includes(action) &&
      !window.confirm(`${privacyActionLabel(action)} this ${item.request_type} request?`)) return;
  button.disabled = true;
  privacySupportStatus.textContent = `${privacyActionLabel(action)} in progress…`;
  try {
    const response = await fetch(apiUrl(`/api/admin/privacy-requests/${encodeURIComponent(item.id)}/actions`), {
      method: 'POST', credentials: 'include',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify(privacyActionPayload(action, item))
    });
    const data = response.headers.get('Content-Type')?.includes('application/json') ? await response.json() : {};
    if (!response.ok) throw new Error(data.error || 'privacy_support_action_failed');
    privacyTicketReference.value = '';
    await loadPrivacyQueue();
  } catch (error) {
    privacySupportStatus.textContent = `Privacy support action failed: ${error.message}. No completion is assumed; refresh before retrying.`;
    button.disabled = false;
  }
});

periodFilter.addEventListener('change', load);
productFilter.addEventListener('change', render);
statusFilter.addEventListener('change', render);
privacyStatusFilter.addEventListener('change', loadPrivacyQueue);
document.querySelector('#refreshPrivacyQueue').addEventListener('click', loadPrivacyQueue);
careLookupButton.addEventListener('click', loadCustomerCare);
careLookup.addEventListener('keydown', event => { if (event.key === 'Enter') loadCustomerCare(); });
creditForm.addEventListener('submit', event => {
  event.preventDefault();
  submitCareForm(creditForm, '/api/admin/customer-care/credit', form => ({
    licenseId: form.get('licenseId'),
    creditType: form.get('creditType'),
    amount: Number(form.get('amount')),
    reasonCode: form.get('reasonCode'),
    ticketReference: form.get('ticketReference'),
    confirm: form.get('confirm') === 'on'
  }), 'Credit');
});
refundForm.addEventListener('submit', event => {
  event.preventDefault();
  submitCareForm(refundForm, '/api/admin/customer-care/refund', form => ({
    purchaseSourceId: form.get('purchaseSourceId') || null,
    stripePaymentIntentId: form.get('stripePaymentIntentId') || null,
    amountCents: form.get('amountCents') ? Number(form.get('amountCents')) : null,
    reasonCode: form.get('reasonCode'),
    ticketReference: form.get('ticketReference'),
    confirm: form.get('confirm') === 'on'
  }), 'Refund request');
});
document.querySelector('#exportCsv').addEventListener('click', () => {
  if (!snapshot) return;
  const quote = value => `"${String(value ?? '').replaceAll('"','""')}"`;
  const rows = [['period','product','activity','status','operations','artifacts','billable_units'],
    ...filteredProducts.map(item => [snapshot.period,item.product,item.artifact_kind,item.status,item.operations,item.artifacts,item.billable_units])];
  const blob = new Blob([rows.map(row => row.map(quote).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob);
  link.download = `materiallogix-operations-${snapshot.period}.csv`; link.click(); URL.revokeObjectURL(link.href);
});
load();
loadPrivacyQueue();
renderCustomerCare();
