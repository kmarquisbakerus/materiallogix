import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../_worker.js';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// The Worker's own rule, read from the Worker, so the test cannot drift from it.
const NOT_THE_SITE = new RegExp(
  readFileSync(resolve(ROOT, '_worker.js'), 'utf8').match(/const NOT_THE_SITE = \/(.+)\/i;/)[1], 'i');

// `_headers` and `_redirects` do not apply in Pages advanced mode, so the
// Worker is the only place these can be set. A release that quietly loses them
// ships a site with no clickjacking, sniffing, or transport protection.
const REQUIRED = [
  ['Content-Security-Policy', /frame-ancestors 'none'/],
  ['Content-Security-Policy', /object-src 'none'/],
  ['Content-Security-Policy', /base-uri 'self'/],
  // Without these two the origin that holds the licence key, the bridge PIN
  // and the operations console has no containment for the next injection.
  ['Content-Security-Policy', /default-src 'self'/],
  ['Content-Security-Policy', /script-src 'self' 'nonce-[A-Za-z0-9+/_-]{16,}'/],
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

test('nothing but the site is served', async () => {
  // The deploy package was built by zipping the repository minus a short
  // exclusion list, so KNOWN_LIMITATIONS.md - which names every unshipped
  // feature and says "Do not sell the Pro plans until both ship" - sat at a
  // public URL on the marketing domain, with robots.txt saying `Allow: /`.
  const internal = [
    '/KNOWN_LIMITATIONS.md', '/ZERO_TRUST.md', '/SECURITY.md',
    '/package.json', '/package-lock.json',
    '/node_modules/playwright-core/README.md', '/node_modules/playwright-core/index.js',
    '/tests/pricing.test.mjs', '/tests/browser/harness.mjs',
    '/.github/workflows/verify.yml', '/.gitignore',
    '/studio/js/deep/nested/node_modules/thing.js'
  ];
  for (const path of internal) {
    const response = await get('https://materiallogix.com' + path);
    assert.equal(response.status, 404, `${path} is readable on the public site`);
    assertHardened(response, path);
  }
});

test('blocking internal files does not take any of the site with it', async () => {
  const site = [
    '/', '/index.html', '/404.html', '/checkout-site.js',
    '/studio/', '/studio/index.html', '/studio/voice.html', '/studio/usage.html',
    '/studio/js/app.js', '/studio/js/pricing.js',
    '/legal/terms.html', '/legal/privacy.html', '/legal/refunds.html',
    '/robots.txt', '/sitemap.xml', '/logo.svg', '/indexnow-key.txt',
    '/cc89cc851acf64485c1280baa77eab1b.txt', '/demo/index.html', '/edge/region'
  ];
  for (const path of site) {
    const response = await get('https://materiallogix.com' + path);
    assert.notEqual(response.status, 404, `${path} is part of the site and must be served`);
  }
});

test('every file the deploy package ships is one the Worker will serve', () => {
  // The two rules have to agree. A file in the package that the Worker 404s is
  // dead weight; a file the Worker serves that the package omits is a broken
  // link in production.
  // Run the workflow's own selection rather than a copy of it. A copy is how
  // this test came to disagree with the packaging step the first time the
  // step learned a new exclusion.
  const workflow = readFileSync(resolve(ROOT, '.github/workflows/package-cloudflare-upload.yml'), 'utf8');
  const start = workflow.indexOf("python - <<'PY'") + "python - <<'PY'".length;
  const block = workflow.slice(start, workflow.indexOf('          PY\n', start));
  const script = block.split('\n').map(line => line.startsWith(' '.repeat(10)) ? line.slice(10) : line).join('\n');
  // Everything up to the archive: the selection, not the writing of a 25MB zip.
  const selection = script.slice(0, script.indexOf('shipped = []'))
    + 'shipped = [p.relative_to(root).as_posix() for p in sorted(root.rglob("*"))'
    + ' if p.is_file() and is_site(p.relative_to(root).as_posix())]\n'
    + 'print("\\n".join(shipped))';
  const shipped = execFileSync('python3', ['-c', selection], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(Boolean);

  assert.ok(shipped.length > 50, `the package looks empty: ${shipped.length} files`);
  // _worker.js is the Worker itself; Pages consumes it rather than serving it.
  const refused = shipped.filter(file => file !== '_worker.js' && NOT_THE_SITE.test('/' + file));
  assert.deepEqual(refused, [], `the package ships files the Worker will 404:\n  ${refused.join('\n  ')}`);
  for (const required of ['index.html', 'studio/index.html', 'studio/js/app.js', 'legal/terms.html']) {
    assert.ok(shipped.includes(required), `${required} is missing from the deploy package`);
  }
});

test('the operations console is served only to a verified Cloudflare Access session', async () => {
  // The console names every admin endpoint, parameter and action, so serving
  // the markup to the public is reconnaissance for no gain.
  //
  // The first version of this gate tested only that a header or cookie NAME was
  // present, and this test asserted that a stub value opened it - which is
  // exactly what an attacker sends. A check that looks like authentication and
  // is not is worse than none, so the token is verified and the unverified
  // cases below are the ones that must be refused.
  const consolePaths = ['/studio/admin.html', '/studio/admin', '/studio/js/admin.js', '/studio/css/admin.css'];
  const configured = { ...env, ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com', ACCESS_AUD: 'aud-value' };

  for (const path of consolePaths) {
    const anonymous = await get('https://materiallogix.com' + path);
    assert.equal(anonymous.status, 404, `${path} is readable without an Access session`);
    assertHardened(anonymous, path);

    for (const [label, headers] of [
      ['a made-up assertion', { 'Cf-Access-Jwt-Assertion': 'stub.jwt.value' }],
      ['a made-up cookie', { Cookie: 'cros=1; CF_Authorization=stub' }],
      ['an empty assertion', { 'Cf-Access-Jwt-Assertion': '' }],
      ['a well-formed but unsigned token', {
        'Cf-Access-Jwt-Assertion': [
          Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'k' })).toString('base64url'),
          Buffer.from(JSON.stringify({ aud: 'aud-value', iss: 'https://team.cloudflareaccess.com',
            exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url'),
          Buffer.from('not-a-signature').toString('base64url')
        ].join('.')
      }]
    ]) {
      const forged = await worker.fetch(new Request('https://materiallogix.com' + path, { headers }), configured);
      assert.equal(forged.status, 404, `${path} opened for ${label}`);
    }
  }

  // Unconfigured is not a reason to open the console.
  const unconfigured = await worker.fetch(new Request('https://materiallogix.com/studio/admin.html',
    { headers: { 'Cf-Access-Jwt-Assertion': 'stub.jwt.value' } }), env);
  assert.equal(unconfigured.status, 404, 'the console opens when the Access audience is not configured');
});

test('every script tag the pages ship with carries the response nonce', async () => {
  // The policy names a nonce, so a page whose own scripts do not carry it does
  // not boot at all: no theme, no service worker, no Voice Studio. Driven
  // against the real files rather than a stub, because the count that matters
  // is the one that ships.
  const pages = ['/index.html', '/studio/index.html', '/studio/voice.html', '/studio/usage.html'];
  const realAssets = {
    ASSETS: {
      fetch: request => new Response(readFileSync(resolve(ROOT, new URL(request.url).pathname.slice(1)), 'utf8'),
        { status: 200, headers: { 'Content-Type': 'text/html' } })
    }
  };
  for (const page of pages) {
    const response = await worker.fetch(new Request('https://materiallogix.com' + page), realAssets);
    const nonce = response.headers.get('Content-Security-Policy').match(/'nonce-([^']+)'/)[1];
    const html = await response.text();
    const tags = html.match(/<script(?=[\s>])/gi) || [];
    const stamped = html.match(new RegExp(`<script nonce="${nonce.replace(/[+/]/g, '\\$&')}"`, 'g')) || [];
    assert.ok(tags.length > 0, `${page} has no script tags to stamp`);
    assert.equal(stamped.length, tags.length, `${page} ships ${tags.length - stamped.length} script tags the policy will refuse`);
  }
});

test('two responses never share a nonce', async () => {
  const first = await get('https://materiallogix.com/studio/index.html');
  const second = await get('https://materiallogix.com/studio/index.html');
  const nonceOf = response => response.headers.get('Content-Security-Policy').match(/'nonce-([^']+)'/)[1];
  assert.notEqual(nonceOf(first), nonceOf(second), 'a reused nonce is a nonce an injection can learn');
});
