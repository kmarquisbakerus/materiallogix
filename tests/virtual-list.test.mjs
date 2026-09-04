import test from 'node:test';
import assert from 'node:assert/strict';
import { planWindow, trackCount } from '../studio/js/virtual-list.js';

/**
 * The library renders every asset on every state change: 652ms at 200 assets,
 * and 240ms for one character typed into the filter. These are the window
 * maths that stop it — run, not grepped.
 */

test('an empty list renders nothing and claims no height', () => {
  const plan = planWindow({ count: 0, columns: 4, rowHeight: 200, gap: 12, viewport: 800 });
  assert.equal(plan.start, 0);
  assert.equal(plan.end, 0);
  assert.equal(plan.height, 0);
  assert.equal(plan.lead, 0);
  assert.equal(plan.trail, 0);
});

test('the window covers the viewport and only a little more', () => {
  // 200 assets, 4 across, 200px rows with a 12px gap, in an 800px viewport.
  const plan = planWindow({ count: 200, columns: 4, rowHeight: 200, gap: 12, viewport: 800, scrollTop: 0 });
  assert.equal(plan.rows, 50);
  assert.equal(plan.start, 0, 'at the top the window starts at the first item');
  // 800px of viewport is ~4 rows, plus 2 rows of overscan.
  assert.ok(plan.end >= 4 * 4 && plan.end <= 8 * 4, `rendered ${plan.end} of 200`);
  assert.ok(plan.end < 200, 'the whole list is still being rendered');

  // Overscan is what stops a fling showing empty ground, so it has to be real:
  // the same scroll with two rows of overscan must render two rows more.
  const shape = { count: 200, columns: 4, rowHeight: 200, gap: 12, viewport: 800, scrollTop: 4000 };
  const none = planWindow({ ...shape, overscan: 0 });
  const two = planWindow({ ...shape, overscan: 2 });
  assert.equal(two.firstRow, none.firstRow - 2, 'the window does not lead the scroll');
  assert.equal(two.lastRow, none.lastRow + 2, 'the window does not trail the scroll');
  assert.equal(two.end - two.start, (none.end - none.start) + 4 * 4,
    'overscan renders no extra rows');
});

test('scrolling moves the window and the spacers keep the height honest', () => {
  const shape = { count: 200, columns: 4, rowHeight: 200, gap: 12, viewport: 800 };
  const top = planWindow({ ...shape, scrollTop: 0 });
  const mid = planWindow({ ...shape, scrollTop: 4000 });
  const end = planWindow({ ...shape, scrollTop: 1e6 });
  assert.ok(mid.start > top.start, 'the window did not move');
  assert.equal(top.height, mid.height, 'the scrollbar changed length while scrolling');
  assert.equal(mid.height, end.height);
  // lead + rendered rows + trail must account for the full height, so the
  // scrollbar matches the list it is scrolling.
  for (const plan of [top, mid, end]) {
    const rendered = (plan.lastRow - plan.firstRow) * (plan.rowHeight ?? 212);
    assert.ok(plan.lead >= 0 && plan.trail >= 0, 'a spacer went negative');
    assert.ok(plan.lead + rendered + plan.trail >= plan.height - 24,
      'the spacers do not add up to the list height');
  }
  assert.equal(end.end, 200, 'the last item is reachable');
  assert.equal(end.trail, 0, 'there is nothing below the last row');
});

test('a scroll left beyond a shortened list still plans a visible window', () => {
  // Typing into the filter shortens the list while the scroll is still where
  // the long list left it. Planning against a stale scroll is a blank board.
  const stale = planWindow({ count: 200, columns: 4, rowHeight: 200, gap: 12, viewport: 800, scrollTop: 1e6 });
  const settled = planWindow({ count: 200, columns: 4, rowHeight: 200, gap: 12, viewport: 800,
    scrollTop: 50 * 212 - 12 - 800 });
  // Planning against where the scroll will land, not where it is, means the
  // frame before the browser clamps shows the end of the list rather than a
  // single row of it.
  assert.equal(stale.firstRow, settled.firstRow, 'a stale scroll plans a different window');
  assert.equal(stale.end, settled.end);
  assert.ok(stale.lastRow - stale.firstRow >= 4,
    `only ${stale.lastRow - stale.firstRow} rows planned at the end of the list`);

  const short = planWindow({ count: 8, columns: 4, rowHeight: 200, gap: 12, viewport: 800, scrollTop: 40000 });
  assert.ok(short.end > short.start, 'nothing would be rendered');
  assert.equal(short.end, 8);
  assert.equal(short.trail, 0);
});

test('an unmeasured board renders everything rather than nothing', () => {
  // A board inside a closed panel reports a zero-height card, and the first
  // measurement has to come off a rendered card. Rendering nothing never
  // recovers.
  const plan = planWindow({ count: 60, columns: 3, rowHeight: 0, gap: 0, viewport: 0 });
  assert.equal(plan.start, 0);
  assert.equal(plan.end, 60);
});

test('the window survives nonsense instead of producing NaN', () => {
  for (const bad of [
    { count: -5, columns: 0, rowHeight: -10, gap: -4, viewport: -100, scrollTop: -50 },
    { count: 'x', columns: null, rowHeight: undefined, gap: NaN, viewport: Infinity },
    {}
  ]) {
    const plan = planWindow(bad);
    for (const [key, value] of Object.entries(plan)) {
      assert.ok(Number.isFinite(value), `${key} came back ${value}`);
      assert.ok(value >= 0, `${key} is negative`);
    }
    assert.ok(plan.end >= plan.start);
  }
});

test('the column count is read from a laid-out grid, not an authored one', () => {
  assert.equal(trackCount('240px 240px 240px'), 3);
  assert.equal(trackCount('100px'), 1);
  // Before layout the browser answers with what was authored; counting those
  // words would give a column count that is not on screen.
  assert.equal(trackCount('repeat(auto-fill, minmax(240px, 1fr))'), 0);
  assert.equal(trackCount('none'), 0);
  assert.equal(trackCount(''), 0);
  assert.equal(trackCount(null), 0);
});
