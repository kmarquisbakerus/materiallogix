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
