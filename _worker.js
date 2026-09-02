// MaterialLogix host routing and Pages-compatible homepage bootstrap.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const host = url.hostname.toLowerCase();
    const path = url.pathname;
    const canonical = (nextPath, status = 301) =>
      Response.redirect('https://materiallogix.com' + nextPath + url.search + url.hash, status);

    if (host === 'app.materiallogix.com' || host === 'studio.materiallogix.com') {
      if (path === '/voice' || path === '/voice.html') return canonical('/studio/voice.html');
      if (path === '/' || path === '/index.html') return canonical('/studio/');
      return canonical(path === '/studio' || path.startsWith('/studio/') ? path : '/studio' + path);
    }
    if (host === 'voice.materiallogix.com') return canonical('/studio/voice.html');
    if (host === 'demo.materiallogix.com') {
      return Response.redirect('https://materiallogix.com/studio/?demo=1', 302);
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
      return new Response(response.body, { status: response.status, headers });
    }

    const response = await env.ASSETS.fetch(request);
    if ((path === '/' || path === '/index.html') && response.headers.get('content-type')?.includes('text/html')) {
      return new HTMLRewriter()
        .on('body', {
          element(element) {
            element.append('<script type="module" src="/checkout-site.js?v=20260902"></script>', { html: true });
          }
        })
        .transform(response);
    }
    return response;
  }
};
