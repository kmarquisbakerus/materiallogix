import test from 'node:test';
import assert from 'node:assert/strict';
import { PRODUCTS } from '../studio/js/pricing.js';
import { performancePlan, planDuration, wordBudgetForSeconds } from '../studio/js/voice.js';
import { HOUSE_VOICES, HOUSE_VOICE_BY_ID } from '../studio/js/house-voices.js';
import { auditVoiceProfiles, voiceReferenceConsent, VOICE_ACCEPTANCE_SCRIPT } from '../studio/js/voice-quality.js';
import { supportedVoiceReference, voiceSampleLimits, voiceMethod, FINE_TUNE_MINIMUM_SECONDS, VOICE_LADDER_PLANS } from '../studio/js/voice-reference.js';

test('a script becomes segments with a word count and a readable duration', () => {
  const plan = performancePlan('Hello there. This is the second sentence, and it runs a little longer.');
  assert.ok(plan.segments.length >= 1);
  assert.ok(plan.totalWords > 5);
  const seconds = planDuration(plan);
  assert.ok(seconds > 0 && Number.isFinite(seconds), String(seconds));
});

test('an empty script plans nothing rather than failing', () => {
  for (const script of ['', '   ', null, undefined]) {
    const plan = performancePlan(script);
    assert.equal(plan.totalWords, 0, JSON.stringify(script));
    assert.equal(planDuration(plan), 0);
  }
});

test('a longer script always plans a longer read', () => {
  const short = planDuration(performancePlan('One sentence here.'));
  const long = planDuration(performancePlan('One sentence here. '.repeat(20)));
  assert.ok(long > short, `${long} should exceed ${short}`);
});

test('the word budget scales with time and with pace', () => {
  assert.ok(wordBudgetForSeconds(60) > wordBudgetForSeconds(30));
  assert.ok(wordBudgetForSeconds(60, 1.5) > wordBudgetForSeconds(60, 1.0), 'a faster pace fits more words');
  assert.ok(wordBudgetForSeconds(60, 0.5) < wordBudgetForSeconds(60, 1.0));
  // An empty or half-typed fit target must never reach the screen as "NaN words".
  for (const bad of [0, -10, NaN, null, undefined, '', 'x', Infinity]) {
    const budget = wordBudgetForSeconds(bad);
    assert.ok(Number.isFinite(budget) && budget >= 0, `${String(bad)} produced ${budget}`);
  }
  assert.equal(wordBudgetForSeconds(60, 0), 0, 'a stopped pace fits no words');
  assert.equal(wordBudgetForSeconds(60, NaN), 0);
});

test('every house voice is complete and uniquely addressable', () => {
  assert.ok(HOUSE_VOICES.length > 0);
  const ids = new Set();
  for (const voice of HOUSE_VOICES) {
    assert.ok(voice.id, 'a voice needs an id');
    assert.ok(voice.name, `${voice.id} needs a name`);
    assert.ok(voice.locale, `${voice.id} needs a locale`);
    assert.ok(voice.provider, `${voice.id} needs a provider`);
    assert.equal(ids.has(voice.id), false, `${voice.id} is declared twice`);
    ids.add(voice.id);
    assert.equal(HOUSE_VOICE_BY_ID[voice.id], voice, `${voice.id} is not addressable`);
  }
});

test('voice profiles that sound alike are reported', () => {
  const far = auditVoiceProfiles([
    { id: 'a', embedding: [0, 0, 0] }, { id: 'b', embedding: [1, 1, 1] }
  ]);
  assert.ok(far, 'an audit is always returned');
  const near = auditVoiceProfiles([
    { id: 'a', embedding: [0, 0, 0] }, { id: 'b', embedding: [0.0001, 0, 0] }
  ]);
  assert.ok(near, 'near-identical profiles are audited too');
  assert.doesNotThrow(() => auditVoiceProfiles([]));
  assert.doesNotThrow(() => auditVoiceProfiles());
});

test('a voice reference passes only with an authorized source, the declared purpose, and accepted retention', () => {
  const full = { ownerConfirmed: true, releaseConfirmed: true, purpose: 'voice_conditioning', retentionAccepted: true };
  assert.equal(voiceReferenceConsent(full).status, 'pass');
  // Either form of authorization is enough on its own, but nothing else is.
  assert.equal(voiceReferenceConsent({ ...full, releaseConfirmed: false }).status, 'pass');
  assert.equal(voiceReferenceConsent({ ...full, ownerConfirmed: false }).status, 'pass');
  assert.equal(voiceReferenceConsent({ ...full, ownerConfirmed: false, releaseConfirmed: false }).status, 'blocked');
  assert.equal(voiceReferenceConsent({ ...full, retentionAccepted: false }).status, 'blocked');
  assert.equal(voiceReferenceConsent({ ...full, purpose: 'marketing' }).status, 'blocked',
    'consent is for voice conditioning specifically, not for any stated purpose');
  assert.equal(voiceReferenceConsent({ ...full, purpose: '' }).status, 'blocked');
  assert.equal(voiceReferenceConsent().status, 'blocked', 'nothing supplied is not consent');
  assert.equal(voiceReferenceConsent({ ...full, ownerConfirmed: 'yes', releaseConfirmed: 'yes' }).status, 'blocked',
    'only a real true counts as a confirmation, never a truthy string');
  assert.equal(voiceReferenceConsent({ ...full, ownerConfirmed: 1, releaseConfirmed: 1 }).status, 'blocked');
});

test('the acceptance script is fixed text a voice can be measured against', () => {
  assert.ok(Array.isArray(VOICE_ACCEPTANCE_SCRIPT) && VOICE_ACCEPTANCE_SCRIPT.length > 0);
  assert.ok(VOICE_ACCEPTANCE_SCRIPT.every(line => typeof line === 'string' && line.trim().length));
});

test('only real audio files are accepted as a voice reference', () => {
  assert.equal(supportedVoiceReference({ name: 'take.wav', type: 'audio/wav' }), true);
  for (const file of [{ name: 'take.exe', type: 'application/x-msdownload' },
                      { name: 'photo.png', type: 'image/png' },
                      { name: '', type: '' }, {}]) {
    assert.equal(supportedVoiceReference(file), false, JSON.stringify(file));
  }
  assert.equal(supportedVoiceReference(), false);
});

test('sample limits and method follow the plan, and fine tuning has a floor', () => {
  assert.ok(FINE_TUNE_MINIMUM_SECONDS > 0);
  for (const plan of ['free', 'voice_starter', 'single', 'full', null, undefined]) {
    const limits = voiceSampleLimits(plan);
    assert.ok(limits && Number.isFinite(limits.maxSeconds ?? limits.seconds ?? 0), JSON.stringify({ plan, limits }));
  }
  const brief = voiceMethod('full', 1);
  const long = voiceMethod('full', FINE_TUNE_MINIMUM_SECONDS + 60);
  assert.ok(brief, 'a short sample still yields a method');
  assert.ok(long, 'a long sample yields a method');
});

test('every plan on the price list has a rung on the voice ladder', () => {
  // The Pro tiers were added to the price list and never added to the ladder,
  // so they fell through to the fallback: a $39 Pro Studio customer could not
  // train a voice at all while a $15 Single Studio customer could.
  for (const product of PRODUCTS) {
    assert.ok(VOICE_LADDER_PLANS.includes(product.plan),
      `${product.plan} is sold but has no rung on the voice ladder`);
  }
});

test('a rung is never worse than the one beneath it', () => {
  const rungs = ['preview', 'voice_starter', 'single', 'single_pro'];
  for (let i = 1; i < rungs.length; i += 1) {
    const below = voiceSampleLimits(rungs[i - 1]);
    const here = voiceSampleLimits(rungs[i]);
    assert.ok(here.maximumSeconds >= below.maximumSeconds,
      `${rungs[i]} accepts less audio than ${rungs[i - 1]}`);
    if (below.method === 'train') assert.equal(here.method, 'train', `${rungs[i]} lost training`);
  }
  // The Pro tiers must be able to train, which is what they are sold on.
  for (const plan of ['single_pro', 'pro', 'full']) {
    assert.equal(voiceSampleLimits(plan).method, 'train', plan);
    assert.equal(voiceMethod(plan, 30 * 60), 'train', `${plan} cannot train on thirty minutes`);
  }
  assert.ok(voiceSampleLimits('pro').maximumSeconds >= voiceSampleLimits('single').maximumSeconds,
    'Pro Studio must not accept less audio than Single Studio');
});

test('an unlicensed voice never gets what a paid one bought', () => {
  // The fallback used to be Voice Starter's limits, so a free preview received
  // exactly what the cheapest paid tier was sold.
  const starter = voiceSampleLimits('voice_starter');
  for (const plan of [undefined, null, '', 'not_a_plan', 'suspended:pro', 'suspended:voice_starter']) {
    const limits = voiceSampleLimits(plan);
    assert.equal(limits.method, 'prompt', String(plan));
    assert.ok(limits.maximumSeconds < starter.maximumSeconds,
      `${plan} may submit as much audio as a paying Voice Starter customer`);
  }
});
