import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  PRODUCTS, TERMS, price, quoteCloudJob, cloudVideoSecondsForCents,
  CLOUD_PRICING, CLOUD_BILLING_INCREMENT_SECONDS, MONTHLY_UNITS, laneFor, LANES, planRemaining,
  CLOUD_VIDEO, CLOUD_VOICE, MEASURED_VIDEO_COST, exportPrice, upscaleModelsForLane, scriptAllowance, allowsMultiSourceVoicePack, voiceProfileLimit,
  exportUnits, unitsForDeliveries, UNITS_PER_VIDEO_MINUTE
} from '../studio/js/pricing.js';
import { covers } from '../studio/js/license.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFileSync(resolve(ROOT, file), 'utf8');

test('every product prices on every term it offers, and longer terms never cost more', () => {
  for (const product of PRODUCTS) {
    for (const term of TERMS) {
      if (product.totals[term.id] == null) continue;
      const quote = price(product.id, term.id);
      assert.ok(quote, `${product.id} on ${term.id}`);
      assert.ok(quote.total > 0, `${product.id} ${term.id} must cost something`);
      assert.equal(quote.months, term.months);
      assert.ok(quote.savings >= 0, `${product.id} ${term.id} must not cost more than paying monthly`);
      assert.ok(quote.perMonth <= product.monthly + 0.001, `${product.id} ${term.id} effective rate`);
    }
  }
});

test('an unknown product or term prices as nothing rather than guessing', () => {
  assert.equal(price('no-such-product', 'monthly'), null);
  assert.equal(price('full', 'fortnightly'), null);
});

test('cloud work is quoted in whole billing blocks, rounded once per job', () => {
  const short = quoteCloudJob({ kind: 'video', durationSeconds: 1 });
  assert.equal(short.billedSeconds, CLOUD_BILLING_INCREMENT_SECONDS, 'a one-second job still bills one block');
  const exact = quoteCloudJob({ kind: 'video', durationSeconds: 60 });
  assert.equal(exact.billedSeconds, 60);
  assert.equal(exact.amountCents, Math.round(CLOUD_PRICING.videoUpscale.price * 100));
  const over = quoteCloudJob({ kind: 'video', durationSeconds: 61 });
  assert.equal(over.billedSeconds, 70, 'part of a block bills a whole block');
  assert.ok(over.amountCents > exact.amountCents);
});

test('an image job bills per image, at the declared rate', () => {
  // The image branch billed a hard-coded ten cents, so the declared price and
  // the quote could disagree without anything noticing.
  const images = quoteCloudJob({ kind: 'image', imageCount: 3 });
  assert.equal(images.blocks, 3);
  assert.equal(images.amountCents, Math.round(3 * CLOUD_PRICING.imageUpscale.price * 100));
  assert.equal(quoteCloudJob({ kind: 'image', imageCount: 0 }).blocks, 1, 'a job is never free by rounding to zero');
});

test('a cloud lane is priced and built before it is switched on', () => {
  // Every product can be sent to the cloud, and every cloud lane stays off
  // until it has a measured cost and a live endpoint - built and priced,
  // switched on by the server, never by shipping.
  for (const key of ['imageUpscale', 'voiceRender', 'voiceTraining', 'videoUpscale']) {
    const rate = CLOUD_PRICING[key];
    assert.ok(rate, `${key} is missing`);
    assert.ok(Number.isFinite(rate.price) && rate.price > 0, `${key} has no price`);
    assert.ok(Number.isFinite(rate.estimatedCost), `${key} has no cost to price against`);
  }
  assert.equal(CLOUD_VOICE.costsConfirmed, false,
    'if the voice costs have been measured, say so here and re-price against them');
  assert.equal(CLOUD_PRICING.voiceRender.available, false, 'no endpoint yet');
  assert.equal(CLOUD_PRICING.voiceTraining.available, false, 'no endpoint yet');
});

test('a quote is never negative or NaN, whatever it is handed', () => {
  for (const input of [{ kind: 'video', durationSeconds: -10 }, { kind: 'video', durationSeconds: NaN },
                       { kind: 'video' }, { kind: 'image', imageCount: -4 }]) {
    const quote = quoteCloudJob(input);
    assert.ok(Number.isFinite(quote.amountCents) && quote.amountCents >= 0, JSON.stringify(input));
  }
});

test('wallet cents convert only into time the customer can actually spend', () => {
  // A block costs the rate for its share of a minute. Rounding that to whole
  // cents before dividing lost the customer a block on any rate that is not an
  // exact number of cents per block - $6.99 is one.
  const blockCents = CLOUD_PRICING.videoUpscale.price * 100 * CLOUD_BILLING_INCREMENT_SECONDS / 60;
  assert.equal(cloudVideoSecondsForCents(Math.floor(blockCents) - 1), 0, 'a partial block is never promised');
  assert.equal(cloudVideoSecondsForCents(Math.ceil(blockCents)), CLOUD_BILLING_INCREMENT_SECONDS);
  assert.equal(cloudVideoSecondsForCents(Math.ceil(blockCents * 4)), CLOUD_BILLING_INCREMENT_SECONDS * 4);
  const minuteCents = Math.round(CLOUD_PRICING.videoUpscale.price * 100);
  assert.equal(cloudVideoSecondsForCents(minuteCents), 60, 'a minute of money buys a minute of video');
  for (const bad of [-100, NaN, null, undefined, 'x']) assert.equal(cloudVideoSecondsForCents(bad), 0, String(bad));
});

test('the cloud price of a job always covers its estimated cost', () => {
  for (const [key, rate] of Object.entries(CLOUD_PRICING)) {
    if (!rate || typeof rate !== 'object' || !('available' in rate)) continue;
    assert.ok(Number.isFinite(rate.estimatedCost), `${key} has no cost to price against`);
    assert.ok(rate.price > rate.estimatedCost, `${key} is sold below its estimated cost`);
  }
  assert.equal(CLOUD_PRICING.prepaidOnly, true, 'cloud work must never be able to run up a bill');
});

test('the video rate is priced against the one measurement that exists', () => {
  // The cost is the only measured figure in the model, and it is measured from
  // a single ten-second run. Price and cost must be stated together, and the
  // lane must stay disabled until a production-length job confirms the cost.
  assert.equal(CLOUD_PRICING.videoUpscale.price, CLOUD_VIDEO.pricePerMinute,
    'the wallet rate and the cloud-video rate must be the same number');
  assert.equal(Math.round(CLOUD_PRICING.videoUpscale.estimatedCost * 100), MEASURED_VIDEO_COST.centsPerOutputMinute);
  const margin = 1 - MEASURED_VIDEO_COST.centsPerOutputMinute / (CLOUD_PRICING.videoUpscale.price * 100);
  assert.ok(margin > 0.5, `a cloud minute leaves only ${(margin * 100).toFixed(1)}% after GPU`);
  assert.equal(MEASURED_VIDEO_COST.productionLengthConfirmed, false,
    'if the checkpoint has been run, say so here and re-price against the real number');
  assert.equal(CLOUD_VIDEO.productionEnabled, false,
    'the lane cannot open on a cost measured from ten seconds');
});

test('a cloud minute costs more than one finished on the customer own machine', () => {
  // Local renders cost nothing to serve; cloud renders cost GPU time. Selling
  // the cloud minute at or below the local price gives the dearer product away.
  const local = exportPrice('export_video').total;
  assert.ok(CLOUD_PRICING.videoUpscale.price > local,
    `cloud is $${CLOUD_PRICING.videoUpscale.price}/min but a local minute sells for $${local}`);
});

test('the wallet range is declared once and enforced from that declaration', () => {
  // Three places used to carry the range: the markup, the guard, and the
  // message. Only pricing.js may state it now.
  const usage = read('studio/js/usage.js');
  assert.match(usage, /CLOUD_PRICING\.minimumRefill/);
  assert.match(usage, /CLOUD_PRICING\.maximumRefill/);
  assert.ok(!/amountCents < 500\b/.test(usage), 'the refill floor must not be a literal');
  assert.ok(!/amountCents > 50000\b/.test(usage), 'the refill ceiling must not be a literal');
  assert.ok(!/from \$5\.00 through \$500\.00/.test(usage), 'the message must be built from the declared range');
  assert.ok(CLOUD_PRICING.minimumRefill > 0 && CLOUD_PRICING.maximumRefill > CLOUD_PRICING.minimumRefill);
});

test('the free lane can never deliver a clean file, and a paid lane always can', () => {
  assert.equal(laneFor(null, 'photo'), LANES.free);
  assert.match(LANES.free.imageExport, /proof/i);
  assert.match(LANES.free.videoExport, /proof/i);
  assert.equal(LANES.free.voice.stamped, true, 'free voice must stay watermarked');
  assert.equal(laneFor({ plan: 'full' }, 'photo'), LANES.paid);
  assert.equal(laneFor({ plan: 'single', selected_product: 'photo' }, 'photo'), LANES.paid);
  assert.equal(laneFor({ plan: 'single', selected_product: 'photo' }, 'video'), LANES.free, 'one product does not unlock another');
  assert.equal(laneFor({ plan: 'suspended:full' }, 'photo'), LANES.free, 'a suspended licence falls back to free');
  assert.equal(laneFor({ plan: 'voice_starter' }, 'photo'), LANES.free);
});

test('a suspended or missing licence has no monthly allowance', () => {
  assert.equal(planRemaining(null), 0);
  assert.equal(planRemaining({ plan: 'suspended:full' }), MONTHLY_UNITS.full, 'the suffix is stripped, not treated as a new plan');
  assert.equal(planRemaining({ plan: 'not-a-plan' }), 0);
});

test('the upscale wall is a gate, not a sentence', () => {
  // The Enhance dialog listed every installed model and preselected the 4x one
  // for everybody, under a line of text claiming a plan was required. A free
  // preview could pick the licensed model straight off the menu.
  const installed = ['RealESRGAN_x4plus.pth', 'realesr-animevideov3-x2.pth', 'cpu-lanczos-x4'];
  const offered = license => upscaleModelsForLane(laneFor(license, 'photo'), installed);
  assert.deepEqual(offered(null), ['realesr-animevideov3-x2.pth'], 'free preview is offered the 2x model only');
  assert.deepEqual(offered({ plan: 'full' }), ['RealESRGAN_x4plus.pth']);
  assert.deepEqual(offered({ plan: 'pro' }), ['RealESRGAN_x4plus.pth']);
  assert.deepEqual(offered({ plan: 'suspended:pro' }), ['realesr-animevideov3-x2.pth'],
    'a suspended licence falls back to the preview lane');
  assert.deepEqual(offered({ plan: 'single', selected_product: 'video' }), ['realesr-animevideov3-x2.pth'],
    'a Video-only plan does not unlock the Photo model');
  assert.deepEqual(upscaleModelsForLane(LANES.paid, []), [], 'nothing installed offers nothing');

  const source = read('studio/js/app.js');
  assert.match(source, /upscaleModelsForLane\(/, 'the Enhance dialog must filter by lane');
  assert.ok(!/models\.find\(m => \/realesrgan-x4plus\$\/\.test\(m\)\)/.test(source),
    'the dialog must not reach past the lane for a better model');
});

test('every tier previews, and the free preview is short', () => {
  // maxWords was declared on the free lane and applied nowhere, so an
  // unlicensed preview would read a script of any length. A preview that is
  // not short is not a preview - it is the product, stamped.
  const forVoice = license => scriptAllowance(laneFor(license, 'voice'), 95);
  const free = forVoice(null);
  assert.equal(free.allowed, false);
  assert.equal(free.limit, LANES.free.voice.maxWords);
  assert.match(free.reason, /Free preview reads up to 60 words/);
  assert.equal(scriptAllowance(laneFor(null, 'voice'), 60).allowed, true, 'exactly the limit is allowed');

  // Voice Starter is a basic paid tier, not a preview: it reads any length and
  // renders clean.
  const starter = { plan: 'voice_starter', selected_product: 'voice' };
  assert.equal(forVoice(starter).allowed, true);
  assert.equal(forVoice(starter).limit, null, 'a paid tier has no reading limit');
  assert.equal(laneFor(starter, 'voice').voice.stamped, false, 'Voice Starter output is not watermarked');
  assert.equal(covers(starter, 'voice'), true, 'Voice Starter is covered for voice');
  for (const plan of ['single', 'single_pro', 'full', 'pro']) {
    assert.equal(forVoice({ plan, selected_product: 'voice' }).allowed, true, `${plan} reads any length`);
  }
  assert.equal(forVoice({ plan: 'suspended:voice_starter' }).allowed, false, 'a suspended licence previews short');

  // Asking the lane is not enough; the answer has to stop the render.
  const markup = read('studio/voice.html');
  assert.match(markup, /scriptAllowance\(laneFor\(/, 'the render button must ask the lane before it renders');
  assert.match(markup, /if \(!allowance\.allowed\)[\s\S]{0,200}?return;/,
    'the render button must stop when the lane refuses');
});

test('a free preview never gets more than a paying tier', () => {
  // The voice pack upload asked `plan === 'voice_starter'` directly, so a free
  // preview - which has no plan at all - sailed past the check and could build
  // composite packs a paying Voice Starter customer could not.
  const lane = license => laneFor(license, 'voice');
  const starter = { plan: 'voice_starter', selected_product: 'voice' };
  assert.equal(allowsMultiSourceVoicePack(lane(null)), false, 'free preview must not out-rank a paid tier');
  assert.equal(allowsMultiSourceVoicePack(lane(starter)), false);
  for (const plan of ['single', 'single_pro', 'full', 'pro']) {
    assert.equal(allowsMultiSourceVoicePack(lane({ plan, selected_product: 'voice' })), true, plan);
  }

  // Whatever the free lane grants, some paid lane must grant at least as much.
  const free = lane(null);
  const paid = lane({ plan: 'full' });
  assert.ok(!Number.isFinite(paid.voice.maxWords) || paid.voice.maxWords >= free.voice.maxWords);
  assert.equal(free.voice.stamped, true, 'the free lane is the watermarked one');
  assert.equal(paid.voice.stamped, false);
  assert.ok(paid.packs >= free.packs && paid.clientLinks >= free.clientLinks);

  // A personal voice profile is Voice Starter's headline benefit. It is not a
  // benefit if the free tier keeps them too.
  assert.equal(voiceProfileLimit(null), 0);
  assert.equal(voiceProfileLimit({ plan: 'suspended:pro' }), 0);
  for (const plan of ['voice_starter', 'single', 'single_pro', 'full', 'pro']) {
    assert.ok(voiceProfileLimit({ plan }) >= 1, `${plan} keeps no voice profile`);
    assert.ok(voiceProfileLimit({ plan }) > voiceProfileLimit(null), `free out-ranks ${plan}`);
  }

  const markup = read('studio/voice.html');
  assert.match(markup, /allowsMultiSourceVoicePack\(laneFor\(/, 'the pack gate must read the lane');
  assert.match(markup, /voiceProfileLimit\(license\)/, 'the profile cap must read the declared limit');
  assert.ok(!/license\?\.plan === 'voice_starter'/.test(markup), 'the gates must not name a single plan');
  // "Voice Studio" is this page's own name. It is not a plan, so it must never
  // be offered as the thing to upgrade to.
  assert.ok(!/[Uu]pgrade to Voice Studio/.test(markup), 'there is no plan called "Voice Studio"');
  for (const name of [...markup.matchAll(/(?:upgrade to|move to|Upgrade to) ([A-Z][A-Za-z ]+?)(?:[.,]| for)/g)]) {
    assert.ok(PRODUCTS.some(product => product.name.startsWith(name[1].trim())),
      `the page offers an upgrade to "${name[1].trim()}", which is not a plan we sell`);
  }
});

test('a delivery spends units by what it actually is', () => {
  // The export authorized `quantity: pairs.length` - one unit per placement,
  // whatever its length - so a ten-minute cut billed the same as a still.
  // Duration is the whole point of the video unit.
  assert.equal(exportUnits('photo'), 1);
  assert.equal(exportUnits('photo', { items: 5 }), 5);
  assert.equal(exportUnits('voice', { seconds: 30 }), 1, 'a part minute bills a whole one');
  assert.equal(exportUnits('voice', { seconds: 90 }), 2);
  assert.equal(exportUnits('video', { seconds: 30 }), UNITS_PER_VIDEO_MINUTE);
  assert.equal(exportUnits('video', { seconds: 600 }), UNITS_PER_VIDEO_MINUTE * 10);
  assert.ok(exportUnits('video', { seconds: 600 }) > exportUnits('video', { seconds: 60 }),
    'a longer cut must cost more than a shorter one');
  assert.equal(exportUnits('video', { seconds: 0 }), UNITS_PER_VIDEO_MINUTE, 'a job is never free by rounding to zero');

  assert.equal(unitsForDeliveries([{ kind: 'photo' }, { kind: 'photo' }]), 2);
  assert.equal(unitsForDeliveries([{ kind: 'video', seconds: 600 }]), UNITS_PER_VIDEO_MINUTE * 10);
  assert.equal(unitsForDeliveries([]), 1, 'an empty package still bills something');
  const mixed = unitsForDeliveries([{ kind: 'photo' }, { kind: 'video', seconds: 120 }]);
  assert.equal(mixed, 1 + UNITS_PER_VIDEO_MINUTE * 2);

  // And the export has to use it, not the placement count.
  const source = read('studio/js/app.js');
  assert.match(source, /quantity: unitsForDeliveries\(/, 'the campaign export must bill by what it renders');
  assert.match(source, /seconds: pair\.asset\.duration/, 'the export must pass each clip its duration');
  // A contact sheet and a review page are one photo artifact per placement, so
  // those two do bill by count. The clean and proof packages must not.
  const packageCall = /artifactKind: exportOpts\.proof[\s\S]{0,220}?\}\);/.exec(source)?.[0] || '';
  assert.ok(packageCall, 'the campaign export authorization moved');
  assert.match(packageCall, /unitsForDeliveries\(/, 'the package must bill by what it renders');
  assert.ok(!/quantity: pairs\.length/.test(packageCall), 'the package must not bill per placement');
  assert.equal((source.match(/artifactKind: 'client_review', quantity: pairs\.length/g) || []).length, 1);
  assert.equal((source.match(/artifactKind: 'contact_sheet', quantity: pairs\.length/g) || []).length, 1);
});
