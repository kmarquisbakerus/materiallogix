// Where the marketing site sits relative to the Studio. The hosted Studio is a
// folder under the site; a packaged Studio ships the site beside it. One rule,
// so the entrance and the paywall never disagree about where pricing lives.
export function entranceLinks(pathname, href) {
  const hostedStudio = /\/studio(?:\/|$)/.test(pathname);
  return {
    pricing: new URL(hostedStudio ? '../#pricing' : 'site/index.html#pricing', href).href,
    mediaBase: new URL(hostedStudio ? '../media/' : 'site/media/', href).href
  };
}

/** The pricing page for the page this is running on. */
export function pricingUrl(location = globalThis.location) {
  return entranceLinks(location.pathname, location.href).pricing;
}
