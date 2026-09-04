// The window maths the board's scroll depends on, run against the module the
// board loads.
//
// Every one of these was reproduced in Chromium first - 2000 cards on the real
// stylesheet, the windowed board screenshotted against the whole board at four
// scroll offsets - and is re-derived here so that breaking one fails a test
// rather than a customer. The two properties everything else serves are that
// the spacers plus the rendered rows always add up to the full height, and
// that the rendered rows always cover the viewport: the first is a scroll bar
// that measures the whole shoot, the second is never a blank band on screen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { planWindow, rowOffsets, rowAt, trackCount, createVirtualList } from '../studio/js/virtual-list.js';

/**
 * A DOM small enough to read and real enough to lay a grid out in: rows of
 * `columns` cards, each row as tall as its tallest card, one `gap` between
 * them, sitting `head` below the top of the scroller the way the board's own
 * padding does.
 */
function stubDom({ columns = 3, gap = 1, head = 24, viewport = 300, width = 600, heightOf = () => 100 } = {}) {
  const frames = [];
  const resizers = [];
  let tracks = columns;

  class El {
    constructor(tag) {
      this.tagName = tag;
      this.children = [];
      this.style = {};
      this.attributes = {};
      this.className = '';
      this.parentNode = null;
      this.clientTop = 0;
      this.top = 0;
      this.height = 0;
      this.wanted = 0;
      this.handlers = new Map();
      this.ownerDocument = doc;
    }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name]; }
    addEventListener(type, fn) { this.handlers.set(type, [...(this.handlers.get(type) || []), fn]); }
    removeEventListener(type, fn) { this.handlers.set(type, (this.handlers.get(type) || []).filter(one => one !== fn)); }
    dispatch(type) { for (const fn of [...(this.handlers.get(type) || [])]) fn({ type }); }
    replaceChildren(...kids) {
      for (const kid of this.children) kid.parentNode = null;
      this.children = kids;
      for (const kid of kids) kid.parentNode = this;
      layout();
    }
    remove() {
      if (!this.parentNode) return;
      this.parentNode.children = this.parentNode.children.filter(kid => kid !== this);
      this.parentNode = null;
    }
    getBoundingClientRect() { return { top: this.top, height: this.height }; }
  }

  const doc = {
    createElement: tag => new El(tag),
    get defaultView() { return view; }
  };
  const view = {
    getComputedStyle: () => ({
      gridTemplateColumns: Array.from({ length: tracks }, () => '100px').join(' '),
      rowGap: `${gap}px`, paddingTop: '0px'
    }),
    requestAnimationFrame(fn) { frames.push(fn); return frames.length; },
    cancelAnimationFrame(id) { frames[id - 1] = null; },
    ResizeObserver: class {
      constructor(callback) { resizers.push(callback); }
      observe() {}
      disconnect() { resizers.splice(resizers.indexOf(this.callback), 1); }
    },
    addEventListener() {},
    removeEventListener() {}
  };

  const scroller = new El('div');
  scroller.clientHeight = viewport;
  scroller.clientWidth = width;
  scroller.scrollTop = 0;

  /** Stack the host's children into rows the way a grid would. */
  function layout() {
    const host = scroller.children[0];
    if (!host) return;
    let y = 0;
    let row = [];
    const closeRow = () => {
      if (!row.length) return;
      const height = Math.max(...row.map(node => node.wanted));
      for (const node of row) { node.height = height; node.top = head + y - scroller.scrollTop; }
      y += height + gap;
      row = [];
    };
    for (const kid of host.children) {
      if (kid.className === 'vpad') {
        closeRow();
        kid.height = parseFloat(kid.style.height) || 0;
        kid.top = head + y - scroller.scrollTop;
        y += kid.height + gap;
      } else {
        row.push(kid);
        if (row.length === tracks) closeRow();
      }
    }
    closeRow();
    host.top = head - scroller.scrollTop;
    host.height = Math.max(0, y - gap);
  }

  const flush = () => {
    const queued = frames.splice(0, frames.length);
    for (const fn of queued) fn?.();
  };

  return {
    scroller, doc, head, gap, flush,
    /** A card that knows how tall it wants to be, at whatever width it is at.
     *  Live rather than fixed, because a card kept across a resize is re-laid
     *  out by the browser rather than remembering its old height. */
    card(index) {
      const node = doc.createElement('div');
      node.className = 'card';
      node.index = index;
      Object.defineProperty(node, 'wanted', { get: () => heightOf(index, tracks) });
      return node;
    },
    scrollTo(top) {
      scroller.scrollTop = top;
      layout();
      scroller.dispatch('scroll');
      flush();
      layout();
    },
    /** A wheel, which moves by a delta and keeps whatever the list corrected. */
    scrollBy(delta) {
      scroller.scrollTop = Math.max(0, scroller.scrollTop + delta);
      layout();
      scroller.dispatch('scroll');
      flush();
      layout();
    },
    /** The card the viewport's top edge falls on, the way a customer sees it. */
    topCard: () => (scroller.children[0]?.children ?? [])
      .find(kid => kid.className === 'card' && kid.top <= 0 && kid.top + kid.height > 0),
    /** Rebuild the page at a new width, the way turning a phone does. */
    setColumns(next) {
      tracks = next;
      scroller.clientWidth = next * 100;
      layout();
      for (const callback of resizers) callback();
      flush();
    },
    cards: () => (scroller.children[0]?.children ?? []).filter(kid => kid.className === 'card'),
    pads: () => (scroller.children[0]?.children ?? []).filter(kid => kid.className === 'vpad'),
    layout
  };
}

/** What a grid actually does with a plan: the spacers and the rows it holds. */
const flowHeight = (plan, rowsHeight, gap) =>
  (plan.lead ? plan.lead + gap : 0) + rowsHeight + (plan.trail ? gap + plan.trail : 0);

// ── the maths ──────────────────────────────────────────────────────────────

test('a window is a window: the whole list is never rendered at once', () => {
  const plan = planWindow({ count: 2000, columns: 6, rowHeight: 300, gap: 1, viewport: 1000, scrollTop: 40000, overscan: 2 });
  assert.equal(plan.rows, 334);
  assert.ok(plan.end - plan.start <= 60, `rendered ${plan.end - plan.start} of 2000`);
  assert.ok(plan.start > 0, 'a window 40000px down cannot start at the first asset');
});

test('the spacers and the rendered rows add up to the full height, at every offset', () => {
  // This is the scroll bar. If the three parts do not add up, the board is
  // either taller or shorter than the shoot it is showing.
  const rowHeight = 100, gap = 1, columns = 4, count = 100;
  const height = 25 * (rowHeight + gap) - gap;
  for (let scrollTop = 0; scrollTop <= height; scrollTop += 37) {
    const plan = planWindow({ count, columns, rowHeight, gap, viewport: 300, scrollTop, head: 24, overscan: 1 });
    const rows = plan.lastRow - plan.firstRow;
    assert.equal(flowHeight(plan, rows * (rowHeight + gap) - gap, gap), plan.height, `at ${scrollTop}`);
    assert.equal(plan.height, height);
  }
});

test('the rendered rows always cover the viewport', () => {
  // The other half of the bargain: a window that adds up but sits in the wrong
  // place is a blank band under the customer's cursor.
  const rowHeight = 100, gap = 1, columns = 4, count = 100, viewport = 300, head = 24;
  const pitch = rowHeight + gap;
  for (let scrollTop = 0; scrollTop <= 2600; scrollTop += 13) {
    const plan = planWindow({ count, columns, rowHeight, gap, viewport, scrollTop, head, overscan: 0 });
    const top = Math.min(Math.max(0, scrollTop - head), plan.height - viewport);
    assert.ok(plan.firstRow * pitch <= top, `window starts below the fold at ${scrollTop}`);
    // The rendered rows run to `lastRow * pitch`: the last row plus the gap
    // after it, which is where the first row nobody rendered begins.
    assert.ok(plan.lastRow * pitch >= Math.min(top + viewport, plan.height),
      `window ends above the fold at ${scrollTop}`);
  }
});

test('the first window has no lead and the last has no trail', () => {
  const top = planWindow({ count: 100, columns: 4, rowHeight: 100, gap: 1, viewport: 300, scrollTop: 0 });
  assert.equal(top.lead, 0);
  assert.equal(top.start, 0);
  assert.ok(top.trail > 0, 'there is more list below, so it has to be held open');

  const end = planWindow({ count: 100, columns: 4, rowHeight: 100, gap: 1, viewport: 300, scrollTop: 99999 });
  assert.equal(end.trail, 0);
  assert.equal(end.end, 100, 'the last asset must be rendered when the scroll is at the end');
  assert.ok(end.lead > 0);
});

test('a spacer stands in for its rows less the gap the grid puts back', () => {
  // A spacer is a cell in the grid, so the grid adds a gap beside it. Counting
  // that gap twice walks the board a pixel per row out of true - 334 pixels
  // over a real shoot.
  const plan = planWindow({ count: 100, columns: 4, rowHeight: 100, gap: 1, viewport: 300, scrollTop: 1010, overscan: 0 });
  assert.equal(plan.firstRow, 10);
  assert.equal(plan.lead, 10 * 101 - 1);
  assert.equal(plan.lead + 1, plan.firstRow * 101, 'the first rendered row must start exactly where its row starts');
});

test('an empty list plans nothing, divides by nothing, and builds nothing', () => {
  const plan = planWindow({ count: 0, columns: 6, rowHeight: 300, gap: 1, viewport: 900, scrollTop: 400 });
  assert.deepEqual({ ...plan, columns: 6 },
    { rows: 0, columns: 6, start: 0, end: 0, firstRow: 0, lastRow: 0, lead: 0, trail: 0, height: 0 });
  for (const value of Object.values(plan)) assert.ok(Number.isFinite(value), `${value} is not a number`);

  // Zero rows is one less than the first row, and a window planned from that
  // asks for items with negative indices. The callback is the thing that would
  // be handed them, so it is the thing that has to be watched.
  const dom = stubDom({ columns: 3, viewport: 300 });
  const asked = [];
  const list = createVirtualList(dom.scroller, {
    count: 0, renderItem: index => { asked.push(index); return dom.card(index); }
  });
  assert.deepEqual(asked, [], 'an empty list built cards');
  assert.equal(list.range().height, 0);
  dom.scrollTo(4000);
  assert.deepEqual(asked, [], 'an empty list built cards once it was scrolled');
  list.destroy();
});

test('a list nothing has measured yet renders rather than showing nothing', () => {
  // A board in a closed panel measures as zero. Rendering the lot is slow;
  // rendering nothing is a board that never comes back, because the first
  // measurement has to come off a card that was rendered.
  const plan = planWindow({ count: 40, columns: 4, rowHeight: 0, gap: 0, viewport: 0, scrollTop: 0 });
  assert.equal(plan.start, 0);
  assert.equal(plan.end, 40);
});

test('a filter that shortens the list still lands on screen', () => {
  // The scroll is still 40000px down for one frame after the count drops to
  // three. Planning against where the browser is about to clamp it means the
  // customer never sees the blank frame in between.
  const plan = planWindow({ count: 3, columns: 4, rowHeight: 100, gap: 1, viewport: 300, scrollTop: 40000, head: 24 });
  assert.equal(plan.rows, 1);
  assert.equal(plan.start, 0);
  assert.equal(plan.end, 3);
  assert.equal(plan.lead, 0);
  assert.equal(plan.trail, 0);
});

test('a scroll left beyond the end plans where the browser is about to put it', () => {
  // Filtering 2000 assets down to 600 leaves the scroll 90000px down for one
  // frame. Planning at 90000 puts the window past the end of a list that is
  // now 15149px tall, and the customer gets that frame as a blank board.
  const plan = planWindow({ count: 600, columns: 4, rowHeight: 100, gap: 1, viewport: 300, scrollTop: 90000, head: 24, overscan: 0 });
  assert.equal(plan.rows, 150);
  assert.equal(plan.lastRow, plan.rows, 'the end of the list has to be what is rendered');
  assert.equal(plan.trail, 0);
  assert.ok(plan.lead <= plan.height - 300, `the window starts at ${plan.lead} in a list ${plan.height} tall`);
});

test('a count that grows extends the scroll rather than the window', () => {
  const before = planWindow({ count: 100, columns: 4, rowHeight: 100, gap: 1, viewport: 300, scrollTop: 500, overscan: 1 });
  const after = planWindow({ count: 4000, columns: 4, rowHeight: 100, gap: 1, viewport: 300, scrollTop: 500, overscan: 1 });
  assert.equal(after.start, before.start, 'the same scroll offset shows the same assets');
  assert.equal(after.end, before.end);
  assert.ok(after.height > before.height * 39, 'the scroll has to grow with the list');
  assert.ok(after.trail > before.trail);
});

test('an offsets table for the wrong count is ignored rather than read', () => {
  // A table left over from the count before last would place rows against
  // heights that belong to other assets.
  const stale = rowOffsets([], { rows: 9, gap: 1, estimate: 100 });
  const plan = planWindow({ count: 100, columns: 4, offsets: stale, rowHeight: 100, gap: 1, viewport: 300, scrollTop: 0 });
  assert.equal(plan.rows, 25);
  assert.equal(plan.height, 25 * 101 - 1);
});

// ── the row table ──────────────────────────────────────────────────────────

test('rows nobody has scrolled to stand at the estimate, and measured rows at their height', () => {
  const offsets = rowOffsets([100, 0, 200], { rows: 3, gap: 1, estimate: 50 });
  assert.deepEqual([...offsets], [0, 101, 152, 353]);
  assert.equal(offsets[3] - 1, 100 + 1 + 50 + 1 + 200, 'the total is the rows and the gaps between them');
});

test('the row under a scroll offset is found on the boundary, not near it', () => {
  const offsets = rowOffsets([100, 50, 200], { rows: 3, gap: 1 });   // 0, 101, 152, 353
  assert.equal(rowAt(offsets, 0), 0);
  assert.equal(rowAt(offsets, 100.9), 0);
  assert.equal(rowAt(offsets, 101), 1, 'a row starts at its own offset');
  assert.equal(rowAt(offsets, 151), 1);
  assert.equal(rowAt(offsets, 152), 2);
  assert.equal(rowAt(offsets, 99999), 2, 'past the end is the last row, not off the end of the table');
});

test('a measured table plans the same window a uniform one does', () => {
  const heights = Array.from({ length: 25 }, () => 100);
  const offsets = rowOffsets(heights, { rows: 25, gap: 1 });
  for (const scrollTop of [0, 300, 1010, 2000, 9999]) {
    const table = planWindow({ count: 100, columns: 4, offsets, gap: 1, viewport: 300, scrollTop, overscan: 1 });
    const uniform = planWindow({ count: 100, columns: 4, rowHeight: 100, gap: 1, viewport: 300, scrollTop, overscan: 1 });
    assert.deepEqual(table, uniform, `at ${scrollTop}`);
  }
});

test('rows of different heights still add up, and still cover the viewport', () => {
  // The board's own case: a card whose metadata wraps to a second line makes
  // its whole row 14px taller than its neighbours.
  const heights = Array.from({ length: 25 }, (_, r) => (r % 3 === 0 ? 116 : 100));
  const offsets = rowOffsets(heights, { rows: 25, gap: 1 });
  const height = heights.reduce((sum, h) => sum + h, 0) + 24;
  for (let scrollTop = 0; scrollTop <= height; scrollTop += 29) {
    const plan = planWindow({ count: 100, columns: 4, offsets, gap: 1, viewport: 300, scrollTop, overscan: 0 });
    assert.equal(plan.height, height, 'the total is the sum of the rows it has');
    const rendered = heights.slice(plan.firstRow, plan.lastRow).reduce((sum, h) => sum + h, 0)
      + (plan.lastRow - plan.firstRow - 1);
    assert.equal(flowHeight(plan, rendered, 1), plan.height, `at ${scrollTop}`);
    const top = Math.min(scrollTop, plan.height - 300);
    assert.ok(offsets[plan.firstRow] <= top, `window starts below the fold at ${scrollTop}`);
    assert.ok(offsets[plan.lastRow] >= Math.min(top + 300, plan.height), `window ends above the fold at ${scrollTop}`);
  }
});

test('a grid nobody has laid out yet is not counted as one column', () => {
  assert.equal(trackCount('230.5px 230.5px 230.5px'), 3);
  assert.equal(trackCount('100px'), 1);
  assert.equal(trackCount('repeat(auto-fill, minmax(230px, 1fr))'), 0, 'the authored value is not a track list');
  assert.equal(trackCount('none'), 0);
  assert.equal(trackCount(''), 0);
  assert.equal(trackCount(undefined), 0);
});

// ── the list itself ────────────────────────────────────────────────────────

const listOf = (dom, count, build) => createVirtualList(dom.scroller, {
  count, renderItem: index => (build ? build(index) : dom.card(index))
});

test('only the window reaches the DOM', () => {
  const dom = stubDom({ columns: 3, viewport: 300, heightOf: () => 100 });
  const list = listOf(dom, 3000);
  const cards = dom.cards();
  assert.ok(cards.length >= 9, `only ${cards.length} cards for a 300px viewport`);
  assert.ok(cards.length <= 45, `${cards.length} cards is not a window`);
  assert.equal(list.range().rows, 1000);
  assert.equal(list.range().height, 1000 * 101 - 1);
  // Measuring changes the estimate, which changes how many rows fit, which
  // renders rows the first pass never planned for. Those are rows on screen,
  // so they have to be measured too.
  assert.equal(list.metrics().measured, list.range().lastRow - list.range().firstRow,
    'a row was rendered and never measured');
  list.destroy();
});

test('the spacers hold the scroll open and say nothing to a screen reader', () => {
  const dom = stubDom({ columns: 3, viewport: 300 });
  const list = listOf(dom, 3000);
  dom.scrollTo(20000);
  const pads = dom.pads();
  assert.equal(pads.length, 2, 'a window in the middle of a list needs both spacers');
  for (const pad of pads) {
    assert.equal(pad.getAttribute('aria-hidden'), 'true');
    assert.equal(pad.style.gridColumn, '1 / -1', 'a spacer that does not span the row is one empty card');
  }
  const plan = list.range();
  assert.equal(parseFloat(pads[0].style.height), plan.lead);
  assert.equal(parseFloat(pads[1].style.height), plan.trail);
  list.destroy();
});

test('a list that fits has no spacers at all', () => {
  const dom = stubDom({ columns: 3, viewport: 300 });
  const list = listOf(dom, 6);
  assert.equal(dom.pads().length, 0);
  assert.equal(dom.cards().length, 6);
  list.destroy();
});

test('scrolling moves the window and keeps the cards it already had', () => {
  // Rebuilding every card on every scroll frame is what makes a windowed list
  // flicker: a thumbnail that was decoded goes back to an empty frame.
  const dom = stubDom({ columns: 3, viewport: 300 });
  const list = listOf(dom, 3000);
  dom.scrollTo(1000);
  const before = new Map(dom.cards().map(card => [card.index, card]));
  const wasStart = list.range().start;
  dom.scrollTo(1101);
  const after = new Map(dom.cards().map(card => [card.index, card]));
  assert.notEqual(list.range().start, wasStart, 'the window did not move');
  const shared = [...after.keys()].filter(index => before.has(index));
  assert.ok(shared.length > 3, 'the two windows barely overlap; nothing to prove');
  for (const index of shared) assert.equal(after.get(index), before.get(index), `card ${index} was rebuilt`);
  list.destroy();
});

test('the count changing re-plans the list and rebuilds its cards', () => {
  // After a filter, index 4 is a different asset. A cached node there would be
  // the previous shoot's card under the new one's place in the list.
  const dom = stubDom({ columns: 3, viewport: 300 });
  let generation = 0;
  const list = createVirtualList(dom.scroller, {
    count: 900,
    renderItem: index => {
      const card = dom.card(index);
      card.generation = generation;
      return card;
    }
  });
  assert.equal(list.range().rows, 300);
  const first = dom.cards()[0];
  generation = 1;
  list.update({ count: 12 });
  assert.equal(list.range().rows, 4);
  assert.equal(list.range().end, 12);
  assert.equal(dom.cards().length, 12);
  assert.notEqual(dom.cards()[0], first, 'the card at index 0 was carried over from the old list');
  assert.equal(dom.cards()[0].generation, 1);
  list.destroy();
});

test('a list that empties empties, and comes back', () => {
  const dom = stubDom({ columns: 3, viewport: 300 });
  const list = listOf(dom, 900);
  list.update({ count: 0 });
  assert.equal(dom.cards().length, 0);
  assert.equal(dom.pads().length, 0);
  assert.equal(list.range().height, 0);
  assert.equal(list.range().rows, 0);
  list.update({ count: 900 });
  assert.ok(dom.cards().length > 0, 'the list never came back');
  assert.equal(list.range().rows, 300);
  list.destroy();
});

test('the total converges on the real height as the rows are measured', () => {
  // Rows are measured as they come into view, so a board nobody has scrolled
  // is an estimate. What it must not be is an estimate for ever.
  // The rows at the top are not a fair sample of the rows below them, so the
  // opening guess cannot be right by luck.
  const heightOf = index => (Math.floor(index / 3) >= 30 ? 200 : 100);
  const dom = stubDom({ columns: 3, viewport: 300, heightOf });
  const list = listOf(dom, 300);
  const rows = 100;
  const truth = Array.from({ length: rows }, (_, r) => heightOf(r * 3)).reduce((sum, h) => sum + h, 0) + (rows - 1);
  const guessed = list.range().height;
  assert.notEqual(guessed, truth, 'nothing had been measured; this test proves nothing');
  for (let at = 0; at < truth; at += 250) dom.scrollTo(at);
  assert.equal(Math.round(list.range().height), truth, 'the scroll bar never became honest');
  assert.equal(list.metrics().measured, rows, 'every row that has been on screen should have been measured');
  list.destroy();
});

test('a row measured for the first time does not shove the page under the thumb', () => {
  // Scrolling up, the rows arriving above the fold are the ones nobody has
  // measured. Each one that turns out to be taller than the estimate moves
  // every row below it - including everything on screen - unless the same
  // amount comes out of the scroll offset. A wheel is a delta, so the
  // correction survives the next notch rather than being overwritten by it.
  const heightOf = index => (Math.floor(index / 3) % 2 === 0 ? 260 : 100);
  const dom = stubDom({ columns: 3, viewport: 300, heightOf });
  const list = listOf(dom, 300);
  dom.scrollTo(15000);
  let last = dom.topCard()?.index;
  assert.ok(last != null, 'nothing is on screen to watch');
  const walk = [];
  for (let step = 0; step < 40; step++) {
    dom.scrollBy(-150);
    const top = dom.topCard()?.index;
    assert.ok(top != null, 'the viewport went blank while scrolling up');
    walk.push(top);
    // Half a viewport up is at most a row up, three cards, and never a step
    // back down the list.
    assert.ok(top <= last, `the board jumped forwards from ${last} to ${top} while scrolling up`);
    assert.ok(last - top <= 6, `the board lurched ${last - top} cards on one notch of the wheel`);
    last = top;
  }
  assert.ok(walk.at(-1) < walk[0], 'the wheel did not move the board');
  list.destroy();
});

test('a narrower window is a different number of columns and a different height', () => {
  // A narrower card is a taller card, so every row measured at the old width
  // is a wrong answer at the new one - three times over, here.
  const dom = stubDom({ columns: 6, viewport: 300, heightOf: (index, columns) => (columns >= 6 ? 100 : 300) });
  const list = listOf(dom, 600);
  assert.equal(list.metrics().columns, 6);
  assert.equal(list.range().rows, 100);
  assert.equal(list.range().height, 100 * 101 - 1);

  // Scrolled first, so that every row has been measured at the old width and
  // most of them are nowhere near the window when the width changes.
  for (let at = 0; at < list.range().height; at += 250) dom.scrollTo(at);
  assert.equal(list.metrics().measured, 100);
  dom.scrollTo(0);

  dom.setColumns(2);
  assert.equal(list.metrics().columns, 2);
  assert.equal(list.range().rows, 300);
  assert.equal(list.range().height, 300 * 301 - 1, 'the board is still measured at the width it used to be');

  dom.setColumns(6);
  assert.equal(list.metrics().columns, 6);
  assert.equal(list.range().height, 100 * 101 - 1, 'the board did not come back to where it was');
  list.destroy();
});

test('scrollToIndex moves only as far as it takes to see the asset', () => {
  const dom = stubDom({ columns: 3, viewport: 300 });
  const list = listOf(dom, 900);
  // Row 50 starts 5050 into the grid, 24 of board padding above that. It is
  // below the fold, so it comes to the bottom edge of the viewport - not to
  // the top, which would move the board four times as far as it had to.
  list.scrollToIndex(150);
  assert.equal(dom.scroller.scrollTop, 24 + 50 * 101 + 100 - 300);
  const parked = dom.scroller.scrollTop;
  list.scrollToIndex(151);                       // same row; already on screen
  assert.equal(dom.scroller.scrollTop, parked, 'an asset already in view must not move the board');
  list.scrollToIndex(0);                         // above the fold: to the top edge
  assert.equal(dom.scroller.scrollTop, 24);
  list.destroy();
});

test('a destroyed list lets go of the scroller', () => {
  const dom = stubDom({ columns: 3, viewport: 300 });
  const list = listOf(dom, 900);
  const host = list.element;
  list.destroy();
  assert.equal(host.children.length, 0);
  assert.equal(host.parentNode, null, 'the host is still in the board it was destroyed out of');
  dom.scrollTo(4000);                            // must not throw, must not rebuild
  assert.equal(host.children.length, 0);
});

test('a stated item height is taken at its word', () => {
  // The measuring is for callers who cannot know. One who can should not pay
  // for a layout read per row.
  const dom = stubDom({ columns: 3, viewport: 300, heightOf: () => 250 });
  const list = createVirtualList(dom.scroller, { count: 300, itemHeight: 100, renderItem: index => dom.card(index) });
  assert.equal(list.range().height, 100 * 101 - 1);
  dom.scrollTo(2000);
  assert.equal(list.range().height, 100 * 101 - 1, 'a stated height must not be quietly re-measured');
  assert.equal(list.metrics().measured, 0);
  list.destroy();
});

test('a filter drops the row heights measured for the rows it replaced', () => {
  // After a filter, row 4 holds different assets than the row measured there,
  // so a height kept across the change describes a card no longer in that row.
  // The spacers are built from those heights, so the scrollbar ends up
  // measuring a list that is not on screen - the one property windowing has to
  // keep. `metrics().measured` counts the rows carrying a measurement.
  const dom = stubDom({ columns: 3, viewport: 300, heightOf: () => 100 });
  const list = listOf(dom, 300);
  list.refresh();
  assert.ok(list.metrics().measured > 0, 'nothing was measured to begin with');

  list.update({ count: 9 });
  assert.equal(list.metrics().measured, list.range().lastRow - list.range().firstRow,
    'measurements from the old list survived the filter');
  list.destroy();

  // The same number of rows holding shorter cards: the list has to re-measure
  // rather than keep the height the taller cards produced.
  //
  // This does NOT discriminate the `heights.length = 0` in `update()`. That
  // reset survives every mutation I could construct - including this one -
  // because `refresh()` re-measures each visible row and overwrites what was
  // there. It is defensive rather than load-bearing, and I could not prove
  // otherwise; the two resets that ARE load-bearing (a column change, and
  // destroy) are pinned above and below.
  let tall = true;
  const swap = stubDom({ columns: 3, viewport: 300, heightOf: () => (tall ? 300 : 100) });
  const swapping = createVirtualList(swap.scroller, {
    count: 300, renderItem: index => swap.card(index)
  });
  swapping.refresh();
  const before = swapping.metrics().height;
  tall = false;
  swapping.update({ count: 300 });
  const after = swapping.metrics().height;
  assert.ok(after < before,
    `the list still measures ${after}px after its cards became a third as tall`);
  swapping.destroy();
});

test('a destroyed list keeps no measurements', () => {
  // The heights live in a closure. A list that is thrown away without
  // clearing them holds every card it ever measured.
  const dom = stubDom({ columns: 3, viewport: 300, heightOf: () => 100 });
  const list = listOf(dom, 300);
  list.refresh();
  assert.ok(list.metrics().measured > 0);
  list.destroy();
  assert.equal(list.metrics().measured, 0, 'measured rows outlived the list');
  assert.equal(dom.cards().length, 0, 'the cards outlived the list');
});
