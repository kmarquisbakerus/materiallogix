// The Content-Security-Policy, exercised in a browser against the real pages.
//
// `npm run journey` serves the repository directly and never touches
// `_worker.js`, so the policy the customer actually receives has no browser
// coverage there at all. A directive that blocks something the product legally
// loads would break production silently and pass every other suite.
//
// The page origin has to BE https://materiallogix.com. Served from anywhere
// else, `api-root.js` switches to an absolute API origin and `connect-src
// 'self'` is judged against the wrong host, so every same-origin call looks
// like a violation - fifteen of them, none real.
import { readFile } from 'node:fs/promises';
import { join, extname, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../../_worker.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ORIGIN = 'https://materiallogix.com';
const PAGES = ['/', '/contact.html', '/studio/', '/studio/voice.html', '/studio/usage.html'];

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.wav': 'audio/wav', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain', '.xml': 'application/xml'
};

// The platform's streaming rewriter, reduced to the one thing the Worker uses.
globalThis.HTMLRewriter = class {
  on(_selector, handlers) { this.handlers = handlers; return this; }
  transform(response) { this.response = response; return this; }
  async text() {
    const html = await this.response.text();
    const added = [];
    this.handlers?.element?.({ append: markup => added.push(markup) });
    return html.replace('</body>', added.join('') + '</body>');
  }
  get headers() { return this.response.headers; }
  get status() { return this.response.status; }
  get statusText() { return this.response.statusText; }
};

const env = { ASSETS: { fetch: async request => {
  let path = decodeURIComponent(new URL(request.url).pathname);
  if (path.endsWith('/')) path += 'index.html';
  try {
    return new Response(await readFile(join(ROOT, path)), {
      status: 200, headers: { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream' } });
  } catch {
    return new Response('not found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
  }
} } };

// The billing service is outside this repository. Answering it keeps a blocked
// request visibly a CSP refusal rather than a 404.
const STUB = JSON.stringify({
  authenticated: false, features: {}, ok: true, balanceCents: 0, recent: [], promotionalRecent: [],
  period: '2026-09', included: { used: 0, limit: 0, remaining: 0 }, breakdown: [], addOns: {},
  license: { plan: null }, configured: false, settings: {}, flags: []
});

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.error('The CSP check needs playwright-core installed. See tests/browser/README.md.'); process.exit(2); }

const executablePath = process.env.JOURNEY_CHROME || process.env.CHROME_PATH || '';
let browser;
try {
  browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox'] });
} catch (error) {
  console.error(`Could not start Chromium: ${error.message.split('\n')[0]}`);
  console.error('Set JOURNEY_CHROME, or run `npx playwright-core install chromium`.');
  process.exit(2);
}

let failures = 0;
for (const path of PAGES) {
  const context = await browser.newContext();
  await context.route(`${ORIGIN}/api/**`, route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: STUB }));
  await context.route(`${ORIGIN}/**`, async route => {
    const request = route.request();
    const response = await worker.fetch(new Request(request.url(), { headers: request.headers() }), env);
    route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: Buffer.from(await response.arrayBuffer())
    });
  });

  const page = await context.newPage();
  const blocked = [], errors = [];
  page.on('console', message => {
    const text = message.text();
    if (/Content Security Policy|Refused to (load|execute|connect|apply)/i.test(text)) blocked.push(text.slice(0, 150));
    else if (message.type() === 'error'
      && !/ERR_CONNECTION|ERR_TUNNEL|Failed to load resource|XNNPACK/.test(text)) errors.push(text.slice(0, 120));
  });
  page.on('pageerror', error => errors.push(`PAGEERROR: ${error.message.split('\n')[0]}`));

  await page.goto(ORIGIN + path, { waitUntil: 'domcontentloaded' })
    .catch(error => errors.push(`GOTO: ${error.message.split('\n')[0]}`));
  await page.waitForTimeout(5000);

  const seen = await page.evaluate(() => ({
    stamped: document.querySelectorAll('script[nonce]').length,
    scripts: document.querySelectorAll('script').length,
    rendered: (document.body.innerText || '').trim().length
  }));
  const ok = !blocked.length && !errors.length
    && seen.stamped === seen.scripts && seen.rendered > 200;
  if (!ok) failures += 1;
  console.log(`${ok ? ' PASS ' : ' FAIL '} ${path.padEnd(22)} ${seen.stamped}/${seen.scripts} scripts stamped, ${seen.rendered} chars rendered`);
  for (const line of blocked) console.log(`         blocked: ${line}`);
  for (const line of errors) console.log(`         error:   ${line}`);
  await context.close();
}

await browser.close();
console.log(failures
  ? `\n${failures} page${failures === 1 ? '' : 's'} broken by the policy the Worker serves`
  : `\nall ${PAGES.length} pages load clean under the policy the Worker serves`);
process.exit(failures ? 1 : 0);
