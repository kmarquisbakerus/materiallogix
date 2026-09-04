// MaterialLogix host routing and Pages-compatible homepage bootstrap.
//
// This file is Pages advanced mode: every request reaches this Worker, and
// static assets are served through `env.ASSETS`. `_headers` and `_redirects`
// are not consulted on that path, so response headers are set here or nowhere.

const SECURITY_HEADERS = {
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Content-Type-Options': 'nosniff',
  'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=(), payment=(), interest-cohort=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains'
};

// This origin holds the licence key, the bridge PIN, the whole project library
// and an operations console, so script execution is allow-listed rather than
// left open. The two reasons the policy used to name for having no
// `script-src` are both answered here rather than avoided:
//
//   - the Studio pages boot from an inline theme script, so every response
//     carries a fresh nonce and every `<script>` the page shipped with is
//     stamped with it. An injected one cannot guess it;
//   - the engine bridge is reachable at `connect-src`. Loopback is the whole
//     of it because it is the whole of what a browser will allow: an https
//     page is refused a LAN address as mixed content long before CSP is
//     consulted, and a Studio opened over http from a Wi-Fi address is not
//     served by this Worker at all.
//
// The rest is what the product actually loads: the MediaPipe vision bundle and
// its models, the Cloudflare beacon, the blob module the people-mapping
// runtime is imported from, and the blob worker behind camera RAW.
const FONT_SWAP_HANDLER = "'sha256-MhtPZXr7+LpJUY5qtMutB+qWfQtMaPccfe7QXtCcEYc='";
const policy = nonce => [
  "default-src 'self'",
  `script-src 'self' 'nonce-${nonce}' blob: 'wasm-unsafe-eval' https://cdn.jsdelivr.net https://static.cloudflareinsights.com`,
  // The site's one inline event handler promotes the print-only font
  // stylesheet once it has loaded. Its hash is the only one accepted.
  `script-src-attr 'unsafe-hashes' ${FONT_SWAP_HANDLER}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "worker-src 'self' blob:",
  // The apex is named as well as `'self'` because the Studio addresses its API
  // absolutely from anywhere that is not the apex (`api-root.js`), which is
  // every preview deployment this Worker also serves.
  "connect-src 'self' https://materiallogix.com data: blob: http://127.0.0.1:* http://localhost:* https://cdn.jsdelivr.net https://storage.googleapis.com https://cloudflareinsights.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join('; ');

const mintNonce = () =>
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))).replace(/=+$/, '');

// Stamping is unconditional: a `<script src>` gains an attribute it does not
// need, and no inline script the page shipped with can be missed. Only markup
// the site itself wrote reaches this - `env.ASSETS` serves the deploy package -
// and `npm test` counts the stamps against every page that ships.
const stampNonce = async (response, nonce) => {
  const html = (await response.text()).replace(/<script(?=[\s>])/gi, `<script nonce="${nonce}"`);
  const headers = new Headers(response.headers);
  headers.delete('Content-Length');
  return new Response(html, { status: response.status, statusText: response.statusText, headers });
};

// The operations console is reconnaissance for anyone not on the team: it names
// every admin endpoint, parameter and action, and the API behind it answers
// only a Cloudflare Access session. Serve it to that session and to nobody
// else. The offline shell treats these three as optional for this reason.
const ADMIN_ONLY = /^\/studio\/(admin(\.html)?|js\/admin\.js|css\/admin\.css)$/;
const hasAccessSession = request =>
  Boolean(request.headers.get('Cf-Access-Jwt-Assertion')) ||
  /(?:^|;\s*)CF_Authorization=/.test(request.headers.get('Cookie') || '');

// Repository files that are not part of the published site: documentation,
// dependency manifests, installed packages, the test suite, and anything
// dotted. Matched on the whole path so a nested copy cannot slip through.
const NOT_THE_SITE = /(^|\/)(node_modules|tests?)\/|(^|\/)\.|\.(md|mjs|yml|yaml|lock)$|(^|\/)package(-lock)?\.json$/i;

// `Response.redirect` returns an immutable response, so hardening means
// rebuilding it rather than mutating headers in place.
const harden = (response, nonce = mintNonce()) => {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  headers.set('Content-Security-Policy', policy(nonce));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const host = url.hostname.toLowerCase();
    const path = url.pathname;
    const canonical = (nextPath, status = 301) =>
      harden(Response.redirect('https://materiallogix.com' + nextPath + url.search + url.hash, status));

    if (host === 'app.materiallogix.com' || host === 'studio.materiallogix.com') {
      if (path === '/voice' || path === '/voice.html') return canonical('/studio/voice.html');
      if (path === '/' || path === '/index.html') return canonical('/studio/');
      return canonical(path === '/studio' || path.startsWith('/studio/') ? path : '/studio' + path);
    }
    if (host === 'voice.materiallogix.com') return canonical('/studio/voice.html');
    if (host === 'demo.materiallogix.com') {
      return harden(Response.redirect('https://materiallogix.com/studio/?demo=1', 302));
    }
    if (host === 'legal.materiallogix.com') {
      return canonical(path === '/legal' || path.startsWith('/legal/') ? path : '/legal' + (path === '/' ? '/' : path));
    }
    if (host === 'www.materiallogix.com') return canonical(path);

    if (path === '/app' || path === '/app/') return canonical('/studio/');
    if (path.startsWith('/app/')) return canonical('/studio/' + path.slice('/app/'.length));
    if (path === '/voice') return canonical('/studio/voice.html', 302);

    // Nothing but the site itself is served.
    //
    // The deploy package is built by zipping the repository minus a short
    // exclusion list, so anything added to the repository is published by
    // default. That put KNOWN_LIMITATIONS.md - which names every unshipped
    // feature and says in terms "Do not sell the Pro plans until both ship" -
    // at a public URL on the marketing domain, with robots.txt saying
    // `Allow: /`. The packaging step now uses an allow-list, and this is the
    // second lock: a file that is not part of the site is not served even if
    // it reaches the bucket.
    if (NOT_THE_SITE.test(path)) {
      return harden(new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain' } }));
    }

    if (ADMIN_ONLY.test(path) && !hasAccessSession(request)) {
      return harden(new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain' } }));
    }

    // Where the customer is, from the edge rather than from the browser.
    //
    // The video engine's licence excludes a list of territories, so the render
    // path needs a location it did not get from the thing being gated. The
    // client asks for this on every session and never caches it; a stale
    // country is a licence decision made on last week's facts.
    //
    // `request.cf` is absent when the Worker runs outside the edge (local
    // development, a unit test). Answering "unknown" there is correct: the
    // engine gate fails closed on an unknown region, which is the safe
    // direction for a territorial licence.
    if (path === '/edge/region') {
      const country = typeof request.cf?.country === 'string' ? request.cf.country : null;
      return harden(new Response(JSON.stringify({ country, source: country ? 'cloudflare-edge' : 'unavailable' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
      }));
    }

    if (path === '/studio/sw.js') {
      const response = await env.ASSETS.fetch(request);
      const headers = new Headers(response.headers);
      headers.set('Cache-Control', 'no-cache');
      return harden(new Response(response.body, { status: response.status, headers }));
    }

    const response = await env.ASSETS.fetch(request);
    const nonce = mintNonce();
    if (!response.headers.get('content-type')?.includes('text/html')) return harden(response, nonce);
    const page = (path === '/' || path === '/index.html')
      ? new HTMLRewriter()
        .on('body', {
          element(element) {
            element.append('<script type="module" src="/checkout-site.js?v=20260903"></script>', { html: true });
          }
        })
        .transform(response)
      : response;
    return harden(await stampNonce(page, nonce), nonce);
  }
};
