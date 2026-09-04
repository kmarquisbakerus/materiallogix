import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { count, nounFor } from '../studio/js/plural.js';
import { readableServiceError } from '../studio/js/service-error.js';
import { performancePlan, planDuration } from '../studio/js/voice.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = name => readFileSync(resolve(ROOT, name), 'utf8');
const voicePage = read('studio/voice.html');
const usagePage = read('studio/usage.html');
const adminPage = read('studio/admin.html');

/**
 * The three account pages are markup plus one module each, and the states worth
 * checking are the ones a customer lands in rather than the ones a unit test
 * reaches: a Usage page whose service never answers, and a Voice page whose
 * engine is not installed. Both are driven here — the page's own functions are
 * lifted out of `voice.html` verbatim, and `usage.js` is imported for real
 * against a minimal DOM and a stubbed service — so a passing run means the code
 * ran, not that a string was present.
 */

/** The parts of an element these pages touch, and nothing more. */
class Element {
  constructor(tag = 'div') {
    this.tag = tag;
    this.children = [];
    this.value = '';
    this.disabled = false;
    this.text = '';
    this.html = '';
  }
  get textContent() { return this.text; }
  set textContent(value) { this.text = String(value); this.html = ''; this.children = []; }
  get innerHTML() { return this.html; }
  set innerHTML(value) { this.html = String(value); this.text = this.html.replace(/<[^>]*>/g, ''); }
  insertAdjacentHTML(position, markup) {
    this.innerHTML = position === 'afterbegin' ? markup + this.html : this.html + markup;
  }
  addEventListener() { /* the page rebinds on input; the load path is what is under test */ }
  removeAttribute(name) { delete this[name]; }
  replaceChildren(...nodes) { this.children = nodes; this.text = nodes.map(node => node.textContent).join(''); }
  append(...nodes) { this.children.push(...nodes); }
  after(...nodes) { this.next = nodes; }
  remove() { /* detached */ }
  querySelectorAll() { return []; }
}

/** A document with one lazily-created element per selector asked for. */
function fakeDocument() {
  const elements = new Map();
  const $ = selector => {
    if (!elements.has(selector)) elements.set(selector, new Element(selector));
    return elements.get(selector);
  };
  return {
    $,
    document: {
      querySelector: $, querySelectorAll: () => [],
      createElement: tag => new Element(tag), getElementById: () => null
    }
  };
}

/** Whatever the shipped markup puts in an element before scripts run. */
const markupText = (page, id) => new RegExp(`id="${id}"[^>]*>([^<]*)`).exec(page)?.[1] ?? '';

/** Let a floating `load()` and its rendering finish. */
const settle = async () => { for (let i = 0; i < 24; i++) await new Promise(resolve => setImmediate(resolve)); };

/** One function lifted out of `voice.html` exactly as the page ships it. */
function pageFunction(name) {
  const start = voicePage.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.notEqual(start, -1, `${name} not found in studio/voice.html`);
  let depth = 0;
  for (let i = voicePage.indexOf('{', start); i < voicePage.length; i++) {
    if (voicePage[i] === '{') depth++;
    else if (voicePage[i] === '}' && --depth === 0) return voicePage.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces in ${name}`);
}

// ── Usage: the load that never lands ─────────────────────────────────────────

test('a Usage page whose service never answers says so and disarms the money controls', async () => {
  // Offline this page was three "Loading…" strings over four empty sections
  // with "Manage billing", "Review $10.00 refill", "Save payment method" and
  // "Enable after review" all still live: a page about money that says nothing
  // and still offers to take some.
  const { $, document } = fakeDocument();
  for (const [selector, value] of [['#walletAmount', '10.00'], ['#autoThreshold', '5.00'],
    ['#autoRefill', '10.00'], ['#autoCap', '50.00']]) $(selector).value = value;
  for (const id of ['planSummary', 'walletBalance', 'cloudPhotoPricing']) {
    $(`#${id}`).textContent = markupText(usagePage, id);
    assert.match($(`#${id}`).textContent, /Loading/, `${id} ships a placeholder to replace`);
  }
  // The markup carries no `disabled`, which is exactly why the load path has to
  // set it.
  for (const id of ['billingPortal', 'walletRefill', 'autoSetup', 'autoEnable']) {
    assert.doesNotMatch(usagePage, new RegExp(`id="${id}"[^>]*disabled`), `${id} starts enabled in the markup`);
    $(`#${id}`).disabled = false;
  }
  globalThis.document = document;
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };

  await import('../studio/js/usage.js?case=unreachable');
  await settle();

  assert.match($('#usageStatus').textContent, /Usage is unavailable: the service could not be reached\./);
  for (const id of ['planSummary', 'walletBalance', 'cloudPhotoPricing']) {
    assert.doesNotMatch($(`#${id}`).textContent, /Loading/, `${id} still says it is loading`);
    assert.ok($(`#${id}`).textContent.length > 20, `${id} explains itself`);
  }
  for (const id of ['usageCards', 'usageBreakdown', 'walletTransactions', 'usageTable']) {
    assert.match($(`#${id}`).textContent, /could not be read/, `${id} is a heading over nothing`);
  }
  for (const id of ['billingPortal', 'walletRefill', 'autoSetup', 'autoEnable']) {
    assert.equal($(`#${id}`).disabled, true, `${id} is still pressable with nothing loaded`);
  }
});

test('the Usage page names the billing period and the wallet activity in words', async () => {
  // The status banner printed the service's own `2026-09`, and the wallet table
  // printed `entry_type` verbatim, so the Activity column read "refill".
  const { $, document } = fakeDocument();
  for (const [selector, value] of [['#walletAmount', '10.00'], ['#autoThreshold', '5.00'],
    ['#autoRefill', '10.00'], ['#autoCap', '50.00']]) $(selector).value = value;
  globalThis.document = document;
  globalThis.fetch = async url => {
    const path = String(url);
    const body = path.includes('/wallet/auto-topup') ? { configured: false, settings: {} }
      : path.includes('/wallet') ? {
        balanceCents: 2500, promotionalVideoSecondsAtCurrentRate: 400, purchasedVideoSecondsAtCurrentRate: 500,
        cloudPhoto: { priceReady: true, executionAvailable: false, minimumCentsPerImage: 25, retailCentsPerMegapixel: 4, maxVariations: 1 },
        recent: [{ entry_type: 'refill', amount_cents: 2500, created_at: 1772668800 }], promotionalRecent: []
      }
        : { period: '2026-09', license: { plan: 'full' }, included: { used: 128, limit: 1000, remaining: 872 },
          addOns: { local_units: 3 }, breakdown: [], recent: [] };
    return { ok: true, headers: { get: () => 'application/json' }, json: async () => body };
  };

  await import('../studio/js/usage.js?case=labelled');
  await settle();

  assert.equal($('#usageStatus').textContent, 'September 2026 · server-verified');
  assert.match($('#walletTransactions').innerHTML, /<td>Wallet refill<\/td>/);
  assert.doesNotMatch($('#walletTransactions').innerHTML, /<td>refill<\/td>/);
  // A plan that allows one variation must not advertise "1 variations".
  assert.match($('#cloudPhotoPricing').textContent, /up to 1 variation\./);
});

test('a wallet redirect with no destination is refused instead of navigating to a 404', async () => {
  // Against a 200 that carries no `url`, both wallet buttons called
  // `location.assign(undefined)` and landed the customer on /studio/undefined —
  // the 404 page — losing the page they were on with no message.
  const { $, document } = fakeDocument();
  for (const [selector, value] of [['#walletAmount', '10.00'], ['#autoThreshold', '5.00'],
    ['#autoRefill', '10.00'], ['#autoCap', '50.00']]) $(selector).value = value;
  const assigned = [];
  globalThis.document = document;
  globalThis.confirm = () => true;
  globalThis.location = { assign: url => assigned.push(url) };
  globalThis.fetch = async () => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({ ok: true }) });

  await import('../studio/js/usage.js?case=noredirect');
  await settle();

  await $('#walletRefill').onclick();
  assert.deepEqual(assigned, [], 'a body with no url must not be navigated to');
  assert.match($('#walletStatus').textContent, /Refill unavailable: checkout unavailable\./);
  await $('#autoSetup').onclick();
  assert.deepEqual(assigned, []);
  assert.match($('#walletStatus').textContent, /Payment-method setup unavailable: checkout unavailable\./);
});

// ── Voice: the reason for a disabled primary ─────────────────────────────────

test('the reason Render voice is disabled sits beside the button, not in the More menu', () => {
  const menu = voicePage.slice(voicePage.indexOf('<div class="topbar-more-menu">'), voicePage.indexOf('</details>'));
  assert.doesNotMatch(menu, /id="engineState"/,
    'the only explanation for the disabled primary is collapsed in the opposite corner');
  const renderBlock = voicePage.slice(voicePage.indexOf('id="render"'), voicePage.indexOf('<audio id="player"'));
  assert.match(renderBlock, /id="engineState"/, 'the reason must render with the control it blocks');
});

/** `checkEngine` as the page ships it, over a bridge that answers `reply`. */
const buildCheckEngine = (($, reply) => new Function(
  '$', 'document', 'fetch', 'BRIDGE', 'rebuildVoiceOptions', 'readableServiceError', `
    let engineReady = false;
    let knownVoicePacks = [];
    ${pageFunction('checkEngine')}
    return checkEngine;
  `)($, fakeDocument().document, reply, 'http://127.0.0.1:8189', () => {}, readableServiceError));

test('an uninstalled voice engine disables Render voice and states why on the button', async () => {
  const { $ } = fakeDocument();
  const health = voice => async () => ({ ok: true, json: async () => ({ voice }) });

  const missing = buildCheckEngine($, health({ available: false, packs: [] }));
  await missing();
  assert.equal($('#render').disabled, true);
  assert.match($('#engineState').textContent, /Local voice engine is not installed/);
  assert.equal($('#render').title, $('#engineState').textContent,
    'a disabled primary with no tooltip and no adjacent message is a dead end');

  const installed = buildCheckEngine($, health({ available: true, warm: true, packs: [] }));
  await installed();
  assert.equal($('#render').disabled, false);
  assert.equal($('#render').title, undefined, 'a working button carries no excuse');
});

test('a voice install that fails states the reason, not a DOM exception', () => {
  // The reason now renders on the main surface, so what this path writes there
  // is read by every customer who presses the one remedy the page offers. A
  // failed install with an empty body threw inside `json()`, and the raw
  // "Failed to execute 'json' on 'Response'" went on screen.
  const { $ } = fakeDocument();
  const empty = { ok: false, status: 503, json: async () => { throw new SyntaxError('Unexpected end of JSON input'); } };
  const checkEngine = buildCheckEngine($, async url =>
    (String(url).endsWith('/health') ? { ok: true, json: async () => ({ voice: { available: false, packs: [] } }) } : empty));
  return checkEngine().then(async () => {
    const [setup] = $('#engineState').next;
    assert.equal(setup.textContent, 'Set up Voice on this computer');
    await setup.onclick();
    assert.doesNotMatch($('#engineState').textContent, /Failed to execute|SyntaxError|\bJSON\b/);
    assert.equal($('#engineState').textContent, 'Voice setup did not finish: bridge 503.');
    assert.equal(setup.disabled, false, 'the remedy stays pressable after it fails');
  });
});

// ── Voice: the fit-to-video readout ──────────────────────────────────────────

/** `paintPlan` as the page ships it, over the real performance planner. */
function fitReadout(script, target, { spanish = false } = {}) {
  const { $, document } = fakeDocument();
  $('#lang').value = spanish ? 'es' : 'en';
  $(spanish ? '#spanishScript' : '#script').value = script;
  const build = new Function('$', 'document', 'performancePlan', 'planDuration', 'count', 'nounFor', 'fitSecondsValue', `
    ${pageFunction('activeScriptText')}
    ${pageFunction('paintPlan')}
    return paintPlan;
  `);
  build($, document, performancePlan, planDuration, count, nounFor, () => target)();
  return { fit: $('#fitStatus').textContent, summary: $('#planSummary').textContent };
}

test('an empty script with a fit target asks for a script instead of printing NaN', () => {
  const copy = 'A strong idea deserves a finished presentation. Create with freedom.';
  assert.match(fitReadout(copy, 30).fit, /^room for ~\d+ more words$/);
  for (const empty of [fitReadout('', 30), fitReadout('', 30, { spanish: true })]) {
    assert.doesNotMatch(empty.fit, /NaN/, 'the word delta is 0/0 with nothing to read');
    assert.equal(empty.fit, 'add a script');
    assert.doesNotMatch(empty.summary, /NaN/);
  }
  // Journey contract: a target of zero says nothing at all.
  assert.equal(fitReadout(copy, 0).fit, '');
});

test('the fit readout counts words in the singular when there is one', () => {
  assert.equal(fitReadout('Ship it now.', 2).fit, 'cut ~1 word');
  assert.equal(fitReadout('Buy the good lamp today.', 4).fit, 'room for ~1 more word');
  assert.match(fitReadout('Ship it now.', 1).fit, /^cut ~\d+ words$/);
});

// ── Admin: the promo-code format rule ────────────────────────────────────────

test('the promo-code pattern is a rule the browser can enforce', () => {
  const pattern = /<input name="code"[^>]*\spattern="([^"]+)"/.exec(adminPage)?.[1];
  assert.ok(pattern, 'the promo code field declares a format');
  // Browsers compile `pattern` anchored, with the `v` flag. An unescaped `-`
  // inside `[…_-]` is an invalid class-set range there, so the whole rule was
  // discarded and `checkValidity()` returned true for "!!".
  for (const flag of ['v', 'u']) {
    const compiled = new RegExp(`^(?:${pattern})$`, flag);
    for (const bad of ['!!', 'abc', 'LAUNCH 20', 'LAUNCH$20', 'x'.repeat(33)]) {
      assert.equal(compiled.test(bad), false, `${bad} must be refused under /${flag}`);
    }
    for (const good of ['LAUNCH20', 'A-B_c1', 'four']) {
      assert.equal(compiled.test(good), true, `${good} must be accepted under /${flag}`);
    }
  }
});
