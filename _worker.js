export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const host = url.hostname.toLowerCase();
    const path = url.pathname;

    const redirect = (target, status = 302) => Response.redirect(target, status);
    const asset = (assetPath, search = url.search) => {
      const next = new URL(request.url);
      next.pathname = assetPath;
      next.search = search;
      return env.ASSETS.fetch(new Request(next.toString(), request));
    };

    if (host === 'app.materiallogix.com') {
      return redirect('https://studio.materiallogix.com' + path + url.search + url.hash, 301);
    }

    if (host === 'studio.materiallogix.com') {
      if (path === '/' || path === '/index.html') return asset('/studio/index.html');
      if (path === '/voice' || path === '/voice.html') return redirect('https://voice.materiallogix.com' + url.search + url.hash, 301);
      return asset(path.startsWith('/studio/') ? path : '/studio' + path);
    }

    if (host === 'voice.materiallogix.com') {
      if (path === '/' || path === '/index.html' || path === '/voice.html') return asset('/studio/voice.html');
      return asset(path.startsWith('/studio/') ? path : '/studio' + path);
    }

    if (host === 'demo.materiallogix.com') {
      if (!url.searchParams.has('demo')) {
        const target = new URL(request.url);
        target.pathname = '/';
        target.searchParams.set('demo', '1');
        return redirect(target.toString(), 302);
      }
      if (path === '/' || path === '/index.html') return asset('/studio/index.html');
      return asset(path.startsWith('/studio/') ? path : '/studio' + path);
    }

    if (host === 'legal.materiallogix.com') {
      if (path === '/' || path === '/index.html') return asset('/legal/index.html');
      return asset(path.startsWith('/legal/') ? path : '/legal' + path);
    }

    if (host === 'materiallogix.com' || host === 'www.materiallogix.com') {
      if (path === '/app' || path.startsWith('/app/')) return redirect('https://studio.materiallogix.com' + url.search + url.hash, 301);
      if (path === '/studio' || path.startsWith('/studio/')) return redirect('https://studio.materiallogix.com' + url.search + url.hash, 301);
      if (path === '/voice' || path === '/voice.html') return redirect('https://voice.materiallogix.com' + url.search + url.hash, 301);
      if (path === '/demo' || path.startsWith('/demo/')) return redirect('https://demo.materiallogix.com' + url.search + url.hash, 301);
      if (path === '/legal' || path === '/legal/') return redirect('https://legal.materiallogix.com' + url.search + url.hash, 301);
      if (path.startsWith('/legal/')) {
        const suffix = path.slice('/legal'.length) || '/';
        return redirect('https://legal.materiallogix.com' + suffix + url.search + url.hash, 301);
      }
    }

    return env.ASSETS.fetch(request);
  }
};
