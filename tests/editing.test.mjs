import test from 'node:test';
import assert from 'node:assert/strict';
import { EDIT_DEFAULTS, ensureEditState, buildLuminanceLut, CURVE_IDENTITY } from '../studio/js/editing.js';

test('ensureEditState keeps every object identity across repeated calls', () => {
  const asset = {};
  const first = ensureEditState(asset);
  const captured = {
    edit: first,
    adjustments: first.adjustments,
    heals: first.adjustments.heals,
    selective: first.adjustments.selective,
    strokes: first.adjustments.selective.strokes,
    curve: first.adjustments.curve,
    pixelGrid: first.pixelGrid
  };
  const second = ensureEditState(asset);
  assert.equal(second, captured.edit);
  assert.equal(second.adjustments, captured.adjustments);
  assert.equal(second.adjustments.heals, captured.heals);
  assert.equal(second.adjustments.selective, captured.selective);
  assert.equal(second.adjustments.selective.strokes, captured.strokes);
  assert.equal(second.adjustments.curve, captured.curve);
  assert.equal(second.pixelGrid, captured.pixelGrid);
});

test('an edit written through a captured reference survives a later normalize', () => {
  // This is the editor's exact lifecycle: a control captures `adjustments`
  // when the panel is built, the stage repaints through ensureEditState, and
  // only then does someone drag the slider.
  const asset = {};
  const adjustments = ensureEditState(asset).adjustments;
  ensureEditState(asset);
  adjustments.exposure = 0.75;
  adjustments.selective.saturation = 40;
  adjustments.heals.push({ x: 0.5, y: 0.5, r: 0.02 });
  assert.equal(ensureEditState(asset).adjustments.exposure, 0.75);
  assert.equal(asset.edit.adjustments.selective.saturation, 40);
  assert.equal(asset.edit.adjustments.heals.length, 1);
});

test('ensureEditState fills defaults and rejects unusable values', () => {
  const asset = { edit: { mode: 'nonsense', adjustments: { exposure: 'x', contrast: 12 }, pixelGrid: { columns: null } } };
  const edit = ensureEditState(asset);
  assert.equal(edit.mode, 'guided');
  assert.equal(edit.adjustments.exposure, 0);
  assert.equal(edit.adjustments.contrast, 12);
  assert.equal(edit.pixelGrid.columns, EDIT_DEFAULTS.pixelGrid.columns);
  assert.equal(edit.pixelGrid.enabled, false);
});

test('ensureEditState never adopts the frozen default containers', () => {
  const asset = {};
  const edit = ensureEditState(asset);
  assert.notEqual(edit.adjustments, EDIT_DEFAULTS.adjustments);
  assert.notEqual(edit.adjustments.heals, EDIT_DEFAULTS.adjustments.heals);
  assert.notEqual(edit.adjustments.selective, EDIT_DEFAULTS.adjustments.selective);
  assert.doesNotThrow(() => { edit.adjustments.heals.push({ x: 0.1, y: 0.1, r: 0.01 }); });
});

test('ensureEditState drops malformed stamps and repairs the curve', () => {
  const asset = { edit: { adjustments: {
    heals: [{ x: 0.5, y: 0.5, r: 0.02 }, { x: 'a', y: 1, r: 1 }, null],
    selective: { strokes: [{ x: 2, y: -2, r: 0.5 }] },
    curve: [{ x: 0, y: 0 }]
  } } };
  const edit = ensureEditState(asset);
  assert.equal(edit.adjustments.heals.length, 1);
  assert.equal(edit.adjustments.selective.strokes.length, 1);
  assert.equal(edit.adjustments.selective.strokes[0].x, 1);
  assert.equal(edit.adjustments.selective.strokes[0].y, 0);
  assert.deepEqual(edit.adjustments.curve, CURVE_IDENTITY.map(p => ({ ...p })));
});

test('ensureEditState is stable when a stored asset is re-opened', () => {
  const stored = JSON.parse(JSON.stringify({ edit: ensureEditState({}) }));
  const edit = ensureEditState(stored);
  assert.equal(edit.adjustments.curve.length, 4);
  assert.equal(ensureEditState(stored).adjustments, edit.adjustments);
});

test('the identity curve needs no lookup table', () => {
  assert.equal(buildLuminanceLut(CURVE_IDENTITY), null);
});

test('a shaped curve produces a monotone lookup table without overshoot', () => {
  const lut = buildLuminanceLut([{ x: 0, y: 0 }, { x: 85, y: 120 }, { x: 170, y: 190 }, { x: 255, y: 255 }]);
  assert.ok(lut, 'expected a lookup table');
  assert.equal(lut.length, 256);
  assert.equal(lut[0], 0);
  assert.equal(lut[255], 255);
  for (let i = 1; i < 256; i++) assert.ok(lut[i] >= lut[i - 1], `lut not monotone at ${i}`);
});
