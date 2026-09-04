import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRODUCTS, MONTHLY_UNITS, includedCloudCents, voiceProfileLimit, laneFor,
  allowsMultiSourceVoicePack, scriptAllowance, upscaleModelsForLane, requiresWatermark, deliveryRulesFor
} from '../studio/js/pricing.js';
import { voiceSampleLimits } from '../studio/js/voice-reference.js';
import { covers } from '../studio/js/license.js';

// Seven separate defects this session had one cause: a tier was declared in the
// price list and forgotten in a table somewhere else, so it fell through to
// whatever the fallback was. Upscale models, the preview word cap, composite
// voice packs, personal profile counts, the video watermark, the export
// descriptors, and the voice ladder - every one gave a paying customer less
// than they bought, silently.
//
// This asks every capability what each tier actually receives, so the next
// table that forgets a tier fails here instead of in production.

const INSTALLED_UPSCALERS = ['RealESRGAN_x4plus.pth', 'realesr-animevideov3-x2.pth'];
const licenceFor = product => plan => ({ plan, selected_product: product });

/** What a licence actually gets, asked of the code rather than assumed. */
function capabilities(license, product) {
  const lane = laneFor(license, product);
  const words = scriptAllowance(lane, 10_000);
  return {
    covered: covers(license, product),
    units: MONTHLY_UNITS[license?.plan] || 0,
    cloudCredit: includedCloudCents(license),
    voiceProfiles: voiceProfileLimit(license),
    voiceAudioSeconds: voiceSampleLimits(license?.plan).maximumSeconds,
    voiceTrains: voiceSampleLimits(license?.plan).method === 'train',
    multiSourcePacks: allowsMultiSourceVoicePack(lane),
    scriptLimit: words.limit === null ? Infinity : words.limit,
    upscalers: upscaleModelsForLane(lane, INSTALLED_UPSCALERS).length,
    watermarked: requiresWatermark(lane, product)
  };
}

const PAID_PLANS = [...new Set(PRODUCTS.map(product => product.plan))];

test('no paid tier receives less than the free preview', () => {
  // The failure mode every time: a tier missing from a table falls through to
  // the fallback, and the fallback is whatever was written first.
  for (const product of ['photo', 'video', 'voice']) {
    const free = capabilities(null, product);
    for (const plan of PAID_PLANS) {
      const paid = capabilities(licenceFor(product)(plan), product);
      const where = `${plan} on ${product}`;
      assert.ok(paid.units >= free.units, `${where}: fewer units than free`);
      assert.ok(paid.cloudCredit >= free.cloudCredit, `${where}: less cloud credit than free`);
      assert.ok(paid.voiceProfiles >= free.voiceProfiles, `${where}: fewer voice profiles than free`);
      assert.ok(paid.voiceAudioSeconds >= free.voiceAudioSeconds, `${where}: less reference audio than free`);
      assert.ok(paid.scriptLimit >= free.scriptLimit, `${where}: a shorter script than free`);
      assert.ok(paid.upscalers >= free.upscalers, `${where}: fewer upscale models than free`);
      if (free.multiSourcePacks) assert.ok(paid.multiSourcePacks, `${where}: lost composite packs`);
      if (free.voiceTrains) assert.ok(paid.voiceTrains, `${where}: lost voice training`);
    }
  }
});

test('a Pro tier is never worse than the tier it upgrades', () => {
  // single_pro upgrades single; pro upgrades full. A Pro customer paying more
  // for the same Studio must not receive less of anything in it.
  for (const product of ['photo', 'video', 'voice']) {
    for (const [base, upgrade] of [['single', 'single_pro'], ['full', 'pro']]) {
      const from = capabilities(licenceFor(product)(base), product);
      const to = capabilities(licenceFor(product)(upgrade), product);
      const where = `${upgrade} vs ${base} on ${product}`;
      assert.equal(to.covered, from.covered, `${where}: coverage changed`);
      assert.ok(to.units >= from.units, `${where}: fewer units`);
      assert.ok(to.cloudCredit >= from.cloudCredit, `${where}: less cloud credit`);
      assert.ok(to.voiceProfiles >= from.voiceProfiles, `${where}: fewer voice profiles`);
      assert.ok(to.voiceAudioSeconds >= from.voiceAudioSeconds, `${where}: less reference audio`);
      assert.ok(to.upscalers >= from.upscalers, `${where}: fewer upscale models`);
      assert.ok(to.scriptLimit >= from.scriptLimit, `${where}: a shorter script`);
      if (from.voiceTrains) assert.ok(to.voiceTrains, `${where}: lost voice training`);
      if (from.multiSourcePacks) assert.ok(to.multiSourcePacks, `${where}: lost composite packs`);
      if (!from.watermarked) assert.equal(to.watermarked, false, `${where}: gained a watermark`);
    }
  }
});

test('a covered Studio is never delivered watermarked', () => {
  // The whole point of paying. A tier missing from the lane table used to fall
  // through to the free lane, which stamps everything.
  for (const product of ['photo', 'video', 'voice']) {
    for (const plan of PAID_PLANS) {
      const license = licenceFor(product)(plan);
      if (!covers(license, product)) continue;
      assert.equal(requiresWatermark(laneFor(license, product), product), false,
        `${plan} pays for ${product} and gets it watermarked`);
    }
  }
});

test('a suspended licence falls to the free tier, never through it', () => {
  for (const product of ['photo', 'video', 'voice']) {
    const free = capabilities(null, product);
    for (const plan of PAID_PLANS) {
      const suspended = capabilities({ plan: `suspended:${plan}`, selected_product: product }, product);
      const where = `suspended:${plan} on ${product}`;
      assert.equal(suspended.covered, false, `${where}: still covered`);
      assert.equal(suspended.cloudCredit, 0, `${where}: still has credit`);
      assert.equal(suspended.voiceProfiles, 0, `${where}: still keeps profiles`);
      assert.equal(suspended.upscalers, free.upscalers, `${where}: not on the free lane`);
      assert.equal(suspended.watermarked, true, `${where}: delivers clean files`);
    }
  }
});

test('the real video-watermark exposure is a wrong-product licence, not an anonymous user', () => {
  // I first described this as "an unlicensed user can render a clean video".
  // That was wrong, and wrong in the direction of alarm: authorizeOutbound
  // returns license_required with no key, so an anonymous user never reaches
  // the renderer. The exposure is a licence that does not cover video - a
  // Photo-only Single Studio, a Voice Starter, a suspended Pro. Those hold a
  // key, so they clear authorization, and the client never checked coverage.
  const holdsKey = license => license !== null;
  const wrongProduct = [
    { plan: 'single', selected_product: 'photo' },
    { plan: 'single', selected_product: 'voice' },
    { plan: 'single_pro', selected_product: 'photo' },
    { plan: 'voice_starter', selected_product: 'voice' },
    { plan: 'suspended:pro' },
    { plan: 'suspended:full' }
  ];
  for (const license of wrongProduct) {
    assert.equal(holdsKey(license), true, 'this case is only interesting because it clears authorization');
    assert.equal(covers(license, 'video'), false, `${license.plan} unexpectedly covers video`);
    assert.equal(requiresWatermark(laneFor(license, 'video'), 'video'), true,
      `${license.plan}/${license.selected_product} renders video unmarked`);
    const rules = deliveryRulesFor(laneFor(license, 'video'), 'video');
    assert.equal(rules.watermark.visual, true);
    assert.equal(rules.watermark.audible, true);
    assert.equal(rules.maxHeight, 720);
  }
  // And a licence that does cover video is never marked, or nobody would pay.
  for (const license of [{ plan: 'single', selected_product: 'video' }, { plan: 'full' }, { plan: 'pro' }]) {
    assert.equal(covers(license, 'video'), true);
    assert.equal(requiresWatermark(laneFor(license, 'video'), 'video'), false);
  }
});
