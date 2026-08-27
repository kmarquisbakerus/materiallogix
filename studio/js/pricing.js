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
  { id: 'monthly', label: 'Monthly', months: 1, discount: 0 },
  { id: 'quarterly', label: '3 months', months: 3, discount: 0.10 },
  { id: 'biannual', label: '6 months', months: 6, discount: 0.15 },
  { id: 'yearly', label: 'Yearly', months: 12, discount: 0.25 }
];

export const PRODUCTS = [
  {
    id: 'lite',
    name: 'Complete Lite',
    monthly: 9,
    vs: 'for light users who want everything',
    pitch: 'All three products at standard quality, 100 units a month.'
  },
  {
    id: 'voice',
    name: 'Voice Studio',
    monthly: 14,
    vs: 'ElevenLabs Creator: $22/mo for 100 minutes',
    pitch: '500 units a month, owned voice packs, the humanizer, the ear.'
  },
  {
    id: 'review',
    name: 'Review',
    monthly: 32,
    vs: 'Topaz charges $299/yr for upscaling alone — included here, with the whole review suite',
    pitch: 'Clean unlimited exports, 4× photo and video upscaling, client links, platform-spec renders, the checks.'
  },
  {
    id: 'complete',
    name: 'Complete',
    monthly: 36,
    vs: '$46 buying both separately — and yearly ($324) undercuts Topaz Studio alone ($399)',
    pitch: 'Both products, the phone app, one license.'
  },
  {
    id: 'pro',
    name: 'Complete Pro',
    monthly: 59,
    vs: 'built for daily commercial use',
    pitch: 'The premium lane: best engine profiles, most packs and client links, priority support, agency-use terms.'
  }
];

/** Price for a product on a term, and the effective monthly rate. */
export function price(productId, termId) {
  const p = PRODUCTS.find(x => x.id === productId);
  const t = TERMS.find(x => x.id === termId);
  if (!p || !t) return null;
  const total = Math.round(p.monthly * t.months * (1 - t.discount));
  return { total, perMonth: +(total / t.months).toFixed(2), months: t.months };
}

// ---------------------------------------------------------------------------
// Monthly production units (founder's rule: nothing is unlimited — value
// justifies limits, and limits justify the price).
//   1 unit  = one clean image render (export crop)
//   UPSCALING CONSUMES NO UNITS: local upscaling (image and video) is
//   unlimited on every paid plan — the founder's Topaz-killer. Renders are
//   metered; enhancement is not. Video ships 1080-first; 4K is opt-in.
//   1 unit  = one minute of rendered voice (rounded up per render)
//   4 units = one minute of rendered video
// Local renders cost us $0, so units price VALUE, not cost — overage can
// never bleed money. Cloud jobs are separate prepaid credits on top.

export const MONTHLY_UNITS = { lite: 100, voice: 500, review: 500, complete: 1000, pro: 2500 };
export const OVERAGE = { units: 100, price: 5 };   // $5 per +100 units, any tier

// Customer-visible prepaid cloud rates. The server must authorize the quoted
// amount before submission and settle the actual amount afterward. Local work
// never draws from this balance.
export const CLOUD_PRICING = {
  imageUpscale: { price: 0.10, unit: 'image', estimatedCost: 0.01 },
  voiceRender: { price: 0.25, unit: 'minute', estimatedCost: 0.10 },
  videoUpscale: { price: 3.00, unit: 'output minute', estimatedCostLow: 0.40, estimatedCostHigh: 0.80 },
  minimumPack: 10,
  prepaidOnly: true,
  autoCharge: false
};

export const CLOUD_BILLING_INCREMENT_SECONDS = 10;

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

// Cloud video upscaling: viable ONLY as one batched GPU job per video
// (per-second billing ~= $0.40-0.80/output-min at 1080p->4K), never as
// per-frame runs (that costs ~$3.30/min and bleeds). Hard constraints:
// Fallback policy: local first, always; if local fails or no engine is
// detected, licensed users are offered the cloud lane automatically,
// spending their tier's included minutes/credits. Free tier: no fallback.
export const CLOUD_VIDEO = {
  maxOutput: '4K',            // resolution ceiling
  maxJobMinutes: 5,           // per-job length cap
  includedMinutes: { lite: 0, voice: 0, review: 10, complete: 20, pro: 30 },  // founder's ladder; owned hardware makes it nearly free
  pricePerMinute: 3           // beyond included: prepaid credits, $3/min (~4-7x cost)
};

// Quality lanes: what each tier's renders run through. Free is a real
// preview lane — capable, capped, and always watermarked. Paid lanes get the
// better engine profiles; Pro gets the best.

export const LANES = {
  lite: {   // all products, standard quality, metered allowance
    label: 'Lite lane',
    voice: { maxWords: Infinity, stamped: false, knobs: true, monthlyMinutes: 30 },
    upscale: { model: 'realesrgan-x4plus', factor: '4×' },
    imageExport: 'clean, full resolution',
    videoExport: 'clean, platform spec',
    packs: 1, clientLinks: 3
  },
  free: {
    label: 'Preview lane',
    voice: { maxWords: 60, stamped: true, knobs: true },
    upscale: { model: 'realesr-animevideov3-x2', factor: '2×' },
    imageExport: 'proof only (watermark + 960px)',
    videoExport: 'proof only (visual + audible watermark, 720p)',
    packs: 0, clientLinks: 0
  },
  standard: {   // voice / review / complete
    label: 'Standard lane',
    voice: { maxWords: Infinity, stamped: false, knobs: true },
    upscale: { model: 'realesrgan-x4plus', factor: '4×' },
    imageExport: 'clean, full resolution',
    videoExport: 'clean, platform spec',
    packs: 5, clientLinks: 25
  },
  pro: {
    label: 'Pro lane',
    voice: { maxWords: Infinity, stamped: false, knobs: true, multiTake: true },
    upscale: { model: 'realesrgan-x4plus', factor: '4×', batch: true },
    imageExport: 'clean, full resolution, batch',
    videoExport: 'clean, platform spec, batch',
    packs: 25, clientLinks: 100
  }
};

export function laneFor(license, product) {
  if (!license) return LANES.free;
  if (license.plan === 'pro') return LANES.pro;
  if (license.plan === 'lite') return LANES.lite;
  if (license.plan === 'complete' || license.plan === product) return LANES.standard;
  return LANES.free;
}

// --- Lite allowance metering (per calendar month, local) --------------------

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
