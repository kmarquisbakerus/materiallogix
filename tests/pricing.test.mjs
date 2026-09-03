import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  PRODUCTS, TERMS, price, quoteCloudJob, cloudVideoSecondsForCents,
  CLOUD_PRICING, CLOUD_BILLING_INCREMENT_SECONDS, MONTHLY_UNITS, laneFor, LANES, planRemaining,
  CLOUD_VIDEO, MEASURED_VIDEO_COST, exportPrice
} from '../studio/js/pricing.js';

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

test('an image job bills per image and a voice job bills per minute', () => {
  const images = quoteCloudJob({ kind: 'image', imageCount: 3 });
  assert.equal(images.blocks, 3);
  assert.equal(images.amountCents, 30);
  assert.equal(quoteCloudJob({ kind: 'image', imageCount: 0 }).blocks, 1, 'a job is never free by rounding to zero');
  const voice = quoteCloudJob({ kind: 'voice', durationSeconds: 60 });
  assert.equal(voice.amountCents, Math.round(CLOUD_PRICING.voiceRender.price * 100));
});

test('a quote is never negative or NaN, whatever it is handed', () => {
  for (const input of [{ kind: 'video', durationSeconds: -10 }, { kind: 'video', durationSeconds: NaN },
                       { kind: 'video' }, { kind: 'voice', durationSeconds: 'x' }, { kind: 'image', imageCount: -4 }]) {
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
  for (const key of ['imageUpscale', 'voiceRender', 'videoUpscale']) {
    const rate = CLOUD_PRICING[key];
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
