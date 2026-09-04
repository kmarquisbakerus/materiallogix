// The controls a customer touches, and the two ways they used to fail without
// saying anything: a promise that never settled, and a machine code on screen.
//
// `studio/js/app.js` is the Studio's entry module - importing it boots the
// application - so the contracts it owns are read out of its source, the way
// wiring.test.mjs and claims.test.mjs already read the shipped code. Everything
// crop.js owns is executed here against a scripted media element, because that
// is where the blocker lived.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { grabVideoFrame } from '../studio/js/crop.js';
import { colorExportDecision } from '../studio/js/color-management.js';
import { preflight } from '../studio/js/analyze.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const app = readFileSync(resolve(ROOT, 'studio/js/app.js'), 'utf8');

// --- a video frame ----------------------------------------------------------

/**
 * A scripted <video>, driven by the same property writes the real one is.
 *
 * `headerDuration: Infinity` is what Chromium reports for anything muxed as a
 * stream, and `recovered` is the length it fills in once a seek past the end
 * has made it walk the file.
 */
function scriptedVideo(script) {
  const video = {
    preload: '', muted: false, seeks: [],
    videoWidth: script.width ?? 1280, videoHeight: script.height ?? 720,
    duration: script.headerDuration ?? 8,
    onloadeddata: null, onseeked: null, onerror: null
  };
  let position = 0;
  Object.defineProperty(video, 'currentTime', {
    get: () => position,
    set(value) {
      video.seeks.push(value);
      // The exact refusal the browser raises, and the one that used to unwind
      // into the event loop instead of into the caller.
      if (!Number.isFinite(value)) {
        throw new TypeError("Failed to set the 'currentTime' property on 'HTMLMediaElement': The provided double value is non-finite.");
      }
      if (!Number.isFinite(video.duration) && value > 1e9) video.duration = script.recovered ?? Infinity;
      position = Number.isFinite(video.duration) ? Math.min(value, video.duration) : value;
      video.onseeked?.();
    }
  });
  Object.defineProperty(video, 'src', {
    set() {
      if (script.silent) return;
      if (script.unreadable) return void video.onerror?.();
      video.onloadeddata?.();
    }
  });
  return video;
}

let lastVideo = null;
globalThis.document = {
  createElement(tag) {
    if (tag === 'video') return (lastVideo = scriptedVideo(globalThis.__videoScript));
    return { width: 0, height: 0, getContext: () => ({ drawImage() {} }) };
  }
};
const withVideo = (script, fn) => { globalThis.__videoScript = script; return fn(); };

test('a clip whose header carries a duration is grabbed at the time asked for', async () => {
  const frame = await withVideo({ headerDuration: 8 }, () => grabVideoFrame('blob:clip', 2.4));
  assert.equal(frame.duration, 8);
  assert.equal(frame.width, 1280);
  assert.deepEqual(lastVideo.seeks, [2.4]);
});

test('a clip whose header carries no duration imports instead of hanging', async () => {
  // A browser recorder, a screen recorder, an action camera: anything muxed as
  // a stream reports Infinity until the file has been walked.
  const frame = await withVideo({ headerDuration: Infinity, recovered: 7.96 },
    () => grabVideoFrame('blob:rec', 2.39));
  assert.equal(frame.duration, 7.96, 'the recovered length is what the library stores');
  for (const target of lastVideo.seeks) {
    assert.ok(Number.isFinite(target), `seeked to ${target}, which the browser refuses`);
  }
  assert.equal(lastVideo.seeks.at(-1), 2.39, 'the frame asked for is the frame taken');
});

test('a non-finite time asked for is clamped rather than passed to the browser', async () => {
  // `+(Infinity * 0.3).toFixed(2)` is Infinity, and app.js used to hand that
  // straight to currentTime.
  for (const time of [Infinity, NaN, -5, undefined]) {
    const frame = await withVideo({ headerDuration: 8 }, () => grabVideoFrame('blob:clip', time));
    assert.equal(frame.duration, 8);
    assert.ok(lastVideo.seeks.every(Number.isFinite), `${time} produced ${lastVideo.seeks}`);
  }
});

test('a clip that is still unusable rejects with a reason', async () => {
  // The walk finished and the length is still unreadable: this has to settle,
  // because the import awaits it and the tab-close guard follows state.busy.
  await assert.rejects(
    withVideo({ headerDuration: Infinity, recovered: Infinity }, () => grabVideoFrame('blob:broken', 0)),
    /no duration the browser can read/);
  await assert.rejects(
    withVideo({ unreadable: true }, () => grabVideoFrame('blob:junk', 0)),
    /could not be read by the browser/);
});

test('a throw inside a media event handler rejects the promise it came from', async () => {
  // A handler that throws unwinds into the event loop, not into the caller's
  // await, so the promise stayed pending forever and no try/catch anywhere
  // above it could see the failure.
  const realCreateElement = globalThis.document.createElement;
  globalThis.document.createElement = function (tag) {
    if (tag === 'canvas') throw new Error('the frame could not be drawn');
    return realCreateElement.call(this, tag);
  };
  try {
    await assert.rejects(withVideo({ headerDuration: 8 }, () => grabVideoFrame('blob:clip', 1)),
      /the frame could not be drawn/);
  } finally {
    globalThis.document.createElement = realCreateElement;
  }

  // A duration of NaN is not finite either, and Math.max(0, NaN - 0.05) is the
  // seek target that used to throw straight out of onloadeddata.
  await assert.rejects(withVideo({ headerDuration: NaN, recovered: NaN }, () => grabVideoFrame('blob:nan', 0)),
    /no duration the browser can read/);
});

test('a video that answers nothing at all rejects on a timeout', async () => {
  const fired = [];
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = fn => { fired.push(fn); return 0; };
  try {
    const pending = withVideo({ silent: true }, () => grabVideoFrame('blob:silent', 0));
    assert.equal(fired.length, 1, 'grabVideoFrame armed no timeout');
    fired[0]();
    await assert.rejects(pending, /produced no frame/);
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
});

// --- Escape, and where focus lands -------------------------------------------

const keydownHandler = (() => {
  const start = app.indexOf("window.addEventListener('keydown'");
  assert.ok(start > 0, 'the workspace keydown handler moved');
  return app.slice(start, app.indexOf("window.addEventListener('beforeunload'", start));
})();

test('an open dialog owns Escape before the sidebar branch sees it', () => {
  // The sidebar branch calls preventDefault(), so while it ran first the
  // dialog's own cancel never fired: Escape silently collapsed the panel
  // behind the modal and left the modal open.
  const guard = keydownHandler.indexOf("if ($('#dlg').open) return;");
  const sidebarEscape = keydownHandler.indexOf("e.key === 'Escape'");
  assert.ok(guard >= 0, 'the dialog guard is gone from the keydown handler');
  assert.ok(sidebarEscape >= 0, 'the sidebar Escape branch is gone from the keydown handler');
  assert.ok(guard < sidebarEscape,
    'the sidebar Escape branch runs before the dialog guard, so Escape cannot close a dialog');
});

test('a re-render puts keyboard focus back where it took it from', () => {
  // `replaceChildren` destroys the node the customer is standing on; without
  // this the reviewer tabs in from the top of the page for every asset.
  for (const name of ['render', 'renderReview']) {
    const start = app.indexOf(`\nfunction ${name}() {`);
    assert.ok(start > 0, `${name}() moved`);
    const body = app.slice(start, app.indexOf('\n}\n', start));
    assert.match(body, /captureFocus\(\)/, `${name}() does not record where focus was`);
    assert.match(body, /restoreFocus\(/, `${name}() does not put focus back`);
  }
  assert.match(app, /function focusSignature\(node\) \{[\s\S]*?node\.id/,
    'the focus key no longer prefers a stable id');
  assert.doesNotMatch(app.slice(app.indexOf('function focusSignature'), app.indexOf('function captureFocus')),
    /className/, 'a toggle changes class when activated, so the class cannot be part of the key');
});

// --- what a failed delivery says ---------------------------------------------

/** Every line that puts a caught failure onto the screen. */
const screenWrites = app.split('\n')
  .map((text, index) => ({ text, line: index + 1 }))
  .filter(({ text }) => /toast\(|textContent\s*=|detail:/.test(text))
  .filter(({ text }) => /\b(err|error)\b|\.reason \|\|/.test(text));

test('no delivery failure reaches the customer as a machine code', () => {
  assert.ok(screenWrites.length >= 24, `only ${screenWrites.length} failure messages found; the scan missed some`);
  for (const { text, line } of screenWrites) {
    assert.match(text, /deliveryReason\(/,
      `app.js:${line} prints a raw error to the customer: ${text.trim()}`);
  }
});

test('the delivery codes the shared helper has no sentence for get one here', () => {
  const codes = app.slice(app.indexOf('const DELIVERY_CODES'), app.indexOf('function deliveryReason'));
  for (const code of ['authorization_required', 'online_authorization_required', 'authorization_failed',
                      'billing_request_failed', 'license_required']) {
    assert.match(codes, new RegExp(`\\b${code}: '[a-z]`), `${code} has no sentence`);
  }
  assert.doesNotMatch(codes, /: '[a-z0-9]+_[a-z0-9_]+'/, 'a code was spelled with another code');
});

test('every colour refusal the export path can raise has words of its own', () => {
  // `buildPackage` throws `color_export_blocked:<file>:<reason>`, and the
  // reason comes from here. A reason with no entry reaches the screen as a
  // machine code inside a sentence, which is worse than either.
  const reasons = new Set();
  for (const color of [{}, { profile: 'unknown' }, { profile: 'cmyk' }, { profile: 'adobe-rgb' },
                       { profile: 'display-p3' }, { profile: 'embedded-icc-unclassified' },
                       { hdrSignaled: true, toneMappingApplied: false }]) {
    const decision = colorExportDecision(color);
    if (!decision.allowed) reasons.add(decision.reason);
  }
  assert.ok(reasons.size >= 6, `only ${reasons.size} refusals exercised`);
  const table = app.slice(app.indexOf('const COLOR_EXPORT_BLOCKS'), app.indexOf('const DELIVERY_CODES'));
  for (const reason of reasons) {
    assert.match(table, new RegExp(`\\b${reason}: \\{`), `${reason} has no sentence in COLOR_EXPORT_BLOCKS`);
  }
  assert.match(app, /raw\.startsWith\('color_export_blocked:'\)/, 'the packed colour code is no longer unpacked');
});

// --- pre-flight and the export path -------------------------------------------

test('pre-flight cannot see the colour refusal on its own, so app.js merges it', () => {
  // The gap this covers, proven against the shipped modules: an approved asset
  // that never analysed raises nothing blocking, and the export refuses it.
  const asset = {
    id: 'a1', filename: 'empty.png', kind: 'image', width: 0, height: 0, auto: null,
    altText: 'x', provenance: 'x', labels: {}, fixes: [],
    placements: { 'web-hero-desktop': { decision: 'approved', crop: { x: 0, y: 0, w: 1, h: 1 }, fill: 'crop' } }
  };
  const result = preflight({ surfaces: ['web-hero-desktop'], qaPreset: 'human', brief: {} }, [asset]);
  assert.equal(result.blocks, 0, 'analyze.js now blocks this on its own; the merge below can be reconsidered');
  assert.equal(colorExportDecision(asset.auto?.color || {}).allowed, false, 'the export path would ship this');

  const merge = app.slice(app.indexOf('function preflightResult()'), app.indexOf('function preflightDialog'));
  assert.match(merge, /colorExportDecision\(asset\.auto\?\.color \|\| \{\}\)/,
    'pre-flight no longer asks the question the export path asks');
  assert.match(merge, /blocks: result\.blocks \+ refusals\.length/, 'the refusals are not counted as blocking');
});

test('every pre-flight surface reads the merged result, not the raw one', () => {
  const raw = app.match(/preflight\(state\.project, state\.assets\)/g) || [];
  assert.equal(raw.length, 1, 'preflight() is called somewhere other than preflightResult()');
  const merged = app.match(/preflightResult\(\)/g) || [];
  assert.ok(merged.length >= 4, `the merged result is used at only ${merged.length} sites`);
  const dialog = app.slice(app.indexOf('function preflightDialog'), app.indexOf('async function openPrintDelivery'));
  assert.match(dialog, /result\.refusals\.length > 0 \|\|/,
    '"Export anyway" can still be ticked past a refusal the export itself enforces');
});

// --- colour is never the only signal ------------------------------------------

test('an issue says its level in words, not only in the fill of a 5px dot', () => {
  const list = app.slice(app.indexOf('const ISSUE_LEVELS'), app.indexOf('function metricsBlock'));
  for (const [level, word] of [['block', 'Blocking'], ['warn', 'Warning'], ['info', 'Note']]) {
    assert.match(list, new RegExp(`${level}: '${word}'`), `the ${level} level has no word`);
  }
  assert.match(list, /ISSUE_LEVELS\[i\.level\]/, 'the level word is not rendered on the row');
  assert.match(list, /className: 'dot', 'aria-hidden': 'true'/, 'the decorative dot is still announced');
});

test('a toggle reports being pressed, and nothing reports it by class alone', () => {
  assert.match(app, /const pressed = \(node, on\) => \{[^}]*aria-pressed/, 'pressed() no longer sets the state');
  const byClassAlone = app.match(/\?\s*'on'\s*:\s*''/g) || [];
  assert.deepEqual(byClassAlone, [],
    `${byClassAlone.length} toggles still say "selected" with a background tint and nothing else`);
  // The stage, the board and the rail all have to go through it.
  assert.ok((app.match(/pressed\(/g) || []).length >= 14, 'most toggles no longer route through pressed()');
});

// --- nothing prints the word "null" -------------------------------------------

/** The text between a call's parentheses, brackets balanced. */
function callArguments(source, open) {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '(') depth++;
    else if (source[i] === ')' && --depth === 0) return source.slice(open + 1, i);
  }
  return '';
}

test('no raw DOM insertion is handed a conditional that can be null', () => {
  // `el()` drops a null child; replaceChildren and append stringify one, and
  // the word "null" was rendering in the Print-ready photo dialog.
  for (const method of ['replaceChildren', 'append']) {
    for (const match of app.matchAll(new RegExp(`\\.${method}\\(`, 'g'))) {
      const args = callArguments(app, match.index + method.length + 1);
      let depth = 0, argument = '';
      const check = text => {
        const trimmed = text.trim();
        if (!trimmed) return;
        assert.doesNotMatch(trimmed, /(^|[^.\w])null$/,
          `.${method}() is passed a value that can be null, which inserts the text "null": ${trimmed.slice(-70)}`);
      };
      for (const character of args) {
        if ('([{'.includes(character)) depth++;
        else if (')]}'.includes(character)) depth--;
        if (character === ',' && depth === 0) { check(argument); argument = ''; continue; }
        argument += character;
      }
      check(argument);
    }
  }
});
