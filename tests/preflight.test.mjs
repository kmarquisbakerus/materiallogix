import test from 'node:test';
import assert from 'node:assert/strict';
import { preflight, assetIssues, placementIssues, smartCrop, energyIn, rectOverlapFrac, hexToRgb, paletteMatch, brandHexesFrom } from '../studio/js/analyze.js';

const project = { surfaces: ['web-hero-desktop'], qaPreset: 'human', brief: { brandRules: '', mustAvoid: '' } };
const analysed = (over = {}) => ({
  sharpness: 80, exposure: { blown: 0, crushed: 0 }, cameraNoise: { class: 'clean' },
  color: { profile: 'srgb' }, palette: [], ...over
});
const asset = (over = {}) => ({
  id: 'a1', filename: 'shot.png', kind: 'image', width: 4000, height: 3000,
  altText: 'A product on linen.', provenance: 'Studio original.', labels: {}, fixes: [],
  auto: analysed(), placements: { 'web-hero-desktop': { decision: 'approved', crop: { x: 0, y: 0, w: 1, h: 1 }, fill: 'crop' } },
  ...over
});

test('an unanalysed asset is reported rather than silently passed', () => {
  const issues = assetIssues({ ...asset(), auto: null }, [], project);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].level, 'info');
  assert.match(issues[0].code, /not-analyzed/);
});

test('a clean asset raises nothing blocking', () => {
  assert.equal(assetIssues(asset(), [asset()], project).filter(i => i.level === 'block').length, 0);
});

test('colour profiles that cannot be delivered block the export', () => {
  for (const [color, expected] of [
    [{ profile: 'cmyk', cmyk: true }, /cmyk/],
    [{ hdrSignaled: true, toneMappingApplied: false }, /hdr/],
    [{ profile: 'adobe-rgb' }, /adobe-rgb/],
    [{ profile: 'embedded-icc-unclassified' }, /profile/]
  ]) {
    const issues = assetIssues(asset({ auto: analysed({ color }) }), [], project);
    const blocking = issues.filter(i => i.level === 'block');
    assert.ok(blocking.length > 0, `${JSON.stringify(color)} must block`);
    assert.ok(blocking.some(i => expected.test(i.code)), `${JSON.stringify(color)} -> ${blocking.map(i => i.code).join(',')}`);
  }
});

test('an accepted tone map clears the HDR block', () => {
  const issues = assetIssues(asset({ auto: analysed({ color: { profile: 'bt2020-linear', hdrSignaled: true, toneMappingApplied: true, conversionAccepted: true } }) }), [], project);
  assert.equal(issues.filter(i => i.code === 'hdr-tone-map-required').length, 0);
});

test('soft, blown and noisy frames are warned about, not blocked', () => {
  for (const auto of [analysed({ sharpness: 10 }), analysed({ exposure: { blown: 0.3, crushed: 0 } }),
                      analysed({ cameraNoise: { class: 'heavy' } })]) {
    const issues = assetIssues(asset({ auto }), [], project);
    assert.ok(issues.some(i => i.level === 'warn'), JSON.stringify(auto));
    assert.equal(issues.filter(i => i.level === 'block').length, 0, 'a quality opinion must not block a deliberate ship');
  }
});

test('preflight ignores assets with nothing approved', () => {
  const unapproved = asset({ placements: { 'web-hero-desktop': { decision: 'revise', crop: { x:0,y:0,w:1,h:1 }, fill:'crop' } } });
  const result = preflight(project, [unapproved]);
  assert.equal(result.items.filter(i => i.assetId).length, 0);
});

test('a surface in scope with nothing approved is reported as a gap', () => {
  const result = preflight({ ...project, surfaces: ['web-hero-desktop', 'ig-feed-portrait'] }, [asset()]);
  const gaps = result.items.filter(i => i.code === 'gap');
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].level, 'warn');
});

test('preflight sorts blocking issues to the top and counts them', () => {
  const result = preflight(project, [asset({ auto: analysed({ color: { profile: 'cmyk', cmyk: true }, sharpness: 10 }) })]);
  assert.ok(result.blocks > 0 && result.warns > 0);
  assert.equal(result.items[0].level, 'block', 'the thing that stops the ship reads first');
  assert.equal(result.blocks, result.items.filter(i => i.level === 'block').length);
});

test('preflight survives an empty or malformed project', () => {
  assert.doesNotThrow(() => preflight({ surfaces: [] }, []));
  assert.doesNotThrow(() => preflight({}, []));
  assert.doesNotThrow(() => preflight({ surfaces: ['nope'] }, [asset({ placements: {} })]));
});

test('placement issues are reported against the surface they belong to', () => {
  const tiny = asset({ width: 200, height: 150 });
  const issues = placementIssues(tiny, 'web-hero-desktop', project);
  assert.ok(Array.isArray(issues));
  assert.ok(issues.every(i => ['block', 'warn', 'info'].includes(i.level)), 'every issue has a level');
});

test('a smart crop stays inside the source', () => {
  const grid = Array.from({ length: 16 }, () => Array.from({ length: 16 }, () => Math.random()));
  const surface = { w: 1920, h: 1080 };
  const crop = smartCrop(grid, 4000, 3000, surface, { x: 0, y: 0, w: 1, h: 1 }, []);
  assert.ok(crop.x >= -1e-9 && crop.y >= -1e-9 && crop.x + crop.w <= 1 + 1e-9 && crop.y + crop.h <= 1 + 1e-9,
    JSON.stringify(crop));
});

test('rectangle overlap is a fraction between nothing and everything', () => {
  assert.equal(rectOverlapFrac({ x:0,y:0,w:1,h:1 }, { x:0,y:0,w:1,h:1 }), 1);
  assert.equal(rectOverlapFrac({ x:0,y:0,w:1,h:1 }, { x:5,y:5,w:1,h:1 }), 0);
  const partial = rectOverlapFrac({ x:0,y:0,w:1,h:1 }, { x:0.5,y:0,w:1,h:1 });
  assert.ok(partial > 0 && partial < 1, String(partial));
});

test('brand colours are read from the brief and matched with tolerance', () => {
  assert.deepEqual(brandHexesFrom('Use #A1B2C3 and #ffffff only'), ['#A1B2C3', '#ffffff']);
  assert.deepEqual(brandHexesFrom(''), []);
  assert.deepEqual(brandHexesFrom(null), []);
  assert.deepEqual(hexToRgb('#ffffff'), [255, 255, 255]);
  assert.deepEqual(hexToRgb('#000000'), [0, 0, 0]);
  const exact = paletteMatch([{ rgb: [255, 255, 255] }], ['#ffffff']);
  assert.ok(exact === true || (exact && exact.matched !== false), 'an exact brand colour matches');
});
