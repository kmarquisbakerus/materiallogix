// The pricing model — single source of truth for the site, the app, and the
// license issuer. Change numbers here, everywhere follows.
//
// Unit economics that make this safe: every render in v1 executes on the
// customer's own hardware, so marginal cost per render is zero — a user who
// renders 1,000 times costs exactly what a user who renders once costs.
// The only spend-per-use surface is the future cloud tier, which is
// prepaid-credits-only with hard caps. Subscriptions here price CAPABILITY,
// not consumption.

export const TERMS = [
  { id: 'monthly', label: 'Month-to-month', months: 1 },
  { id: 'quarterly', label: '3 months', months: 3 },
  { id: 'yearly', label: 'Annual', months: 12 }
];

export const PRODUCTS = [
  {
    id: 'voice_starter',
    plan: 'voice_starter', selectedProduct: 'voice',
    name: 'Voice Starter',
    monthly: 5,
    totals: { monthly: 5 },
    pitch: '60 finished local voice minutes each month and one active personal voice profile.'
  },
  {
    id: 'single_photo',
    plan: 'single', selectedProduct: 'photo',
    name: 'Single Studio — Photo',
    monthly: 15,
    totals: { monthly: 15, quarterly: 40, yearly: 140 },
    pitch: 'Photo direction, review, and delivery.'
  },
  {
    id: 'single_video',
    plan: 'single', selectedProduct: 'video',
    name: 'Single Studio — Video',
    monthly: 15,
    totals: { monthly: 15, quarterly: 40, yearly: 140 },
    pitch: 'Video direction, editing, and accepted render features.'
  },
  {
    id: 'single_voice',
    plan: 'single', selectedProduct: 'voice',
    name: 'Single Studio — Voice',
    monthly: 15,
    totals: { monthly: 15, quarterly: 40, yearly: 140 },
    pitch: 'Voice direction and accepted local voice features.'
  },
  {
    id: 'full',
    plan: 'full', selectedProduct: null,
    name: 'Full Studio',
    monthly: 29,
    totals: { monthly: 29, quarterly: 77, yearly: 275 },
    pitch: 'Photo, Video, and Voice in one license.'
  }
];

/** Price for a product on a term, and the effective monthly rate. */
export function price(productId, termId) {
  const p = PRODUCTS.find(x => x.id === productId);
  const t = TERMS.find(x => x.id === termId);
  if (!p || !t) return null;
  const total = p.totals[termId];
  // A product that is not offered on this term has no price. Returning a record
  // with an undefined total reads as truthy to every caller, which is how the
  // monthly-only Voice Starter used to render "$undefined / 3 mo" and still let
  // a customer open a checkout for a SKU the licence service does not sell.
  if (typeof total !== 'number') return null;
  const baseline = p.monthly * t.months;
  const savings = baseline - total;
  return { total, perMonth: +(total / t.months).toFixed(2), months: t.months,
    savings, savingsPercent: baseline === total ? 0 : +((savings / baseline) * 100).toFixed(1) };
}

// ---------------------------------------------------------------------------
// Monthly production-unit policy. Limits are enforced consistently across
// the site, application, and license service.
//   1 unit  = one clean image render (export crop)
//   UPSCALING CONSUMES NO UNITS: local upscaling (image and video) is
//   unlimited on every paid plan. Renders are
//   metered; enhancement is not. Video ships 1080-first; 4K is opt-in.
//   1 unit  = one minute of rendered voice (rounded up per render)
//   4 units = one minute of rendered video
// Local renders cost us $0, so units price VALUE, not cost — overage can
// never bleed money. Cloud jobs are separate prepaid credits on top.

export const MONTHLY_UNITS = { voice_starter: 60, single: 500, full: 1000 };
export const PAY_PER_EXPORT = { units: 1, price: 2.99 };

// Customer-visible prepaid cloud rates. The server must authorize the quoted
// amount before submission and settle the actual amount afterward. Local work
// never draws from this balance.
export const CLOUD_PRICING = {
  imageUpscale: { price: 0.10, unit: 'image', estimatedCost: 0.01 },
  voiceRender: { price: 0.25, unit: 'minute', estimatedCost: 0.10 },
  videoUpscale: { price: 3.00, unit: 'output minute', estimatedCostLow: 0.40, estimatedCostHigh: 0.80 },
  minimumRefill: 10,
  maximumRefill: 500,
  prepaidOnly: true,
  autoCharge: 'optional-explicit-opt-in'
};

export const CLOUD_BILLING_INCREMENT_SECONDS = 10;

/** Convert wallet cents to whole billable Video time without promising a
 * partial block the customer cannot spend. */
export function cloudVideoSecondsForCents(amountCents) {
  const cents = Number.isFinite(Number(amountCents)) ? Math.max(0, Math.floor(Number(amountCents))) : 0;
  const blockCents = Math.round(CLOUD_PRICING.videoUpscale.price * 100 * CLOUD_BILLING_INCREMENT_SECONDS / 60);
  return Math.floor(cents / blockCents) * CLOUD_BILLING_INCREMENT_SECONDS;
}

/** Quote one compiled cloud package. Duration is rounded once at job level,
 * never once per frame or clip. Money is returned in cents for safe billing. */
export function quoteCloudJob({ kind, durationSeconds = 0, imageCount = 0 }) {
  if (kind === 'image') {
    const count = Math.max(1, Math.ceil(Number(imageCount) || 0));
    return { kind, billedSeconds: 0, blocks: count, amountCents: count * 10 };
  }
  const seconds = Math.max(0, Number(durationSeconds) || 0);
  const billedSeconds = Math.ceil(seconds / CLOUD_BILLING_INCREMENT_SECONDS) * CLOUD_BILLING_INCREMENT_SECONDS;
  const rate = kind === 'voice' ? CLOUD_PRICING.voiceRender.price : CLOUD_PRICING.videoUpscale.price;
  return {
    kind,
    billedSeconds,
    blocks: billedSeconds / CLOUD_BILLING_INCREMENT_SECONDS,
    amountCents: Math.round((billedSeconds / 60) * rate * 100)
  };
}

// Cloud video processing is one batched provider job per video. The earlier
// $0.40-$0.80/output-minute cost range is an unverified engineering estimate,
// not a customer or margin claim. Provider fixtures must prove the full $20
// benefit costs <=$10 (target <=$6) before this disabled lane can activate.
export const CLOUD_VIDEO = {
  maxOutput: '4K',            // resolution ceiling
  maxJobMinutes: 5,           // per-job length cap
  includedPromotionalCents: { videoSingle: 2000, full: 2000 },
  includedEquivalentSeconds: 400,
  pricePerMinute: 3,
  productionEnabled: false
};

// Quality lanes: what each tier's renders run through. Free is a real
// preview lane — capable, capped, and always watermarked. Paid licenses use
// the production profile for the product or products they include.

export const LANES = {
  free: {
    label: 'Preview lane',
    voice: { maxWords: 60, stamped: true, knobs: true },
    upscale: { model: 'realesr-animevideov3-x2', factor: '2×' },
    imageExport: 'proof only (watermark + 960px)',
    videoExport: 'proof only (visual + audible watermark, 720p)',
    packs: 0, clientLinks: 0
  },
  paid: {
    label: 'Studio lane',
    voice: { maxWords: Infinity, stamped: false, knobs: true },
    upscale: { model: 'realesrgan-x4plus', factor: '4×' },
    imageExport: 'clean, full resolution',
    videoExport: 'clean, platform spec',
    packs: 5, clientLinks: 25
  }
};

export const VOICE_STARTER_LANE = Object.freeze({
  ...LANES.paid,
  label: 'Voice Starter lane',
  voice: Object.freeze({ maxWords: Infinity, stamped: false, knobs: true, quality: 'standard', batch: false, multiTake: false }),
  packs: 1,
  clientLinks: 0
});

export function laneFor(license, product) {
  if (!license) return LANES.free;
  if (license.plan === 'voice_starter' && product === 'voice') return VOICE_STARTER_LANE;
  if (license.plan === 'full') return LANES.paid;
  if (license.plan === 'single' && license.selected_product === product) return LANES.paid;
  if (license.plan === 'payg') return LANES.paid;
  return LANES.free;
}

// --- Allowance metering (per calendar month, local) -------------------------

const USAGE_KEY = () => 'cros:usage:' + new Date().toISOString().slice(0, 7);

export function usageThisMonth() {
  try { return JSON.parse(localStorage.getItem(USAGE_KEY())) || { exports: 0 }; }
  catch { return { exports: 0 }; }
}

export function recordExport(units = 1) {
  const u = usageThisMonth();
  u.exports = (u.exports || 0) + units;
  try { localStorage.setItem(USAGE_KEY(), JSON.stringify(u)); } catch { /* full */ }
  return u;
}

/** Units remaining this month for any licensed plan. Free tier has none. */
export function planRemaining(license) {
  if (!license) return 0;
  const plan = String(license.plan).replace('suspended:', '');
  const cap = MONTHLY_UNITS[plan];
  if (!cap) return 0;
  const bonus = usageThisMonth().bonus || 0;      // purchased overage packs
  return Math.max(0, cap + bonus - (usageThisMonth().exports || 0));
}

// Back-compat alias.
export const liteRemaining = planRemaining;
