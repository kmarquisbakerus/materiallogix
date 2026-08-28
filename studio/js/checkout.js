import { PRODUCTS, TERMS, price } from './pricing.js';

const API_ROOT = 'https://studio.materiallogix.com/api';
const TERM_STORAGE = 'materiallogix:checkout-term';
const ATTRIBUTION_STORAGE = 'materiallogix:attribution';
const ANALYTICS_SESSION = 'materiallogix:analytics-session';

function attribution() {
  const params = new URLSearchParams(location.search);
  let saved = {};
  try { saved = JSON.parse(sessionStorage.getItem(ATTRIBUTION_STORAGE)) || {}; } catch { saved = {}; }
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
    const value = params.get(key);
    if (value) saved[key] = value.slice(0, 200);
  }
  if (!saved.referrer && document.referrer) saved.referrer = document.referrer.slice(0, 200);
  try { sessionStorage.setItem(ATTRIBUTION_STORAGE, JSON.stringify(saved)); } catch { /* unavailable */ }
  return saved;
}

function analyticsSession() {
  try {
    let value = sessionStorage.getItem(ANALYTICS_SESSION);
    if (!value) {
      value = crypto.randomUUID();
      sessionStorage.setItem(ANALYTICS_SESSION, value);
    }
    return value;
  } catch {
    return crypto.randomUUID();
  }
}

function sendAnalytics(event) {
  fetch(`${API_ROOT}/analytics/event`, {
    method: 'POST',
    body: JSON.stringify({ event, operationId: `${analyticsSession()}:${event}`, attribution: attribution() }),
    keepalive: true
  }).catch(() => {});
}

function selectedTerm() {
  return document.querySelector('#billingTerm')?.value || 'monthly';
}

function updatePricing(termId) {
  const term = TERMS.find(item => item.id === termId) || TERMS[0];
  for (const button of document.querySelectorAll('[data-checkout-plan]')) {
    const planId = button.dataset.checkoutPlan;
    const product = PRODUCTS.find(item => item.id === planId);
    const amount = price(planId, term.id);
    const card = button.closest('.tier');
    if (!product || !card) continue;
    if (!amount) {
      button.disabled = true;
      button.textContent = `${product.name} is monthly only`;
      continue;
    }
    button.disabled = false;
    const priceNode = card.querySelector('.price');
    if (priceNode) priceNode.innerHTML = `$${amount.total}<small>/${term.months === 1 ? 'mo' : `${term.months} mo`}</small>`;
    button.textContent = `Choose ${product.name}`;
  }
  try { localStorage.setItem(TERM_STORAGE, term.id); } catch { /* unavailable */ }
}

async function beginCheckout(button) {
  const consent = document.querySelector('#purchaseConsent');
  if (!consent?.checked) {
    consent?.focus();
    document.querySelector('#checkoutStatus').textContent = 'Review and accept the purchase terms before continuing.';
    return;
  }
  const termId = selectedTerm();
  const planId = button.dataset.checkoutPlan;
  if (!price(planId, termId)) {
    document.querySelector('#checkoutStatus').textContent = 'That plan is not available for the selected term.';
    return;
  }
  const operationId = crypto.randomUUID();
  button.disabled = true;
  document.querySelector('#checkoutStatus').textContent = 'Opening secure Stripe checkout…';
  try {
    const response = await fetch(`${API_ROOT}/checkout/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': operationId },
      body: JSON.stringify({ sku: `${planId}_${termId}`, attribution: attribution() })
    });
    const result = await response.json();
    if (!response.ok || !result.url) throw new Error(result.error || 'checkout_unavailable');
    location.assign(result.url);
  } catch {
    button.disabled = false;
    document.querySelector('#checkoutStatus').textContent = 'Checkout is temporarily unavailable. No payment was taken. Please try again.';
  }
}

const selector = document.querySelector('#billingTerm');
if (selector) {
  const remembered = localStorage.getItem(TERM_STORAGE);
  if (TERMS.some(term => term.id === remembered)) selector.value = remembered;
  selector.addEventListener('change', () => updatePricing(selector.value));
  updatePricing(selector.value);
}
attribution();
sendAnalytics('page_view');
const pricing = document.querySelector('#pricing');
if (pricing && 'IntersectionObserver' in globalThis) {
  const observer = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) {
      sendAnalytics('pricing_view');
      observer.disconnect();
    }
  }, { threshold: 0.2 });
  observer.observe(pricing);
}
for (const button of document.querySelectorAll('[data-checkout-plan]')) {
  button.addEventListener('click', () => beginCheckout(button));
}
