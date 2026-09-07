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
  // A plan that is not sold on this term has no price on it. This used to
  // return an object with an undefined total, which is truthy: the checkout
  // button stayed enabled on Voice Starter's yearly tab and would have sent
  // Stripe a `voice_starter_yearly` SKU that does not exist.
  if (!Number.isFinite(total)) return null;
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

// Declared once so the meter and the policy comment cannot drift apart.
export const UNITS_PER_VIDEO_MINUTE = 4;

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
 * Every product can be sent to the cloud, so every product has both prices. The
 * cloud lanes stay `available: false` until each has a measured cost and a live
 * endpoint - built and priced, switched on by the server, the same way the
 * sign-in providers wait on their developer accounts.
 */
export const RENDER_PRICES = Object.freeze({
  photo: Object.freeze({ local: 2.99, per: 'image' }),
  video: Object.freeze({ local: 4.99, per: 'minute' }),
  voice: Object.freeze({ local: 2.99, per: 'minute' })
});

/**
 * What rendering in the cloud adds, on top of the thing being made.
 *
 * This was priced as a second retail price for the same deliverable, which got
 * the shape wrong in both directions. A cloud job's cost is dominated by pod
 * spin-up - about $0.26 whatever it does - and only video has compute that
 * scales with output. So:
 *
 *   - Photo and voice are charged PER JOB. A ten-minute script costs us half a
 *     cent more than a one-minute one, so billing it by the minute charges for
 *     a cost that does not exist.
 *   - Video is charged PER OUTPUT MINUTE, because 185 GPU-minutes go into each
 *     one and that is a cost that genuinely grows.
 *
 * The surcharge is what a plan's cloud credit is spent on. A plan's monthly
 * units already paid for the file; the credit pays for where it was made. That
 * separation matters: a unit earns us about three cents, so a cloud job billed
 * against units would lose money on every render.
 */
// Whole dollars, deliberately. Loose change on top of a price reads as a
// surprise fee however small it is, and this is the one charge a customer meets
// after they have already decided to buy.
export const CLOUD_SURCHARGE = Object.freeze({
  photo: Object.freeze({ price: 1, basis: 'job', unit: 'image', lane: 'photo' }),
  voiceRender: Object.freeze({ price: 1, basis: 'job', unit: 'render', lane: 'voice_render' }),
  voiceTraining: Object.freeze({ price: 2, basis: 'job', unit: 'voice profile', lane: 'voice_training' }),
  video: Object.freeze({ price: 2, basis: 'output minute', unit: 'output minute', lane: 'video' })
});

/**
 * What a finished thing costs with no plan, made locally or in the cloud.
 * `units` is images, or whole minutes. Returns cents, because money that has
 * been through a float is money waiting to be wrong.
 */
export function deliveredPrice(product, { units = 1, cloud = false } = {}) {
  const rate = RENDER_PRICES[product];
  if (!rate) return null;
  const count = Math.max(1, Math.ceil(Number(units) || 1));
  const deliverableCents = Math.round(rate.local * 100) * count;
  if (!cloud) {
    return { product, units: count, deliverableCents, surchargeCents: 0, totalCents: deliverableCents, basis: 'local' };
  }
  const surcharge = product === 'video' ? CLOUD_SURCHARGE.video
    : product === 'voice' ? CLOUD_SURCHARGE.voiceRender
      : CLOUD_SURCHARGE.photo;
  const surchargeCents = Math.round(surcharge.price * 100) * (surcharge.basis === 'job' ? 1 : count);
  return {
    product, units: count, deliverableCents, surchargeCents,
    totalCents: deliverableCents + surchargeCents, basis: surcharge.basis
  };
}

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
  imageUpscale: { price: CLOUD_SURCHARGE.photo.price, unit: 'image', estimatedCost: 0.26, available: false },
  // Cloud voice, so a long script does not tie up the customer's machine.
  // Synthesis is a tiny GPU job; almost all of its cost is pod lifecycle, which
  // the video measurement puts at about a fifth of $1.31. Derived, not
  // measured - see CLOUD_VOICE.
  voiceRender: { price: CLOUD_SURCHARGE.voiceRender.price, unit: 'render', estimatedCost: 0.27, available: false },
  // Conditioning a voice profile is the heavy one: a fine-tune over up to
  // thirty minutes of reference audio, which is what runs long on a CPU.
  voiceTraining: { price: CLOUD_SURCHARGE.voiceTraining.price, unit: 'voice profile', estimatedCost: 0.40, available: false },
  // Measured at $1.31 per output minute for native 4K on a community RTX 4090
  // pool at $0.34/hr - see MEASURED_VIDEO_COST for what that measurement is
  // worth.
  videoUpscale: { price: CLOUD_SURCHARGE.video.price, unit: 'output minute', estimatedCost: 1.31, available: true },
  minimumRefill: 10,
  maximumRefill: 500,
  prepaidOnly: true,
  autoCharge: 'optional-explicit-opt-in'
};

/**
 * What the cloud voice figures rest on, recorded so nobody quotes a margin they
 * do not have. Neither number is measured. Both are derived from the one cloud
 * measurement that exists - $1.31 per 4K output minute, of which roughly a
 * fifth is fixed pod lifecycle - on the reasoning that synthesis is a far
 * lighter job than 4K video generation and conditioning is a heavier one.
 *
 * Training is included rather than billed for the profiles a plan already
 * bought: a customer who paid for five voice clones should not be charged five
 * more times to make them usable. Beyond that allowance it is a wallet job.
 */
export const CLOUD_VOICE = Object.freeze({
  renderCostBasis: 'derived from pod lifecycle, not measured',
  trainingCostBasis: 'derived from a 30-minute fine-tune at $0.34/hr, not measured',
  costsConfirmed: false,
  trainingIncludedPerPeriod: 'one conditioning run for each voice profile the plan includes'
});

/** Cloud conditioning runs included this period: one per profile the plan buys. */
export function includedVoiceTrainings(license) {
  return voiceProfileLimit(license);
}

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
  pricePerMinute: CLOUD_SURCHARGE.video.price,
  productionEnabled: false
};

// Included prepaid cloud credit, granted each paid period. It spends on any
// cloud job - a photo upscale, a voice render, or a video render - because a
// customer who bought Photo has no use for credit that only buys video.
export const CLOUD_CREDIT = Object.freeze({
  includedCents: Object.freeze({ voice_starter: 0, single: 2000, single_pro: 2000, full: 2000, pro: 2000 }),
  // Credit spends on any cloud job.
  spendableOn: Object.freeze(['image', 'voice', 'video']),
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
    voice: { maxWords: 60, stamped: true, knobs: true, batch: false, multiTake: false },
    upscale: { model: 'realesr-animevideov3-x2', factor: '2×' },
    // Prose the renderer cannot act on is how the video watermark went missing.
    // These are instructions now, and the render plan carries them.
    imageExport: { clean: false, watermark: 'full-frame', maxEdge: 960, label: 'proof only (watermark + 960px)' },
    videoExport: { clean: false, watermark: { visual: true, audible: true }, maxHeight: 720,
      label: 'proof only (visual + audible watermark, 720p)' },
    packs: 0, clientLinks: 0
  },
  paid: {
    label: 'Studio lane',
    voice: { maxWords: Infinity, stamped: false, knobs: true, batch: true, multiTake: true },
    upscale: { model: 'realesrgan-x4plus', factor: '4×' },
    imageExport: { clean: true, watermark: null, maxEdge: null, label: 'clean, full resolution' },
    videoExport: { clean: true, watermark: null, maxHeight: null, label: 'clean, platform spec' },
    packs: 5, clientLinks: 25
  }
};

// The Pro tiers buy quality, not quantity: the same allowances, run through the
// Pro Motion Engine, with premium voice and more personal clones.
LANES.pro = {
  ...LANES.paid,
  label: 'Pro lane',
  motionEngine: 'pro',
  voice: { maxWords: Infinity, stamped: false, knobs: true, quality: 'premium', batch: true, multiTake: true },
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
 * How a lane must deliver a finished file.
 *
 * The free lane has always said its video export is "proof only (visual +
 * audible watermark, 720p)". It was a sentence in a config object that nothing
 * read, and the local renderer shipped a clean MP4 to anybody: photo exports
 * were blocked at the paywall and voice previews were audibly stamped, but
 * video had no protection at all.
 *
 * The render plan carries this to the engine. A caller that cannot apply it
 * must refuse the render rather than deliver an unmarked file.
 */
export function deliveryRulesFor(lane, kind) {
  const rules = kind === 'video' ? lane?.videoExport : lane?.imageExport;
  if (!rules || typeof rules !== 'object') {
    // An unknown lane is treated as the most restrictive one, never the least.
    return kind === 'video'
      ? { ...LANES.free.videoExport }
      : { ...LANES.free.imageExport };
  }
  return { ...rules };
}

/** True when this lane's output must carry a watermark of any kind. */
export function requiresWatermark(lane, kind) {
  return deliveryRulesFor(lane, kind).clean !== true;
}

/**
 * Units one delivery spends out of a plan's monthly allowance.
 *
 * The unit policy has always said four units to a minute of video, but the
 * export authorized `quantity: pairs.length` - one unit per placement, whatever
 * its length. A ten-minute cut billed the same as a still. Duration is the
 * whole point of the video unit, so it has to reach the meter.
 *
 * Photo bills per crop. Voice and video bill per whole minute, rounded up once
 * per file, never per frame or per clip.
 */
export function exportUnits(product, { items = 1, seconds = 0 } = {}) {
  const files = Math.max(1, Math.ceil(Number(items) || 1));
  if (product === 'photo') return files;
  const minutes = Math.max(1, Math.ceil(Math.max(0, Number(seconds) || 0) / 60));
  if (product === 'voice') return minutes * files;
  if (product === 'video') return UNITS_PER_VIDEO_MINUTE * minutes * files;
  return files;
}

/** Units for a set of approved placements, each of which renders its own file. */
export function unitsForDeliveries(deliveries = []) {
  let total = 0;
  for (const item of deliveries) {
    total += exportUnits(item?.kind || 'photo', { items: 1, seconds: item?.seconds || 0 });
  }
  return Math.max(1, total);
}

/**
 * How many personal voice profiles a licence may keep on the device.
 *
 * The count was compared against `plan === 'voice_starter'`, so a free preview
 * could store any number while the paying Starter tier was held to one. Free
 * gets none: "one approved personal voice profile" is the Starter tier's
 * headline benefit, and it is not a benefit if it is also free.
 */
export function voiceProfileLimit(license) {
  if (!license) return 0;
  const plan = String(license.plan);
  if (plan.startsWith('suspended:')) return 0;
  // Indexing by plan name alone ignored which Studio was bought: a Photo-only
  // Single got a voice profile it never paid for, a Photo-or-Video Single Pro
  // got five, and payg - which does cover voice - got none. The lane already
  // knows; ask it.
  if (laneFor(license, 'voice') === LANES.free) return 0;
  return PREMIUM_VOICE.personalClones[plan] ?? PREMIUM_VOICE.personalClones.full ?? 0;
}

/**
 * Whether this lane may build a voice profile from more than one recording.
 *
 * The upload handler asked `plan === 'voice_starter'` directly, so a free
 * preview - which has no plan at all - sailed past the check and could build
 * composite packs that a paying Voice Starter customer could not. Reading the
 * lane fixes the inversion and puts the rule in one place.
 */
export function allowsMultiSourceVoicePack(lane) {
  return lane?.voice?.multiTake === true;
}

/**
 * How long a script this lane may read, and what to say when it is too long.
 *
 * `maxWords` was declared on the free lane and applied nowhere, so a free
 * preview would read a script of any length. A preview that is not short is
 * not a preview - it is the product, stamped.
 *
 * Every tier keeps a preview. The paid lanes simply have no length limit on
 * theirs, which is why an unlimited lane returns `allowed` with no ceiling
 * rather than a different code path.
 */
export function scriptAllowance(lane, wordCount) {
  const limit = Number(lane?.voice?.maxWords);
  const words = Math.max(0, Math.floor(Number(wordCount) || 0));
  if (!Number.isFinite(limit)) return { allowed: true, limit: null, words, over: 0 };
  const over = Math.max(0, words - limit);
  return {
    allowed: over === 0,
    limit,
    words,
    over,
    reason: over === 0 ? '' : `Free preview reads up to ${limit} words. This script is ${words}. Trim ${over}, or start a plan to read the whole thing.`
  };
}

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
  // A suspended licence keeps its signature and its plan name, and nothing
  // else. Stripping the prefix here handed a customer suspended for
  // non-payment their full monthly allowance, and told them so on the usage
  // page. Every other capability function refuses a `suspended:` plan; this
  // one un-suspended it.
  const plan = String(license.plan);
  if (plan.startsWith('suspended:')) return 0;
  const cap = MONTHLY_UNITS[plan];
  if (!cap) return 0;
  const bonus = usageThisMonth().bonus || 0;      // purchased overage packs
  return Math.max(0, cap + bonus - (usageThisMonth().exports || 0));
}

// Back-compat alias.
export const liteRemaining = planRemaining;

// ---------------------------------------------------------------------------
// The catalogue Stripe has to carry.
//
// Every SKU the client can send to /api/checkout/session, generated from the
// same declarations the site renders, so the payment processor and the page a
// customer read cannot disagree. A SKU the service does not recognise is a
// checkout that fails after the customer has clicked.
//
// Cloud jobs are not here: they are metered against the prepaid wallet, and the
// only Stripe product behind them is the top-up itself.

export function stripeCatalogue() {
  const rows = [];
  for (const product of PRODUCTS) {
    for (const term of TERMS) {
      const amount = price(product.id, term.id);
      if (!amount) continue;
      rows.push({
        sku: `${product.id}_${term.id}`,
        kind: 'subscription',
        name: `${product.name} — ${term.label}`,
        amountCents: Math.round(amount.total * 100),
        intervalMonths: term.months,
        plan: product.plan,
        selectedProduct: product.selectedProduct
      });
    }
  }
  for (const item of EXPORT_PRODUCTS) {
    rows.push({
      sku: item.id,
      kind: 'one_time',
      name: item.label,
      amountCents: Math.round(item.price * 100),
      intervalMonths: 0,
      plan: null,
      selectedProduct: item.product
    });
  }
  rows.push({
    sku: 'wallet_topup',
    kind: 'customer_chosen_amount',
    name: 'Prepaid cloud wallet top-up',
    amountCents: null,
    minimumCents: Math.round(CLOUD_PRICING.minimumRefill * 100),
    maximumCents: Math.round(CLOUD_PRICING.maximumRefill * 100),
    intervalMonths: 0,
    plan: null,
    selectedProduct: null
  });
  return rows;
}

