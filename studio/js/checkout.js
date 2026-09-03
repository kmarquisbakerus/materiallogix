import { PRODUCTS, TERMS, price } from './pricing.js?v=20260903';
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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, operationId: `${analyticsSession()}:${event}`, attribution: attribution() }),
    keepalive: true
  }).catch(() => {});
}

function setStatus(message) {
  const node = document.querySelector('#checkoutStatus');
  if (node) node.textContent = message;
}

// The page owns its own term control: three radios whose :checked state drives
// which per-term price each card shows. Read that, and fall back to the legacy
// injected select only where the page has not published one.
const RADIO_TERMS = { 'term-m': 'monthly', 'term-q': 'quarterly', 'term-y': 'yearly' };

function termRadios() {
  return [...document.querySelectorAll('.term-radio')].filter(radio => RADIO_TERMS[radio.id]);
}

function selectedTerm() {
  const checked = termRadios().find(radio => radio.checked);
  if (checked) return RADIO_TERMS[checked.id];
  return document.querySelector('#billingTerm')?.value || 'monthly';
}

// Prices are published in the page's own markup, one node per term, and the
// licence service charges from the same catalogue. This never rewrites them:
// a client-side catalogue that has drifted from the published page must not be
// able to show a customer a total they will not be charged. It only settles
// which plans can be bought on the selected term, and how the button reads.
function updatePricing(termId) {
  const term = TERMS.find(item => item.id === termId) || TERMS[0];
  for (const button of document.querySelectorAll('[data-checkout-plan]')) {
    const planId = button.dataset.checkoutPlan;
    const product = PRODUCTS.find(item => item.id === planId);
    if (!product) continue;
    const amount = price(planId, term.id);
    if (!amount) {
      button.disabled = true;
      button.textContent = `${product.name} is monthly only`;
      continue;
    }
    button.disabled = false;
    button.textContent = `Choose ${product.name}`;
  }
  try { localStorage.setItem(TERM_STORAGE, term.id); } catch { /* unavailable */ }
}

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

// Storage is a convenience, never a dependency. An unguarded read throws in a
// private window with site data blocked, and a throw here is a module-level
// throw: every checkout button below would silently never get a click handler.
function rememberedTerm() {
  try {
    const remembered = localStorage.getItem(TERM_STORAGE);
    return TERMS.some(term => term.id === remembered) ? remembered : null;
  } catch {
    return null;
  }
}

const radios = termRadios();
const selector = document.querySelector('#billingTerm');
if (radios.length) {
  const remembered = rememberedTerm();
  const restore = remembered && radios.find(radio => RADIO_TERMS[radio.id] === remembered);
  if (restore) restore.checked = true;
  for (const radio of radios) radio.addEventListener('change', () => updatePricing(selectedTerm()));
  if (selector) {
    // Keep a legacy injected select in step with the page's own control rather
    // than letting two term pickers disagree about what the customer chose.
    selector.value = selectedTerm();
    selector.addEventListener('change', () => {
      const target = radios.find(radio => RADIO_TERMS[radio.id] === selector.value);
      if (target) target.checked = true;
      updatePricing(selectedTerm());
    });
  }
  updatePricing(selectedTerm());
} else if (selector) {
  const remembered = rememberedTerm();
  if (remembered) selector.value = remembered;
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
for (const button of document.querySelectorAll(checkoutSelector)) {
  button.addEventListener('click', () => beginCheckout(button));
}
