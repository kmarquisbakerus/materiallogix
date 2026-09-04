import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFileSync(resolve(ROOT, file), 'utf8');

const app = read('studio/css/app.css');
const site = read('index.html');
const siteStyle = /<style>([\s\S]*?)<\/style>/.exec(site)[1];

/**
 * The ratios here were taken from rendered pixels in Chromium - each element's
 * computed ink against the colour actually painted behind it - because the
 * surfaces that failed are translucent panels floating over `.stage`, which
 * stays near-black in both themes. Walking `background-color` up the DOM
 * reports the parent chain and misses that: it says the sidebar sits on
 * rgb(247,244,238) while the screen shows rgb(178,176,172).
 *
 * So this file re-derives the same composites from the tokens the stylesheets
 * declare. A palette edit that drops a pair back below AA fails here instead
 * of in front of a customer.
 */
const STAGE = [6, 6, 7];        // .stage, and it does not lighten with the theme

const channel = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const contrast = (ink, ground) => {
  const a = luminance(ink), b = luminance(ground);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};
/** A translucent layer painted over an opaque one, the way the compositor does it. */
const over = ([r, g, b, alpha], ground) => [r, g, b].map((v, i) => Math.round(v * alpha + ground[i] * (1 - alpha)));

function colour(value) {
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (hex) return [0, 2, 4].map(i => parseInt(hex[1].slice(i, i + 2), 16));
  const parts = value.match(/[\d.]+/g);
  assert.ok(parts && parts.length >= 3, `not a colour this test can read: ${value}`);
  return parts.slice(0, 4).map(Number);
}

// Comments carry commas, and a comma is how a selector list is split.
const stripped = css => css.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * The first rule whose selector list carries `selector`, as its own selector.
 * Substring matching would hand back `.topbar>.btn{flex-shrink:0}` when asked
 * for `.btn`, which is a rule about layout and says nothing about colour.
 */
function rule(css, selector) {
  for (const match of stripped(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1].split(',').map(one => one.trim().replace(/\s+/g, ' '));
    if (selectors.includes(selector)) return { selectors, declarations: match[2] };
  }
  return assert.fail(`no rule for ${selector}`);
}

/** Custom properties declared in one rule, with one level of var() resolved. */
function tokens(css, selector) {
  const declared = {};
  for (const match of rule(css, selector).declarations.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    declared[match[1]] = match[2].trim();
  }
  for (const [name, value] of Object.entries(declared)) {
    const alias = /^var\((--[\w-]+)\)$/.exec(value);
    if (alias) declared[name] = declared[alias[1]];
  }
  return declared;
}

const dark = tokens(app, ':root');
const light = tokens(app, ':root[data-theme="light"]');
const marketing = tokens(siteStyle, ':root');

/** What the light-theme chrome over the stage actually paints. Looked up per
 *  test, so a stylesheet missing the rule fails one test rather than the file. */
const lightChromeRule = () => rule(app, ':root[data-theme="light"] .stage-head');
const lightChrome = () => colour(light[/background:\s*var\((--[\w-]+)\)/.exec(lightChromeRule().declarations)[1]]);

test('the light chrome painted over the stage is opaque', () => {
  // All four are position:fixed or live inside .stage. Translucent there, the
  // ground they hand their text is the picture, not the panel: the stage head
  // composited to rgb(169,167,163) and the sidebar to rgb(178,176,172).
  for (const surface of ['aside.sidebar', '.stage-head', '.stage-tools', '.toast']) {
    assert.ok(lightChromeRule().selectors.includes(`:root[data-theme="light"] ${surface}`),
      `${surface} is back to glass over the dark stage in light theme`);
  }
  assert.equal(lightChrome().length, 3, 'the light chrome ground carries an alpha again');
});

test('chrome ink clears AA on the ground each theme actually paints', () => {
  // Light: rendered pixels put --faint and --muted at 4.95:1 across the
  // sidebar, the stage head and the stage tools; they were 2.26-2.51:1.
  // Dark keeps the glass, so there the composite is what has to hold -
  // --glass-2 under the sidebar, --glass-4 under the stage head and tools.
  const grounds = [['light chrome', light, lightChrome()],
    ['--glass-2 over the stage', dark, over(colour(dark['--glass-2']), STAGE)],
    ['--glass-4 over the stage', dark, over(colour(dark['--glass-4']), STAGE)]];
  for (const [where, theme, ground] of grounds) {
    for (const ink of ['--faint', '--muted', '--ink-2', '--ink']) {
      const ratio = contrast(colour(theme[ink]), ground);
      assert.ok(ratio >= 4.5, `${ink} on ${where} is ${ratio.toFixed(2)}:1, below 4.5:1`);
    }
  }
});

test('the board placement pills read on the shade they sit on', () => {
  // .pdot is 8.5px mono on --hair-soft, which is a near neighbour of --faint:
  // the pending pill measured 4.12:1 light and 4.42:1 dark. Board mode is the
  // one screen it appears on, and the review screen never showed it.
  const pdot = rule(app, '.pdot').declarations;
  const ink = /color:\s*var\((--[\w-]+)\)/.exec(pdot)[1];
  const ground = /background:\s*var\((--[\w-]+)\)/.exec(pdot)[1];
  for (const [name, theme] of [['light', light], ['dark', dark]]) {
    const ratio = contrast(colour(theme[ink]), colour(theme[ground]));
    assert.ok(ratio >= 4.5, `${name} .pdot is ${ratio.toFixed(2)}:1 on ${ground}, below 4.5:1`);
  }
});

test('the error toast reads in both themes, and its ink is a token', () => {
  // The toast is the only channel a failure has - the storage-full sentence
  // included - and #e6b6b1 is a pink tuned for the dark one. Against rendered
  // pixels the light toast measured 1.58:1; it is 5.34:1 now, dark 10.42:1.
  assert.match(rule(app, '.toast.bad').declarations, /color:\s*var\(--toast-bad-ink\)/,
    'the toast ink is hard-coded again');

  const lightRatio = contrast(colour(light['--toast-bad-ink']), lightChrome());
  assert.ok(lightRatio >= 4.5, `the light error toast is ${lightRatio.toFixed(2)}:1, below 4.5:1`);

  const darkRatio = contrast(colour(dark['--toast-bad-ink']), over(colour(dark['--glass-3']), STAGE));
  assert.ok(darkRatio >= 4.5, `the dark error toast is ${darkRatio.toFixed(2)}:1, below 4.5:1`);
});

test('an anchor styled as a button is not left at the UA link colour', () => {
  // .btn set no colour, so `button` picked up --ink through the control reset
  // and every <a class="btn"> rendered #0000EE, underlined, in both themes.
  const btn = rule(app, '.btn').declarations;
  const ink = /color:\s*var\((--[\w-]+)\)/.exec(btn);
  assert.ok(ink, '.btn declares no colour, so anchors fall back to #0000EE');
  assert.match(btn, /text-decoration:\s*none/, '.btn leaves the UA underline on anchors');
  for (const [name, theme] of [['dark', dark], ['light', light]]) {
    const ratio = contrast(colour(theme[ink[1]]), colour(theme['--panel']));
    assert.ok(ratio >= 4.5, `${name} .btn ink is ${ratio.toFixed(2)}:1 on --panel, below 4.5:1`);
  }
});

test('a text field the theme cannot select is still not left to the UA', () => {
  // input[type="text"] does not match an <input> with no type attribute, so
  // admin.html's eight bare fields kept the UA's white box under --ink: 1.19:1.
  assert.match(app, /input:not\(\[type\]\)\s*,/, 'a bare <input> is back to the UA field');
  assert.match(app, /:root\s*\{\s*color-scheme:\s*dark;?\s*\}/,
    'the date and month pickers no longer follow the dark theme');
  assert.match(app, /:root\[data-theme="light"\]\s*\{\s*color-scheme:\s*light;?\s*\}/,
    'the light theme no longer tells the UA it is light');
});

test('the marketing gold and muted clear AA on the grounds they are used on', () => {
  // --gold measured 3.90:1 on the paper and 4.10:1 on a proof card; --muted
  // 4.00:1 in the footer. Every one of those nodes is 11px or smaller, so
  // none of them gets the large-text allowance.
  const paper = colour(marketing['--paper']);
  const proofCard = over(colour(marketing['--glass']), paper);
  const footer = colour(/footer\{background:(#[0-9a-f]{6})/i.exec(siteStyle)[1]);
  const pairs = [
    ['--gold on the paper', marketing['--gold'], paper],
    ['--gold on a proof card', marketing['--gold'], proofCard],
    ['--muted on the paper', marketing['--muted'], paper],
    ['--muted in the footer', marketing['--muted'], footer]
  ];
  for (const [what, ink, ground] of pairs) {
    const ratio = contrast(colour(ink), ground);
    assert.ok(ratio >= 4.5, `${what} is ${ratio.toFixed(2)}:1, below 4.5:1`);
  }
});

test('the eyebrows on the dark marketing surfaces keep a gold that reads', () => {
  // A --gold dark enough for the paper is 3.32:1 on the value strip, so the
  // three dark sections take the bright gold: 4.71:1 on the featured access
  // card, 6.70:1 on the workspace panel, 6.97:1 on the strip.
  const eyebrow = rule(siteStyle, '.value-strip .eyebrow');
  for (const surface of ['.access-card.featured .eyebrow', '.workspace-glass .eyebrow']) {
    assert.ok(eyebrow.selectors.includes(surface), `${surface} is back on the paper gold`);
  }
  assert.match(eyebrow.declarations, /color:var\(--gold-bright\)/);
  const ratio = contrast(colour(marketing['--gold-bright']), colour(marketing['--ink']));
  assert.ok(ratio >= 4.5, `--gold-bright on the value strip is ${ratio.toFixed(2)}:1, below 4.5:1`);
});

test('the pricing radios that choose a Studio have a name and a ring that shows', () => {
  // The three sp-* radios are 0x0, so the ring is painted on their labels -
  // and those sat inside a shut <details>, rendering nothing at all.
  for (const [id, name] of [['sp-photo', 'Photo'], ['sp-video', 'Video'], ['sp-voice', 'Voice']]) {
    const input = new RegExp(`<input[^>]*id="${id}"[^>]*>`).exec(site);
    assert.ok(input, `${id} is gone from the pricing table`);
    assert.match(input[0], new RegExp(`aria-label="${name}"`), `${id} has no accessible name`);
  }
  const card = /<article class="plan featured">[\s\S]*?<\/article>/.exec(site)[0];
  const picker = card.indexOf('<div class="pick prod-pick">');
  assert.ok(picker > 0, 'the Studio picker is not a row of its own');
  assert.ok(picker < card.indexOf('<details>'), 'the Studio picker is back inside the disclosure');
  assert.ok(rule(siteStyle, '.prod-radio:focus-visible~.prod-pick label').declarations.includes('outline:2px solid var(--gold)'),
    'the focus ring no longer lands on the rendered picker');
  // 1.4.11 asks 3:1 of the ring against what it is drawn on.
  const ring = contrast(colour(marketing['--gold']), colour(marketing['--paper']));
  assert.ok(ring >= 3, `the focus ring is ${ring.toFixed(2)}:1 against the page, below 3:1`);
});
