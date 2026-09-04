import { PRODUCTS, TERMS, price } from './pricing.js';
import { apiUrl } from './api-root.js';

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
  fetch(apiUrl('/api/analytics/event'), {
    method: 'POST',
    body: JSON.stringify({ event, operationId: `${analyticsSession()}:${event}`, attribution: attribution() }),
    keepalive: true
  }).catch(() => {});
}

function setStatus(message) {
  const node = document.querySelector('#checkoutStatus');
  if (node) node.textContent = message;
}

// One control decides the term. There used to be two - a radio switch that
// changed the displayed price and a select that decided the SKU - so a customer
// could read the yearly price and be charged the monthly one.
function termRadios() {
  return [...document.querySelectorAll('.term-radio')];
}

function selectedTerm() {
  const checked = termRadios().find(input => input.checked);
  const id = checked?.dataset.term || TERMS[0].id;
  return TERMS.some(term => term.id === id) ? id : TERMS[0].id;
}

/**
 * The markup and its stylesheet own which price is on screen. This only marks
 * the plans that term cannot buy, so the button never offers a price the
 * customer is not looking at.
 */
function updatePricing(termId) {
  const term = TERMS.find(item => item.id === termId) || TERMS[0];
  for (const button of document.querySelectorAll('[data-checkout-plan]')) {
    const product = PRODUCTS.find(item => item.id === button.dataset.checkoutPlan);
    if (!product) continue;
    const amount = price(product.id, term.id);
    button.disabled = !amount;
    button.textContent = amount
      ? (button.dataset.label || `Choose ${product.name}`)
      : `${product.name} is monthly only`;
  }
  try { localStorage.setItem(TERM_STORAGE, term.id); } catch { /* unavailable */ }
}

/** Re-read the buttons after another script relabels or replaces them. */
globalThis.addEventListener('materiallogix:checkout-buttons-changed', () => updatePricing(selectedTerm()));

async function beginCheckout(button) {
  const consent = document.querySelector('#purchaseConsent');
  if (!consent?.checked) {
    consent?.focus();
    setStatus('Review and accept the purchase terms before continuing.');
    return;
  }

  const termId = selectedTerm();
  const planId = button.dataset.checkoutPlan || '';
  const directSku = button.dataset.checkoutSku || '';
  if (!directSku && !price(planId, termId)) {
    setStatus('That plan is not available for the selected term.');
    return;
  }

  const operationId = crypto.randomUUID();
  button.disabled = true;
  setStatus('Opening secure Stripe checkout…');
  const promoField = document.querySelector('#promoCode');
  const promotionCode = promoField?.value.trim().toUpperCase() || '';
  try {
    const response = await fetch(apiUrl('/api/checkout/session'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': operationId },
      body: JSON.stringify({
        sku: directSku || `${planId}_${termId}`,
        attribution: attribution(),
        ...(promotionCode ? { promotionCode } : {})
      })
    });
    const result = await response.json();
    if (!response.ok || !result.url) throw new Error(result.error || 'checkout_unavailable');
    location.assign(result.url);
  } catch (error) {
    button.disabled = false;
    if (error?.message === 'invalid_promo_code') {
      setStatus('That promo code is not valid or has expired. Remove it or try another — no payment was taken.');
      promoField?.focus();
    } else if (error?.message === 'promo_code_already_used') {
      setStatus('That promo code was already used on this account. Remove it to continue — no payment was taken.');
      promoField?.focus();
    } else {
      setStatus('Checkout is temporarily unavailable. No payment was taken. Please try again.');
    }
  }
}

const checkoutSelector = '[data-checkout-plan], [data-checkout-sku]';
const promoRow = document.querySelector('#promoRow');
if (promoRow && document.querySelector(checkoutSelector)) promoRow.hidden = false;

const terms = termRadios();
if (terms.length) {
  const remembered = localStorage.getItem(TERM_STORAGE);
  const restore = terms.find(input => input.dataset.term === remembered);
  if (restore) restore.checked = true;
  for (const input of terms) input.addEventListener('change', () => updatePricing(selectedTerm()));
  updatePricing(selectedTerm());
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
for (const button of document.querySelectorAll(checkoutSelector)) {
  button.addEventListener('click', () => beginCheckout(button));
}
