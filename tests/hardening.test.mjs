// The controls that only matter when something else has already gone wrong:
// the script policy that contains an injection, the offline licence record that
// a customer can reach with devtools, and the two things the installed app
// stores on a customer's disk that it should never have stored.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import worker from '../_worker.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// --- the content security policy -------------------------------------------

const env = {
  ASSETS: {
    fetch: request => {
      const path = new URL(request.url).pathname;
      const html = path === '/' || path.endsWith('.html');
      return new Response(html ? readFileSync(resolve(ROOT, (path === '/' ? '/index.html' : path).slice(1)), 'utf8') : 'asset',
        { status: 200, headers: { 'Content-Type': html ? 'text/html' : 'text/plain' } });
    }
  }
};
globalThis.HTMLRewriter ??= class {
  on(_selector, handlers) { this.handlers = handlers; return this; }
  transform(response) { this.handlers?.element?.({ append: () => undefined }); return response; }
};

const policyFor = async path => {
  const response = await worker.fetch(new Request('https://materiallogix.com' + path), env);
  return Object.fromEntries((response.headers.get('Content-Security-Policy') || '')
    .split(';').map(part => part.trim().split(/\s+/)).map(([name, ...values]) => [name, values]));
};

test('the pages that hold the licence key ship a script policy, not an open origin', async () => {
  // Every Studio page carried only object-src/base-uri/form-action/frame-ancestors,
  // which contains nothing: an injection anywhere on this origin could read
  // cros:license, cros:bridgePin, IndexedDB and the admin console's session.
  for (const page of ['/studio/index.html', '/studio/voice.html', '/studio/usage.html', '/index.html']) {
    const policy = await policyFor(page);
    assert.deepEqual(policy['default-src'], ["'self'"], `${page} has no default-src`);
    assert.ok(policy['script-src'], `${page} has no script-src`);
    assert.ok(policy['script-src'].some(source => source.startsWith("'nonce-")),
      `${page} allows scripts by origin alone, which an injection on this origin satisfies`);
    assert.ok(!policy['script-src'].includes("'unsafe-inline'"),
      `${page} allows any inline script, which is the thing being contained`);
    assert.ok(!policy['script-src'].includes("'unsafe-eval'"), `${page} allows eval`);
  }
});

test('the policy accommodates the two things it was left out for', async () => {
  // The Studio boots from an inline theme script: it is allowed by the nonce
  // the same response stamps onto it, not by opening inline scripts up. One
  // response, because the nonce is per-response and must match its own page.
  const response = await worker.fetch(new Request('https://materiallogix.com/studio/index.html'), env);
  const policy = Object.fromEntries(response.headers.get('Content-Security-Policy')
    .split(';').map(part => part.trim().split(/\s+/)).map(([name, ...values]) => [name, values]));
  const nonce = policy['script-src'].find(source => source.startsWith("'nonce-"));
  const page = await response.text();
  const theme = page.match(/<script[^>]*>\(function\(\)\{var t=localStorage\.getItem\('cros:theme'\)/);
  assert.ok(theme, 'the inline theme script is no longer where this test looks for it');
  assert.ok(theme[0].includes(`nonce="${nonce.slice("'nonce-".length, -1)}"`),
    'the theme script that ships does not carry the nonce the policy names, so the Studio boots unstyled');
  // And it talks to a local engine bridge. Loopback is the whole of what an
  // https page can reach, and the whole of what the policy grants.
  assert.ok(policy['connect-src'].includes('http://127.0.0.1:*'), 'the local engine is unreachable');
  assert.ok(policy['connect-src'].includes('http://localhost:*'), 'the local engine is unreachable by name');
  assert.ok(!policy['connect-src'].includes('http:'), 'a blanket http: source is an exfiltration channel');
  assert.ok(policy['connect-src'].includes('https://materiallogix.com'),
    'a preview deployment addresses the API absolutely and would lose it');
});

test('the policy still allows everything the product actually loads', async () => {
  const policy = await policyFor('/studio/index.html');
  // A policy that breaks the product gets removed again, so name the real
  // dependencies: the MediaPipe bundle and its models, the blob module the
  // people-mapping runtime is imported from, and the camera RAW worker.
  // Path-scoped, not host-scoped. jsDelivr serves arbitrary GitHub and npm
  // content from `/gh/<user>/<repo>@<ref>/<file>`, so naming the bare host
  // would let an injected `<script src>` load anything and skip the nonce - a
  // source list is a union, and the nonce closes only the inline vector.
  assert.ok(policy['script-src'].includes('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/'),
    'the vision bundle is imported from jsdelivr');
  assert.ok(!policy['script-src'].includes('https://cdn.jsdelivr.net'),
    'the whole of jsDelivr must not be a script source');
  assert.ok(!policy['connect-src'].includes('https://cdn.jsdelivr.net'),
    'the whole of jsDelivr must not be a connect source');
  assert.ok(policy['script-src'].includes('blob:'), 'the verified people-mapping runtime is imported from a blob');
  assert.ok(policy['script-src'].includes("'wasm-unsafe-eval'"), 'the vision backend instantiates WebAssembly');
  assert.ok(policy['connect-src'].includes('https://storage.googleapis.com/mediapipe-models/'),
    'the landmark models are fetched from Google');
  assert.ok(!policy['connect-src'].includes('https://storage.googleapis.com'),
    'every bucket on storage.googleapis.com must not be reachable');
  assert.ok(policy['worker-src'].includes('blob:'), 'camera RAW decodes in a worker');
  assert.ok(policy['media-src'].includes('blob:'), 'rendered audio and video play from a blob');
  assert.ok(policy['img-src'].includes('blob:') && policy['img-src'].includes('data:'), 'previews are blobs and data URLs');
  assert.ok(policy['style-src'].includes("'unsafe-inline'"), 'the checkout UI injects a stylesheet');
});

// --- the operations console -------------------------------------------------

test('the operations console is not part of a customer install', () => {
  // It was in the mandatory shell, so every customer downloaded the whole ops
  // surface to disk and an install failed outright without it.
  const sw = readFileSync(resolve(ROOT, 'studio/sw.js'), 'utf8');
  const optional = sw.match(/const OPTIONAL = new Set\(\[([^\]]*)\]\)/);
  assert.ok(optional, 'sw.js must mark the console optional');
  for (const entry of ['admin.html', 'js/admin.js', 'css/admin.css']) {
    assert.ok(optional[1].includes(`'${entry}'`), `${entry} is still mandatory in every install`);
  }
});

// --- the service worker, executed ------------------------------------------

/** Load sw.js against a fake worker global and hand back its listeners. */
async function loadServiceWorker({ add = async () => undefined } = {}) {
  const listeners = {};
  const put = [];
  const cache = {
    add,
    put: async (request, response) => { put.push({ request, response }); },
    match: async () => undefined
  };
  globalThis.self = {
    location: { href: 'https://materiallogix.com/studio/sw.js', origin: 'https://materiallogix.com' },
    addEventListener: (name, handler) => { listeners[name] = handler; },
    skipWaiting: async () => undefined,
    clients: { claim: async () => undefined }
  };
  globalThis.location = globalThis.self.location;
  globalThis.caches = { open: async () => cache, keys: async () => [], delete: async () => true };
  // Cache-bust the module so each test gets its own listeners.
  await import(`../studio/sw.js?${Math.random()}`);
  return { listeners, put };
}

test('an install survives the console it is no longer allowed to fetch', async () => {
  // The Worker answers /studio/admin* with 404 to anyone without an Access
  // session, so a customer's install must not treat the miss as fatal.
  const refuseAdmin = async path => { if (/admin/.test(path)) throw new Error('404'); };
  const { listeners } = await loadServiceWorker({ add: refuseAdmin });
  let installed = null;
  await listeners.install({ waitUntil: promise => { installed = promise; } });
  await assert.doesNotReject(installed, 'a missing operations console must not cost the customer their offline shell');
});

test('an install still fails on a module the app cannot start without', async () => {
  const refuseApp = async path => { if (path === 'js/app.js') throw new Error('404'); };
  const { listeners } = await loadServiceWorker({ add: refuseApp });
  let installed = null;
  await listeners.install({ waitUntil: promise => { installed = promise; } });
  await assert.rejects(installed, /Offline shell incomplete: js\/app\.js/);
});

test('the one-time checkout claim is not what the offline cache stores', async () => {
  // checkout-result.js strips session_id and claim from the address bar so the
  // claim is not left in history; caching the request as it arrived left it in
  // Cache Storage instead, where nothing clears it.
  const { listeners, put } = await loadServiceWorker();
  const claimUrl = 'https://materiallogix.com/studio/index.html?checkout=success&session_id=cs_live_SECRET&claim=clm_ONE_TIME';
  globalThis.fetch = async () => new Response('<html></html>', { status: 200 });
  let answered = null;
  const waited = [];
  listeners.fetch({
    request: new Request(claimUrl),
    respondWith: promise => { answered = promise; },
    waitUntil: promise => { waited.push(promise); }
  });
  await answered;
  await Promise.all(waited);
  assert.equal(put.length, 1, 'the page was not cached at all');
  assert.equal(put[0].request.url, 'https://materiallogix.com/studio/index.html',
    'the cache key still carries the one-time claim');
});

// --- the offline licence record --------------------------------------------

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  globalThis.localStorage = {
    getItem: name => (map.has(name) ? map.get(name) : null),
    setItem: (name, value) => map.set(name, String(value)),
    removeItem: name => map.delete(name)
  };
  return map;
}

const KEY = 'ML1.payload.signature';
const offline = () => { globalThis.fetch = async () => { throw new Error('offline'); }; };

test('a hand-edited grace record does not revive a revoked licence', async () => {
  // One devtools edit turned a server-revoked licence back into three days of
  // full entitlement, with no network call at all.
  const { revalidateLicense } = await import('../studio/js/license.js');
  const storage = fakeStorage({ 'cros:licenseCheck': JSON.stringify({ revoked: true, reason: 'subscription_cancelled' }) });
  offline();
  const forged = await revalidateLicense(KEY, { now: Date.now() });
  assert.equal(forged.valid, false, 'the revoked licence is still revoked');

  storage.set('cros:licenseCheck', JSON.stringify({ okAt: Date.now() }));
  const edited = await revalidateLicense(KEY, { now: Date.now() });
  assert.equal(edited.valid, false, 'an untagged okAt buys a grace window');
});

test('a real check writes a record that survives the round trip', async () => {
  // The tag has to be evidence, not an obstacle: the customer who genuinely
  // verified yesterday still works on a train today.
  const { revalidateLicense, GRACE_DAYS } = await import('../studio/js/license.js');
  fakeStorage();
  const now = Date.now();
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, entitlements: { seats: 1 } }), { status: 200 });
  assert.equal((await revalidateLicense(KEY, { now })).valid, true);

  offline();
  assert.equal((await revalidateLicense(KEY, { now: now + 2 * 86400e3 })).valid, true, 'inside the grace window');
  const expired = await revalidateLicense(KEY, { now: now + (GRACE_DAYS + 1) * 86400e3 });
  assert.equal(expired.valid, false, 'past the grace window');
  assert.equal(expired.reason, 'offline');
});

test('a record minted for another licence does not work here', async () => {
  const { revalidateLicense } = await import('../studio/js/license.js');
  const storage = fakeStorage();
  const now = Date.now();
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true }), { status: 200 });
  await revalidateLicense(KEY, { now });
  const theirs = storage.get('cros:licenseCheck');

  fakeStorage({ 'cros:licenseCheck': theirs });
  offline();
  const lifted = await revalidateLicense('ML1.someone.else', { now });
  assert.equal(lifted.valid, false, 'a grace record is transferable between licences');
});

test('an okAt in the future is not a licence that never expires', async () => {
  // `okAt = now + 10 years` was valid forever and made no network call. This
  // is the strong form of the test: the record is re-tagged after the edit, so
  // it is not the tag that refuses it.
  const { revalidateLicense } = await import('../studio/js/license.js');
  const storage = fakeStorage();
  const now = Date.now();
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true }), { status: 200 });
  await revalidateLicense(KEY, { now });

  const record = JSON.parse(storage.get('cros:licenseCheck'));
  const future = { ...record, okAt: now + 3650 * 86400e3 };
  const canonical = JSON.stringify([1, KEY, future.okAt, future.revoked ?? null, future.reason ?? null,
    future.entitlements ?? null, future.replacedAt ?? null]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  future.tag = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  storage.set('cros:licenseCheck', JSON.stringify(future));

  offline();
  const dated = await revalidateLicense(KEY, { now });
  assert.equal(dated.valid, false, 'a future okAt is an unexpiring offline licence');
});

// --- the licence payload ----------------------------------------------------

test('there is no key that skips the server check', async () => {
  // activeLicense used to branch on payload.net === 1, which verifyLicense had
  // already made the only possibility. The branch is gone; this is the
  // invariant that made it dead, asserted against the real functions.
  const { verifyLicense, activeLicense } = await import('../studio/js/license.js');
  const b64u = value => Buffer.from(value).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const signed = payload => `ML1.${b64u(JSON.stringify(payload))}.${b64u('signature')}`;
  const base = { v: 1, plan: 'full', lid: 'lic_testkey0001' };

  // Any signature this test could produce would be rejected, so the signature
  // check is stubbed out and the payload rules are what is under test.
  const realVerify = crypto.subtle.verify.bind(crypto.subtle);
  crypto.subtle.verify = async () => true;
  try {
    assert.equal(await verifyLicense(signed({ ...base, net: 0 })), null, 'a net:0 key must not verify');
    assert.equal(await verifyLicense(signed({ ...base })), null, 'a key with no net must not verify');
    assert.ok(await verifyLicense(signed({ ...base, net: 1 })), 'a net:1 key is the only issuable kind');

    const calls = [];
    fakeStorage({ 'cros:license': signed({ ...base, net: 1 }) });
    globalThis.fetch = async url => { calls.push(String(url)); return new Response(JSON.stringify({ ok: true }), { status: 200 }); };
    assert.equal((await activeLicense()).plan, 'full');
    assert.equal(calls.length, 1, 'the licence was honoured without asking the server');
    assert.match(calls[0], /\/api\/license\/check$/);

    // And the branch that asked the same question a second time is gone: it
    // read as a promise that no-phone-home keys exist, which they do not.
    const source = readFileSync(resolve(ROOT, 'studio/js/license.js'), 'utf8');
    assert.equal((source.match(/payload\.net/g) || []).length, 1,
      'net is read somewhere other than where it is enforced');
  } finally {
    crypto.subtle.verify = realVerify;
  }
});
