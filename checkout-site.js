const ready = document.readyState === 'loading'
  ? new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }))
  : Promise.resolve();

await ready;

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
  const addButton = (target, attributes, label) => {
    if (!target) return null;
    const selector = attributes.checkoutPlan
      ? `[data-checkout-plan="${attributes.checkoutPlan}"]`
      : `[data-checkout-sku="${attributes.checkoutSku}"]`;
    let button = target.querySelector(selector);
    if (button) return button;
    button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn primary checkout-cta';
    if (attributes.checkoutPlan) button.dataset.checkoutPlan = attributes.checkoutPlan;
    if (attributes.checkoutSku) button.dataset.checkoutSku = attributes.checkoutSku;
    button.textContent = label;
    target.append(button);
    return button;
  };

  addButton(card('Free Preview'), { checkoutSku: 'export_one' }, 'Buy one clean export — $3.99');
  addButton(card('Voice Starter'), { checkoutPlan: 'voice_starter' }, 'Choose Voice Starter');

  const single = card('Single Studio');
  if (single) {
    const panelPlans = [
      ['.p-photo', 'single_photo', 'Choose Single Studio — Photo'],
      ['.p-video', 'single_video', 'Choose Single Studio — Video'],
      ['.p-voice', 'single_voice', 'Choose Single Studio — Voice']
    ];
    let attached = 0;
    for (const [selector, plan, label] of panelPlans) {
      const panel = single.querySelector(selector);
      if (panel) {
        addButton(panel, { checkoutPlan: plan }, label);
        attached += 1;
      }
    }
    if (!attached) {
      const productSelect = document.createElement('select');
      productSelect.setAttribute('aria-label', 'Single Studio product');
      productSelect.innerHTML = '<option value="single_photo">Photo</option><option value="single_video">Video</option><option value="single_voice">Voice</option>';
      productSelect.style.cssText = 'width:100%;min-height:44px;margin-top:16px;border:1px solid var(--hair);border-radius:10px;background:var(--card);color:var(--ink);padding:0 12px;font:inherit';
      single.append(productSelect);
      const button = addButton(single, { checkoutPlan: 'single_photo' }, 'Choose Single Studio — Photo');
      productSelect.addEventListener('change', () => {
        button.dataset.checkoutPlan = productSelect.value;
        button.textContent = `Choose Single Studio — ${productSelect.options[productSelect.selectedIndex].text}`;
      });
    }
  }

  addButton(card('Full Studio'), { checkoutPlan: 'full' }, 'Choose Full Studio');

  const plansContainer = pricing.querySelector('.plans');
  if (plansContainer && !document.querySelector('#billingTerm')) {
    const toolbar = document.createElement('div');
    toolbar.className = 'commerce-toolbar';
    toolbar.innerHTML = `
      <label>Billing term
        <select id="billingTerm">
          <option value="monthly">Month-to-month</option>
          <option value="quarterly">3 months</option>
          <option value="yearly">Annual</option>
        </select>
      </label>
      <p>Choose a term, select the Studio you need, then continue to secure Stripe Checkout. The final total appears before payment.</p>`;
    plansContainer.before(toolbar);
  }

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

  await import('/studio/js/checkout.js?v=20260902');
}
