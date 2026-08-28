import { cloudVideoSecondsForCents, CLOUD_PRICING } from './pricing.js';
import { pendingUsageReleases } from './billing-client.js';

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
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store',
    headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) }, ...options });
  const data = response.headers.get('Content-Type')?.includes('application/json') ? await response.json() : {};
  if (!response.ok) throw new Error(data.error || 'request_unavailable');
  return data;
}

function renderRules() {
  const refillCents = cents(walletAmount);
  const refillSeconds = cloudVideoSecondsForCents(refillCents);
  document.querySelector('#walletEstimate').textContent = Number.isInteger(refillCents) && refillCents >= 500 && refillCents <= 50000
    ? `At the current ${money(CLOUD_PRICING.videoUpscale.price * 100)}/finished-minute rate, this adds about ${videoTime(refillSeconds)} of Video processing. Each completed package rounds once to 10 seconds.`
    : 'Choose an amount from $5 through $500 to see its current Video-time estimate.';
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
  status.textContent = `${data.period} · server-verified`;
  cards.innerHTML = [
    card('Plan', safe(data.license?.plan || 'No active plan')),
    card('Included used', `${Number(data.included.used).toLocaleString()} / ${Number(data.included.limit).toLocaleString()}`),
    card('Included remaining', Number(data.included.remaining).toLocaleString()),
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
  const tx = wallet.recent.map(item => `<tr><td>${safe(item.entry_type)}</td><td>${money(item.amount_cents)}</td><td>${new Date(Number(item.created_at) * 1000).toLocaleString()}</td></tr>`).join('');
  document.querySelector('#walletTransactions').innerHTML = `<table class="usage-table"><thead><tr><th>Activity</th><th>Amount</th><th>Time</th></tr></thead><tbody>${tx || '<tr><td colspan="3">No wallet transactions.</td></tr>'}</tbody></table>`;
  const promoTx = (wallet.promotionalRecent || []).map(item => `<tr><td>${safe(item.entry_type)}</td><td>${money(item.amount_cents)}</td><td>${new Date(Number(item.created_at) * 1000).toLocaleString()}</td></tr>`).join('');
  document.querySelector('#walletTransactions').insertAdjacentHTML('afterbegin', `<p class="note">Included Video time is a promotional plan benefit, not cash or a transferable wallet balance. It expires at the next paid-period boundary and is used before purchased wallet funds.</p><table class="usage-table"><thead><tr><th>Included-time activity</th><th>Value</th><th>Time</th></tr></thead><tbody>${promoTx || '<tr><td colspan="3">No included Video-time activity.</td></tr>'}</tbody></table>`);
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
  if (!Number.isInteger(amountCents) || amountCents < 500 || amountCents > 50000) { walletStatus.textContent = 'Choose a refill from $5.00 through $500.00.'; return; }
  if (!confirm(`Continue to Stripe to add exactly ${money(amountCents)} to your prepaid cloud wallet? This is a one-time refill and does not enable automatic top-up.`)) return;
  walletStatus.textContent = 'Creating secure Stripe Checkout…';
  try {
    const result = await api('/api/wallet/checkout', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ amountCents }) });
    location.assign(result.url);
  } catch (error) { walletStatus.textContent = `Refill unavailable: ${error.message}`; }
};

document.querySelector('#autoSetup').onclick = async () => {
  walletStatus.textContent = 'Opening Stripe to save a payment method securely…';
  try {
    const result = await api('/api/wallet/auto-topup/setup', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() } });
    location.assign(result.url);
  } catch (error) { walletStatus.textContent = `Payment-method setup unavailable: ${error.message}`; }
};

document.querySelector('#autoEnable').onclick = async () => {
  renderRules();
  if (!confirm(`${document.querySelector('#autoRules').textContent}\n\nExplicitly enable this automatic billing rule?`)) return;
  walletStatus.textContent = 'Saving automatic top-up rule…';
  try {
    await api('/api/wallet/auto-topup', { method: 'POST', body: JSON.stringify({ enabled: true, confirm: true,
      thresholdCents: cents(autoThreshold), refillCents: cents(autoRefill), monthlyCapCents: cents(autoCap) }) });
    walletStatus.textContent = 'Automatic top-up is enabled with the rule shown above.';
  } catch (error) { walletStatus.textContent = `Automatic top-up was not enabled: ${error.message}`; }
};

document.querySelector('#autoDisable').onclick = async () => {
  try {
    await api('/api/wallet/auto-topup', { method: 'POST', body: JSON.stringify({ enabled: false }) });
    walletStatus.textContent = 'Automatic top-up is disabled immediately. Manual refills remain available.';
  } catch (error) { walletStatus.textContent = `Could not disable automatic top-up: ${error.message}`; }
};

load().catch(error => { status.textContent = `Usage is unavailable: ${error.message}. Sign in through the Material Logic account gateway.`; });
