// The shape of the four shipped pages, and the parts of app.css that decide
// whether a keyboard or a screen reader can use them.
//
// Everything here was reproduced in Chromium first — the tab order at 320px,
// the modal's accessible name out of the browser's own accessibility tree, the
// pills' contrast off rendered pixels — and is re-derived from the shipped
// files so that undoing one of those fixes fails a test rather than a customer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFileSync(resolve(ROOT, file), 'utf8');
const app = read('studio/css/app.css');

/** The four pages a customer reaches, and where each one's skip link lands. */
const PAGES = [
  ['studio/index.html', '#main'],
  ['studio/voice.html', '#main-content'],
  ['studio/usage.html', '#main-content'],
  ['studio/admin.html', '#main-content']
];

// Comments carry braces and commas; neither belongs in a selector.
const stripped = css => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of the first rule that lists `selector` as its own. */
function rule(css, selector) {
  for (const match of stripped(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (match[1].split(',').map(one => one.trim().replace(/\s+/g, ' ')).includes(selector)) return match[2];
  }
  return assert.fail(`no rule for ${selector}`);
}

/** One @media block's body, by the condition it opens with. */
function media(css, condition) {
  const start = stripped(css).indexOf(`@media${condition}`);
  assert.notEqual(start, -1, `no @media${condition} block`);
  const body = stripped(css).slice(start);
  let depth = 0;
  for (let i = body.indexOf('{'); i < body.length; i++) {
    if (body[i] === '{') depth++;
    else if (body[i] === '}' && --depth === 0) return body.slice(0, i + 1);
  }
  return assert.fail(`unbalanced braces in @media${condition}`);
}

/**
 * Markup with the comments, the inline stylesheets and the inline modules
 * taken out. All three quote the tags they are about - voice.html's own
 * <style> opens by explaining which element is the page's <main> - and a tag
 * count that reads them counts the explanation as the thing.
 */
const markup = page => page
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
  .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
const body = page => /<body[^>]*>([\s\S]*)<\/body>/.exec(markup(page))[1];

// ── the drawer that stayed in the tab order ─────────────────────────────────

test('the closed jobs drawer leaves the tab order at every width it overlays', () => {
  // Below 1281px the rail is position:fixed and parked with translateX(102%).
  // A transform moves a subtree; it does not remove it from the tab order, so
  // "Move left", "Close", "Clear finished" and "Usage this month" stayed
  // tabbable at an x no scroll can reach — four of the ten stops at 320px put
  // the focus ring outside the window. `visibility` is what removes them, and
  // it has to be given back on .open or the drawer can never be used.
  const overlay = media(app, '(max-width:1280px)');
  assert.match(rule(overlay, '.layout>.activity-rail'), /visibility:\s*hidden/,
    'the parked drawer is painted again, so its controls are back in the tab order off-screen');
  assert.match(rule(overlay, '.activity-rail.open'), /visibility:\s*visible/,
    'the opened drawer stays hidden, so its controls cannot be reached at all');
  // display:none would take the same controls out of the tab order and take
  // the slide-in with them; the transition is the reason this is visibility.
  assert.doesNotMatch(rule(overlay, '.layout>.activity-rail'), /display:\s*none/);
  assert.match(rule(overlay, '.layout>.activity-rail'), /transition:[^;]*visibility/,
    'without visibility in the transition the drawer vanishes before it has slid out');
});

// ── the modal with no name ─────────────────────────────────────────────────

test('the one dialog every Studio panel reuses carries a name', () => {
  // Chromium's accessibility tree reported role=dialog name="" for Pre-flight,
  // Import, Generative Fill and the paywall alike: a screen reader was told a
  // dialog had opened and nothing about which one. axe has no rule for it.
  const page = read('studio/index.html');
  const dialog = /<dialog id="dlg"[^>]*>/.exec(markup(page));
  assert.ok(dialog, 'the shared dialog is gone from studio/index.html');
  const labelledby = /aria-labelledby="([^"]+)"/.exec(dialog[0]);
  assert.ok(labelledby, 'the dialog has no accessible name; it announces as "dialog"');
  assert.match(page, new RegExp(`<h2[^>]*id="${labelledby[1]}"`),
    `#${labelledby[1]} must be the heading app.js retitles, so the dialog is named and has an outline`);
  // A bare <h2> brings the UA's 0.83em margin into a padded head.
  assert.match(rule(app, 'dialog .dlg-head'), /margin:\s*0/);
});

// ── the masthead every page opens with ─────────────────────────────────────

test('every page opens on a skip link that goes somewhere', () => {
  // The Studio put "Create or open" first and the Voice Studio the brand link:
  // a keyboard customer walked the whole masthead on every page load. Usage
  // already had this; it was never carried across.
  for (const [file, target] of PAGES) {
    const page = read(file);
    const first = /<(?:a|button|select|textarea|summary)\b[^>]*>/.exec(body(page));
    assert.ok(first && /class="skip-link"/.test(first[0]),
      `${file} reaches ${first?.[0] ?? 'nothing'} before its skip link`);
    assert.match(first[0], new RegExp(`href="${target}"`), `${file}'s skip link points somewhere else`);
    assert.match(page, new RegExp(`id="${target.slice(1)}"`), `${file} has no ${target} to skip to`);
  }
  // The Studio and the Voice Studio load app.css and nothing else, so the
  // utility has to be declared there or the link is never visible on focus.
  assert.match(rule(app, '.skip-link'), /position:\s*fixed/);
  assert.match(rule(app, '.skip-link:focus'), /transform:\s*translateY\(0\)/,
    'the skip link never comes back down, so it is focusable and invisible');
});

test('every page has one main landmark and one first-level heading', () => {
  // voice.html shipped with neither: axe reported landmark-one-main,
  // page-has-heading-one and fourteen nodes outside any landmark. The Studio
  // had a <main> but its outline started at <h4>, because every heading in the
  // workspace is built by app.js.
  for (const [file] of PAGES) {
    const page = markup(read(file));
    assert.equal((page.match(/<main\b/g) || []).length, 1, `${file} does not have exactly one <main>`);
    assert.equal((page.match(/<h1\b/g) || []).length, 1, `${file} does not have exactly one <h1>`);
  }
  // The two workspace headings are off-screen, which only works while the
  // utility that hides them keeps them in the accessibility tree.
  const srOnly = rule(app, '.sr-only');
  assert.doesNotMatch(srOnly, /display:\s*none|visibility:\s*hidden/,
    'an <h1> hidden this way is not a heading any assistive technology can find');
  for (const file of ['studio/index.html', 'studio/voice.html']) {
    assert.match(read(file), /<h1 class="sr-only">/, `${file}'s <h1> is not the off-screen one`);
  }
});

// ── the placement pills ────────────────────────────────────────────────────

const channel = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const contrast = (ink, ground) => {
  const a = luminance(ink), b = luminance(ground);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};
const colour = value => {
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim());
  return hex ? [0, 2, 4].map(i => parseInt(hex[1].slice(i, i + 2), 16)) : value.match(/[\d.]+/g).map(Number);
};
const over = ([r, g, b, alpha], ground) => [r, g, b].map((v, i) => Math.round(v * alpha + ground[i] * (1 - alpha)));

/** Custom properties declared in one rule. */
function tokens(selector) {
  const declared = {};
  for (const match of rule(app, selector).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) declared[match[1]] = match[2].trim();
  return declared;
}
const THEMES = [['dark', tokens(':root')], ['light', tokens(':root[data-theme="light"]')]];

test('a placement decision is readable without reading its colour', () => {
  // The pill's text is the surface name in all four states, so approved,
  // revise, denied and pending differed by tint alone: a customer with a
  // colour deficiency saw five near-identical pills and could not tell which
  // placements were signed off. WCAG 1.4.1.
  const marks = ['.pdot::before', '.pdot.approved::before', '.pdot.revise::before', '.pdot.denied::before']
    .map(selector => /content:\s*"([^"]*)"/.exec(rule(app, selector))?.[1]);
  for (const [i, mark] of marks.entries()) {
    assert.ok(mark, `${['pending', 'approved', 'revise', 'denied'][i]} carries no mark of its own`);
  }
  assert.equal(new Set(marks).size, marks.length, 'two decisions are drawn with the same mark');
});

test('every placement pill clears AA on the wash it is painted on', () => {
  // 8.5px mono on a 10-12% wash of its own ink. Rendered pixels put approved at
  // 3.98:1, revise 3.95:1 and denied 4.32:1 in light and denied 4.40:1 in dark;
  // the wash composites over the board card (--ground) and, for the sibling
  // .chip, over a panel, so both grounds have to hold.
  for (const [state, ink, wash] of [['approved', '--ok', '--ok-wash'], ['revise', '--warn', '--warn-wash'],
    ['denied', '--bad', '--bad-wash']]) {
    const declarations = rule(app, `.pdot.${state}`);
    assert.match(declarations, new RegExp(`color:\\s*var\\(${ink}\\)`), `.pdot.${state} took a different ink`);
    assert.match(declarations, new RegExp(`background:\\s*var\\(${wash}\\)`), `.pdot.${state} took a different wash`);
    for (const [name, theme] of THEMES) {
      for (const surface of ['--ground', '--panel']) {
        const ratio = contrast(colour(theme[ink]), over(colour(theme[wash]), colour(theme[surface])));
        assert.ok(ratio >= 4.5,
          `${name} .pdot.${state} is ${ratio.toFixed(2)}:1 on ${wash} over ${surface}, below 4.5:1`);
      }
    }
  }
});
