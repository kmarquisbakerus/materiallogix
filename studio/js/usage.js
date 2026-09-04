import { cloudVideoSecondsForCents, CLOUD_PRICING, MONTHLY_UNITS, includedCloudCents, planLabel } from './pricing.js';
import { pendingUsageReleases, openBillingPortal } from './billing-client.js';
import { apiUrl } from './api-root.js';
import { readableServiceError } from './service-error.js';
import { count } from './plural.js';

// The wallet range is declared once in pricing.js. Reading it here keeps the
// input bounds, the guard, and the message that explains them from drifting
// apart the next time the range changes.
const REFILL_MIN_CENTS = Math.round(CLOUD_PRICING.minimumRefill * 100);
const REFILL_MAX_CENTS = Math.round(CLOUD_PRICING.maximumRefill * 100);

const status = document.querySelector('#usageStatus');
const cards = document.querySelector('#usageCards');
const table = document.querySelector('#usageTable');
const walletStatus = document.querySelector('#walletStatus');
const walletAmount = document.querySelector('#walletAmount');
const autoThreshold = document.querySelector('#autoThreshold');
const autoRefill = document.querySelector('#autoRefill');
const autoCap = document.querySelector('#autoCap');
const card = (label, value) => `<div class="usage-card"><span class="eyebrow">${label}</span><b>${value}</b></div>`;
const safe = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[character]));
const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(cents || 0) / 100);
const cents = input => Math.round(Number(input.value) * 100);
const videoTime = seconds => {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(total / 60), remainder = total % 60;
  return minutes && remainder ? `${minutes}m ${remainder}s` : minutes ? `${minutes}m` : `${remainder}s`;
};
const productLabel = value => ({ photo: 'Photo', video: 'Video', voice: 'Voice' }[value] || String(value || 'Studio'));
const activityLabel = value => ({
  proof_export: 'Watermarked proof', clean_export: 'Clean export', client_review: 'Client review file',
  contact_sheet: 'Contact sheet', upload: 'Local processing job', cloud_submission: 'Cloud package'
}[value] || String(value || 'Activity').replaceAll('_', ' '));
const statusLabel = value => ({ settled: 'Used', voided: 'Returned', authorized: 'Reserved', release_pending: 'Release pending' }[value] || String(value || 'Unknown'));
const resultLabel = item => item.status === 'voided'
  ? `Returned${item.void_reason ? ` · ${String(item.void_reason).replaceAll('_', ' ')}` : ''}`
  : item.status === 'authorized' ? 'Held temporarily until the operation finishes or is released'
    : item.status === 'settled' ? 'Finalized after the output was confirmed'
      : 'Will retry automatically when the app is online';

async function api(path, options = {}) {
  const response = await fetch(apiUrl(path), { credentials: 'include', cache: 'no-store',
    headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) }, ...options });
  const data = response.headers.get('Content-Type')?.includes('application/json') ? await response.json() : {};
  if (!response.ok) throw new Error(data.error || 'request_unavailable');
  return data;
}

function renderRules() {
  const refillCents = cents(walletAmount);
  const refillSeconds = cloudVideoSecondsForCents(refillCents);
  // The wallet buys any cloud job that exists. Voice has no cloud endpoint, so
  // the estimate must not offer minutes of it.
  const buys = [`${videoTime(refillSeconds)} of Video`];
  for (const rate of [CLOUD_PRICING.imageUpscale]) {
    if (!rate.available || !Number.isFinite(rate.price)) continue;
    buys.push(count(Math.floor(refillCents / Math.round(rate.price * 100)), 'photo'));
  }
  document.querySelector('#walletEstimate').textContent = Number.isInteger(refillCents) && refillCents >= REFILL_MIN_CENTS && refillCents <= REFILL_MAX_CENTS
    ? `That buys about ${buys.join(', or ')} — whichever you use it on. Each completed video package rounds once to 10 seconds.`
    : `Choose an amount from ${money(REFILL_MIN_CENTS)} through ${money(REFILL_MAX_CENTS)} to see what it buys.`;
  document.querySelector('#autoRules').textContent = `If the verified cloud balance is at or below ${money(cents(autoThreshold))}, add exactly ${money(cents(autoRefill))}. Never spend more than ${money(cents(autoCap))} on automatic refills in a calendar month. A 15-minute cooldown, idempotency, and failure pause prevent refill loops. You can disable this immediately.`;
  document.querySelector('#walletRefill').textContent = `Review ${money(cents(walletAmount))} refill`;
}
[walletAmount, autoThreshold, autoRefill, autoCap].forEach(input => input.addEventListener('input', renderRules));
document.querySelectorAll('[data-wallet-suggestion]').forEach(button => button.onclick = () => {
  walletAmount.value = Number(button.dataset.walletSuggestion).toFixed(2); renderRules();
});
renderRules();

async function load() {
  const [data, wallet, auto] = await Promise.all([api('/api/usage'), api('/api/wallet'), api('/api/wallet/auto-topup')]);
  const includedVideoSeconds = Number.isFinite(Number(wallet.promotionalVideoSecondsAtCurrentRate))
    ? Number(wallet.promotionalVideoSecondsAtCurrentRate)
    : cloudVideoSecondsForCents(wallet.promotionalVideoCents);
  const purchasedVideoSeconds = Number.isFinite(Number(wallet.purchasedVideoSecondsAtCurrentRate))
    ? Number(wallet.purchasedVideoSecondsAtCurrentRate)
    : cloudVideoSecondsForCents(wallet.balanceCents);
  const cloudPhoto = wallet.cloudPhoto || { priceReady: false, executionAvailable: false };
  const cloudPhotoLabel = cloudPhoto.priceReady
    ? `${money(cloudPhoto.minimumCentsPerImage)} minimum · ${money(cloudPhoto.retailCentsPerMegapixel)}/MP`
    : 'Unavailable pending benchmark and price approval';
  status.textContent = data.period ? `${data.period} · server-verified` : 'Current period · server-verified';
  // A field the service does not send must cost its own card, not the page.
  // This is the only screen a customer has for what they were charged.
  const whole = value => (Number.isFinite(Number(value)) ? Number(value).toLocaleString() : '—');
  const included = data.included || {};
  cards.innerHTML = [
    card('Plan', safe(planLabel(data.license?.plan))),
    card('Included used', `${whole(included.used)} / ${whole(included.limit)}`),
    card('Included remaining', whole(included.remaining)),
    card('Pay-per-export credits', Number(data.addOns?.local_units || 0).toLocaleString()),
    card('Included video time', videoTime(includedVideoSeconds)),
    card('Purchased wallet', `${money(wallet.balanceCents)} · about ${videoTime(purchasedVideoSeconds)}`),
    card('Cloud Photo', cloudPhotoLabel),
    card('Release pending', pendingUsageReleases().length.toLocaleString())
  ].join('');
  document.querySelector('#walletBalance').textContent = `Included Video: ${videoTime(includedVideoSeconds)} remaining (resets; no rollover) · Purchased wallet: ${money(wallet.balanceCents)}, about ${videoTime(purchasedVideoSeconds)} at the current rate · hard stop at $0.00`;
  document.querySelector('#cloudPhotoPricing').textContent = cloudPhoto.priceReady
    ? `Cloud Photo generation is quoted separately before every job: ${money(cloudPhoto.minimumCentsPerImage)} minimum per image and ${money(cloudPhoto.retailCentsPerMegapixel)} per megapixel, up to ${Number(cloudPhoto.maxVariations)} variation${Number(cloudPhoto.maxVariations) === 1 ? '' : 's'}. ${cloudPhoto.executionAvailable ? 'Execution is available.' : 'Execution remains unavailable until provider and quality acceptance pass.'} Local Photo editing and generation on this computer do not use cloud wallet funds.`
    : 'Cloud Photo generation is unavailable until its measured provider cost, customer price, rights, and output quality are accepted. Local Photo editing and generation on this computer do not use cloud wallet funds.';
  const tx = (wallet.recent || []).map(item => `<tr><td>${safe(item.entry_type)}</td><td>${money(item.amount_cents)}</td><td>${new Date(Number(item.created_at) * 1000).toLocaleString()}</td></tr>`).join('');
  document.querySelector('#walletTransactions').innerHTML = `<table class="usage-table"><thead><tr><th>Activity</th><th>Amount</th><th>Time</th></tr></thead><tbody>${tx || '<tr><td colspan="3">No wallet transactions.</td></tr>'}</tbody></table>`;
  const promoTx = (wallet.promotionalRecent || []).map(item => `<tr><td>${safe(item.entry_type)}</td><td>${money(item.amount_cents)}</td><td>${new Date(Number(item.created_at) * 1000).toLocaleString()}</td></tr>`).join('');
  document.querySelector('#walletTransactions').insertAdjacentHTML('afterbegin', `<p class="note">Included Video time is a promotional plan benefit, not cash or a transferable wallet balance. It expires at the next paid-period boundary and is used before purchased wallet funds.</p><table class="usage-table"><thead><tr><th>Included-time activity</th><th>Value</th><th>Time</th></tr></thead><tbody>${promoTx || '<tr><td colspan="3">No included Video-time activity.</td></tr>'}</tbody></table>`);
  renderPlan(data.license);
  const settings = auto.settings || {};
  if (auto.configured) {
    autoThreshold.value = (Number(settings.threshold_cents) / 100).toFixed(2);
    autoRefill.value = (Number(settings.refill_cents) / 100).toFixed(2);
    autoCap.value = (Number(settings.monthly_cap_cents) / 100).toFixed(2);
    walletStatus.textContent = settings.enabled ? 'Automatic top-up is enabled.' : `Automatic top-up is off${settings.paused_reason ? ` (${settings.paused_reason.replaceAll('_', ' ')})` : ''}.`;
  } else walletStatus.textContent = 'Automatic top-up is off.';
  renderRules();
  const summaryRows = (data.breakdown || []).map(item => `<tr><td>${safe(productLabel(item.product))}</td><td>${safe(activityLabel(item.artifact_kind))}</td><td>${Number(item.operations).toLocaleString()}</td><td>${Number(item.included_units).toLocaleString()}</td><td>${Number(item.purchased_units).toLocaleString()}</td><td>${safe(statusLabel(item.status))}</td></tr>`).join('');
  document.querySelector('#usageBreakdown').innerHTML = `<table class="usage-table"><thead><tr><th>Studio</th><th>What happened</th><th>Operations</th><th>Plan allowance</th><th>Add-on units</th><th>Result</th></tr></thead><tbody>${summaryRows || '<tr><td colspan="6">No usage in this billing period.</td></tr>'}</tbody></table>`;
  const serverRows = (data.recent || []).map(item => `<tr><td>${safe(productLabel(item.product))}</td><td>${safe(activityLabel(item.artifact_kind))}</td><td>${Number(item.requested_units)}</td><td>${Number(item.included_units)}</td><td>${Number(item.purchased_units)}</td><td>${safe(statusLabel(item.status))}</td><td>${safe(resultLabel(item))}</td><td>${new Date(Number(item.updated_at || item.created_at)*1000).toLocaleString()}</td></tr>`);
  const localRows = pendingUsageReleases().map(item => `<tr><td>Studio</td><td>Interrupted operation</td><td>—</td><td>—</td><td>—</td><td>Release pending</td><td>Will retry automatically when this app is online</td><td>${new Date(item.queuedAt).toLocaleString()}</td></tr>`);
  const rows = [...localRows, ...serverRows].join('');
  table.innerHTML = `<table class="usage-table"><thead><tr><th>Studio</th><th>What happened</th><th>Items</th><th>Plan allowance</th><th>Add-on units</th><th>Status</th><th>Meaning</th><th>Updated</th></tr></thead><tbody>${rows || '<tr><td colspan="8">No production activity yet.</td></tr>'}</tbody></table>`;
}

document.querySelector('#walletRefill').onclick = async () => {
  const amountCents = cents(walletAmount);
  if (!Number.isInteger(amountCents) || amountCents < REFILL_MIN_CENTS || amountCents > REFILL_MAX_CENTS) {
    walletStatus.textContent = `Choose a refill from ${money(REFILL_MIN_CENTS)} through ${money(REFILL_MAX_CENTS)}.`;
    return;
  }
  if (!confirm(`Continue to Stripe to add exactly ${money(amountCents)} to your prepaid cloud wallet? This is a one-time refill and does not enable automatic top-up.`)) return;
  walletStatus.textContent = 'Creating secure Stripe Checkout…';
  try {
    const result = await api('/api/wallet/checkout', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ amountCents }) });
    location.assign(result.url);
  } catch (error) { walletStatus.textContent = `Refill unavailable: ${readableServiceError(error)}.`; }
};

document.querySelector('#autoSetup').onclick = async () => {
  walletStatus.textContent = 'Opening Stripe to save a payment method securely…';
  try {
    const result = await api('/api/wallet/auto-topup/setup', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() } });
    location.assign(result.url);
  } catch (error) { walletStatus.textContent = `Payment-method setup unavailable: ${readableServiceError(error)}.`; }
};

document.querySelector('#autoEnable').onclick = async () => {
  renderRules();
  if (!confirm(`${document.querySelector('#autoRules').textContent}\n\nExplicitly enable this automatic billing rule?`)) return;
  walletStatus.textContent = 'Saving automatic top-up rule…';
  try {
    await api('/api/wallet/auto-topup', { method: 'POST', body: JSON.stringify({ enabled: true, confirm: true,
      thresholdCents: cents(autoThreshold), refillCents: cents(autoRefill), monthlyCapCents: cents(autoCap) }) });
    walletStatus.textContent = 'Automatic top-up is enabled with the rule shown above.';
  } catch (error) { walletStatus.textContent = `Automatic top-up was not enabled: ${readableServiceError(error)}.`; }
};

// Plan and payment. Every subscription needs a way out as well as a way in,
// so the portal is one click from the page that shows what the plan spent.
function renderPlan(license) {
  const plan = license?.plan ? String(license.plan) : '';
  const units = MONTHLY_UNITS[plan.replace(/^suspended:/, '')] || 0;
  const creditCents = includedCloudCents(license);
  const parts = [`Current plan: ${planLabel(plan)}.`];
  if (units) parts.push(`${units.toLocaleString()} production units each month.`);
  if (creditCents) parts.push(`${money(creditCents)} of cloud credit each paid period, spendable on photo, video or voice.`);
  parts.push(plan
    ? 'Manage billing opens the secure Stripe portal, where you can change your payment method, switch term, or cancel.'
    : 'Activate a licence in the Studio to manage billing here.');
  document.querySelector('#planSummary').textContent = parts.join(' ');
  document.querySelector('#billingPortal').disabled = !plan;
}

document.querySelector('#billingPortal').onclick = async event => {
  const button = event.currentTarget;
  const planStatus = document.querySelector('#planStatus');
  button.disabled = true;
  planStatus.textContent = 'Opening the secure Stripe billing portal…';
  try { await openBillingPortal(); }
  catch (error) {
    button.disabled = false;
    planStatus.textContent = error?.message === 'license_required'
      ? 'Activate a licence in the Studio first — billing is managed per licence.'
      : `The billing portal is unavailable: ${readableServiceError(error)}.`;
  }
};

// The markup carries starting bounds so the control is usable before scripts
// run; align them with the declared range once they have.
for (const input of [walletAmount, autoRefill]) {
  input.min = String(CLOUD_PRICING.minimumRefill);
  input.max = String(CLOUD_PRICING.maximumRefill);
}

document.querySelector('#autoDisable').onclick = async () => {
  try {
    await api('/api/wallet/auto-topup', { method: 'POST', body: JSON.stringify({ enabled: false }) });
    walletStatus.textContent = 'Automatic top-up is disabled immediately. Manual refills remain available.';
  } catch (error) { walletStatus.textContent = `Could not disable automatic top-up: ${readableServiceError(error)}.`; }
};

load().catch(error => { status.textContent = `Usage is unavailable: ${readableServiceError(error)}. Sign in through the MaterialLogix account gateway.`; });
