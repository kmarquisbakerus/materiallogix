// MaterialLogix host routing and Pages-compatible homepage bootstrap.
//
// This file is Pages advanced mode: every request reaches this Worker, and
// static assets are served through `env.ASSETS`. `_headers` and `_redirects`
// are not consulted on that path, so response headers are set here or nowhere.

// Directives that hold for a static site with same-origin APIs. `script-src`
// and `connect-src` are deliberately absent: the Studio boots from an inline
// theme script and talks to a local engine bridge over the customer's own
// network, and a static allow-list would break both.
const SECURITY_HEADERS = {
  'Content-Security-Policy': "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Content-Type-Options': 'nosniff',
  'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=(), payment=(), interest-cohort=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains'
};

// Repository files that are not part of the published site: documentation,
// dependency manifests, installed packages, the test suite, and anything
// dotted. Matched on the whole path so a nested copy cannot slip through.
const NOT_THE_SITE = /(^|\/)(node_modules|tests?)\/|(^|\/)\.|\.(md|mjs|yml|yaml|lock)$|(^|\/)package(-lock)?\.json$/i;

// `Response.redirect` returns an immutable response, so hardening means
// rebuilding it rather than mutating headers in place.
const harden = response => {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
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
    if ((path === '/' || path === '/index.html') && response.headers.get('content-type')?.includes('text/html')) {
      return harden(new HTMLRewriter()
        .on('body', {
          element(element) {
            element.append('<script type="module" src="/checkout-site.js?v=20260903"></script>', { html: true });
          }
        })
        .transform(response));
    }
    return harden(response);
  }
};
