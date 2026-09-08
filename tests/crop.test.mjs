import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultCrop, clampCrop, zoomCrop, panCrop, straightenRad, straightenCover,
  snapToRatio, placementRect, adjustmentFrame, proofSurface
} from '../studio/js/crop.js';
import { SURFACE_BY_ID } from '../studio/js/model.js';

const hero = SURFACE_BY_ID['web-hero-desktop'];
const inside = crop => crop.x >= -1e-9 && crop.y >= -1e-9
  && crop.w > 0 && crop.h > 0
  && crop.x + crop.w <= 1 + 1e-9 && crop.y + crop.h <= 1 + 1e-9;

test('a default crop stays inside the source and matches the surface shape', () => {
  for (const [w, h] of [[4000, 3000], [1080, 1920], [1000, 1000], [6000, 1000], [1, 1]]) {
    const crop = defaultCrop(w, h, hero);
    assert.ok(inside(crop), `${w}x${h} produced ${JSON.stringify(crop)}`);
    const ratio = (w * crop.w) / (h * crop.h);
    assert.ok(Math.abs(ratio - hero.w / hero.h) < 0.02, `${w}x${h} ratio ${ratio}`);
  }
});

test('a crop is clamped back inside the frame however it is pushed', () => {
  for (const crop of [{ x: -1, y: -1, w: 3, h: 3 }, { x: 0.9, y: 0.9, w: 0.5, h: 0.5 },
                      { x: 0.5, y: 0.5, w: 0, h: 0 }]) {
    const clamped = clampCrop({ ...crop });
    assert.ok(inside(clamped), `${JSON.stringify(crop)} -> ${JSON.stringify(clamped)}`);
  }
});

test('a crop with a broken number is repaired, not passed to the renderer', () => {
  // A restored project or a degenerate drag can produce one of these, and a
  // NaN crop draws nothing at all.
  for (const crop of [{ x: NaN, y: 0.2, w: 0.4, h: 0.4 }, { x: 0.2, y: Infinity, w: 0.4, h: 0.4 },
                      { x: 0.2, y: 0.2, w: 'wide', h: 0.4 }, { x: null, y: null, w: null, h: null },
                      {}, undefined]) {
    const clamped = clampCrop(crop);
    for (const key of ['x', 'y', 'w', 'h']) assert.ok(Number.isFinite(clamped[key]), `${JSON.stringify(crop)} left ${key} unusable`);
    assert.ok(inside(clamped), `${JSON.stringify(crop)} -> ${JSON.stringify(clamped)}`);
  }
});

test('zooming in and back out returns to where it started', () => {
  const start = { x: 0.2, y: 0.2, w: 0.5, h: 0.5 };
  const round = zoomCrop(zoomCrop({ ...start }, 0.8), 1 / 0.8);
  for (const key of ['x', 'y', 'w', 'h']) assert.ok(Math.abs(round[key] - start[key]) < 1e-6, key);
});

test('zooming never escapes the frame or collapses the crop', () => {
  let crop = { x: 0.4, y: 0.4, w: 0.2, h: 0.2 };
  for (let i = 0; i < 30; i++) { crop = zoomCrop(crop, 1.4); assert.ok(inside(crop), `zoom out ${i}`); }
  for (let i = 0; i < 40; i++) { crop = zoomCrop(crop, 0.7); assert.ok(inside(crop) && crop.w > 0 && crop.h > 0, `zoom in ${i}`); }
});

test('panning stops at the edges instead of leaving the picture', () => {
  let crop = { x: 0.3, y: 0.3, w: 0.4, h: 0.4 };
  for (const [dx, dy] of [[-5, -5], [5, 5], [0, -5], [5, 0]]) {
    crop = panCrop({ x: 0.3, y: 0.3, w: 0.4, h: 0.4 }, dx, dy);
    assert.ok(inside(crop), `pan ${dx},${dy} -> ${JSON.stringify(crop)}`);
  }
});

test('straighten is bounded and symmetric', () => {
  assert.equal(straightenRad(0), 0);
  assert.ok(Math.abs(straightenRad(15)) > 0);
  assert.equal(straightenRad(-15), -straightenRad(15));
  for (const value of [1e6, -1e6, NaN, null, undefined, 'x']) {
    const rad = straightenRad(value);
    assert.ok(Number.isFinite(rad), `${value} produced ${rad}`);
    assert.ok(Math.abs(rad) <= Math.PI, `${value} exceeded a half turn`);
  }
});

test('a straightened frame is covered, never showing a corner of nothing', () => {
  for (const deg of [0, 1, 5, 15, -15]) {
    const cover = straightenCover(straightenRad(deg), 1000, 800);
    assert.ok(cover >= 1 - 1e-9, `${deg}° gave cover ${cover}`);
  }
  assert.equal(straightenCover(0, 1000, 800), 1, 'no rotation needs no extra cover');
});

test('snapping to a surface keeps the crop inside and on ratio', () => {
  for (const id of ['web-hero-desktop', 'ig-feed-portrait', 'meta-story', 'gd-mpu']) {
    const surface = SURFACE_BY_ID[id];
    const snapped = snapToRatio({ x: 0.1, y: 0.1, w: 0.9, h: 0.2 }, 4000, 3000, surface);
    assert.ok(inside(snapped), `${id} -> ${JSON.stringify(snapped)}`);
    const ratio = (4000 * snapped.w) / (3000 * snapped.h);
    assert.ok(Math.abs(ratio - surface.w / surface.h) < 0.02, `${id} ratio ${ratio}`);
  }
});

test('a placement rectangle fits the surface for both fills', () => {
  for (const fill of ['crop', 'contain']) {
    const rect = placementRect(4000, 3000, { x: 0, y: 0, w: 1, h: 1 }, hero, fill);
    assert.ok(rect.w > 0 && rect.h > 0, fill);
    if (fill === 'contain') {
      assert.ok(rect.w <= hero.w + 1 && rect.h <= hero.h + 1, 'contain must fit inside the frame');
    } else {
      assert.ok(rect.w >= hero.w - 1 || rect.h >= hero.h - 1, 'crop must cover the frame');
    }
  }
});

test('the adjustment frame maps source points to the canvas and back again', () => {
  // Spot heal and the selective brush both anchor edits through this mapping;
  // if it does not round-trip, a click lands somewhere other than the blemish.
  const crop = { x: 0.1, y: 0.2, w: 0.6, h: 0.5 };
  const rect = placementRect(4000, 3000, crop, hero, 'crop');
  for (const rotate of [0, 5, -5, 15]) {
    const frame = adjustmentFrame(crop, rect, rotate);
    for (const [nx, ny] of [[0.1, 0.2], [0.4, 0.5], [0.69, 0.69]]) {
      const [x, y] = frame.point(nx, ny);
      assert.ok(Number.isFinite(x) && Number.isFinite(y), `rotate ${rotate} produced no point`);
      const [bx, by] = frame.unpoint(x, y);
      assert.ok(Math.abs(bx - nx) < 1e-6 && Math.abs(by - ny) < 1e-6,
        `rotate ${rotate}: ${nx},${ny} came back as ${bx},${by}`);
    }
    assert.ok(frame.radius(0.05) > 0, `rotate ${rotate} radius`);
    assert.equal(frame.radius('x'), 0, 'an unusable radius is zero, not NaN');
  }
});

test('a proof surface is capped and keeps the delivery shape', () => {
  for (const id of ['web-hero-desktop', 'ig-feed-portrait', 'meta-story']) {
    const surface = SURFACE_BY_ID[id];
    const proof = proofSurface(surface, 960);
    assert.ok(Math.max(proof.w, proof.h) <= 960, `${id} exceeded the proof cap`);
    assert.ok(Math.abs((proof.w / proof.h) - (surface.w / surface.h)) < 0.02, `${id} changed shape`);
  }
  const small = proofSurface({ w: 400, h: 300 }, 960);
  assert.ok(Math.max(small.w, small.h) <= 960, 'a small surface is never enlarged past the cap');
});
