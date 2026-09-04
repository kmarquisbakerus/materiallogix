import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { exportUnits, unitsForDeliveries, UNITS_PER_VIDEO_MINUTE, MONTHLY_UNITS } from '../studio/js/pricing.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const app = readFileSync(resolve(ROOT, 'studio/js/app.js'), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

/** Slice one top-level function body out of app.js by matching braces. */
function functionBody(name) {
  const start = app.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.notEqual(start, -1, `${name} not found in app.js`);
  let depth = 0;
  // Open at the brace after the parameter list, so a default like `{}` does not
  // close the body before it has begun.
  for (let i = app.indexOf('{', app.indexOf(') {', start)); i < app.length; i++) {
    if (app[i] === '{') depth++;
    else if (app[i] === '}' && --depth === 0) return app.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces in ${name}`);
}

// ── the paywall on every path that hands over a file ────────────────────────

// A licence that does not cover this Studio buys nothing here. The campaign
// package asked; the client review page and the contact sheet asked nobody, so
// a $5 Voice Starter downloaded a 426 KB page with every approved photo
// embedded at 1500px, clean, and a contact sheet of the same photos.
const GATED_DOWNLOADS = ['doExport', 'exportClientPage', 'exportContactSheet'];

for (const name of GATED_DOWNLOADS) {
  test(`${name} refuses a licence that does not cover the Studio`, () => {
    const body = functionBody(name);
    const gateAt = body.indexOf('licensedToDeliver(');
    assert.ok(gateAt > -1, `${name} must ask whether the licence covers this Studio`);
    assert.match(body.slice(gateAt - 40, gateAt + 60), /if \(!await licensedToDeliver\([^)]*\)\) return/,
      `${name} must return when the licence does not cover it, not carry on`);
    const authorizeAt = body.indexOf('authorizeOutbound(');
    assert.ok(authorizeAt > -1, `${name} must still reserve usage`);
    assert.ok(gateAt < authorizeAt, `${name} must check coverage before it reserves anything`);
  });
}

test('the download paywall reads the licence, not the button that was pressed', () => {
  const body = functionBody('licensedToDeliver');
  assert.match(body, /covers\(await activeLicense\(\), product\)/,
    'the paywall must answer from the installed licence and the Studio asked for');
  assert.match(body, /plansCovering\(product\)/, 'it must name the plans that do cover it');
});

// ── what a delivery costs ───────────────────────────────────────────────────

/**
 * Run the campaign export's own authorization, as shipped, against the real
 * pricing policy. This asserts what a customer is billed rather than how the
 * expression is spelled.
 */
async function packageAuthorization({ pairs, proof }) {
  const body = functionBody('doExport');
  const anchor = body.indexOf('const evidenceHash');
  assert.ok(anchor > -1, 'the campaign export no longer hashes what it is about to deliver');
  const start = body.indexOf('\n', body.indexOf(';', anchor)) + 1;
  const end = body.indexOf('});', body.indexOf('operationId: evidenceHash', start)) + 3;
  assert.ok(end > start, 'the campaign export no longer builds its own authorization');
  const calls = [];
  const run = new AsyncFunction('unitsForDeliveries', 'pairs', 'exportOpts', 'product', 'evidenceHash',
    'authorizeOutbound', body.slice(start, end));
  await run(unitsForDeliveries, pairs, { proof }, 'video', 'hash',
    args => { calls.push(args); return { ok: true, authorization: { id: 'test' } }; });
  assert.equal(calls.length, 1, 'the campaign export must authorize exactly once');
  return calls[0];
}

const videoPairs = surfaces => Array.from({ length: surfaces },
  () => ({ asset: { id: 'clip', kind: 'video', duration: 600 } }));

test('the campaign package bills the stills it renders, not the source it was given', async () => {
  // The zip holds one JPEG per approved placement — a video placement gets a
  // poster frame in video/reference-frames and the customer's own file back
  // unmodified, never a cut. Four units per source minute charged 240 units
  // for a ten-minute upload approved on six surfaces: a quarter of a Full
  // Studio month for six JPEGs and a copy of their own file.
  const oneSurface = await packageAuthorization({ pairs: videoPairs(1), proof: false });
  assert.equal(oneSurface.artifactKind, 'clean_export');
  assert.equal(oneSurface.quantity, 1, 'one placement renders one still');

  const sixSurfaces = await packageAuthorization({ pairs: videoPairs(6), proof: false });
  assert.equal(sixSurfaces.quantity, 6, 'six placements render six stills');
  assert.ok(sixSurfaces.quantity < UNITS_PER_VIDEO_MINUTE * 10,
    'the package must not bill a source minute it never rendered');
  assert.ok(sixSurfaces.quantity / MONTHLY_UNITS.full < 0.01,
    'one export must not eat a measurable share of a monthly allowance');

  const photos = await packageAuthorization({
    pairs: [{ asset: { id: 'a', kind: 'photo' } }, { asset: { id: 'b', kind: 'photo' } }], proof: false
  });
  assert.equal(photos.quantity, 2, 'a photo package is unchanged: one unit per crop');
});

test('a watermarked proof spends no plan units', async () => {
  // "Unlimited watermarked previews — they never use your allowance" is on
  // every plan card. The local ledger already skipped proofs; the server-facing
  // one billed them the same as a clean export.
  for (const pairs of [videoPairs(1), videoPairs(6), [{ asset: { id: 'a', kind: 'photo' } }]]) {
    const proof = await packageAuthorization({ pairs, proof: true });
    assert.equal(proof.artifactKind, 'proof_export', 'a proof is still recorded as what it is');
    assert.equal(proof.quantity, 0, 'a proof must not spend allowance');
  }
  // The two ledgers have to agree: recordExport already refuses proofs.
  assert.match(functionBody('doExport'), /if \(!exportOpts\.proof\) recordExport\(/,
    'the local ledger must keep skipping proofs');
});

/** The same trick for the one local flow that really renders video. */
async function videoRenderAuthorization(outputSeconds) {
  const body = functionBody('renderEditedVideo');
  const start = body.indexOf('const authorization = await authorizeOutbound(');
  assert.ok(start > -1, 'the local video render no longer reserves usage');
  const end = body.indexOf('});', start) + 3;
  const calls = [];
  const run = new AsyncFunction('exportUnits', 'plan', 'authorizeOutbound', body.slice(start, end));
  await run(exportUnits, { outputSeconds }, args => { calls.push(args); return { ok: true }; });
  assert.equal(calls.length, 1);
  return calls[0];
}

test('the local video render bills the length of the cut it delivers', async () => {
  // A flat unit charged an hour of finished video the same as a minute, on the
  // only local flow that does the long, real work — while the package that
  // renders no video at all billed by the minute.
  assert.equal((await videoRenderAuthorization(60)).quantity, UNITS_PER_VIDEO_MINUTE);
  assert.equal((await videoRenderAuthorization(600)).quantity, UNITS_PER_VIDEO_MINUTE * 10);
  assert.equal((await videoRenderAuthorization(3600)).quantity, UNITS_PER_VIDEO_MINUTE * 60);
  assert.equal((await videoRenderAuthorization(30)).quantity, UNITS_PER_VIDEO_MINUTE,
    'a part minute bills a whole one, never zero');
  const short = await videoRenderAuthorization(60);
  const long = await videoRenderAuthorization(3600);
  assert.ok(long.quantity > short.quantity, 'a longer cut must cost more than a shorter one');
  assert.equal(short.product, 'video');
});
