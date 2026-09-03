import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSpinIndex, stepSpinIndex, spinIndexFromDrag, spinStepFromWheel, spinAngleLabel } from '../studio/js/spin-viewer.js';

test('a spin index wraps in both directions', () => {
  assert.equal(normalizeSpinIndex(0, 6), 0);
  assert.equal(normalizeSpinIndex(6, 6), 0);
  assert.equal(normalizeSpinIndex(7, 6), 1);
  assert.equal(normalizeSpinIndex(-1, 6), 5);
  assert.equal(normalizeSpinIndex(-13, 6), 5);
});

test('an empty or unusable sequence stays on frame zero', () => {
  for (const count of [0, -3, null, undefined, NaN, 'x']) assert.equal(normalizeSpinIndex(4, count), 0);
  assert.equal(spinAngleLabel(2, 0), 'No frames');
});

test('stepping keeps a continuous turn', () => {
  assert.equal(stepSpinIndex(5, 1, 6), 0);
  assert.equal(stepSpinIndex(0, -1, 6), 5);
  assert.equal(stepSpinIndex(0, 0, 6), 0);
});

test('dragging left advances the turn and dragging right reverses it', () => {
  assert.equal(spinIndexFromDrag(0, -48, 12, 24), 2);
  assert.equal(spinIndexFromDrag(2, 48, 12, 24), 0);
  assert.equal(spinIndexFromDrag(0, -18, 12, 24), 1, 'three quarters of a frame rounds up');
  assert.equal(spinIndexFromDrag(0, -6, 12, 24), 0, 'a quarter of a frame holds the frame');
});

test('drag sensitivity never drops below the safe floor', () => {
  // A tiny pixels-per-frame would let one stray pixel spin the whole model.
  assert.equal(spinIndexFromDrag(0, -8, 24, 1), 1, 'clamped up to 8px per frame');
  assert.equal(spinIndexFromDrag(0, -4, 24, 1), 0, 'exactly half a frame still holds, at the floor too');
  assert.equal(spinIndexFromDrag(0, -8, 24, 0), 0, 'zero is not a sensitivity, so the 24px default applies');
});

test('the wheel honours the stronger axis and ignores small jitter', () => {
  assert.equal(spinStepFromWheel(0, 40), 1);
  assert.equal(spinStepFromWheel(0, -40), -1);
  assert.equal(spinStepFromWheel(-40, 5), -1, 'horizontal wins when it is larger');
  assert.equal(spinStepFromWheel(3, 4), 0, 'below threshold is no movement');
});

test('the readout reports degrees for a body turn and frames for a head turn', () => {
  assert.equal(spinAngleLabel(0, 8), '0° through turn');
  assert.equal(spinAngleLabel(2, 8), '90° through turn');
  assert.equal(spinAngleLabel(2, 8, 'face'), 'head-turn frame 3');
});
