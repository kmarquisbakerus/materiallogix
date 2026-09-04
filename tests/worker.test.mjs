import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../_worker.js';

// `_headers` and `_redirects` do not apply in Pages advanced mode, so the
// Worker is the only place these can be set. A release that quietly loses them
// ships a site with no clickjacking, sniffing, or transport protection.
const REQUIRED = [
  ['Content-Security-Policy', /frame-ancestors 'none'/],
  ['Content-Security-Policy', /object-src 'none'/],
  ['Content-Security-Policy', /base-uri 'self'/],
  ['Referrer-Policy', /strict-origin-when-cross-origin/],
  ['X-Content-Type-Options', /^nosniff$/],
  ['Permissions-Policy', /camera=\(self\)/],
  ['Strict-Transport-Security', /max-age=31536000/]
];

const contentType = pathname => (pathname.endsWith('.js') ? 'text/javascript'
  : pathname === '/' || pathname.endsWith('.html') ? 'text/html' : 'text/plain');

const env = {
  ASSETS: {
    fetch: request => new Response('<html><body>site</body></html>', {
      status: 200,
      headers: { 'Content-Type': contentType(new URL(request.url).pathname) }
    })
  }
};

// The platform's streaming rewriter, reduced to what the Worker uses: register
// a body handler, then record what it appends.
const appended = [];
globalThis.HTMLRewriter = class {
  on(_selector, handlers) { this.handlers = handlers; return this; }
  transform(response) {
    this.handlers?.element?.({ append: html => appended.push(html) });
    return response;
  }
};

const get = url => worker.fetch(new Request(url), env);

const assertHardened = (response, label) => {
  for (const [header, pattern] of REQUIRED) {
    assert.match(response.headers.get(header) || '', pattern, `${label} is missing ${header}`);
  }
};

test('every response carries the security headers', async () => {
  assertHardened(await get('https://materiallogix.com/legal/terms.html'), 'an asset');
  assertHardened(await get('https://materiallogix.com/studio/js/app.js'), 'a module');
  assertHardened(await get('https://app.materiallogix.com/'), 'a host redirect');
  assertHardened(await get('https://materiallogix.com/app/'), 'a path redirect');
  assertHardened(await get('https://demo.materiallogix.com/'), 'the demo redirect');
});

test('the service worker is still served uncached', async () => {
  const response = await get('https://materiallogix.com/studio/sw.js');
  assert.equal(response.headers.get('Cache-Control'), 'no-cache');
  assertHardened(response, 'the service worker');
});

test('the marketing homepage is served, not redirected away', async () => {
  // A stale `_redirects` sent `/` to `/studio/`, which would have made pricing
  // and every checkout button unreachable if it were ever honoured.
  appended.length = 0;
  const response = await get('https://materiallogix.com/');
  assert.equal(response.status, 200, 'the homepage must render the site, not redirect');
  assertHardened(response, 'the homepage');
  assert.equal(appended.length, 1, 'the checkout script is what turns the pricing table into buttons');
  assert.match(appended[0], /src="\/checkout-site\.js\?v=\d{8}"/, 'the checkout script must be cache-busted');
});

test('the canonical host and paths still redirect', async () => {
  const cases = [
    ['https://www.materiallogix.com/legal/', 'https://materiallogix.com/legal/'],
    ['https://app.materiallogix.com/voice', 'https://materiallogix.com/studio/voice.html'],
    ['https://voice.materiallogix.com/', 'https://materiallogix.com/studio/voice.html'],
    ['https://legal.materiallogix.com/privacy.html', 'https://materiallogix.com/legal/privacy.html'],
    ['https://materiallogix.com/app/index.html', 'https://materiallogix.com/studio/index.html'],
    ['https://materiallogix.com/voice', 'https://materiallogix.com/studio/voice.html']
  ];
  for (const [from, to] of cases) {
    const response = await get(from);
    assert.ok(response.status === 301 || response.status === 302, `${from} did not redirect`);
    assert.equal(response.headers.get('Location'), to, `${from} went to the wrong place`);
  }
});

test('the edge answers where the customer is, and never from a cache', async () => {
  // The video engine's licence is territorial. The Studio asks the Worker,
  // because the browser is the thing being gated and cannot be the source.
  const atEdge = new Request('https://materiallogix.com/edge/region');
  Object.defineProperty(atEdge, 'cf', { value: { country: 'IE' } });
  const response = await worker.fetch(atEdge, env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'application/json');
  assert.equal(response.headers.get('Cache-Control'), 'no-store',
    'a cached country is a licence decision made on stale facts');
  assert.deepEqual(await response.json(), { country: 'IE', source: 'cloudflare-edge' });
  assertHardened(response, 'the region endpoint');
});

test('off the edge, the region is unknown rather than invented', async () => {
  // Local development and unit tests have no `request.cf`. "Unknown" is the
  // answer the gate fails closed on, which is the safe direction.
  const response = await get('https://materiallogix.com/edge/region');
  assert.deepEqual(await response.json(), { country: null, source: 'unavailable' });
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});
