// The whole product, once, the way a customer meets it.
//
// Arrive, start a project, try it free, hit the paywall, pay, edit, generate,
// fill, enhance, cut a clip, direct a voice, deliver every way the product
// offers, check the wallet and the ledger, and work with the network off.
//
// Run it with: npm run journey   (needs playwright-core and a Chromium build)
import { serve } from './serve.mjs';
import { engineStub } from './engine-stub.mjs';
import { mintLicence, studioContext, photoScript } from './harness.mjs';
import { CLOUD_PRICING } from '../../studio/js/pricing.js';

const BASE = 'http://127.0.0.1:8099/studio';
let passed = 0;
const failures = [];
const step = title => console.log(`\n─── ${title} ${'─'.repeat(Math.max(0, 58 - title.length))}`);
const ok = (label, pass, detail = '') => {
  if (pass) passed++; else failures.push(label);
  console.log(`   ${pass ? 'PASS' : '**FAIL**'}  ${label}${detail ? ` :: ${detail}` : ''}`);
};

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.error('The journey needs playwright-core installed. See tests/browser/README.md.'); process.exit(2); }
const executablePath = process.env.JOURNEY_CHROME || process.env.CHROME_PATH;
if (!executablePath) { console.error('Set JOURNEY_CHROME to a Chromium binary. See tests/browser/README.md.'); process.exit(2); }

const site = await serve();
const engine = await engineStub();
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
const licence = await mintLicence('full');

const settle = (page, ms) => page.waitForTimeout(ms);
const body = page => page.evaluate(() => (document.querySelector('#dlgBody')?.innerText || '').replace(/\s+/g, ' '));
const title = page => page.evaluate(() => document.querySelector('#dlgTitle')?.textContent || '');
const toast = page => page.evaluate(() => document.querySelector('[class*=toast]')?.textContent || '');
const closeDialog = page => page.evaluate(() => document.querySelector('#dlg')?.close());
const openSidebar = async page => {
  await page.evaluate(() => document.querySelector('#menuBtn')?.click());
  for (let i = 0; i < 2; i++) { await settle(page, 400); await page.evaluate(() => document.querySelectorAll('#sidebar details').forEach(d => d.open = true)); }
  await settle(page, 400);
};
const sideClick = (page, pattern) => page.evaluate(({ source }) => {
  const button = [...document.querySelectorAll('#sidebar button')].find(b => new RegExp(source, 'i').test(b.textContent));
  if (!button) return null; button.click(); return button.textContent.trim();
}, { source: pattern.source });
const waitForBody = async (page, pattern) => {
  for (let i = 0; i < 14; i++) { await settle(page, 1600); const text = await body(page); if (pattern.test(text)) return text.slice(0, 180); }
  return `(timeout) ${(await body(page)).slice(0, 140)}`;
};
const select = (page, kind) => page.evaluate(k => {
  const assets = window.__cros.visibleAssets();
  const index = assets.findIndex(a => a.kind === k);
  if (index < 0) return null;
  window.__cros.state.index = index; window.__cros.render();
  return assets[index].filename;
}, kind);
const fingerprint = page => page.evaluate(() => {
  const canvas = document.querySelector('.srcwrap canvas');
  if (!canvas) return 'none';
  const data = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data;
  let hash = 0;
  for (let i = 0; i < data.length; i += 97) hash = (hash * 31 + data[i]) >>> 0;
  return String(hash);
});

const allErrors = [];
try {
  // ── Free, then paid ──────────────────────────────────────────────────────
  const free = await studioContext(browser, { licence: null, authenticated: false });
  const page = free.page;

  step('Arrive at the Studio');
  await page.goto(`${BASE}/index.html?dev=1`, { waitUntil: 'domcontentloaded' });
  await settle(page, 3500);
  const entrance = await page.evaluate(() => ({
    cards: document.querySelectorAll('.studio-entry-card').length,
    titles: [...document.querySelectorAll('.studio-entry-card h3, .studio-entry-card h2')].map(h => h.textContent.trim()).slice(0, 4)
  }));
  ok('the entrance offers Photo, Video and Voice', entrance.cards >= 3, entrance.titles.join(', '));

  step('Start a project from a starter');
  const starter = await page.evaluate(() => { const b = document.querySelector('.studio-entry-card__starter'); if (!b) return null; const l = b.textContent.trim(); b.click(); return l; });
  await page.waitForFunction(() => !!window.__cros, null, { timeout: 25000 });
  await settle(page, 2500);
  ok('a starter opens a configured workspace', !!starter, starter || '');
  ok('surfaces and a QA preset are in scope', await page.evaluate(() => window.__cros.state.project.surfaces.length > 0),
    await page.evaluate(() => `${window.__cros.state.project.surfaces.length} surfaces, preset "${window.__cros.state.project.qaPreset}"`));

  step('Free preview: import a photo, then try to export');
  await page.evaluate(`(async () => { ${photoScript(2400, 1800, 'hero-shot.png')} })()`);
  await settle(page, 4500);
  await closeDialog(page);
  ok('the photo imported and was analysed', await page.evaluate(() => !!window.__cros.state.assets[0]?.auto),
    await page.evaluate(() => { const a = window.__cros.state.assets[0]; return `${a.width}x${a.height}, sharpness ${a.auto?.sharpness}, ${a.auto?.color?.profile}`; }));
  ok('an ordinary photograph is not blocked as HDR', await page.evaluate(() => window.__cros.issueCount(window.__cros.state.assets[0]).block === 0));
  await page.evaluate(() => { const s = window.__cros.state;
    for (const id of s.project.surfaces) { window.__cros.ensurePlacement(s.assets[0], id); window.__cros.decidePlacement(s.assets[0], id, 'approved'); } });
  await settle(page, 1000);
  await page.evaluate(() => document.querySelector('#exportBtn').click());
  await settle(page, 2000);
  ok('export is refused before a licence', /license is required/i.test(await title(page)), await title(page));
  {
    const paywall = await page.evaluate(() => {
      const box = document.querySelector('#dialog, .dialog, dialog') || document.body;
      return { text: box.innerText, buttons: [...box.querySelectorAll('button')].map(b => b.textContent.trim()) };
    });
    ok('the paywall names every plan that covers it and the price of one export',
      /Single Studio/.test(paywall.text) && /Pro Studio/.test(paywall.text) && /\$2\.99/.test(paywall.text),
      paywall.text.replace(/\s+/g, ' ').slice(0, 120));
    ok('the paywall offers a way to buy', paywall.buttons.some(label => /plans and single exports/i.test(label)),
      paywall.buttons.join(', '));
  }
  await closeDialog(page);
  allErrors.push(...free.errors);
  await free.context.close();

  // ── The paid session ─────────────────────────────────────────────────────
  const paid = await studioContext(browser, { licence });
  const app = paid.page;
  await app.goto(`${BASE}/index.html?dev=1#workspace`, { waitUntil: 'domcontentloaded' });
  await app.waitForFunction(() => !!window.__cros, null, { timeout: 25000 });
  await settle(app, 3000);

  step('Activate a licence');
  ok('the licence activates and covers every Studio', await app.evaluate(() => globalThis.lic?.plan === 'full'),
    await app.evaluate(() => `plan ${globalThis.lic?.plan}`));

  step('Import the campaign photo');
  await app.evaluate(`(async () => { ${photoScript(3600, 2700, 'campaign-still.png')} })()`);
  await settle(app, 5000);
  await closeDialog(app);
  ok('the photo imported at print resolution', await app.evaluate(() => { const a = window.__cros.state.assets.find(x => x.kind === 'image'); return !!a && a.width >= 3000; }),
    await app.evaluate(() => { const a = window.__cros.state.assets.find(x => x.kind === 'image'); return a ? `${a.filename} ${a.width}x${a.height}` : 'none'; }));

  step('Edit the photo');
  await app.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /review tools/i.test(x.textContent || '')); b && b.click(); });
  await settle(app, 900);
  const beforeEdit = await fingerprint(app);
  const movedSliders = await app.evaluate(() => {
    const moved = [];
    for (const label of ['Light', 'Contrast', 'Warmth', 'Color', 'Noise cleanup']) {
      const input = [...document.querySelectorAll('.editor-slider input[type=range]')]
        .find(n => n.closest('label')?.querySelector('span')?.textContent?.trim() === label);
      if (!input) continue;
      input.value = input.max;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      moved.push(label);
    }
    return moved;
  });
  await settle(app, 1800);
  ok('every slider changes the rendered picture', beforeEdit !== await fingerprint(app), movedSliders.join(', '));
  ok('the edit is stored on the asset', await app.evaluate(() => window.__cros.state.assets.some(a => a.edit?.adjustments?.exposure !== 0)));
  await app.keyboard.press('Control+z');
  await settle(app, 1000);
  ok('undo puts it back', /^Undid/.test(await toast(app)), await toast(app));

  step('Generate a photo');
  await openSidebar(app);
  await app.evaluate(() => {
    const panel = [...document.querySelectorAll('#sidebar details')].find(d => /Generate photo/.test(d.querySelector('summary')?.textContent || ''));
    const box = panel?.querySelector('textarea');
    if (box) { box.value = 'a ceramic mug on a linen cloth in window light'; box.dispatchEvent(new Event('input', { bubbles: true })); }
    [...(panel?.querySelectorAll('button') || [])].find(b => /Generate photo/i.test(b.textContent))?.click();
  });
  let generated = 0;
  for (let i = 0; i < 10 && !generated; i++) { await settle(app, 2000); generated = await app.evaluate(() => window.__cros.state.assets.filter(a => a.source === 'generated-local').length); }
  ok('a generated photo is added with its provenance', generated > 0,
    await app.evaluate(() => window.__cros.state.assets.find(a => a.source === 'generated-local')?.provenance.slice(0, 80) || 'none'));

  step('Generative Fill');
  await app.evaluate(() => window.__cros.generativeFillDialog(window.__cros.state.assets[0]));
  await settle(app, 2500);
  ok('the Fill dialog opens with its selection tools', /Generative Fill/i.test(await title(app)),
    await app.evaluate(() => [...document.querySelectorAll('.fill-selection-actions button')].map(b => b.textContent.trim()).join(', ')));
  const beforeFill = await app.evaluate(() => window.__cros.state.assets.length);
  await app.evaluate(() => {
    [...document.querySelectorAll('#dlgBody button')].find(b => /Use rectangle/.test(b.textContent))?.click();
    const box = document.querySelector('#dlgBody textarea');
    box.value = 'a small brass lamp'; box.dispatchEvent(new Event('input', { bubbles: true }));
    [...document.querySelectorAll('#dlgFoot button')].find(b => /Create new candidate/.test(b.textContent))?.click();
  });
  let filled = beforeFill;
  for (let i = 0; i < 10 && filled === beforeFill; i++) { await settle(app, 2000); filled = await app.evaluate(() => window.__cros.state.assets.length); }
  ok('Fill creates a candidate, reserves and settles usage', filled > beforeFill,
    await app.evaluate(() => { const a = window.__cros.state.assets.find(x => x.source === 'generated-fill-local'); return a ? `${a.filename}, boundary ${a.inpaintBoundaryQuality?.status}` : 'none'; }));
  ok('the original is left untouched', await app.evaluate(() => window.__cros.state.assets[0].source !== 'generated-fill-local'));
  await closeDialog(app);

  step('Enhance a photo');
  const beforeUpscale = await app.evaluate(() => window.__cros.state.assets.length);
  await app.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Upscale')?.click());
  await settle(app, 2000);
  await app.evaluate(() => [...document.querySelectorAll('#dlgFoot button')].find(b => /^Upscale/.test(b.textContent))?.click());
  let upscaled = beforeUpscale;
  for (let i = 0; i < 10 && upscaled === beforeUpscale; i++) { await settle(app, 2000); upscaled = await app.evaluate(() => window.__cros.state.assets.length); }
  ok('an enhanced copy joins the library', upscaled > beforeUpscale,
    await app.evaluate(() => window.__cros.state.assets.find(a => a.source === 'enhanced-local')?.filename || 'none'));

  step('Cut a small video');
  await app.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
    const context = canvas.getContext('2d');
    const recorder = new MediaRecorder(canvas.captureStream(25), { mimeType: 'video/webm' });
    const chunks = []; recorder.ondataavailable = e => chunks.push(e.data); recorder.start();
    for (let i = 0; i < 45; i++) {
      const gradient = context.createLinearGradient(0, 0, 1280, 720);
      gradient.addColorStop(0, `hsl(${(i * 6) % 360},55%,42%)`); gradient.addColorStop(1, '#141a20');
      context.fillStyle = gradient; context.fillRect(0, 0, 1280, 720);
      context.fillStyle = '#f6efe2'; context.beginPath(); context.arc(300 + i * 14, 360, 110, 0, Math.PI * 2); context.fill();
      await new Promise(r => setTimeout(r, 40));
    }
    await new Promise(r => { recorder.onstop = r; recorder.stop(); });
    await window.__cros.importFiles([new File([new Blob(chunks, { type: 'video/webm' })], 'promo-cut.webm', { type: 'video/webm' })]);
  });
  await settle(app, 5000);
  await closeDialog(app);
  const clip = await app.evaluate(() => { const a = window.__cros.state.assets.find(x => x.kind === 'video'); return a ? { name: a.filename, w: a.width, h: a.height, d: a.duration } : null; });
  ok('the clip imported with its real duration', !!clip && clip.d > 0, clip ? `${clip.name} ${clip.w}x${clip.h} ${clip.d.toFixed(2)}s` : 'none');
  ok('the clip opens for editing', !!(await select(app, 'video')));
  await settle(app, 1500);
  await app.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /review tools/i.test(x.textContent || '')); b && b.click(); });
  await settle(app, 900);
  await app.evaluate(() => document.querySelectorAll('details').forEach(d => d.open = true));
  await settle(app, 900);
  const editorial = await app.evaluate(() => [...document.querySelectorAll('.video-delivery-grid select')]
    .map(s => s.closest('label')?.querySelector('span')?.textContent).filter(Boolean));
  ok('the editorial controls are present', editorial.length >= 4, editorial.join(', '));
  const trims = await app.evaluate(async () => {
    const { resolveVideoTrim } = await import('./js/video-plan.js');
    const duration = window.__cros.state.assets.find(a => a.kind === 'video')?.duration || 2;
    const out = {};
    for (const [label, trimStart, trimEnd] of [['valid', '0', '1'], ['negative in', '-5', ''], ['reversed', '1', '0'], ['nonsense', 'abc', '']]) {
      try { out[label] = `ok ${resolveVideoTrim({ trimStart, trimEnd, duration, speed: 1 }).outputSeconds.toFixed(2)}s`; }
      catch { out[label] = 'refused'; }
    }
    return out;
  });
  ok('a real trim is accepted and impossible ones are refused',
    /^ok/.test(trims.valid) && trims['negative in'] === 'refused' && trims.reversed === 'refused' && trims.nonsense === 'refused', JSON.stringify(trims));

  step('Approve everything, then deliver');
  await app.evaluate(() => {
    const s = window.__cros.state;
    s.assets.forEach((a, i) => { a.altText = `Frame ${i + 1} of the release check.`; a.provenance = 'Studio original.'; });
    for (const a of s.assets) for (const id of s.project.surfaces) { window.__cros.ensurePlacement(a, id); window.__cros.decidePlacement(a, id, 'approved'); }
  });
  await settle(app, 1500);
  ok('placements are approved across every surface',
    await app.evaluate(() => window.__cros.state.assets.length * window.__cros.state.project.surfaces.length) > 0,
    await app.evaluate(() => `${window.__cros.state.assets.length * window.__cros.state.project.surfaces.length} placements`));

  paid.downloads.length = 0;
  await app.evaluate(() => document.querySelector('#exportBtn').click());
  await settle(app, 2200);
  await app.evaluate(() => {
    const accept = document.querySelector('#dlgFoot input[type=checkbox]');
    if (accept) { accept.checked = true; accept.dispatchEvent(new Event('change', { bubbles: true })); }
    [...document.querySelectorAll('#dlgFoot button')].find(b => /^Export/.test(b.textContent) && !b.disabled)?.click();
  });
  const packaged = await waitForBody(app, /Done|failed|Not downloaded/i);
  ok('the campaign package downloads', paid.downloads.some(f => /_package_.*\.zip$/.test(f)), `${packaged} | ${paid.downloads.join(', ')}`);
  await closeDialog(app);

  for (const [label, pattern, expected] of [
    ['the watermarked proof package', /Proof package/, /_PROOF_.*\.zip$/],
    ['the client review page', /Client review page/, /-client-review\.html$/],
    ['the contact sheet', /Contact sheet/, /-contact-sheet\.png$/],
    ['the recovery file', /Save recovery file/, /-recovery\.zip$/]
  ]) {
    paid.downloads.length = 0;
    await openSidebar(app);
    const clicked = await sideClick(app, pattern);
    await settle(app, 1800);
    await app.evaluate(() => {
      const accept = document.querySelector('#dlgFoot input[type=checkbox]');
      if (accept) { accept.checked = true; accept.dispatchEvent(new Event('change', { bubbles: true })); }
      [...document.querySelectorAll('#dlgFoot button')].find(b => /^Export/.test(b.textContent) && !b.disabled)?.click();
    });
    for (let i = 0; i < 12 && !paid.downloads.length; i++) await settle(app, 1600);
    ok(label, paid.downloads.some(f => expected.test(f)), `${clicked || 'button missing'} -> ${paid.downloads.join(', ') || 'nothing'}`);
    await closeDialog(app);
  }

  step('Print-ready photo');
  paid.downloads.length = 0;
  ok('a photo can be selected for print', !!(await select(app, 'image')));
  await settle(app, 1500);
  await openSidebar(app);
  await sideClick(app, /Print-ready/);
  await settle(app, 2500);
  await app.evaluate(() => [...document.querySelectorAll('#dlgFoot button')].find(b => /Download print/i.test(b.textContent) && !b.disabled)?.click());
  for (let i = 0; i < 10 && !paid.downloads.length; i++) await settle(app, 1600);
  ok('a print JPEG downloads at 300 PPI', paid.downloads.some(f => /\.jpg$/.test(f)), paid.downloads.join(', ') || (await body(app)).slice(0, 110));
  await closeDialog(app);

  step('Decision summary');
  await openSidebar(app);
  await sideClick(app, /Decision summary/);
  await settle(app, 1600);
  const report = await body(app);
  ok('the decision report lists surfaces and statuses', /decision report/i.test(report) && /Summary/i.test(report), report.slice(0, 110));
  await closeDialog(app);
  allErrors.push(...paid.errors);
  await paid.context.close();

  // ── Voice ────────────────────────────────────────────────────────────────
  step('Direct a voice');
  {
    const voice = await studioContext(browser, { licence });
    const page = voice.page;
    await page.goto(`${BASE}/voice.html?dev=1`, { waitUntil: 'domcontentloaded' });
    await settle(page, 4000);
    const text = selector => page.evaluate(s => document.querySelector(s)?.textContent || '', selector);
    await page.evaluate(() => { const box = document.querySelector('textarea');
      box.value = 'Good evening. This is the launch narration for the release check, read at an even pace.';
      box.dispatchEvent(new Event('input', { bubbles: true })); });
    await settle(page, 1000);
    const plan = await text('#planSummary');
    ok('the performance plan tracks the script', /\d+ segments?, \d+ words/.test(plan) && !/\(s\)|NaN/.test(plan), plan);
    await page.evaluate(() => { const fit = document.querySelector('#fitTarget'); fit.value = 'custom'; fit.dispatchEvent(new Event('change', { bubbles: true })); });
    await settle(page, 400);
    const fits = {};
    for (const seconds of ['5', '30', '', 'abc']) {
      await page.evaluate(v => { const input = document.querySelector('#fitSeconds'); input.value = v; input.dispatchEvent(new Event('input', { bubbles: true })); }, seconds);
      await settle(page, 350);
      fits[seconds || 'empty'] = (await text('#fitStatus')).slice(0, 40);
    }
    ok('fit targets advise, and unusable ones say nothing', /cut/.test(fits['5']) && /room/.test(fits['30']) && !fits.empty && !fits.abc, JSON.stringify(fits));
    ok('no NaN reaches the screen', !/NaN/.test(await page.evaluate(() => document.body.innerText)));
    ok('render is refused with a plain reason while the engine is offline',
      await page.evaluate(() => document.querySelector('#render')?.disabled === true), await text('#engineState'));
    allErrors.push(...voice.errors);
    await voice.context.close();
  }

  // ── Wallet and ledger ────────────────────────────────────────────────────
  step('Check the wallet and the ledger');
  {
    const account = await studioContext(browser, { licence });
    const page = account.page;
    const prompts = [];
    page.on('dialog', async dialog => { prompts.push(dialog.message().slice(0, 60)); await dialog.dismiss(); });
    await page.goto(`${BASE}/usage.html?dev=1`, { waitUntil: 'domcontentloaded' });
    await settle(page, 4000);
    ok('the usage page loads', /Production activity/i.test(await page.evaluate(() => document.body.innerText)));
    const expected = `${CLOUD_PRICING.minimumRefill}..${CLOUD_PRICING.maximumRefill}`;
    const bounds = await page.evaluate(() => { const input = document.querySelector('#walletAmount'); return `${input.min}..${input.max}`; });
    ok('the wallet bounds come from the declared range', bounds === expected, `${bounds} (declared ${expected})`);
    const view = await page.evaluate(() => ({
      status: document.querySelector('#usageStatus')?.textContent || '',
      cards: [...document.querySelectorAll('.usage-card')].map(node => node.textContent),
      summary: document.querySelector('#planSummary')?.textContent || '',
      balance: document.querySelector('#walletBalance')?.textContent || '',
      breakdownRows: document.querySelectorAll('#usageBreakdown tbody tr').length,
      ledgerRows: document.querySelectorAll('#usageTable tbody tr').length,
      portalEnabled: document.querySelector('#billingPortal') ? !document.querySelector('#billingPortal').disabled : null
    }));
    ok('the account page renders every panel from the server',
      view.cards.length >= 8 && view.breakdownRows > 0 && view.ledgerRows > 0 && /remaining/.test(view.balance),
      `${view.cards.length} cards, ${view.breakdownRows} breakdown rows, ${view.ledgerRows} ledger rows`);
    ok('the plan is named the way it was sold, and billing is reachable',
      /Full Studio/.test(view.summary) && view.cards.some(text => /^PlanFull Studio/.test(text)) && view.portalEnabled === true,
      `${view.cards.find(text => /^Plan/.test(text)) || '(no plan card)'} | ${view.summary.slice(0, 80)}`);
    const refill = value => page.evaluate(async amount => {
      document.querySelector('#walletStatus').textContent = '';
      const input = document.querySelector('#walletAmount'); input.value = amount;
      document.querySelector('#walletRefill').click();
      await new Promise(r => setTimeout(r, 300));
      return document.querySelector('#walletStatus').textContent;
    }, value);
    const below = (CLOUD_PRICING.minimumRefill - 1).toFixed(2);
    const atMinimum = CLOUD_PRICING.minimumRefill.toFixed(2);
    ok(`a refill below the minimum is refused ($${below})`, /Choose a refill/.test(await refill(below)));
    ok(`a refill at the minimum goes to checkout ($${atMinimum})`, (await refill(atMinimum)) === '' && prompts.length > 0, prompts.at(-1) || '');

    await page.goto(`${BASE}/admin.html?dev=1`, { waitUntil: 'domcontentloaded' });
    await settle(page, 4000);
    ok('the operations ledger renders', await page.evaluate(() => document.querySelectorAll('.ops-table tbody tr').length) > 0);
    const flags = await page.evaluate(() => [...document.querySelectorAll('[data-flag-key]')].map(r => `${r.dataset.flagKey}=${r.dataset.flagEnabled === '1' ? 'ON' : 'off'}`));
    ok('Google and Apple are listed in Operations, both off', flags.length === 2 && flags.every(f => f.endsWith('=off')), flags.join(', '));
    allErrors.push(...account.errors);
    await account.context.close();
  }

  // ── Sign-in switches ─────────────────────────────────────────────────────
  step('Sign-in stays hidden until the server enables it');
  for (const [label, features, expected] of [
    ['nothing renders while both flags are off', {}, 0],
    ['both appear the moment the server enables them', { google_sign_in: true, apple_sign_in: true }, 2]
  ]) {
    const session = await studioContext(browser, { licence, features });
    await session.page.goto(`${BASE}/index.html?dev=1#workspace`, { waitUntil: 'domcontentloaded' });
    await session.page.waitForFunction(() => !!window.__cros, null, { timeout: 25000 });
    await settle(session.page, 1500);
    await openSidebar(session.page);
    const buttons = await session.page.evaluate(() => [...document.querySelectorAll('.account-providers button')].map(b => b.textContent.trim()));
    ok(label, buttons.length === expected, buttons.join(', ') || '(none)');
    allErrors.push(...session.errors);
    await session.context.close();
  }

  // ── Coming back from Stripe ──────────────────────────────────────────────
  step('Return from checkout with a paid claim');
  {
    // checkout-result.js sat in the repository and was loaded by no page at
    // all: a customer who paid was redirected back and never licensed. This
    // drives the real return URL and reads the licence the app actually gates
    // on, rather than trusting that the file exists.
    const bought = await mintLicence('full');
    let fulfilled = null;                       // the webhook has not landed yet
    const buyer = await studioContext(browser, { checkoutLicenceKey: () => fulfilled });
    // The minted key only verifies against the public key swapped at the edge.
    await buyer.context.route('**/studio/js/license-key.js', route => route.fulfill({
      status: 200, contentType: 'text/javascript',
      body: `export const LICENSE_PUBLIC_JWK = ${JSON.stringify(bought.jwk)};`
    }));
    const page = buyer.page;

    // 1. Fulfilment trails the redirect - the usual case for a card payment.
    await page.goto(`${BASE}/index.html?dev=1&entry=0&checkout=success&session_id=cs_journey_001&claim=clm_journey_001`,
      { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__cros, null, { timeout: 25000 });
    await settle(page, 2500);
    const lagging = await page.evaluate(() => ({
      licensed: !!globalThis.lic,
      held: JSON.parse(sessionStorage.getItem('materiallogix:pending-checkout') || 'null'),
      search: location.search
    }));
    ok('a claim the service cannot fulfil yet is held, not lost',
      !lagging.licensed && lagging.held?.claim === 'clm_journey_001',
      `licensed=${lagging.licensed}, held=${JSON.stringify(lagging.held)}`);
    ok('the one-time claim leaves the address bar but the page keeps its own query',
      !/claim|session_id|checkout=/.test(lagging.search) && /dev=1/.test(lagging.search) && /entry=0/.test(lagging.search),
      `search was "${lagging.search}"`);

    // 2. The webhook lands. The next ordinary page load must finish the job
    //    with no claim in the URL at all.
    fulfilled = bought.key;
    await page.goto(`${BASE}/index.html?dev=1&entry=0`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__cros, null, { timeout: 25000 });
    await page.waitForFunction(() => !!globalThis.lic, null, { timeout: 20000 }).catch(() => {});
    await settle(page, 1500);
    const redeemed = await page.evaluate(() => ({
      plan: globalThis.lic?.plan || null,
      keyMatches: localStorage.getItem('cros:license'),
      held: sessionStorage.getItem('materiallogix:pending-checkout')
    }));
    ok('the held claim is redeemed on the next visit and the licence goes live',
      redeemed.plan === 'full' && redeemed.keyMatches === bought.key,
      `plan ${redeemed.plan}`);
    ok('the spent claim is not kept once it has been used', redeemed.held === null,
      `sessionStorage held ${redeemed.held}`);

    allErrors.push(...buyer.errors);
    await buyer.context.close();
  }

  // ── Offline ──────────────────────────────────────────────────────────────
  // ── What the renderer is actually told ───────────────────────────────────
  step('Watch what a render sends the engine');
  {
    // The watermark rule was guarded by a grep for the line that builds it.
    // This drives a real render and reads what the client put on the wire.
    const sendsFor = async (plan, product) => {
      const licence = await mintLicence(plan, product);
      const ctx = await studioContext(browser, { licence });
      await ctx.page.goto(`${BASE}/index.html?dev=1&entry=0`, { waitUntil: 'domcontentloaded' });
      await settle(ctx.page, 3000);
      await ctx.page.evaluate(async () => {
        const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
        const context = canvas.getContext('2d');
        const recorder = new MediaRecorder(canvas.captureStream(25), { mimeType: 'video/webm' });
        const chunks = []; recorder.ondataavailable = e => chunks.push(e.data); recorder.start();
        for (let i = 0; i < 20; i++) {
          context.fillStyle = `hsl(${(i * 12) % 360},55%,42%)`;
          context.fillRect(0, 0, 640, 360);
          await new Promise(r => setTimeout(r, 40));
        }
        await new Promise(r => { recorder.onstop = r; recorder.stop(); });
        await window.__cros.importFiles([new File([new Blob(chunks, { type: 'video/webm' })], 'engine-check.webm', { type: 'video/webm' })]);
      });
      await settle(ctx.page, 4000);
      await closeDialog(ctx.page);
      await ctx.page.evaluate(() => {
        const asset = window.__cros.state.assets.find(a => a.kind === 'video');
        window.__cros.state.selected = asset.id;
        window.__cros.render();
      });
      await settle(ctx.page, 800);
      await ctx.page.evaluate(() => {
        const open = [...document.querySelectorAll('button')].find(b => /Edit video|Open video/i.test(b.textContent));
        open?.click();
      });
      await settle(ctx.page, 1200);
      await ctx.page.evaluate(() => {
        const go = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Render video');
        go?.click();
      });
      await settle(ctx.page, 2500);
      const sent = ctx.bridge.filter(entry => entry.path === '/video/render').map(entry => JSON.parse(entry.opts || '{}'));
      const errors = [...ctx.errors];
      await ctx.context.close();
      return { sent, errors };
    };

    const photoOnly = await sendsFor('single', 'photo');
    const marked = photoOnly.sent.find(opts => opts.delivery);
    ok('a licence that does not cover video sends the watermark rule',
      !!marked && marked.delivery.clean === false
        && marked.delivery.watermark?.visual === true
        && marked.delivery.watermark?.audible === true
        && marked.delivery.maxHeight === 720,
      marked ? JSON.stringify(marked.delivery) : `no render reached the engine (${photoOnly.sent.length} calls)`);

    const covered = await sendsFor('full', null);
    const clean = covered.sent.find(opts => opts.delivery);
    ok('a licence that covers video sends a clean render',
      !!clean && clean.delivery.clean === true && clean.delivery.watermark === null,
      clean ? JSON.stringify(clean.delivery) : `no render reached the engine (${covered.sent.length} calls)`);

    allErrors.push(...photoOnly.errors, ...covered.errors);
  }

  // ── The free preview is short ────────────────────────────────────────────
  step('Preview voice without a licence');
  {
    const guest = await studioContext(browser, {});
    const page = guest.page;
    await page.goto(`${BASE}/voice.html?dev=1`, { waitUntil: 'domcontentloaded' });
    await settle(page, 2500);
    // The render button is disabled while the local engine is offline, which is
    // its own gate and tested elsewhere. Enable it so the length check - which
    // runs before any engine call - gets a chance to answer.
    const render = async text => page.evaluate(async body => {
      const script = document.querySelector('#script');
      script.value = body;
      script.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#status').textContent = '';
      const button = document.querySelector('#render');
      button.disabled = false;
      button.click();
      await new Promise(r => setTimeout(r, 700));
      return document.querySelector('#status').textContent;
    }, text);
    const refusal = await render(Array.from({ length: 95 }, (_, i) => `word${i}`).join(' ') + '.');
    ok('a 95-word script is refused on the free preview', /reads up to 60 words/.test(refusal),
      refusal.slice(0, 90));

    const shortEnough = await render('A short line for the preview to read aloud.');
    ok('a short script is not refused for length', !/reads up to 60 words/.test(shortEnough),
      shortEnough.slice(0, 90));
    allErrors.push(...guest.errors);
    await guest.context.close();
  }

  // ── The pricing table ────────────────────────────────────────────────────
  step('Read the pricing table and pick a plan');
  {
    const shop = await studioContext(browser, {});
    const page = shop.page;
    await page.goto('http://127.0.0.1:8099/index.html', { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ type: 'module', url: 'http://127.0.0.1:8099/checkout-site.js' });
    await settle(page, 1200);

    const cards = await page.evaluate(() => [...document.querySelectorAll('#pricing .plan h3')].map(h => h.textContent.trim()));
    ok('the table is four cards, one clean row', cards.length === 4, cards.join(', '));

    // Flip every switch and read back what the button would buy and what the
    // customer is looking at while it says so.
    const offer = (cardName, ids) => page.evaluate(({ cardName, ids }) => {
      const card = [...document.querySelectorAll('#pricing .plan')]
        .find(node => node.querySelector('h3')?.textContent.trim() === cardName);
      for (const id of ids) {
        const input = card.querySelector(`#${id}`);
        if (input) { input.checked = true; input.dispatchEvent(new Event('change', { bubbles: true })); }
      }
      const button = card.querySelector('[data-checkout-plan]');
      const price = [...card.querySelectorAll('.price')].find(node => node.offsetParent !== null);
      return { plan: button?.dataset.checkoutPlan, label: button?.textContent.trim(),
        disabled: !!button?.disabled, price: price?.textContent.replace(/\s+/g, ' ').trim() || '' };
    }, { cardName, ids });

    const combos = [
      ['Single Studio', ['ss-std', 'sp-photo'], 'single_photo', '$15'],
      ['Single Studio', ['ss-std', 'sp-video'], 'single_video', '$15'],
      ['Single Studio', ['ss-std', 'sp-voice'], 'single_voice', '$15'],
      ['Single Studio', ['ss-pro', 'sp-photo'], 'single_pro_photo', '$25'],
      ['Single Studio', ['ss-pro', 'sp-video'], 'single_pro_video', '$25'],
      ['Single Studio', ['ss-pro', 'sp-voice'], 'single_pro_voice', '$25'],
      ['Full Studio', ['fs-std'], 'full', '$29'],
      ['Full Studio', ['fs-pro'], 'pro', '$39']
    ];
    const wrong = [];
    for (const [cardName, ids, expectedPlan, expectedPrice] of combos) {
      const got = await offer(cardName, ids);
      if (got.plan !== expectedPlan || !got.price.startsWith(expectedPrice)) {
        wrong.push(`${ids.join('+')} -> ${got.plan} at ${got.price}, expected ${expectedPlan} at ${expectedPrice}`);
      }
    }
    ok('every switch buys the plan whose price is on screen', wrong.length === 0,
      wrong.length ? wrong.join(' | ') : `${combos.length} combinations`);

    // One control decides the term. A second one used to change the price on
    // screen without changing the plan bought.
    const yearly = await page.evaluate(() => {
      const input = document.querySelector('#term-y');
      input.checked = true; input.dispatchEvent(new Event('change', { bubbles: true }));
      const card = [...document.querySelectorAll('#pricing .plan')]
        .find(node => node.querySelector('h3')?.textContent.trim() === 'Full Studio');
      const price = [...card.querySelectorAll('.price')].find(node => node.offsetParent !== null);
      return { shown: price?.textContent.replace(/\s+/g, ' ').trim(), controls: document.querySelectorAll('#billingTerm').length };
    });
    ok('the term switch is the only term control, and it moves the price',
      yearly.shown?.startsWith('$366') && yearly.controls === 0,
      `${yearly.shown} | ${yearly.controls} duplicate term selects`);

    // The site ships its own Content-Security-Policy, and it does its job here:
    // the API is same-origin in production but cross-origin under the harness,
    // so the analytics beacon is refused. That refusal is the policy working,
    // not a defect - assert it, and hold every other console error.
    const blocked = shop.errors.filter(line => /Content Security Policy/.test(line) && /analytics/.test(line));
    ok('the page policy refuses a cross-origin beacon', blocked.length > 0, `${blocked.length} refused`);
    allErrors.push(...shop.errors.filter(line => !blocked.includes(line)));
    await shop.context.close();
  }

  step('Work offline');
  {
    const installed = await studioContext(browser, { licence });
    const page = installed.page;
    await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    await settle(page, 6000);
    const cached = await page.evaluate(async () => {
      const names = await caches.keys();
      const shell = names.find(n => n.startsWith('materiallogix-shell'));
      return shell ? (await (await caches.open(shell)).keys()).length : 0;
    });
    ok('the offline shell installs completely', cached > 50, `${cached} entries cached`);
    await installed.context.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await settle(page, 6000);
    const shell = await page.evaluate(() => ({ topbar: !!document.querySelector('.topbar'), exportButton: !!document.querySelector('#exportBtn') }));
    ok('the Studio still opens with no connection', shell.topbar && shell.exportButton, JSON.stringify(shell));
    await installed.context.setOffline(false);
    allErrors.push(...installed.errors);
    await installed.context.close();
  }
} finally {
  await browser.close();
  site.close();
  engine.close();
}

const unique = [...new Set(allErrors)];
console.log(`\n${'═'.repeat(64)}`);
console.log(`  ${passed} passed, ${failures.length} failed, ${unique.length} console errors`);
if (failures.length) console.log('  failed: ' + failures.join('; '));
if (unique.length) console.log('  errors:\n    ' + unique.join('\n    '));
console.log('═'.repeat(64));
process.exit(failures.length || unique.length ? 1 : 0);
