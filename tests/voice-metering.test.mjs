import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { count } from '../studio/js/plural.js';
import { covers } from '../studio/js/license.js';
import { plansCovering, voiceProfileLimit } from '../studio/js/pricing.js';
import { voiceReferenceConsent } from '../studio/js/voice-quality.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const page = readFileSync(resolve(ROOT, 'studio/voice.html'), 'utf8');

/**
 * Counting authorize/settle/void over a faulted run, not grepping for the
 * tokens: a name appearing somewhere in a function body says nothing about
 * whether it is on the path the failure actually takes. The two metering
 * functions are lifted out of the page verbatim and run against the real
 * billing client, a stubbed billing service and a minimal DOM.
 */
function pageFunction(name) {
  const start = page.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.notEqual(start, -1, `${name} not found in studio/voice.html`);
  let depth = 0;
  for (let i = page.indexOf('{', start); i < page.length; i++) {
    if (page[i] === '{') depth++;
    else if (page[i] === '}' && --depth === 0) return page.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces in ${name}`);
}

const PAGE_SOURCE = ['releaseVoiceUsage', 'analyse', 'offerDownload', 'playAndCheck', 'savePack']
  .map(pageFunction).join('\n\n');

const DEPENDENCIES = ['$', 'document', 'fetch', 'AudioContext', 'prompt', 'URL',
  'authorizeOutbound', 'settleOutbound', 'stagePendingUsageRelease', 'voidOutbound',
  'activeLicense', 'covers', 'humanizeBuffer', 'stampPreview', 'voiceTells',
  'voiceReferenceConsent', 'voiceProfileLimit', 'plansCovering', 'count',
  'bridgeFetch', 'BRIDGE', 'checkEngine', 'recordConsent', 'ensureGuardianAck'];

// eslint-disable-next-line no-new-func
const buildPage = new Function(...DEPENDENCIES, `
  let lastTells = null;
  let knownVoicePacks = [];
  ${PAGE_SOURCE}
  return { playAndCheck, savePack };
`);

class Element {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.style = { cssText: '' };
    this.hidden = false;
    this.checked = false;
    this.value = '';
    this.text = '';
  }
  get textContent() { return this.text; }
  set textContent(value) { this.text = String(value); this.children = []; }
  replaceChildren(...nodes) { this.children = nodes; this.text = nodes.map(node => node.textContent).join(''); }
  append(...nodes) { this.children.push(...nodes); }
  prepend(...nodes) { this.children.unshift(...nodes); }
  after() { /* the rating row is not under test */ }
  remove() { /* detached */ }
  removeAttribute(name) { delete this[name]; }
  querySelectorAll() { return []; }
}

const AUTHORIZATION_ID = 'auth_00000001';

/** One faulted (or clean) run of the page's metering path. */
function harness({
  license = { plan: 'full' },
  settle = { authorization: { status: 'settled' } },
  stampAvailable = true,
  humanize = null,
  bridge = null,
  guardianAck = true
} = {}) {
  const billing = [];
  const stagedDuringFlight = [];
  const channelReads = [];
  const blobs = [];
  const store = new Map([['cros:license', 'ML1.test.key']]);

  globalThis.localStorage = {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: key => { store.delete(key); }
  };

  const reply = (body, ok = true) => ({ ok, json: async () => body });
  const fetchStub = async url => {
    const href = String(url);
    if (href.includes('/api/outbound/')) {
      const operation = href.slice(href.indexOf('/api/') + 5);
      billing.push(operation);
      if (operation === 'outbound/authorize') {
        return reply({ ok: true, authorization: { id: AUTHORIZATION_ID, status: 'reserved' } });
      }
      if (operation === 'outbound/settle') {
        return settle instanceof Error ? reply({ error: settle.message }, false) : reply(settle);
      }
      return reply({ authorization: { status: 'voided' } });
    }
    if (href.includes('preview-stamp.wav')) {
      return stampAvailable
        ? { ok: true, arrayBuffer: async () => new ArrayBuffer(16) }
        : { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
    }
    throw new TypeError(`unexpected fetch ${href}`);
  };
  globalThis.fetch = fetchStub;

  const buffer = (label, seconds, length) => ({
    label,
    duration: seconds,
    length,
    sampleRate: 24000,
    getChannelData() { channelReads.push(label); return new Float32Array(length); }
  });
  const clean = buffer('clean', 4.1, 128);
  const humanized = buffer('humanized', 4.1, 128);
  const stamped = buffer('stamped', 11.56, 512);
  const stampSource = buffer('stamp-source', 0.9, 16);

  const elements = new Map();
  const $ = selector => {
    if (!elements.has(selector)) elements.set(selector, new Element(selector));
    return elements.get(selector);
  };
  $('#voiceRights').checked = true;
  $('#voiceRetention').checked = true;

  let decodes = 0;
  const consents = [], acks = [];
  let promptWith = () => 'my-voice';
  const deps = {
    $,
    document: { createElement: tag => new Element(tag), getElementById: () => null },
    fetch: fetchStub,
    AudioContext: class { async decodeAudioData() { return ++decodes === 1 ? clean : stampSource; } close() { return Promise.resolve(); } },
    prompt: (...args) => promptWith(...args),
    URL: { createObjectURL: blob => { blobs.push(blob.size); return `blob:take-${blobs.length}`; } },
    activeLicense: async () => license,
    covers,
    humanizeBuffer: async () => {
      stagedDuringFlight.push(...pending().map(entry => entry.authorizationId));
      if (humanize) throw humanize;
      return humanized;
    },
    stampPreview: async () => stamped,
    voiceTells: () => ({ silenceFloorDb: -62, loudnessCv: 0.31, pauseCount: 2, pauseJitter: 0.4,
      clipPercent: 0, transientClicks: 1, sibilanceIndex: 0.2, crestFactorDb: 11 }),
    voiceReferenceConsent,
    voiceProfileLimit,
    plansCovering,
    count,
    bridgeFetch: async (...args) => {
      stagedDuringFlight.push(...pending().map(entry => entry.authorizationId));
      if (bridge) return bridge(...args);
      return { ok: true, json: async () => ({ report: 'ready' }) };
    },
    BRIDGE: 'http://127.0.0.1:8189',
    checkEngine: () => {},
    // A voice profile is biometric data, so both of these have to happen
    // before the upload and both are watched here: the confirmation that was
    // asked, and the record that was written.
    recordConsent: async record => { consents.push(record); return { id: 'consent_test', ...record }; },
    ensureGuardianAck: async options => { acks.push(options); return guardianAck; }
  };

  let pending = () => [];
  const ready = import('../studio/js/billing-client.js').then(client => {
    pending = client.pendingUsageReleases;
    return buildPage(...DEPENDENCIES.map(name => deps[name] ?? client[name]));
  });

  return {
    billing, stagedDuringFlight, channelReads, blobs, $, consents, acks,
    setPrompt: fn => { promptWith = fn; },
    pending: () => pending(),
    async playAndCheck() { return (await ready).playAndCheck(new ArrayBuffer(64)); },
    async savePack() { return (await ready).savePack(new Blob([new Uint8Array(8)]), { status: 'pass', advisories: [] }); }
  };
}

test('a voice reference that never reaches the engine gives the reservation back', async () => {
  // The everyday condition: the local bridge is not running, so the upload
  // rejects rather than answering. The reservation was taken; it has to come
  // back, and the page has to say so instead of blaming the customer's file.
  const run = harness({ bridge: () => { throw new TypeError('Failed to fetch'); } });
  await run.savePack();
  assert.deepEqual(run.billing, ['outbound/authorize', 'outbound/void']);
  assert.deepEqual(run.pending(), [], 'a confirmed void leaves nothing queued');
  assert.match(run.$('#recState').textContent, /Save failed: Failed to fetch\. Reserved usage was returned\./);
});

test('a voice reference stages its release before the upload leaves the page', async () => {
  // A crash or a closed tab mid-upload is only recoverable if the release is
  // already on disk when the upload is in flight.
  const run = harness({ bridge: () => { throw new TypeError('Failed to fetch'); } });
  await run.savePack();
  assert.deepEqual(run.stagedDuringFlight, [AUTHORIZATION_ID]);
});

test('a voice reference the engine rejects gives the reservation back', async () => {
  const run = harness({ bridge: async () => ({ ok: false, status: 503, json: async () => ({ error: 'engine_down' }) }) });
  await run.savePack();
  assert.deepEqual(run.billing, ['outbound/authorize', 'outbound/void']);
  assert.match(run.$('#recState').textContent, /Save failed: engine_down\. Reserved usage was returned\./);
});

test('a render that fails after the reservation gives it back', async () => {
  // Voice finishing, analysis and encoding all sit between authorize and
  // settle. Any of them throwing used to leave the minutes spent.
  const run = harness({ humanize: new Error('voice finishing failed') });
  await run.playAndCheck();
  assert.deepEqual(run.billing, ['outbound/authorize', 'outbound/void']);
  assert.deepEqual(run.pending(), []);
  assert.deepEqual(run.stagedDuringFlight, [AUTHORIZATION_ID], 'staged before the finishing work starts');
  assert.match(run.$('#status').textContent, /voice finishing failed\. Reserved usage was returned\./);
});

test('a settled render is billed once and hands over the clean take', async () => {
  const run = harness();
  await run.playAndCheck();
  assert.deepEqual(run.billing, ['outbound/authorize', 'outbound/settle']);
  assert.deepEqual(run.pending(), [], 'settlement clears the staged release');
  assert.deepEqual(run.$('#dl').children.map(child => child.tag), ['a'], 'a paid take is downloadable');
  assert.deepEqual(run.channelReads, ['humanized'], 'the clean take is what was delivered');
  assert.doesNotMatch(run.$('#planSummary').textContent, /PREVIEW/);
});

test('an unsettled render leaves no clean take in the page', async () => {
  // The watermark is the paywall in Voice. Withholding only the download link
  // left the clean file in the player, where "Save audio as…" retrieves it.
  const run = harness({ settle: new Error('usage_settlement_unconfirmed') });
  await run.playAndCheck();
  assert.deepEqual(run.billing, ['outbound/authorize', 'outbound/settle', 'outbound/void']);
  assert.deepEqual(run.$('#dl').children.map(child => child.tag), ['p'], 'no download link');
  assert.deepEqual(run.channelReads, ['stamped'], 'only the marked take is encoded for the player');
  assert.equal(run.blobs.length, 1);
  assert.equal(run.blobs[0], 44 + 512 * 2, 'the player holds the stamped take, not the 128-frame clean one');
  assert.match(run.$('#planSummary').textContent, /PREVIEW/);
  assert.equal(run.$('#player').hidden, false);
});

test('an unsettled render that cannot be marked is not left in the player at all', async () => {
  const run = harness({ settle: new Error('usage_settlement_unconfirmed'), stampAvailable: false });
  await run.playAndCheck();
  assert.deepEqual(run.billing, ['outbound/authorize', 'outbound/settle', 'outbound/void']);
  assert.deepEqual(run.channelReads, [], 'nothing was encoded');
  assert.deepEqual(run.blobs, []);
  assert.equal(run.$('#player').hidden, true);
  assert.equal(run.$('#player').src, undefined);
});

test('the profile gate asks pricing which Studio the licence bought', async () => {
  // voiceProfileLimit is the shared rule and the page must not re-derive it:
  // a Photo-only Single covers no voice and stores no personal profile, while
  // a plan that covers voice does.
  const photoOnly = harness({ license: { plan: 'single', selected_product: 'photo' } });
  await photoOnly.savePack();
  assert.deepEqual(photoOnly.billing, [], 'nothing is reserved for a profile the licence does not include');
  assert.match(photoOnly.$('#recState').textContent, /does not store a personal voice profile/);

  const voiceStarter = harness({ license: { plan: 'voice_starter', selected_product: 'voice' } });
  await voiceStarter.savePack();
  assert.deepEqual(voiceStarter.billing, ['outbound/authorize', 'outbound/settle']);
});

test('a voice profile is not built without the age confirmation, on any route', async () => {
  // `ensureGuardianAck` had exactly two call sites, and "Import reference" -
  // the route that accepts somebody else's audio file, including the composite
  // multi-voice blend - was not one of them. The route most likely to carry a
  // stranger's or a minor's voice was the only one with no age gate. Every
  // route into a profile funnels through savePack, so the gate lives there.
  const refused = harness({ guardianAck: false });
  await refused.savePack();
  assert.deepEqual(refused.billing, [], 'nothing may be reserved before the age confirmation');
  assert.equal(refused.consents.length, 0, 'a refused confirmation records no consent');
  assert.match(refused.$('#recState').textContent, /age and guardian confirmation/);

  const allowed = harness();
  await allowed.savePack();
  assert.equal(allowed.acks.length, 1, 'the confirmation must be asked once per subject');
  assert.equal(allowed.acks[0].subject, 'my-voice', 'the confirmation must name the subject it covers');
  assert.equal(allowed.acks[0].purpose, 'voice_conditioning');
});

test('the consent is written down against the subject, not read and dropped', async () => {
  // `voiceReferenceConsent(...)` was read for `.status` and fell out of scope.
  // Nothing persisted it and no consent store existed, while privacy.html
  // stated that consent records live in access-controlled databases. For
  // biometric data the burden of demonstrating consent is ours, and a record
  // that was never written cannot be produced.
  const session = harness();
  await session.savePack();
  assert.equal(session.consents.length, 1, 'the consent must be recorded');
  const [record] = session.consents;
  assert.equal(record.subject, 'my-voice', 'a record with nobody on it covers nobody');
  assert.equal(record.purpose, 'voice_conditioning');
  assert.equal(record.granted, true);
  assert.ok(record.statement.length > 20, 'the record must say what was agreed');
  assert.equal(record.evidence.authorizedSource, true);
  assert.equal(record.evidence.retentionAccepted, true);
});

test('an unnamed subject is refused rather than filed under nothing', async () => {
  const session = harness();
  session.setPrompt(() => '   ');
  await session.savePack();
  assert.deepEqual(session.billing, []);
  assert.equal(session.consents.length, 0);
  assert.match(session.$('#recState').textContent, /needs the name of the person/);
});
