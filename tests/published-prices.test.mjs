import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  PRODUCTS, TERMS, price, PAY_PER_EXPORT, CLOUD_PRICING, MONTHLY_UNITS, PREMIUM_VOICE, LANES, laneFor,
  EXPORT_PRODUCTS, exportPrice, UNIT_PRICE, CLOUD_CREDIT, includedCloudCents, applyCloudCredit,
  walletTopUpCents, quoteCloudJob, planLabel
} from '../studio/js/pricing.js';
import { covers } from '../studio/js/license.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const site = readFileSync(resolve(ROOT, 'index.html'), 'utf8');

const pricingSection = () => {
  const section = site.slice(site.indexOf('<section class="pricing"'));
  return section.slice(0, section.indexOf('</section>'));
};

/** The card headings, in the order a customer reads them. */
const publishedCards = () => [...pricingSection().matchAll(/<article class="plan[^"]*">[\s\S]*?<h3>(.*?)<\/h3>/g)]
  .map(match => match[1]);

/**
 * Every price the site puts on screen, keyed by the plan and term it is for.
 * Cards carry more than one plan now - a Standard/Pro switch inside the card -
 * so a price has to say which plan it belongs to rather than be inferred from
 * the heading above it.
 */
function publishedPrices() {
  const prices = {};
  for (const match of pricingSection().matchAll(
    /<div class="price[^"]*"\s+data-plan="([a-z_]+)"\s+data-term="([a-z]+)"[^>]*>\s*\$([0-9]+)/g)) {
    prices[`${match[1]}:${match[2]}`] = Number(match[3]);
  }
  return prices;
}

// The site is what a customer has been promised. If these disagree, the
// product is charging one thing and advertising another.
const EXPECTED = {
  'Voice Starter': { monthly: 5 },
  'Single Studio': { monthly: 15, quarterly: 40, yearly: 140 },
  'Single Studio Pro': { monthly: 25, quarterly: 67, yearly: 235 },
  'Full Studio': { monthly: 29, quarterly: 77, yearly: 275 },
  'Pro Studio': { monthly: 39, quarterly: 104, yearly: 366 }
};

test('the pricing table is four cards, and every plan lives in one of them', () => {
  // Six cards wrapped 4+2 into a ragged second row. The Pro tiers now ride a
  // switch inside the card they upgrade, so the table is one clean row.
  assert.deepEqual(publishedCards(), ['Free Preview', 'Voice Starter', 'Single Studio', 'Full Studio']);
  const plans = new Set(Object.keys(publishedPrices()).map(key => key.split(':')[0]));
  for (const plan of ['single', 'single_pro', 'full', 'pro']) {
    assert.ok(plans.has(plan), `${plan} lost its price when the cards merged`);
  }
});

test('every published price matches what the code would charge', () => {
  const published = publishedPrices();
  for (const [name, terms] of Object.entries(EXPECTED)) {
    const product = PRODUCTS.find(p => p.name === name || p.name.startsWith(`${name} —`));
    assert.ok(product, `${name} has no product in pricing.js`);
    for (const [term, total] of Object.entries(terms)) {
      assert.equal(product.totals[term], total, `${name} ${term}`);
      assert.equal(price(product.id, term).total, total, `${name} ${term} through price()`);
      const shown = published[`${product.plan}:${term}`];
      assert.equal(shown, total, `${name} ${term}: the site shows ${shown}, the code charges ${total}`);
    }
  }
});

test('every plan and term the code sells is on the page', () => {
  // A price the code will charge but the site never shows is a price nobody
  // agreed to. Voice Starter is the one deliberate exception: monthly only.
  const published = publishedPrices();
  for (const product of PRODUCTS) {
    for (const term of TERMS) {
      const total = price(product.id, term.id)?.total;
      if (!total) continue;
      if (product.plan === 'voice_starter' && term.id !== 'monthly') continue;
      assert.equal(published[`${product.plan}:${term.id}`], total,
        `${product.name} on ${term.id} is priced at ${total} and shown as ${published[`${product.plan}:${term.id}`]}`);
    }
  }
});

test('the pay-per-export price on the site is the price in the code', () => {
  const advertised = /Exports from \$([0-9.]+)\./.exec(site)?.[1];
  assert.ok(advertised, 'the site no longer advertises a pay-per-export price');
  assert.equal(PAY_PER_EXPORT.price, Number(advertised));
});

test('the wallet range on the site is the range the code enforces', () => {
  const range = /any amount from \$(\d+) to \$(\d+)/.exec(site);
  assert.ok(range, 'the site no longer states a wallet range');
  assert.equal(CLOUD_PRICING.minimumRefill, Number(range[1]));
  assert.equal(CLOUD_PRICING.maximumRefill, Number(range[2]));
});

test('the Voice Starter allowance on the site is the allowance in the code', () => {
  const minutes = /(\d+) finished voice minutes each month/.exec(site)?.[1];
  assert.ok(minutes, 'the site no longer states a Voice Starter allowance');
  assert.equal(MONTHLY_UNITS.voice_starter, Number(minutes));
});

test('the premium voice rate on the site is the rate in the code', () => {
  const rate = /Extra voice from \$([0-9.]+)\/hour/.exec(site)?.[1];
  assert.ok(rate, 'the site no longer advertises a premium voice rate');
  assert.equal(PREMIUM_VOICE.extraPricePerHour, Number(rate));
});

test('every plan the site sells has an allowance and unlocks something', () => {
  for (const product of PRODUCTS) {
    assert.ok(MONTHLY_UNITS[product.plan] > 0, `${product.plan} has no monthly allowance`);
    const licence = { plan: product.plan, selected_product: product.selectedProduct };
    const unlocked = ['photo', 'video', 'voice'].filter(kind => covers(licence, kind));
    assert.ok(unlocked.length > 0, `${product.id} unlocks nothing at all`);
  }
});

test('a Pro licence buys the Pro lane, and a standard one does not', () => {
  assert.equal(laneFor({ plan: 'pro' }, 'video'), LANES.pro);
  assert.equal(laneFor({ plan: 'single_pro', selected_product: 'photo' }, 'photo'), LANES.pro);
  assert.equal(laneFor({ plan: 'single_pro', selected_product: 'photo' }, 'video'), LANES.free, 'one Studio does not unlock another');
  assert.equal(laneFor({ plan: 'full' }, 'photo'), LANES.paid);
  assert.equal(laneFor({ plan: 'suspended:pro' }, 'photo'), LANES.free, 'a suspended Pro licence is not a Pro lane');
  assert.equal(LANES.pro.motionEngine, 'pro');
  assert.ok(LANES.pro.walletDiscount > 0, 'the Pro tiers advertise a wallet discount');
});

test('a Pro licence covers what it paid for and nothing more', () => {
  assert.equal(covers({ plan: 'pro' }, 'photo'), true);
  assert.equal(covers({ plan: 'pro' }, 'voice'), true);
  assert.equal(covers({ plan: 'single_pro', selected_product: 'video' }, 'video'), true);
  assert.equal(covers({ plan: 'single_pro', selected_product: 'video' }, 'photo'), false);
  assert.equal(covers({ plan: 'suspended:pro' }, 'photo'), false);
  assert.equal(covers({ plan: 'pro' }, 'telepathy'), false);
});

test('the retired second pricing source is gone', async () => {
  // Two sources of truth that disagreed is what this test exists to prevent.
  await assert.rejects(() => import('../studio/js/pricing-catalog.js'), /Cannot find module|ERR_MODULE_NOT_FOUND/);
});

test('every card on the page is wired to checkout', () => {
  // Two Pro tiers were once advertised with no checkout button at all. The
  // plan a button buys is now resolved from the card's switches at runtime, so
  // the journey proves the six combinations; this holds the wiring in place.
  const checkout = readFileSync(resolve(ROOT, 'checkout-site.js'), 'utf8');
  for (const name of publishedCards()) {
    assert.match(checkout, new RegExp(`card\\('${name}'\\)`), `${name} is never looked up on the page`);
  }
  for (const family of ['single_pro_\\$\\{product\\}', 'single_\\$\\{product\\}']) {
    assert.match(checkout, new RegExp(family), 'the Single Studio button no longer builds its plan from the switches');
  }
  for (const plan of ['voice_starter', 'full', 'pro']) {
    assert.match(checkout, new RegExp(`plan: '${plan}'|checkoutPlan: '${plan}'`), `${plan} has no way to buy it`);
  }
});

test('every plan id a checkout button offers is a real product', () => {
  const checkout = readFileSync(resolve(ROOT, 'checkout-site.js'), 'utf8');
  const offered = new Set([
    ...[...checkout.matchAll(/checkoutPlan:\s*'([a-z_]+)'/g)].map(m => m[1]),
    ...[...checkout.matchAll(/value="([a-z_]+)">(?:Photo|Video|Voice)</g)].map(m => m[1])
  ]);
  const known = new Set(PRODUCTS.map(p => p.id));
  for (const plan of offered) assert.ok(known.has(plan), `checkout offers "${plan}", which pricing.js does not sell`);
});

test('no export price is ever written out by hand', () => {
  const checkout = readFileSync(resolve(ROOT, 'checkout-site.js'), 'utf8');
  assert.match(checkout, /exportPrice\(/, 'the checkout buttons must read the declared prices');
  const hardCoded = checkout.match(/\$\d+\.\d{2}/g) || [];
  assert.deepEqual(hardCoded, [], `checkout-site.js still hard-codes a price: ${hardCoded.join(', ')}`);
});

// ── exports and cloud credit ────────────────────────────────────────────────

test('a photo, a minute of audio and a minute of video are each buyable', () => {
  const checkout = readFileSync(resolve(ROOT, 'checkout-site.js'), 'utf8');
  assert.match(checkout, /EXPORT_PRODUCTS/, 'the free card must offer every export it sells');
  assert.deepEqual(EXPORT_PRODUCTS.map(item => item.id), ['export_image', 'export_audio', 'export_video']);
  for (const item of EXPORT_PRODUCTS) {
    assert.ok(item.label && item.per && item.product, `${item.id} is incomplete`);
    assert.ok(item.units >= 1, `${item.id} must cost at least one unit`);
    assert.ok(item.price > 0, `${item.id} has no price`);
  }
});

test('an export spends units by the work, and is priced on its own', () => {
  // Units are the plan's currency: a minute of finished video is four units
  // because it is four times the work. Price is a separate decision - a single
  // video minute sells for $4.99, not four photos' worth of list - so the two
  // must be able to move apart without one silently dragging the other.
  assert.equal(exportPrice('export_image').units, 1);
  assert.equal(exportPrice('export_audio').units, 1);
  assert.equal(exportPrice('export_video').units, 4);
  assert.equal(exportPrice('export_image').total, 2.99);
  assert.equal(exportPrice('export_audio').total, 2.99);
  assert.equal(exportPrice('export_video').total, 4.99);
  assert.equal(exportPrice('export_video', 3).units, 12, 'three minutes still spend twelve units');
  assert.equal(exportPrice('export_video', 3).total, 14.97, 'and cost three times the minute price');
  assert.equal(exportPrice('export_image', 0).quantity, 1, 'buying nothing is buying one');
  assert.equal(exportPrice('export_image', 2.4).quantity, 3, 'a part minute bills a whole one');
  assert.equal(exportPrice('not_a_product'), null);
  assert.equal(UNIT_PRICE, 2.99, 'a unit is still one clean image');
});

test('the cheapest export is the price the site quotes as its floor', () => {
  const floor = Math.min(...EXPORT_PRODUCTS.map(item => exportPrice(item.id).total));
  const advertised = Number(/Clean exports without a plan[^<]*?from \$([0-9.]+)/.exec(site)?.[1]);
  assert.equal(floor, advertised, 'the site quotes a floor the code does not offer');
  assert.equal(PAY_PER_EXPORT.price, floor);
});

test('the site quotes the video export price the code charges', () => {
  const advertised = Number(/a minute of video from \$([0-9.]+)/.exec(site)?.[1]);
  assert.ok(advertised, 'the site no longer quotes a video export price');
  assert.equal(exportPrice('export_video').total, advertised);
});

test('included cloud credit spends on any cloud job, not only video', () => {
  assert.deepEqual([...CLOUD_CREDIT.spendableOn].sort(), ['image', 'video', 'voice']);
  const advertised = Number(/\$(\d+) of cloud credit each paid period/.exec(site)?.[1]);
  assert.ok(advertised, 'the site no longer states an included cloud credit');
  for (const plan of ['single', 'single_pro', 'full', 'pro']) {
    assert.equal(includedCloudCents({ plan }), advertised * 100, `${plan} credit`);
  }
  assert.equal(includedCloudCents({ plan: 'voice_starter' }), 0, 'a voice-only plan has no cloud lane to spend it on');
  assert.equal(includedCloudCents({ plan: 'suspended:pro' }), 0, 'a suspended licence has no credit');
  assert.equal(includedCloudCents(null), 0);
});

test('credit is spent before the wallet, and a job never runs on account', () => {
  const quote = quoteCloudJob({ kind: 'video', durationSeconds: 120 }).amountCents;
  const covered = applyCloudCredit(quote, { creditCents: 2000, walletCents: 0 });
  assert.equal(covered.fromCreditCents, quote);
  assert.equal(covered.fromWalletCents, 0);
  assert.equal(covered.executable, true);

  const split = applyCloudCredit(quote, { creditCents: 100, walletCents: 10000 });
  assert.equal(split.fromCreditCents, 100, 'credit is always spent first');
  assert.equal(split.fromWalletCents, quote - 100);
  assert.equal(split.executable, true);

  const short = applyCloudCredit(quote, { creditCents: 100, walletCents: 100 });
  assert.equal(short.executable, false, 'prepaid means prepaid');
  assert.equal(short.shortfallCents, quote - 200);
});

test('splitting a cloud job never invents or loses money', () => {
  for (const [owed, credit, wallet] of [[0, 0, 0], [500, 0, 0], [500, 5000, 5000], [1, 0, 1],
                                        [-100, 100, 100], [NaN, 100, 100], [750, 300, 200]]) {
    const split = applyCloudCredit(owed, { creditCents: credit, walletCents: wallet });
    assert.equal(split.fromCreditCents + split.fromWalletCents + split.shortfallCents, split.owedCents,
      `${owed}/${credit}/${wallet} does not add up`);
    for (const value of Object.values(split)) {
      if (typeof value === 'number') assert.ok(Number.isFinite(value) && value >= 0, `${owed}/${credit}/${wallet}`);
    }
  }
});

test('every cloud service the code prices can be paid for with credit', () => {
  for (const kind of CLOUD_CREDIT.spendableOn) {
    const quote = quoteCloudJob({ kind, durationSeconds: 60, imageCount: 1 });
    assert.ok(quote.amountCents > 0, `${kind} has no price`);
    assert.equal(applyCloudCredit(quote.amountCents, { creditCents: 100000 }).executable, true, `${kind} cannot be paid from credit`);
  }
});

test('the Pro wallet discount the site advertises is the discount applied', () => {
  const advertised = Number(/(\d+)% off any wallet top-up/.exec(site)?.[1]);
  assert.ok(advertised, 'the site no longer advertises a wallet discount');
  assert.equal(CLOUD_CREDIT.walletDiscount.pro, advertised / 100);
  assert.equal(walletTopUpCents(5000, { plan: 'pro' }).chargedCents, 5000 * (1 - advertised / 100));
  assert.equal(walletTopUpCents(5000, { plan: 'full' }).chargedCents, 5000, 'only the Pro tier is discounted');
  assert.equal(walletTopUpCents(5000, { plan: 'suspended:pro' }).chargedCents, 5000, 'a suspended licence buys at list');
  assert.equal(walletTopUpCents(5000, null).chargedCents, 5000);
});

test('the wallet page never states a range or a service it does not mean', () => {
  // The estimate, the guard and the fallback all used to carry their own copy
  // of the range, and all of them quoted video alone.
  const usage = readFileSync(resolve(ROOT, 'studio/js/usage.js'), 'utf8');
  assert.ok(!/from \$5 through \$500|\$5\.00 through \$500\.00/.test(usage), 'the wallet range must not be written out by hand');
  assert.ok(!/Video-time estimate/.test(usage), 'the wallet buys any cloud job, not only video');
  assert.match(usage, /REFILL_MIN_CENTS/, 'the estimate must use the declared minimum');
  assert.match(usage, /imageUpscale|voiceRender/, 'the estimate must cover more than video');
});

test('a plan reads as the name it was sold under, never as its id', () => {
  for (const product of PRODUCTS) {
    const label = planLabel(product.plan);
    assert.notEqual(label, product.plan, `${product.plan} still shows its id`);
    assert.ok(product.name.startsWith(label), `${product.plan} reads as "${label}", but the site sells "${product.name}"`);
  }
  assert.equal(planLabel('suspended:full'), 'Full Studio (suspended)');
  assert.equal(planLabel(''), 'No active plan');
  assert.equal(planLabel(null), 'No active plan');
  assert.equal(planLabel('something_we_never_sold'), 'No active plan', 'an unknown id must not reach the screen');
});

test('a subscriber can reach billing and see what the plan includes', () => {
  // A subscription with no way to change a card or cancel is not shippable.
  const markup = readFileSync(resolve(ROOT, 'studio/usage.html'), 'utf8');
  const usage = readFileSync(resolve(ROOT, 'studio/js/usage.js'), 'utf8');
  assert.match(markup, /id="billingPortal"/, 'Usage must offer a way into the billing portal');
  assert.match(markup, /id="planSummary"/, 'Usage must say which plan is active');
  assert.match(usage, /openBillingPortal/, 'the portal button must call the portal');
  assert.match(usage, /planLabel\(/, 'the plan must be named, not printed as an id');
  assert.ok(!/data\.license\?\.plan \|\| 'No active plan'/.test(usage), 'the raw plan id must not be shown');
});

test('the entrance recognises every plan the site sells', async () => {
  // The entrance used to carry its own list of plan ids. Adding the two Pro
  // tiers to the site without adding them there told a paying customer their
  // plan was a preview.
  const { entranceAccess } = await import('../studio/js/studio-entry.js');
  for (const product of PRODUCTS) {
    const license = { plan: product.plan, selected_product: product.selectedProduct };
    const access = entranceAccess(license);
    assert.notEqual(access.label, 'Studio Preview', `${product.id} is shown as a preview`);
    assert.notEqual(access.label, 'Studio', `${product.id} is not named`);
    assert.ok(product.name.startsWith(access.label.split(' — ')[0]),
      `${product.id} is labelled "${access.label}" but sold as "${product.name}"`);
    assert.notEqual(access.message, 'Explore every Studio. A plan unlocks clean delivery.',
      `${product.id} is told it has no plan`);
  }
  assert.equal(entranceAccess(null).label, 'Studio Preview');
  assert.equal(entranceAccess(null, 'demo').label, 'Free Preview');
  assert.equal(entranceAccess({ plan: 'suspended:pro' }).label, 'Reconnect your account');
});

test('no customer-facing screen prints a raw plan id', () => {
  for (const file of ['studio/js/app.js', 'studio/js/usage.js', 'studio/js/studio-entry.js']) {
    const source = readFileSync(resolve(ROOT, file), 'utf8');
    assert.ok(!/\$\{(?:lic|license)\??\.plan\}/.test(source), `${file} interpolates a plan id directly`);
    assert.ok(!/String\((?:lic|license)\.plan\)\.replaceAll/.test(source), `${file} pretty-prints a plan id by hand`);
  }
});

test('the account panels are styled by name, not by position', () => {
  // Inserting a section used to move the tinted backgrounds onto the wrong
  // panels, because the stylesheet counted sections instead of naming them.
  const css = readFileSync(resolve(ROOT, 'studio/css/usage.css'), 'utf8');
  const markup = readFileSync(resolve(ROOT, 'studio/usage.html'), 'utf8');
  assert.ok(!/nth-of-type/.test(css), 'usage.css must not select panels by position');
  for (const name of ['usage-panel--breakdown', 'usage-panel--wallet']) {
    assert.ok(css.includes(`.${name}`), `${name} has no style`);
    assert.ok(markup.includes(name), `${name} is not on any panel`);
  }
});
