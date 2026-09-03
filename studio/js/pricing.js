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
    pitch: '30 finished local voice minutes each month and one active personal voice profile.'
  },
  ...['photo', 'video', 'voice'].map(product => ({
    id: `single_${product}`,
    plan: 'single', selectedProduct: product,
    name: `Single Studio — ${product[0].toUpperCase()}${product.slice(1)}`,
    monthly: 15,
    totals: { monthly: 15, quarterly: 40, yearly: 140 },
    pitch: 'One Studio: direction, review, and delivery.'
  })),
  ...['photo', 'video', 'voice'].map(product => ({
    id: `single_pro_${product}`,
    plan: 'single_pro', selectedProduct: product,
    name: `Single Studio Pro — ${product[0].toUpperCase()}${product.slice(1)}`,
    monthly: 25,
    totals: { monthly: 25, quarterly: 67, yearly: 235 },
    pitch: 'One Studio, at its best: the Pro Motion Engine, personal voice clones, and premium voice minutes.'
  })),
  {
    id: 'full',
    plan: 'full', selectedProduct: null,
    name: 'Full Studio',
    monthly: 29,
    totals: { monthly: 29, quarterly: 77, yearly: 275 },
    pitch: 'Photo, Video, and Voice in one licence.'
  },
  {
    id: 'pro',
    plan: 'pro', selectedProduct: null,
    name: 'Pro Studio',
    monthly: 39,
    totals: { monthly: 39, quarterly: 104, yearly: 366 },
    pitch: 'Every Studio, at its best.'
  }
];

/** Price for a product on a term, and the effective monthly rate. */
export function price(productId, termId) {
  const p = PRODUCTS.find(x => x.id === productId);
  const t = TERMS.find(x => x.id === termId);
  if (!p || !t) return null;
  const total = p.totals[termId];
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

export const MONTHLY_UNITS = { voice_starter: 30, single: 500, single_pro: 500, full: 1000, pro: 1000 };
export const PAY_PER_EXPORT = { units: 1, price: 2.99 };

// Premium natural voice, sold with the Pro tiers and billed by the hour beyond
// the included minutes.
export const PREMIUM_VOICE = Object.freeze({
  includedMinutes: Object.freeze({ single_pro: 60, pro: 120 }),
  extraPricePerHour: 4.99,
  personalClones: Object.freeze({ voice_starter: 1, single: 1, single_pro: 5, full: 1, pro: 5 })
});

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
// not a customer or margin claim. Provider fixtures must prove the full $10
// benefit costs <=$5 (target <=$3) before this disabled lane can activate.
export const CLOUD_VIDEO = {
  maxOutput: '4K',            // resolution ceiling
  maxJobMinutes: 5,           // per-job length cap
  includedPromotionalCents: { videoSingle: 2000, singlePro: 2000, full: 2000, pro: 2000 },
  includedEquivalentSeconds: 200,
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

// The Pro tiers buy quality, not quantity: the same allowances, run through the
// Pro Motion Engine, with premium voice and more personal clones.
LANES.pro = {
  ...LANES.paid,
  label: 'Pro lane',
  motionEngine: 'pro',
  voice: { maxWords: Infinity, stamped: false, knobs: true, quality: 'premium' },
  cloudUpscaleIncluded: true,
  walletDiscount: 0.2
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
  const plan = String(license.plan);
  if (plan.startsWith('suspended:')) return LANES.free;
  const selected = license.selected_product || license.selectedProduct;
  if (plan === 'voice_starter') return product === 'voice' ? VOICE_STARTER_LANE : LANES.free;
  if (plan === 'pro') return LANES.pro;
  if (plan === 'single_pro') return selected === product ? LANES.pro : LANES.free;
  if (plan === 'full' || plan === 'payg') return LANES.paid;
  if (plan === 'single') return selected === product ? LANES.paid : LANES.free;
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
