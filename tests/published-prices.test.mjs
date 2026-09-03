import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PRODUCTS, price, PAY_PER_EXPORT, CLOUD_PRICING, MONTHLY_UNITS, PREMIUM_VOICE, LANES, laneFor } from '../studio/js/pricing.js';
import { covers } from '../studio/js/license.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const site = readFileSync(resolve(ROOT, 'index.html'), 'utf8');

/** The plan cards as the site actually renders them, name and prices. */
function publishedPlans() {
  const section = site.slice(site.indexOf('<section class="pricing"'));
  const pricing = section.slice(0, section.indexOf('</section>'));
  const plans = [];
  for (const card of pricing.matchAll(/<article class="plan[^"]*">([\s\S]*?)<\/article>/g)) {
    const name = /<h3>(.*?)<\/h3>/.exec(card[1])?.[1];
    const amounts = [...card[1].matchAll(/<div class="price[^"]*">\s*\$([0-9]+)/g)].map(m => Number(m[1]));
    if (name) plans.push({ name, amounts });
  }
  return plans;
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

test('the site still advertises exactly the plans the code prices', () => {
  const published = publishedPlans().map(p => p.name).filter(name => name !== 'Free Preview');
  assert.deepEqual(published.sort(), Object.keys(EXPECTED).sort());
});

test('every published price matches what the code would charge', () => {
  for (const [name, terms] of Object.entries(EXPECTED)) {
    const card = publishedPlans().find(p => p.name === name);
    assert.ok(card, `${name} is no longer on the site`);
    const advertised = [...new Set(card.amounts)];
    for (const amount of Object.values(terms)) {
      assert.ok(advertised.includes(amount), `${name} advertises ${advertised.join('/')}, code says ${amount}`);
    }
    const product = PRODUCTS.find(p => p.name === name || p.name.startsWith(`${name} —`));
    assert.ok(product, `${name} has no product in pricing.js`);
    for (const [term, total] of Object.entries(terms)) {
      assert.equal(product.totals[term], total, `${name} ${term}`);
      assert.equal(price(product.id, term).total, total, `${name} ${term} through price()`);
    }
  }
});

test('the pay-per-export price on the site is the price in the code', () => {
  const advertised = /Clean exports from \$([0-9.]+)/.exec(site)?.[1];
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

test('every plan the site advertises can actually be bought', () => {
  // Two Pro tiers were advertised with no checkout button at all.
  const checkout = readFileSync(resolve(ROOT, 'checkout-site.js'), 'utf8');
  const wired = new Set([...checkout.matchAll(/checkoutPlan:\s*'([a-z_]+)'/g)].map(m => m[1]));
  for (const plan of ['voice_starter', 'single_photo', 'single_pro_photo', 'full', 'pro']) {
    assert.ok(wired.has(plan), `${plan} has no way to buy it`);
  }
  for (const name of Object.keys(EXPECTED)) {
    assert.match(checkout, new RegExp(`card\\('${name}'\\)|'${name}'`), `${name} is never looked up on the page`);
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

test('the export price is never written out by hand', () => {
  const checkout = readFileSync(resolve(ROOT, 'checkout-site.js'), 'utf8');
  assert.match(checkout, /PAY_PER_EXPORT/, 'the checkout button must read the declared price');
  const hardCoded = checkout.match(/\$\d+\.\d{2}/g) || [];
  assert.deepEqual(hardCoded, [], `checkout-site.js still hard-codes a price: ${hardCoded.join(', ')}`);
});
