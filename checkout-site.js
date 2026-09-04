import { EXPORT_PRODUCTS, exportPrice } from './studio/js/pricing.js';

const money = amount => `$${Number(amount).toFixed(2)}`;

const ready = document.readyState === 'loading'
  ? new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }))
  : Promise.resolve();

await ready;

// A paid Stripe return can land here just as easily as in the Studio - the
// success URL is set by the billing service, not by this repository - so the
// marketing page has to be able to redeem a claim too. Imported only when
// there is one, so an ordinary visit pays nothing for it.
let pendingClaim = false;
try { pendingClaim = Boolean(sessionStorage.getItem('materiallogix:pending-checkout')); } catch { /* unavailable */ }
if (new URLSearchParams(location.search).get('checkout') === 'success' || pendingClaim) {
  await import('/studio/js/checkout-result.js?v=20260904');
}

const pricing = document.querySelector('#pricing');
if (pricing && !document.querySelector('#materiallogixCheckoutUi')) {
  const style = document.createElement('style');
  style.id = 'materiallogixCheckoutUi';
  style.textContent = `
    .commerce-toolbar{display:flex;align-items:end;justify-content:space-between;gap:16px;margin:20px 0 8px;padding:16px 18px;border:1px solid var(--hair);border-radius:14px;background:rgba(255,255,255,.48)}
    .commerce-toolbar label{display:grid;gap:6px;font-size:12px;font-weight:700;color:var(--ink-2)}
    .commerce-toolbar select,.commerce-promo input{min-height:44px;border:1px solid var(--hair);border-radius:10px;background:var(--card);color:var(--ink);padding:0 12px;font:inherit}
    .commerce-toolbar p{margin:0;max-width:50ch;color:var(--muted);font-size:12px}
    .checkout-cta{width:100%;margin-top:16px;white-space:normal;text-align:center}
    .checkout-cta+.checkout-cta{margin-top:8px}
    .commerce-purchase{display:grid;gap:12px;margin:18px 0 0;padding:18px;border:1px solid var(--hair);border-radius:14px;background:rgba(255,255,255,.48)}
    .commerce-promo{display:grid;grid-template-columns:minmax(0,1fr);gap:6px;max-width:420px;font-size:12px;font-weight:700;color:var(--ink-2)}
    .commerce-consent{display:flex;align-items:flex-start;gap:10px;color:var(--ink-2);font-size:12px;line-height:1.5}
    .commerce-consent input{width:20px;height:20px;flex:0 0 auto;margin:1px 0 0;accent-color:var(--gold)}
    .commerce-consent a{text-decoration:underline;text-underline-offset:2px}
    #checkoutStatus{min-height:1.5em;margin:0;color:var(--ink-2);font-size:12px;font-weight:600}
    @media(max-width:720px){.commerce-toolbar{align-items:stretch;flex-direction:column}.commerce-toolbar label{width:100%}.commerce-toolbar select{width:100%}}
  `;
  document.head.append(style);

  const plans = [...pricing.querySelectorAll('.plan')];
  const card = title => plans.find(item => item.querySelector('h3')?.textContent.trim().toLowerCase() === title.toLowerCase());
  const addButton = (target, attributes, label, variant = 'primary') => {
    if (!target) return null;
    const selector = attributes.checkoutPlan
      ? `[data-checkout-plan="${attributes.checkoutPlan}"]`
      : `[data-checkout-sku="${attributes.checkoutSku}"]`;
    let button = target.querySelector(selector);
    if (button) return button;
    button = document.createElement('button');
    button.type = 'button';
    button.className = `btn${variant === 'primary' ? ' primary' : ''} checkout-cta`;
    if (attributes.checkoutPlan) button.dataset.checkoutPlan = attributes.checkoutPlan;
    if (attributes.checkoutSku) button.dataset.checkoutSku = attributes.checkoutSku;
    button.textContent = label;
    target.append(button);
    return button;
  };

  // A photo, a minute of audio and a minute of video are three different
  // things to buy, so the free card offers all three rather than one "export".
  const preview = card('Free Preview');
  for (const item of EXPORT_PRODUCTS) {
    const quote = exportPrice(item.id);
    addButton(preview, { checkoutSku: item.id }, `${item.label} — ${money(quote.total)}`, 'secondary');
  }
  addButton(card('Voice Starter'), { checkoutPlan: 'voice_starter' }, 'Choose Voice Starter');

  // A card now carries its own switches - Standard/Pro, and on Single Studio the
  // Studio itself - so one button per card follows them rather than a button
  // per combination sitting hidden behind CSS.
  const checkedId = (cardEl, names) => names.find(name => cardEl.querySelector(`#${name}`)?.checked);

  const wireCard = (cardEl, resolve) => {
    if (!cardEl) return;
    const first = resolve(cardEl);
    const button = addButton(cardEl, { checkoutPlan: first.plan }, first.label);
    if (!button) return;
    button.dataset.label = first.label;
    const sync = () => {
      const next = resolve(cardEl);
      button.dataset.checkoutPlan = next.plan;
      button.dataset.label = next.label;
      button.textContent = next.label;
      // checkout.js decides which terms a plan can be bought on.
      globalThis.dispatchEvent(new CustomEvent('materiallogix:checkout-buttons-changed'));
    };
    for (const input of cardEl.querySelectorAll('.tier-radio, .prod-radio')) {
      input.addEventListener('change', sync);
    }
    sync();
  };

  wireCard(card('Single Studio'), cardEl => {
    const product = (checkedId(cardEl, ['sp-photo', 'sp-video', 'sp-voice']) || 'sp-photo').slice(3);
    const pro = checkedId(cardEl, ['ss-pro']) === 'ss-pro';
    const named = product[0].toUpperCase() + product.slice(1);
    return pro
      ? { plan: `single_pro_${product}`, label: `Choose Single Studio Pro \u2014 ${named}` }
      : { plan: `single_${product}`, label: `Choose Single Studio \u2014 ${named}` };
  });

  wireCard(card('Full Studio'), cardEl => (checkedId(cardEl, ['fs-pro']) === 'fs-pro'
    ? { plan: 'pro', label: 'Choose Pro Studio' }
    : { plan: 'full', label: 'Choose Full Studio' }));

  const plansContainer = pricing.querySelector('.plans');

  let purchase = pricing.querySelector('.commerce-purchase');
  if (!purchase) {
    purchase = document.createElement('div');
    purchase.className = 'commerce-purchase';
    plansContainer?.after(purchase);
  }

  let promoRow = document.querySelector('#promoRow');
  if (!promoRow) {
    promoRow = document.createElement('label');
    promoRow.id = 'promoRow';
    promoRow.className = 'commerce-promo';
    promoRow.hidden = true;
    promoRow.innerHTML = 'Promo code <input id="promoCode" type="text" inputmode="text" autocomplete="off" maxlength="64" placeholder="Optional">';
  }
  if (!promoRow.closest('.commerce-purchase')) {
    promoRow.classList.add('commerce-promo');
    purchase.append(promoRow);
  }

  if (!document.querySelector('#purchaseConsent')) {
    const consent = document.createElement('label');
    consent.className = 'commerce-consent';
    consent.innerHTML = `<input id="purchaseConsent" type="checkbox"><span>I agree to the <a href="/legal/terms.html">Terms</a>, <a href="/legal/refunds.html">Refund Policy</a>, and <a href="/legal/privacy.html">Privacy Policy</a>. Paid plans renew at the selected interval until canceled.</span>`;
    purchase.append(consent);
  }

  if (!document.querySelector('#checkoutStatus')) {
    const status = document.createElement('p');
    status.id = 'checkoutStatus';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.textContent = 'No payment is taken until you confirm inside Stripe Checkout.';
    purchase.append(status);
  }

  await import('/studio/js/checkout.js?v=20260903');
}
