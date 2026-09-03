import test from 'node:test';
import assert from 'node:assert/strict';
import {
  slug, approvedPairs, decisionsJson, decisionsMarkdown, filenameMapCsv,
  altTextMarkdown, retouchListMarkdown, rejectedRecord, teamNotes, cropsJson, videoNotes
  , executionSummary
} from '../studio/js/export.js';
import { ASSET_SOURCES } from '../studio/js/model.js';
import { makeZip } from '../studio/js/zip.js';
import { planPrint, printColorDecision, setJpegDensity, readJpegDensity, PRINT_PPI } from '../studio/js/print.js';
import { colorExportDecision } from '../studio/js/color-management.js';

const project = {
  id: 'p1', name: 'First campaign',
  brief: { brand: 'Acme Co', campaignGoal: 'Spring launch', audience: '', tone: '', mustHave: '', mustAvoid: '' },
  surfaces: ['web-hero-desktop'], qaPreset: 'person', providers: {}
};
const approvedImage = () => ({
  id: 'a1', kind: 'image', filename: 'Shot One.PNG', width: 3000, height: 2400,
  status: 'approved', rating: 4, role: 'candidate',
  labels: { campaign: 'Spring', lane: 'Social', audience: '' },
  altText: 'A product on linen.', provenance: 'Studio original.',
  auto: { color: { profile: 'srgb' } }, fixes: [], log: [],
  placements: { 'web-hero-desktop': { decision: 'approved', crop: { x: 0, y: 0, w: 1, h: 1 }, fill: 'crop' } }
});

test('slug produces a safe, stable filename stem', () => {
  assert.equal(slug('Shot One.PNG'), 'shot-one', 'the extension is dropped from the stem');
  assert.equal(slug('  Ünïcode / slash  '), slug('  Ünïcode / slash  '), 'slug is deterministic');
  assert.match(slug('Acme Co.'), /^[a-z0-9-]+$/);
  // A filename stem may never be empty, or two assets would collide on "".
  assert.equal(slug(''), 'asset');
  assert.equal(slug(null), 'asset');
  assert.equal(slug('...'), 'asset');
  assert.ok(slug('x'.repeat(200)).length <= 48, 'stems stay inside filesystem limits');
});

test('only approved placements on known surfaces are delivered', () => {
  const asset = approvedImage();
  asset.placements['not-a-real-surface'] = { decision: 'approved', crop: { x:0,y:0,w:1,h:1 }, fill: 'crop' };
  asset.placements['web-hero-mobile'] = { decision: 'revise', crop: { x:0,y:0,w:1,h:1 }, fill: 'crop' };
  const pairs = approvedPairs([asset]);
  assert.equal(pairs.length, 1, 'an unknown surface and a non-approved decision are both excluded');
  assert.equal(pairs[0].surface.id, 'web-hero-desktop');
  assert.deepEqual(approvedPairs([]), []);
  assert.deepEqual(approvedPairs([{ }]), [], 'an asset with no placements is not a crash');
});

test('the decisions record is valid JSON and carries the audit fields', () => {
  const parsed = JSON.parse(decisionsJson(project, [approvedImage()]));
  assert.equal(parsed.schema, 'creative-review-os/decisions@1');
  assert.ok(parsed.exportedAt);
  assert.equal(parsed.project.name, 'First campaign');
  assert.equal(parsed.assets.length, 1);
  assert.equal(parsed.assets[0].filename, 'Shot One.PNG');
});

test('the decisions record never carries a stored credential', () => {
  const withKey = { ...project, providers: { 'image-renderer': { enabled: true, key: 'sk-should-never-ship' } } };
  const text = decisionsJson(withKey, [approvedImage()]);
  assert.ok(!text.includes('sk-should-never-ship'), 'a stored key must never reach the package');
  assert.ok(!/"key"\s*:/.test(text), 'the record has no place to put a credential at all');
});

test('the package reports where the work actually ran', () => {
  const record = JSON.parse(decisionsJson(project, [
    { ...approvedImage(), source: 'upload' },
    { ...approvedImage(), id: 'a2', source: 'generated-fill-local' },
    { ...approvedImage(), id: 'a3', source: 'generated-local' }
  ]));
  const execution = record.project.execution;
  assert.equal(execution.ranEntirelyOnThisComputer, true);
  assert.deepEqual(execution.offDevice, []);
  assert.deepEqual(execution.sources.map(entry => entry.id).sort(),
    ['generated-fill-local', 'generated-local', 'upload']);
  for (const entry of execution.sources) {
    assert.ok(entry.label && entry.ranOn, 'every source is named and placed');
    assert.ok(entry.assets > 0);
  }
});

test('the execution record counts every asset and never invents a source', () => {
  const summary = executionSummary([{ source: 'generated-local' }, {}, { source: 'not-a-real-source' }]);
  const total = summary.sources.reduce((sum, entry) => sum + entry.assets, 0);
  assert.equal(total, 3, 'an unknown or missing source still counts, as an import');
  assert.ok(summary.sources.every(entry => Object.hasOwn(ASSET_SOURCES, entry.id)));
  assert.deepEqual(executionSummary([]).sources, []);
  assert.equal(executionSummary(undefined).ranEntirelyOnThisComputer, true);
});

test('the filename map is well-formed CSV with a header and one row per placement', () => {
  const csv = filenameMapCsv(project, [approvedImage()]);
  const lines = csv.trim().split('\n');
  assert.ok(lines.length >= 2);
  const columns = lines[0].split(',').length;
  for (const line of lines) assert.equal(line.split(',').length >= columns, true, `ragged row: ${line}`);
});

test('CSV values containing commas or quotes are escaped', () => {
  const asset = approvedImage();
  asset.filename = 'a,"weird",name.png';
  const csv = filenameMapCsv(project, [asset]);
  assert.match(csv, /""/, 'an embedded quote must be doubled');
  const body = csv.trim().split('\n')[1];
  assert.match(body, /"/, 'a value with a comma must be quoted');
});

test('the delivery documents render for a normal project', () => {
  const assets = [approvedImage()];
  for (const [name, doc] of Object.entries({
    decisionsMarkdown: decisionsMarkdown(project, assets),
    altTextMarkdown: altTextMarkdown(project, assets),
    retouchListMarkdown: retouchListMarkdown(project, assets),
    teamNotes: teamNotes(project, assets),
    videoNotes: videoNotes(project, assets)
  })) {
    assert.equal(typeof doc, 'string', `${name} must render`);
    assert.ok(doc.length > 0, `${name} must not be empty`);
    assert.ok(!doc.includes('undefined'), `${name} leaked "undefined" into the package`);
    assert.ok(!/\(s\)/.test(doc), `${name} shipped a "(s)" placeholder`);
  }
  assert.doesNotThrow(() => JSON.parse(cropsJson(project, assets)));
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(rejectedRecord(assets))));
});

test('the delivery documents survive an empty project', () => {
  const bare = { ...project, brief: { brand: '', campaignGoal: '' } };
  for (const doc of [decisionsMarkdown(bare, []), altTextMarkdown(bare, []), retouchListMarkdown(bare, []), teamNotes(bare, []), videoNotes(bare, [])]) {
    assert.equal(typeof doc, 'string');
    assert.ok(!doc.includes('undefined'));
  }
});

test('a zip is built with the local and central signatures a reader expects', async () => {
  const blob = makeZip([{ name: 'README.md', data: '# hello' }, { name: 'a/b.txt', data: 'nested' }]);
  assert.equal(blob.type, 'application/zip');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.ok(bytes.length > 0);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(view.getUint32(0, true), 0x04034b50, 'first record must be a local file header');
  const text = new TextDecoder().decode(bytes);
  assert.match(text, /README\.md/);
  assert.match(text, /a\/b\.txt/);
  assert.match(text, /# hello/);
});

test('a print plan refuses nonsense and blocks an undersized source', () => {
  assert.throws(() => planPrint({ presetId: 'not-a-size', sourceWidth: 3000, sourceHeight: 2400 }), /unknown_print_size/);
  assert.throws(() => planPrint({ orientation: 'sideways', sourceWidth: 3000, sourceHeight: 2400 }), /invalid_print_orientation/);
  assert.throws(() => planPrint({ fit: 'squash', sourceWidth: 3000, sourceHeight: 2400 }), /invalid_print_fit/);
  assert.throws(() => planPrint({ sourceWidth: 0, sourceHeight: 2400 }), /invalid_source_dimensions/);
  assert.throws(() => planPrint({ sourceWidth: 3000, sourceHeight: 2400, ppi: 50 }), /invalid_print_ppi/);

  const small = planPrint({ presetId: '8x10', sourceWidth: 900, sourceHeight: 700 });
  assert.equal(small.quality, 'blocked');
  assert.equal(small.canExport, false, 'a print that would look bad must not be sellable');

  const big = planPrint({ presetId: '8x10', sourceWidth: 3000, sourceHeight: 2400 });
  assert.equal(big.canExport, true);
  assert.equal(big.pixelWidth, 8 * PRINT_PPI);
  assert.equal(big.pixelHeight, 10 * PRINT_PPI);
});

test('bleed grows the sheet on every edge without moving the trim', () => {
  const plain = planPrint({ presetId: '8x10', sourceWidth: 4000, sourceHeight: 5000 });
  const bled = planPrint({ presetId: '8x10', sourceWidth: 4000, sourceHeight: 5000, bleed: true });
  assert.equal(bled.trimPixelWidth, plain.trimPixelWidth);
  assert.equal(bled.pixelWidth, plain.pixelWidth + bled.bleedPixels * 2);
  assert.equal(bled.pixelHeight, plain.pixelHeight + bled.bleedPixels * 2);
});

test('landscape swaps the sheet but leaves a square preset alone', () => {
  const portrait = planPrint({ presetId: '8x10', orientation: 'portrait', sourceWidth: 5000, sourceHeight: 5000 });
  const landscape = planPrint({ presetId: '8x10', orientation: 'landscape', sourceWidth: 5000, sourceHeight: 5000 });
  assert.equal(landscape.pixelWidth, portrait.pixelHeight);
  assert.equal(landscape.pixelHeight, portrait.pixelWidth);
  const square = planPrint({ presetId: '12x12', orientation: 'landscape', sourceWidth: 5000, sourceHeight: 5000 });
  assert.equal(square.pixelWidth, square.pixelHeight);
});

test('print delivery is only ever sRGB, and unsupported profiles stay blocked', () => {
  assert.deepEqual(printColorDecision({ profile: 'srgb' }), { allowed: true, reason: 'embedded_srgb', outputProfile: 'srgb' });
  assert.equal(printColorDecision({ profile: 'untagged-srgb-fallback' }).allowed, true);
  for (const profile of ['adobe-rgb', 'cmyk', 'embedded-icc-unclassified', 'unknown']) {
    const decision = printColorDecision({ profile });
    assert.equal(decision.allowed, false, `${profile} must not print`);
    assert.equal(decision.outputProfile, null);
  }
  assert.equal(colorExportDecision({ hdrSignaled: true }).allowed, false, 'untone-mapped HDR must not ship');
});

test('a print JPEG carries its resolution so a lab prints it at the right size', () => {
  const jpeg = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00,
    0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xD9]);
  const stamped = setJpegDensity(jpeg, 300);
  assert.deepEqual(readJpegDensity(stamped), { units: 'ppi', x: 300, y: 300 });
});
