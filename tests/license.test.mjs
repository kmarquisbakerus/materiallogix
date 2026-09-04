import test from 'node:test';
import assert from 'node:assert/strict';
import { covers, GRACE_DAYS } from '../studio/js/license.js';
import { APP_VERSION, MINIMUM_COMPATIBLE, versionBehind } from '../studio/js/app-version.js';
import { validateHealthAttempt, summarizeHealthAttempts } from './lib/service-health.mjs';
import { normalizePrompt, screenPrompt } from '../studio/js/prompt-guard.js';

test('a licence covers exactly what it paid for', () => {
  assert.equal(covers({ plan: 'full' }, 'photo'), true);
  assert.equal(covers({ plan: 'full' }, 'video'), true);
  assert.equal(covers({ plan: 'full' }, 'voice'), true);
  assert.equal(covers({ plan: 'single', selected_product: 'photo' }, 'photo'), true);
  assert.equal(covers({ plan: 'single', selected_product: 'photo' }, 'video'), false);
  assert.equal(covers({ plan: 'single', selectedProduct: 'video' }, 'video'), true, 'either field spelling is honoured');
  assert.equal(covers({ plan: 'voice_starter' }, 'voice'), true);
  assert.equal(covers({ plan: 'voice_starter' }, 'photo'), false);
  assert.equal(covers({ plan: 'payg' }, 'photo'), true);
});

test('no licence, an unknown plan, or a suspended one covers nothing', () => {
  for (const payload of [null, undefined, {}, { plan: 'nonsense' },
                         { plan: 'suspended:full' }, { plan: 'suspended:single', selected_product: 'photo' }]) {
    for (const product of ['photo', 'video', 'voice']) {
      assert.equal(covers(payload, product), false, `${JSON.stringify(payload)} / ${product}`);
    }
  }
});

test('an unknown product is never covered, whatever the plan', () => {
  for (const plan of ['full', 'payg', 'single', 'voice_starter']) {
    assert.equal(covers({ plan, selected_product: 'photo' }, 'telepathy'), false, plan);
  }
});

test('the offline grace period is short and finite', () => {
  assert.ok(Number.isInteger(GRACE_DAYS) && GRACE_DAYS > 0 && GRACE_DAYS <= 14, String(GRACE_DAYS));
});

test('the shipped version is a real version and is not itself out of date', () => {
  assert.match(APP_VERSION, /^\d+\.\d+\.\d+$/);
  assert.match(MINIMUM_COMPATIBLE, /^\d+\.\d+\.\d+$/);
  assert.equal(versionBehind(APP_VERSION, MINIMUM_COMPATIBLE), false, 'the build must not be below its own minimum');
});

test('version comparison orders releases correctly', () => {
  assert.equal(versionBehind('1.0.0', '1.0.1'), true);
  assert.equal(versionBehind('1.0.1', '1.0.0'), false);
  assert.equal(versionBehind('1.0.0', '1.0.0'), false);
  assert.equal(versionBehind('1.9.0', '1.10.0'), true, 'ten is after nine, not before it');
  assert.equal(versionBehind('2.0.0', '1.99.99'), false);
  assert.equal(versionBehind('1.2.3', '2.0.0'), true);
});

test('health checks measure a real contract, not just a 200', () => {
  const good = { status: 200, contentType: 'application/json', cacheControl: 'no-store',
    body: { ok: true, environment: 'production' }, elapsedMs: 120 };
  assert.deepEqual(validateHealthAttempt(good, 'production', 500), [], 'a correct response has no findings');
  const check = (patch, code) => assert.ok(
    validateHealthAttempt({ ...good, ...patch }, 'production', 500).includes(code),
    `${JSON.stringify(patch)} should report ${code}`);
  check({ status: 503 }, 'status_not_200');
  check({ contentType: 'text/html' }, 'content_type_not_json');
  check({ cacheControl: 'max-age=60' }, 'cache_control_not_no_store');
  check({ body: { ok: false, environment: 'production' } }, 'body_contract_invalid');
  check({ body: { ok: true, environment: 'staging' } }, 'body_contract_invalid');
  check({ body: { ok: true, environment: 'production', secret: 'x' } }, 'body_not_minimal');
  check({ elapsedMs: 5000 }, 'latency_threshold_exceeded');
  check({ elapsedMs: NaN }, 'latency_threshold_exceeded');
});

test('a run of health attempts passes only on enough clean successes', () => {
  const options = { expectedEnvironment: 'production', maxLatencyMs: 500, minimumSuccesses: 2 };
  const good = { status: 200, contentType: 'application/json', cacheControl: 'no-store',
    body: { ok: true, environment: 'production' }, elapsedMs: 100 };
  const bad = { ...good, status: 500 };
  assert.equal(summarizeHealthAttempts([good, good], options).ok, true);
  assert.equal(summarizeHealthAttempts([good, bad], options).ok, false, 'one success is not two');
  assert.equal(summarizeHealthAttempts([], options).ok, false, 'no evidence is not a pass');
  const mixed = summarizeHealthAttempts([good, bad, good], options);
  assert.equal(mixed.successes, 2);
  assert.equal(mixed.attempts, 3);
  assert.ok(mixed.failureCodes.includes('status_not_200'));
  assert.equal(mixed.maxSuccessfulLatencyMs, 100, 'latency is reported from clean attempts only');
});

test('a prompt is refused before it becomes GPU time', () => {
  assert.equal(screenPrompt('a ceramic mug on linen').ok, true);
  assert.equal(screenPrompt('').ok, false);
  assert.equal(screenPrompt('    ').ok, false);
  assert.equal(screenPrompt(null).ok, false);
  const long = screenPrompt('mug '.repeat(400));
  assert.equal(long.ok, false);
  assert.match(long.reason, /trim the prompt/);
});

test('the screen refuses what the acceptable use policy forbids', () => {
  const refusals = [
    'a topless teenager on a beach',
    'nude photo in the likeness of a famous actress',
    'gore and dismembered bodies',
    'a politician caught committing fraud'
  ];
  for (const prompt of refusals) {
    const result = screenPrompt(prompt);
    assert.equal(result.ok, false, `must refuse: ${prompt}`);
    assert.ok(result.reason && result.reason.length > 20, `must explain why: ${prompt}`);
  }
});

test('the screen does not refuse ordinary direction that merely shares a word', () => {
  for (const prompt of ['a young family at dinner', 'children playing in a park',
                        'a chef plating a dish', 'an actress reading a script at a desk',
                        'a nude-toned linen backdrop']) {
    assert.equal(screenPrompt(prompt).ok, true, `must allow: ${prompt}`);
  }
});

test('the same prompt is not queued twice', () => {
  const first = screenPrompt('a ceramic mug on linen');
  assert.equal(first.ok, true);
  const again = screenPrompt('  A Ceramic   Mug On Linen  ', { recent: [first.normalized] });
  assert.equal(again.ok, false, 'case and spacing do not make it a different prompt');
  assert.match(again.reason, /already have|just ran/i);
  assert.equal(screenPrompt('a different mug', { recent: [first.normalized] }).ok, true);
});

test('normalizing a prompt is stable and case-insensitive', () => {
  assert.equal(normalizePrompt('  A   Mug  '), 'a mug');
  assert.equal(normalizePrompt(null), '');
  assert.equal(normalizePrompt(undefined), '');
  assert.equal(normalizePrompt('a mug'), normalizePrompt('A  MUG'));
});
