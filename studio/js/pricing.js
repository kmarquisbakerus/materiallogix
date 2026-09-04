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

// One unit is one clean image. Units are the plan's currency - what an export
// spends out of a monthly allowance - and a minute of finished video spends
// four because it is four times the work.
export const UNIT_PRICE = 2.99;

/**
 * What one finished thing costs, by where it is made. This is the whole price
 * ladder in one place: everything else on this page reads it.
 *
 * Two rules hold it together, and both are tested:
 *
 *   1. Cloud costs more than local, for the same deliverable. Local runs on the
 *      customer's own machine and costs us nothing; cloud runs on our GPUs.
 *   2. Nobody without a plan pays less than somebody with one. These are the
 *      no-plan prices, and they are the same numbers a plan's wallet is
 *      charged - a plan only ever does better, through its included credit and
 *      the Pro top-up discount. A cheaper no-plan price would pay customers to
 *      cancel.
 *
 * Voice has no cloud price because it has no cloud endpoint: voice runs
 * entirely on the customer's machine. Pricing a cloud minute we cannot render
 * would be selling something that does not exist.
 */
export const RENDER_PRICES = Object.freeze({
  photo: Object.freeze({ local: 2.99, cloud: 3.99, per: 'image' }),
  video: Object.freeze({ local: 4.99, cloud: 5.99, per: 'minute' }),
  voice: Object.freeze({ local: 2.99, cloud: null, per: 'minute' })
});

// Price is a separate decision from metering. A one-off video minute is sold at
// its ladder price, not at four units of list, because a customer buying a
// single minute without a plan is not buying four photos.
//
// These ids are the checkout SKUs. The billing service must accept all three;
// a SKU it does not know is a checkout that fails after the customer clicked.
export const EXPORT_PRODUCTS = Object.freeze([
  Object.freeze({ id: 'export_image', product: 'photo', units: 1, price: RENDER_PRICES.photo.local, per: 'image', label: 'One clean photo export' }),
  Object.freeze({ id: 'export_audio', product: 'voice', units: 1, price: RENDER_PRICES.voice.local, per: 'minute', label: 'One clean minute of audio' }),
  Object.freeze({ id: 'export_video', product: 'video', units: 4, price: RENDER_PRICES.video.local, per: 'minute', label: 'One clean minute of video' })
]);

export const EXPORT_PRODUCT_BY_ID = Object.fromEntries(EXPORT_PRODUCTS.map(item => [item.id, item]));

/** The single export that covers a Studio, for the paywall to quote. */
export const exportForProduct = product => EXPORT_PRODUCTS.find(item => item.product === product) || null;

// The licence carries a plan id; customers were sold a plan name. One map,
// so no screen shows the id.
const PLAN_NAMES = Object.freeze({
  voice_starter: 'Voice Starter', single: 'Single Studio', single_pro: 'Single Studio Pro',
  full: 'Full Studio', pro: 'Pro Studio', payg: 'Pay per export'
});

/** How a plan reads to the person who bought it. */
export function planLabel(plan) {
  const id = String(plan || '');
  if (!id) return 'No active plan';
  if (id.startsWith('suspended:')) {
    const base = PLAN_NAMES[id.slice('suspended:'.length)];
    return base ? `${base} (suspended)` : 'Suspended plan';
  }
  return PLAN_NAMES[id] || 'No active plan';
}

/** Every plan that unlocks a Studio, named as the site names them. */
export function plansCovering(product) {
  return [...new Set(PRODUCTS
    .filter(item => item.selectedProduct === null || item.selectedProduct === product)
    .map(item => item.name.split(' — ')[0]))];
}

/** What one export of this kind costs, and how many units it spends. */
export function exportPrice(id, quantity = 1) {
  const item = EXPORT_PRODUCT_BY_ID[id];
  if (!item) return null;
  const count = Math.max(1, Math.ceil(Number(quantity) || 1));
  return {
    id, product: item.product, per: item.per, label: item.label,
    quantity: count,
    units: item.units * count,
    total: +(item.price * count).toFixed(2),
    unitPrice: item.price
  };
}

/** The cheapest single export, which is what "exports from" quotes. */
export const PAY_PER_EXPORT = Object.freeze({
  units: 1,
  price: Math.min(...EXPORT_PRODUCTS.map(item => item.price))
});

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
  // Rates come from the ladder, so a cloud job and a no-plan purchase of the
  // same thing can never quote different numbers. A cloud image used to be
  // $0.10 - less than a plain photo export - which paid a customer to route
  // work through our GPUs.
  imageUpscale: { price: RENDER_PRICES.photo.cloud, unit: 'image', estimatedCost: 0.01, available: true },
  // Voice has no cloud endpoint. It stays declared and unavailable rather than
  // priced, so nothing offers a minute we cannot render.
  voiceRender: { price: null, unit: 'minute', estimatedCost: null, available: false },
  // Measured at $1.31 per output minute for native 4K on a community RTX 4090
  // pool at $0.34/hr - see MEASURED_VIDEO_COST for what that measurement is
  // worth.
  videoUpscale: { price: RENDER_PRICES.video.cloud, unit: 'output minute', estimatedCost: 1.31, available: true },
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
  // Rate first, blocks second. Rounding the block price before dividing lost a
  // block on any rate that is not a whole number of cents per block.
  const seconds = (cents / (CLOUD_PRICING.videoUpscale.price * 100)) * 60;
  return Math.floor(seconds / CLOUD_BILLING_INCREMENT_SECONDS) * CLOUD_BILLING_INCREMENT_SECONDS;
}

/** Quote one compiled cloud package. Duration is rounded once at job level,
 * never once per frame or clip. Money is returned in cents for safe billing. */
export function quoteCloudJob({ kind, durationSeconds = 0, imageCount = 0 }) {
  if (kind === 'image') {
    // This used to bill a hard-coded ten cents, so moving the declared price
    // moved the site and left every quote where it was.
    const count = Math.max(1, Math.ceil(Number(imageCount) || 0));
    return { kind, billedSeconds: 0, blocks: count,
      amountCents: Math.round(count * CLOUD_PRICING.imageUpscale.price * 100) };
  }
  const rate = kind === 'voice' ? CLOUD_PRICING.voiceRender.price : CLOUD_PRICING.videoUpscale.price;
  if (!Number.isFinite(rate)) throw new Error(`There is no cloud ${kind} service to quote.`);
  const seconds = Math.max(0, Number(durationSeconds) || 0);
  const billedSeconds = Math.ceil(seconds / CLOUD_BILLING_INCREMENT_SECONDS) * CLOUD_BILLING_INCREMENT_SECONDS;
  return {
    kind,
    billedSeconds,
    blocks: billedSeconds / CLOUD_BILLING_INCREMENT_SECONDS,
    amountCents: Math.round((billedSeconds / 60) * rate * 100)
  };
}

/**
 * What the one cost measurement actually covers, recorded so nobody quotes a
 * margin it does not support. Every figure extrapolates from a single
 * ten-second run; the sixty-second checkpoint has never been run. Because
 * roughly a fifth of the cost is fixed pod lifecycle, longer jobs should come
 * in cheaper per minute, so this is the pessimistic case rather than a floor.
 * The lane stays disabled until a production-length fixture confirms it.
 */
export const MEASURED_VIDEO_COST = Object.freeze({
  centsPerOutputMinute: 131,
  resolution: '4K',
  gpuPool: 'community RTX 4090',
  gpuHourly: 0.34,
  measuredFromSeconds: 10,
  fixedLifecycleShare: 0.2,
  productionLengthConfirmed: false
});

// Cloud video processing is one batched provider job per video.
export const CLOUD_VIDEO = {
  maxOutput: '4K',            // resolution ceiling
  maxJobMinutes: 5,           // per-job length cap
  includedEquivalentSeconds: 200,
  pricePerMinute: RENDER_PRICES.video.cloud,
  productionEnabled: false
};

// Included prepaid cloud credit, granted each paid period. It spends on any
// cloud job - a photo upscale, a voice render, or a video render - because a
// customer who bought Photo has no use for credit that only buys video.
export const CLOUD_CREDIT = Object.freeze({
  includedCents: Object.freeze({ voice_starter: 0, single: 2000, single_pro: 2000, full: 2000, pro: 2000 }),
  // Credit spends on the cloud jobs that exist. Voice is not one of them.
  spendableOn: Object.freeze(['image', 'video']),
  freeUpscalePlans: Object.freeze(['pro']),
  walletDiscount: Object.freeze({ pro: 0.2 })
});

/** Credit included with a licence this period, in cents. Never negative. */
export function includedCloudCents(license) {
  if (!license) return 0;
  const plan = String(license.plan);
  if (plan.startsWith('suspended:')) return 0;
  return CLOUD_CREDIT.includedCents[plan] || 0;
}

/**
 * Split a quoted cloud job between included credit and the prepaid wallet.
 * The credit is spent first, and a job is only executable when the two
 * together cover it - cloud work is prepaid, so it never runs on account.
 */
export function applyCloudCredit(quotedCents, { creditCents = 0, walletCents = 0 } = {}) {
  const owed = Math.max(0, Math.round(Number(quotedCents) || 0));
  const credit = Math.max(0, Math.round(Number(creditCents) || 0));
  const wallet = Math.max(0, Math.round(Number(walletCents) || 0));
  const fromCredit = Math.min(owed, credit);
  const fromWallet = Math.min(owed - fromCredit, wallet);
  const shortfallCents = owed - fromCredit - fromWallet;
  return {
    owedCents: owed,
    fromCreditCents: fromCredit,
    fromWalletCents: fromWallet,
    shortfallCents,
    creditRemainingCents: credit - fromCredit,
    walletRemainingCents: wallet - fromWallet,
    executable: shortfallCents === 0
  };
}

/** What a top-up actually costs this licence, after any plan discount. */
export function walletTopUpCents(amountCents, license) {
  const amount = Math.max(0, Math.round(Number(amountCents) || 0));
  const plan = license ? String(license.plan) : '';
  const discount = plan.startsWith('suspended:') ? 0 : (CLOUD_CREDIT.walletDiscount[plan] || 0);
  return { amountCents: amount, discount, chargedCents: Math.round(amount * (1 - discount)) };
}

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

/**
 * The upscale models a lane may use, filtered from what the engine has
 * installed. The Enhance dialog used to list every installed model and preselect
 * the 4x one for everybody, while a line of text underneath claimed that
 * "licensed Photo plans unlock 4x" - so the wall was a sentence, not a gate.
 *
 * A lane names the model it is entitled to. Anything the lane does not name is
 * withheld. If the engine has nothing matching, the caller gets an empty list
 * and must say so rather than quietly serving a better model.
 */
export function upscaleModelsForLane(lane, installed = []) {
  const entitled = String(lane?.upscale?.model || '');
  if (!entitled) return [];
  const wanted = entitled.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return installed.filter(name => String(name).replace(/[^a-z0-9]/gi, '').toLowerCase().includes(wanted));
}

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
