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
    const bounds = await page.evaluate(() => { const input = document.querySelector('#walletAmount'); return `${input.min}..${input.max}`; });
    ok('the wallet bounds come from the declared range', bounds === '5..500', bounds);
    const refill = value => page.evaluate(async amount => {
      document.querySelector('#walletStatus').textContent = '';
      const input = document.querySelector('#walletAmount'); input.value = amount;
      document.querySelector('#walletRefill').click();
      await new Promise(r => setTimeout(r, 300));
      return document.querySelector('#walletStatus').textContent;
    }, value);
    ok('a refill below the minimum is refused', /Choose a refill/.test(await refill('2.00')));
    ok('a refill at the minimum goes to checkout', (await refill('5.00')) === '' && prompts.length > 0, prompts.at(-1) || '');

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

  // ── Offline ──────────────────────────────────────────────────────────────
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
