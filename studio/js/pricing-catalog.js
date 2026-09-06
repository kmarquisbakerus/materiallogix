export const ACTIVE_PRICE_CATALOG = Object.freeze({
  version: 'launch-2026-08-27',
  effectiveFrom: '2026-08-27',
  stage: 'launch_founding',
  currency: 'usd'
});

export const PRICING = Object.freeze({
  preview: Object.freeze({ name: 'Free Preview', totalCents: 0, billedEveryMonths: 0 }),
  export: Object.freeze({ name: 'Pay-per-export', totalCents: 299, billedEveryMonths: 0 }),
  voiceStarter: Object.freeze({
    name: 'Voice Starter',
    description: '60 finished local voice minutes each month and one active personal voice profile.',
    monthly: Object.freeze({ totalCents: 500, billedEveryMonths: 1 })
  }),
  single: Object.freeze({
    name: 'Single Studio',
    description: 'Choose one: Photo, Video, or Voice.',
    products: Object.freeze({
      photo: Object.freeze({
        monthly: Object.freeze({ totalCents: 1500, billedEveryMonths: 1 }),
        quarterly: Object.freeze({ totalCents: 4000, billedEveryMonths: 3 }),
        yearly: Object.freeze({ totalCents: 14000, billedEveryMonths: 12 })
      }),
      video: Object.freeze({
        monthly: Object.freeze({ totalCents: 1500, billedEveryMonths: 1 }),
        quarterly: Object.freeze({ totalCents: 4000, billedEveryMonths: 3 }),
        yearly: Object.freeze({ totalCents: 14000, billedEveryMonths: 12 })
      }),
      voice: Object.freeze({
        monthly: Object.freeze({ totalCents: 1500, billedEveryMonths: 1 }),
        quarterly: Object.freeze({ totalCents: 4000, billedEveryMonths: 3 }),
        yearly: Object.freeze({ totalCents: 14000, billedEveryMonths: 12 })
      })
    })
  }),
  full: Object.freeze({
    name: 'Full Studio',
    description: 'Photo, Video, and Voice together.',
    monthly: Object.freeze({ totalCents: 2900, billedEveryMonths: 1 }),
    quarterly: Object.freeze({ totalCents: 7700, billedEveryMonths: 3 }),
    yearly: Object.freeze({ totalCents: 27500, billedEveryMonths: 12 })
  })
});

export function termPresentation(plan, term, selectedProduct = null) {
  const offer = PRICING[plan];
  const terms = plan === 'single' ? offer?.products?.[selectedProduct] : offer;
  if (plan === 'single' && !['photo', 'video', 'voice'].includes(selectedProduct)) throw new Error('single_product_required');
  const selected = terms?.[term];
  const monthly = terms?.monthly;
  if (!selected || !monthly) throw new Error('unknown_pricing_term');
  const baselineCents = monthly.totalCents * selected.billedEveryMonths;
  const savingsCents = Math.max(0, baselineCents - selected.totalCents);
  const savingsPercent = baselineCents ? savingsCents / baselineCents * 100 : 0;
  return {
    catalogVersion: ACTIVE_PRICE_CATALOG.version,
    totalCents: selected.totalCents,
    billedEveryMonths: selected.billedEveryMonths,
    monthlyEquivalentCents: Math.round(selected.totalCents / selected.billedEveryMonths),
    savingsCents,
    savingsPercent: +savingsPercent.toFixed(1),
    savingsBadge: savingsCents ? `Save ${Math.round(savingsPercent)}%` : null
  };
}

export const money = cents => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD'
}).format(cents / 100);
