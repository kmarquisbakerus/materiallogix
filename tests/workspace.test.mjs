// The workspace's shared surfaces: the one <dialog> every dialog in the Studio
// is, the two import refusals, the empty-library check, and the loupe toggle.
//
// `studio/js/app.js` is the Studio's entry module — importing it boots the
// application — so the way interaction.test.mjs, wiring.test.mjs and
// claims.test.mjs do, the pieces under test are lifted out of the shipped
// source and run. Lifting and running is the point: a grep for the new shape
// would pass against code that no longer does the thing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { isImportableMediaFile } from '../studio/js/raw.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const app = readFileSync(resolve(ROOT, 'studio/js/app.js'), 'utf8');

/** A top-level declaration, from its first line to the `}` in column one. */
function block(opening) {
  const start = app.indexOf(opening);
  assert.ok(start > 0, `${opening.slice(0, 40)} moved`);
  const end = app.indexOf('\n}\n', start);
  assert.ok(end > start, `${opening.slice(0, 40)} has no end`);
  return app.slice(start, end + 2);
}

// --- the one <dialog> ---------------------------------------------------------

/** The four nodes `dialog()` writes to, with only the behaviour it relies on. */
function scriptedDialog() {
  const make = () => ({
    textContent: '', className: '', open: false, children: [],
    replaceChildren(...kids) { this.children = kids; },
    showModal() { this.open = true; },
    close() { this.open = false; }
  });
  const nodes = { '#dlg': make(), '#dlgTitle': make(), '#dlgBody': make(), '#dlgFoot': make() };
  const start = app.indexOf('const dialogStack = [];');
  assert.ok(start > 0, 'the dialog stack is gone: one shared #dlg with no owner is the defect');
  const end = app.indexOf('\n', app.indexOf('const closeDialog = () =>', start));
  const source = app.slice(start, end);
  const build = new Function('$', `${source}\nreturn { dialog, closeDialog, dismissDialog, dialogStack };`);
  return { nodes, ...build(sel => nodes[sel]) };
}

const shown = nodes => ({ open: nodes['#dlg'].open, title: nodes['#dlgTitle'].textContent, skin: nodes['#dlg'].className });

test('a job that finishes closes its own dialog, never the one the customer opened', async () => {
  // Watched live: the shortcuts panel closed itself when an import finished.
  // The customer dismisses the import's progress panel — it offers a Close
  // button — opens the shortcuts panel to read while the job runs, and the job
  // finishes underneath them.
  const { nodes, dialog, closeDialog } = scriptedDialog();
  const importing = dialog('Import', 'progress', ['close']);
  closeDialog();
  assert.equal(shown(nodes).open, false, 'dismissing the only dialog closes the element');

  dialog('Keyboard', 'shortcuts', ['close']);
  importing.close();
  assert.deepEqual(shown(nodes), { open: true, title: 'Keyboard', skin: '' },
    'the import closed the panel the customer had opened');
});

test('a dialog opened over another covers it and hands it back', async () => {
  // The other half: `dialog()` overwrote the element in place, so a job's own
  // question — the progress it is the only indicator of — was destroyed by
  // whatever opened next rather than waiting underneath it.
  const { nodes, dialog, closeDialog } = scriptedDialog();
  const importing = dialog('Import', 'progress', ['close']);
  dialog('Keyboard', 'shortcuts', ['close']);
  assert.equal(shown(nodes).title, 'Keyboard');

  closeDialog();
  assert.deepEqual(shown(nodes), { open: true, title: 'Import', skin: '' },
    'the covered dialog was destroyed instead of handed back');
  importing.close();
  assert.equal(shown(nodes).open, false, 'the element closes once nothing is left on it');
});

test('the skin belongs to the dialog, not to the element they share', () => {
  // `feedback-popover` and `generate-dialog` used to be added to and removed
  // from #dlg by hand, so a second dialog wore the first one's styling.
  const { nodes, dialog, closeDialog } = scriptedDialog();
  dialog('Why are you declining this result?', 'reasons', ['cancel'], { className: 'feedback-popover' });
  assert.equal(shown(nodes).skin, 'feedback-popover');
  dialog('Keyboard', 'shortcuts', ['close']);
  assert.equal(shown(nodes).skin, '', 'the covering dialog inherited the skin underneath it');
  closeDialog();
  assert.equal(shown(nodes).skin, 'feedback-popover', 'the skin did not come back with its dialog');
});

test('a dialog that is dismissed while covered still stops what it was running', () => {
  // The video comments and spin dialogs stop playback when they go away. That
  // used to hang off the element's own `close` event, which no longer fires
  // when the dialog is only uncovered.
  const { dialog, closeDialog } = scriptedDialog();
  let stopped = 0;
  const player = dialog('promo.webm', 'video', ['close'], { onDismiss: () => { stopped += 1; } });
  dialog('Keyboard', 'shortcuts', ['close']);
  player.close();
  assert.equal(stopped, 1, 'a covered dialog was dropped without stopping its playback');
  closeDialog();
  assert.equal(stopped, 1);
});

test('closing a dialog twice, or closing none, does nothing', () => {
  const { nodes, dialog, closeDialog } = scriptedDialog();
  const only = dialog('Import', 'progress', ['close']);
  only.close();
  only.close();
  closeDialog();
  assert.equal(shown(nodes).open, false);
});

test('every close that happens after an await is scoped to its own dialog', () => {
  // A bare `closeDialog()` reached after an await closes whatever is on screen
  // by then, which is the defect. These are the paths that have one.
  for (const [name, opening] of [
    ['analyzeAll', 'async function analyzeAll() {'],
    ['importFiles', 'async function importFiles('],
    ['renameProject', 'function renameProject() {'],
    ['deleteProjectFlow', 'function deleteProjectFlow() {']
  ]) {
    const body = block(opening);
    const deferred = body.split('\n').filter(line => /await |\.then\(/.test(line) && /closeDialog\(\)/.test(line));
    assert.deepEqual(deferred, [], `${name} closes whatever is on screen after an await`);
  }
  // The generation panel used to identify its dialog by a CSS class on the
  // shared element, which any other dialog could be wearing.
  assert.ok(!/dlg\.classList\.contains\('generate-dialog'\)/.test(app),
    'the generate dialog is identified by a class on the shared element again');
  assert.match(app, /photoCreationDialog\?\.close\(\);/);
});

// --- what the import refuses, and in whose words -------------------------------

/** The shipped `importFiles`, run far enough to reach its refusal. */
function refusal(files, gesture) {
  const refusals = app.indexOf('const IMPORT_REFUSALS');
  const start = refusals >= 0 ? refusals : app.indexOf('async function importFiles(');
  assert.ok(start > 0, 'importFiles moved');
  const source = app.slice(start, app.indexOf('\n}\n', app.indexOf('async function importFiles(')) + 2);
  let said = null;
  const build = new Function('isImportableMediaFile', 'toast', 'Object',
    `${source}\nreturn importFiles;`);
  const importFiles = build(isImportableMediaFile, message => { said = message; }, Object);
  importFiles(files, gesture);
  return said;
}

test('a file chosen in the picker is not refused with drag-and-drop wording', () => {
  // The drop handler and `#fileInput.onchange` shared one sentence, so opening
  // the file dialog and choosing a text file was told there were no media
  // files "in that drop" — a gesture the customer never made.
  const notes = [{ name: 'notes.txt', type: 'text/plain' }, { name: 'script.exe', type: '' }];
  const picked = refusal(notes, 'picker');
  assert.match(picked, /No supported photo or video files/);
  assert.doesNotMatch(picked, /drop/, `the picker still names a drag: "${picked}"`);
  assert.match(refusal(notes, 'drop'), /in that drop\./, 'a real drop must still say drop');
  // An unnamed caller gets the neutral one rather than the wrong one.
  assert.equal(refusal(notes, undefined), picked);
});

test('the two import gestures are wired to the two sentences', () => {
  assert.match(app, /\$\('#fileInput'\)\.onchange = e => \{ importFiles\(e\.target\.files\); e\.target\.value = ''; \};/);
  assert.match(app, /if \(e\.dataTransfer\?\.files\?\.length\) importFiles\(e\.dataTransfer\.files, 'drop'\);/);
});

// --- the automated checks on an empty library ---------------------------------

/** The shipped `analyzeAll`, run as far as its early return. */
function checksOn(assets) {
  const source = block('async function analyzeAll() {');
  let said = null;
  const build = new Function('state', 'toast', 'count', 'el', 'dialog', 'btn', 'closeDialog',
    'busy', 'runAnalysis', 'render', 'sentence', 'deliveryReason',
    `${source}\nreturn analyzeAll;`);
  const analyzeAll = build({ assets }, message => { said = message; },
    (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`, () => ({}), () => ({ close() {} }), () => ({}),
    () => {}, fn => fn(), () => {}, () => {}, String, String);
  analyzeAll();
  return said;
}

test('an empty library is not told everything in it has already been analysed', () => {
  // Vacuously true and reads as a fault: nothing has been analysed, because
  // there is nothing to analyse.
  const empty = checksOn([]);
  assert.doesNotMatch(empty, /already been analysed/, `an empty library was told: "${empty}"`);
  assert.match(empty, /Nothing to check yet/);
  assert.match(empty, /import or generate a photo first/, 'say what to do next');
  // And a library that really has been analysed still says so.
  assert.match(checksOn([{ id: 'a1', auto: { sharpness: 70 } }]), /Every asset has already been analysed\./);
});

// --- the loupe, on a viewport that can show one -------------------------------

/** `loupeIsAvailable` and `setLoupe`, run against a scripted media query. */
function loupeApi(phone) {
  const start = app.indexOf('function loupeIsAvailable()');
  assert.ok(start > 0, 'nothing asks whether the loupe can be shown');
  const source = app.slice(start, app.indexOf('\n}\n', app.indexOf('function setLoupe(on) {')) + 2);
  const state = { loupe: false };
  let removed = 0;
  const build = new Function('matchMedia', 'state', 'removeLoupe',
    `${source}\nreturn { loupeIsAvailable, setLoupe };`);
  return { state, removed: () => removed,
    ...build(query => ({ matches: phone && /max-width: 900px/.test(query) }), state, () => { removed += 1; }) };
}

test('the loupe cannot be turned on where the stylesheet hides it', () => {
  // `.loupe` is display:none below 900px — a hover concept with no cursor to
  // sit under — so turning it on there showed nothing and took the stage's
  // drag handlers with it, which are guarded by `if (state.loupe) return`.
  const phone = loupeApi(true);
  assert.equal(phone.loupeIsAvailable(), false);
  phone.setLoupe(true);
  assert.equal(phone.state.loupe, false, 'the phone turned on a loupe the stylesheet hides');
  assert.ok(phone.removed() > 0, 'any loupe already drawn has to go');

  const desktop = loupeApi(false);
  assert.equal(desktop.loupeIsAvailable(), true);
  desktop.setLoupe(true);
  assert.equal(desktop.state.loupe, true, 'the loupe no longer works where it can be drawn');
  desktop.setLoupe(false);
  assert.equal(desktop.state.loupe, false);
});

test('the Loupe toggle is only built where the loupe can draw', () => {
  // The toggle itself, lifted out of `stageTools` and run both ways.
  const start = app.indexOf('  const loupeBtn = ');
  assert.ok(start > 0, 'the Loupe toggle moved');
  const source = app.slice(start, app.indexOf('\n  const thirdsBtn', start));
  const build = new Function('loupeIsAvailable', 'pressed', 'btn', 'state', 'setLoupe', 'renderReview',
    `${source}\nreturn loupeBtn;`);
  const make = available => build(() => available, node => node, label => ({ label }), { loupe: false }, () => {}, () => {});
  assert.equal(make(false), null, 'a phone is still offered a toggle for a loupe it cannot see');
  assert.deepEqual(make(true), { label: 'Loupe' });
  // The keyboard shortcut reaches the same state and must ask the same question.
  assert.match(app, /if \(!loupeIsAvailable\(\)\) \{ toast\('The loupe needs a wider window/,
    'the L shortcut can still set a loupe that cannot be shown');
});
