// The session a journey runs in: a licensed Studio with a stubbed billing
// service and a stubbed local engine.
//
// The licence is minted here, in memory, against a keypair generated for this
// run. The shipped public key is swapped at the network edge so the minted
// licence verifies - no product code is modified, and no real key is involved.
import { webcrypto } from 'node:crypto';

const b64u = bytes => Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function mintLicence(plan = 'full', selectedProduct = null) {
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await webcrypto.subtle.exportKey('jwk', pair.publicKey);
  const payload = { v: 1, net: 1, plan, lid: 'lic_journeyRun0001', email: 'journey@materiallogix.test', iss: 'journey' };
  // A single-Studio licence has to say which Studio, or it covers nothing.
  if (selectedProduct) payload.selected_product = selectedProduct;
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const signature = await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, bytes);
  return { key: `ML1.${b64u(bytes)}.${b64u(new Uint8Array(signature))}`, jwk: { kty: jwk.kty, x: jwk.x, y: jwk.y, crv: jwk.crv } };
}

/** A browser context with billing stubbed and, optionally, a licence installed. */
export async function studioContext(browser, { licence = null, features = {}, authenticated = true } = {}) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1100 }, acceptDownloads: true });
  const api = [], downloads = [], errors = [];

  await context.route('https://materiallogix.com/api/**', route => {
    const path = route.request().url().replace('https://materiallogix.com/api/', '').split('?')[0];
    api.push(path);
    const json = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (path.startsWith('license/check')) return json({ ok: true, entitlements: { plan: licence ? 'full' : 'free' } });
    if (path.startsWith('session')) return json({ authenticated, features });
    if (path.startsWith('outbound/authorize')) return json({ ok: true, authorization: { id: 'auth-journey-000001', status: 'authorized' } });
    if (path.startsWith('outbound/settle')) return json({ ok: true, authorization: { id: 'auth-journey-000001', status: 'settled' } });
    if (path.startsWith('outbound/void')) return json({ ok: true, authorization: { id: 'auth-journey-000001', status: 'voided' } });
    // The Usage page reads every one of these fields. A thin stub let the page
    // throw on the first missing one and render nothing at all, which is
    // exactly what a customer would have seen.
    if (path.startsWith('usage')) return json({
      period: '2026-09', license: { plan: licence ? 'full' : null, selected_product: null },
      included: { used: 128, limit: 1000, remaining: 872 },
      addOns: { local_units: 3 },
      breakdown: [{ product: 'photo', artifact_kind: 'clean_export', operations: 24, included_units: 24, purchased_units: 0, status: 'settled' }],
      recent: [{ product: 'photo', artifact_kind: 'clean_export', requested_units: 1, included_units: 1, purchased_units: 0,
        status: 'settled', updated_at: 1772668800 }]
    });
    if (path.startsWith('wallet/auto-topup')) return json({ configured: false, settings: {} });
    if (path.startsWith('wallet/checkout')) return json({ url: 'https://checkout.stripe.test/journey' });
    if (path.startsWith('wallet')) return json({
      balanceCents: 2500, promotionalVideoCents: 2000,
      promotionalVideoSecondsAtCurrentRate: 400, purchasedVideoSecondsAtCurrentRate: 500,
      cloudPhoto: { priceReady: true, executionAvailable: false, minimumCentsPerImage: 25, retailCentsPerMegapixel: 4, maxVariations: 4 },
      recent: [{ entry_type: 'refill', amount_cents: 2500, created_at: 1772668800 }],
      promotionalRecent: []
    });
    if (path.startsWith('admin/usage')) return json({ period: '2026-09', totals: { operations: 5, billable_units: 5 },
      products: [{ product: 'photo', artifact_kind: 'clean_export', status: 'settled', operations: 5, artifacts: 5, billable_units: 5 }], failures: [] });
    if (path.startsWith('admin/feature-flags')) return json({ flags: [
      { key: 'google_sign_in', audience: 'all', note: 'Waiting on the Google developer account', enabled: features.google_sign_in === true },
      { key: 'apple_sign_in', audience: 'all', note: 'Waiting on the Apple developer account', enabled: features.apple_sign_in === true }] });
    return json({ ok: true });
  });

  if (licence) {
    await context.route('**/studio/js/license-key.js', route => route.fulfill({ status: 200, contentType: 'text/javascript',
      body: `export const LICENSE_PUBLIC_JWK = ${JSON.stringify(licence.jwk)};` }));
    await context.addInitScript(key => { try { localStorage.setItem('cros:license', key); } catch { /* private mode */ } }, licence.key);
  }

  // The local engine bridge, so a render can be observed rather than assumed.
  // Every request it receives is recorded, which is the only way to see what
  // the client actually sent - a grep for the line that builds the options
  // proves the line exists, not that it runs.
  const bridge = [];
  await context.route('http://*:8189/**', route => {
    const url = new URL(route.request().url());
    bridge.push({ path: url.pathname, opts: url.searchParams.get('opts') });
    if (url.pathname === '/health') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        // Upscaling stays on the ComfyUI path the rest of the journey exercises.
        // Reporting it available here would route Enhance through this stub and
        // test the stub instead of the product.
        upscale: { available: false, models: [] },
        voice: { available: false, packs: [] },
        video: { ffmpeg: true, whisper: true, watermark: true },
        lan: []
      }) });
    }
    if (url.pathname === '/video/render') {
      return route.fulfill({ status: 200, contentType: 'video/mp4', body: 'rendered' });
    }
    return route.fulfill({ status: 404, body: '' });
  });

  const page = await context.newPage();
  page.on('pageerror', error => errors.push(`PAGEERROR: ${error.message.split('\n')[0]}`));
  page.on('console', message => {
    const text = message.text();
    if (message.type() === 'error' && !/ERR_CONNECTION|ERR_TUNNEL|Failed to load resource/.test(text)) errors.push(`CONSOLE: ${text.slice(0, 150)}`);
  });
  page.on('download', download => downloads.push(download.suggestedFilename()));
  return { context, page, api, downloads, errors, bridge };
}

/** A synthetic photograph: a gradient, a subject, and enough texture to analyse. */
export const photoScript = (width, height, name) => `
  const c = document.createElement('canvas'); c.width = ${width}; c.height = ${height};
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, ${width}, ${height});
  g.addColorStop(0, '#334d6e'); g.addColorStop(.6, '#cfa877'); g.addColorStop(1, '#1b2530');
  x.fillStyle = g; x.fillRect(0, 0, ${width}, ${height});
  x.fillStyle = '#f7f1e6';
  x.beginPath(); x.arc(${Math.round(width * 0.42)}, ${Math.round(height * 0.42)}, ${Math.round(Math.min(width, height) * 0.16)}, 0, Math.PI * 2); x.fill();
  for (let i = 0; i < 900; i++) {
    x.fillStyle = 'rgba(' + (i * 31) % 255 + ',' + (i * 71) % 255 + ',' + (i * 101) % 255 + ',.28)';
    x.fillRect((i * 233) % ${width}, (i * 331) % ${height}, 20, 20);
  }
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  await window.__cros.importFiles([new File([blob], '${name}', { type: 'image/png' })]);
`;
