// Windowing for lists long enough that building them is what costs the time.
//
// The board draws one card per asset, and a real shoot is hundreds of them.
// Every filter keystroke rebuilt the whole grid. Measured in Chromium against
// the board's own card, 2000 assets opened in 513ms and cost 118ms a
// keystroke, which is a search box a customer cannot type into. This renders
// only the rows on screen plus a small overscan - 36 cards, 584 nodes - and
// stands two spacer cells in for the rows above and below, so the scroll bar
// still measures the whole shoot: 18ms to open, 10ms a keystroke.
//
// Spacers rather than an absolutely positioned window, because of what the
// board's grid already is: `.grid` paints its own hairline frame and lets its
// background through the 1px gaps between cards. A window positioned inside
// that would draw the frame around whichever rows happened to be rendered.
// Two in-flow cells that span every column leave the grid's layout, its border
// and its gaps exactly as they were.
//
// Rows are measured rather than assumed. A board card is not a fixed height:
// its metadata strip wraps to a second line when a five-star asset also
// carries a warning, so a grid row is 302px or 316px depending on what is in
// it. Assuming one height put the scroll bar 2% out and the item under the
// thumb 24 places from where a customer dragged to. Every row that has been on
// screen is remembered at the height it actually took, rows nobody has reached
// stand at the average of the ones that have, and the total gets truer as the
// customer moves rather than lying confidently from the start. Against the
// same 2000 assets rendered whole, that is a scroll 0.2% too long and an asset
// at most six places from the one the whole list puts under the thumb, on a
// board nobody has scrolled yet - and, once it has been scrolled, a screenshot
// that matches the whole list byte for byte.
//
// Nothing here is board-specific: the caller supplies the scroller, the count
// and a render callback.

const num = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/**
 * Where every row starts, as a running total: entry `r` is the top of row `r`,
 * and the last entry is the end of the list plus the gap that would follow it.
 *
 * `heights` holds the rows this list has rendered and measured. A row nobody
 * has scrolled to is 0 and stands at `estimate`.
 */
export function rowOffsets(heights, { rows = 0, gap = 0, estimate = 0 } = {}) {
  const total = Math.max(0, Math.floor(num(rows)));
  const gutter = Math.max(0, num(gap));
  const fallback = Math.max(0, num(estimate));
  const offsets = new Float64Array(total + 1);
  for (let r = 0; r < total; r++) {
    const height = num(heights?.[r]);
    offsets[r + 1] = offsets[r] + (height > 0 ? height : fallback) + gutter;
  }
  return offsets;
}

/** The row that `top` falls in: the last offset at or before it. */
export function rowAt(offsets, top) {
  const target = num(top);
  let low = 0;
  let high = Math.max(0, (offsets?.length ?? 1) - 2);
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (offsets[mid] <= target) low = mid; else high = mid - 1;
  }
  return low;
}

/**
 * The rows to render, and the two spacer heights that hold the rest of the
 * scroll open. Pure arithmetic - every browser measurement arrives as an
 * argument - so the window maths can be checked without a layout.
 *
 * Takes either an `offsets` table or a uniform `rowHeight`. `head` is where the
 * host's first row sits in the scroller's own scroll coordinates: the board's
 * 24px of top padding, plus anything above the grid.
 *
 * A spacer occupies a row of the grid, so it stands in for the rows it replaces
 * minus the one gap the grid puts back beside it. That is the `- gap` in `lead`,
 * and it is why the rows either side of a window line up to the pixel.
 */
export function planWindow({
  count = 0, columns = 1, offsets = null, rowHeight = 0, gap = 0,
  viewport = 0, scrollTop = 0, head = 0, overscan = 2
} = {}) {
  const total = Math.max(0, Math.floor(num(count)));
  const cols = Math.max(1, Math.floor(num(columns, 1)));
  const gutter = Math.max(0, num(gap));
  const rows = Math.ceil(total / cols);
  if (!total) return { rows: 0, columns: cols, start: 0, end: 0, firstRow: 0, lastRow: 0, lead: 0, trail: 0, height: 0 };

  // A table for a different row count is a table for a different list. Falling
  // back to the uniform height renders something honest rather than reading
  // offsets that belong to the count before last.
  const table = offsets && offsets.length === rows + 1 ? offsets : null;
  const pitch = Math.max(0, num(rowHeight)) + gutter;
  const at = table ? (r => table[r]) : (r => r * pitch);
  const height = at(rows) - gutter;
  // Nothing has been measured yet - a board inside a closed panel reports a
  // zero-height card. Rendering the lot is slow; rendering nothing is a blank
  // board, and the first measurement has to come off a rendered card, so the
  // one that recovers is the lot.
  if (!(height > 0)) return { rows, columns: cols, start: 0, end: total, firstRow: 0, lastRow: rows, lead: 0, trail: 0, height: 0 };

  const view = Math.max(0, num(viewport));
  // A filter that shortens the list leaves the scroll beyond the new end for
  // one frame, until the browser clamps it. Planning against where the scroll
  // will land means that frame is never a blank board.
  const top = clamp(num(scrollTop) - num(head), 0, Math.max(0, height - view));
  const over = Math.max(0, Math.floor(num(overscan)));
  const seenFirst = table ? rowAt(table, top) : Math.floor(top / pitch);
  const seenLast = table ? rowAt(table, top + view) + 1 : Math.ceil((top + view) / pitch);
  const firstRow = clamp(seenFirst - over, 0, rows - 1);
  const lastRow = clamp(seenLast + over, firstRow + 1, rows);
  return {
    rows, columns: cols, firstRow, lastRow,
    start: firstRow * cols,
    end: Math.min(total, lastRow * cols),
    lead: firstRow > 0 ? at(firstRow) - gutter : 0,
    trail: lastRow < rows ? height - at(lastRow) : 0,
    height
  };
}

/** How many tracks a computed `grid-template-columns` resolved to, or 0. */
export function trackCount(value) {
  const tracks = String(value ?? '').trim();
  // A grid nobody has laid out yet answers with the authored value. `repeat()`
  // and `minmax()` are not track sizes, and counting the words in them gives a
  // column count that is confidently wrong.
  if (!tracks || tracks === 'none' || /repeat\(|minmax\(|auto-fill|auto-fit|fit-content|subgrid/.test(tracks)) return 0;
  return tracks.split(/\s+/).filter(Boolean).length;
}

const makePad = (doc, className) => {
  const pad = doc.createElement('div');
  pad.className = className;
  // Two empty cells among the cards would be two blank items to a screen
  // reader. They exist to hold the scroll open and nothing else.
  pad.setAttribute('aria-hidden', 'true');
  // The span belongs with the height rather than in a stylesheet: it is what
  // makes one cell stand for a whole row, and the helper has to be right on a
  // page that has not loaded app.css.
  pad.style.gridColumn = '1 / -1';
  return pad;
};

/**
 * Window a scroll container.
 *
 * @param {Element} scroller  the element with `overflow-y: auto`
 * @param {object}  options
 * @param {number}  options.count       how many items there are in total
 * @param {(index: number) => Element} options.renderItem  builds one item
 * @param {number} [options.itemHeight]  fixed row height; omit to measure rows
 * @param {number} [options.estimate]    height to stand rows at until they are measured
 * @param {number} [options.columns]     fixed column count; omit to read the grid's tracks
 * @param {number} [options.gap]         fixed row gap; omit to read it off the host
 * @param {number} [options.overscan]    rows rendered beyond the viewport, each side
 * @param {Element} [options.host]       container for the items; one is made if omitted
 *
 * The helper takes over the inside of the scroller when it makes its own host:
 * the board it is handed may still be showing an empty state.
 */
export function createVirtualList(scroller, options = {}) {
  if (!scroller) throw new TypeError('createVirtualList needs a scroll container');
  const opts = { overscan: 2, estimate: 260, hostClass: 'grid', padClass: 'vpad', ...options };
  if (typeof opts.renderItem !== 'function') throw new TypeError('createVirtualList needs a renderItem callback');

  const doc = scroller.ownerDocument || globalThis.document;
  const view = doc?.defaultView || globalThis;
  const host = opts.host || doc.createElement('div');
  if (!opts.host) host.className = opts.hostClass;
  if (!host.parentNode) scroller.replaceChildren(host);
  const lead = makePad(doc, opts.padClass);
  const trail = makePad(doc, opts.padClass);

  /** A caller who states the height means it: no measuring, no table. */
  const fixed = opts.itemHeight == null ? null : Math.max(0, num(opts.itemHeight));
  let count = Math.max(0, Math.floor(num(opts.count)));
  let renderItem = opts.renderItem;
  let metrics = { columns: Math.max(1, Math.floor(num(opts.columns, 1))), gap: Math.max(0, num(opts.gap)), head: 0 };
  let estimate = fixed ?? Math.max(1, num(opts.estimate, 260));
  let heights = [];        // per row, 0 until the row has been on screen
  let offsets = null;      // prefix sums; null while a fixed height is in force
  let rows = 0;
  /** index → node, so scrolling reuses cards instead of rebuilding their images. */
  let live = new Map();
  let plan = null;
  let frame = 0;
  let width = 0, viewportHeight = 0;

  const schedule = typeof view.requestAnimationFrame === 'function'
    ? view.requestAnimationFrame.bind(view) : (fn => view.setTimeout(fn, 16));
  const unschedule = typeof view.cancelAnimationFrame === 'function'
    ? view.cancelAnimationFrame.bind(view) : (id => view.clearTimeout(id));

  /** Recompute the row table. Cheap: one pass over the rows, not the items. */
  function rebuild() {
    rows = Math.ceil(count / metrics.columns);
    if (heights.length > rows) heights.length = rows;
    // Kept dense. A hole in a long array turns it into a dictionary, and this
    // one is walked every time a row is measured.
    while (heights.length < rows) heights.push(0);
    if (fixed != null) { offsets = null; return; }
    let sum = 0, known = 0;
    for (let r = 0; r < rows; r++) if (heights[r] > 0) { sum += heights[r]; known++; }
    // Rows nobody has reached stand at the average of the rows that have been
    // seen, which is a far better guess than any constant this file could hold.
    if (known) estimate = sum / known;
    offsets = rowOffsets(heights, { rows, gap: metrics.gap, estimate });
  }

  /** The scroll offset of the host's first row, padding and borders included. */
  function headOffset(style) {
    if (typeof host.getBoundingClientRect !== 'function' || typeof scroller.getBoundingClientRect !== 'function') return 0;
    const inner = num(host.clientTop) + (style ? num(parseFloat(style.paddingTop)) : 0);
    return Math.max(0, host.getBoundingClientRect().top - scroller.getBoundingClientRect().top
      + num(scroller.scrollTop) + inner);
  }

  /**
   * Read back the layout the grid produced: how many tracks it resolved to,
   * what its row gap is, where its first row starts. Returns true when
   * something the window depends on moved.
   */
  function measure() {
    // A board in a closed panel measures as nothing at all. Keeping the last
    // good numbers means the window survives a tab switch; taking the zeros
    // would put every row in the same place and render the entire list.
    if (!num(scroller.clientWidth) && !num(scroller.clientHeight)) return false;
    const style = typeof view.getComputedStyle === 'function' ? view.getComputedStyle(host) : null;
    const next = { ...metrics };
    if (opts.columns == null) {
      const tracks = trackCount(style?.gridTemplateColumns);
      if (tracks) next.columns = tracks;
    }
    if (opts.gap == null && style) {
      const rowGap = parseFloat(style.rowGap ?? style.gap);
      if (Number.isFinite(rowGap)) next.gap = Math.max(0, rowGap);
    }
    next.head = headOffset(style);
    const moved = ['columns', 'gap', 'head'].some(key => Math.abs(next[key] - metrics[key]) > 0.5);
    // A narrower window is a narrower card, and a narrower card is a different
    // height. Every row measured at the old width is now a wrong answer.
    if (next.columns !== metrics.columns || next.gap !== metrics.gap) heights.length = 0;
    metrics = next;
    width = num(scroller.clientWidth);
    viewportHeight = num(scroller.clientHeight);
    if (moved) rebuild();
    return moved;
  }

  /** Put the window on screen. Returns true when the DOM actually changed. */
  function paint(force = false) {
    const next = planWindow({
      count, columns: metrics.columns, offsets, rowHeight: fixed ?? estimate, gap: metrics.gap,
      viewport: num(scroller.clientHeight), scrollTop: num(scroller.scrollTop),
      head: metrics.head, overscan: opts.overscan
    });
    if (!force && plan && plan.start === next.start && plan.end === next.end
      && plan.lead === next.lead && plan.trail === next.trail) {
      plan = next;
      return false;
    }
    // The same rows, in the same order, with the spacers a different size:
    // measuring a row moves the scroll around a window without changing what
    // is in it. Writing two heights is the whole repaint.
    if (!force && plan && plan.start === next.start && plan.end === next.end
      && (plan.lead > 0) === (next.lead > 0) && (plan.trail > 0) === (next.trail > 0)) {
      if (next.lead > 0) lead.style.height = `${next.lead}px`;
      if (next.trail > 0) trail.style.height = `${next.trail}px`;
      plan = next;
      return true;
    }

    const kids = [];
    if (next.lead > 0) {
      lead.style.height = `${next.lead}px`;
      kids.push(lead);
    }
    const kept = new Map();
    for (let i = next.start; i < next.end; i++) {
      // Reuse across scrolls. `replaceChildren` moves a node it already holds
      // rather than recreating it, so a thumbnail already decoded stays
      // decoded instead of flashing back to an empty frame.
      const node = live.get(i) ?? renderItem(i);
      if (!node) continue;
      kept.set(i, node);
      kids.push(node);
    }
    if (next.trail > 0) {
      trail.style.height = `${next.trail}px`;
      kids.push(trail);
    }
    live = kept;
    host.replaceChildren(...kids);
    plan = next;
    return true;
  }

  /**
   * Learn the heights of the rows just rendered, and keep the view still while
   * doing it. Returns true when the table changed and the window needs redoing.
   */
  function settle() {
    if (fixed != null || !plan || !offsets) return false;
    const top = Math.max(0, num(scroller.scrollTop) - metrics.head);
    // The row at the top of the viewport is the one a customer is looking at.
    const anchor = rowAt(offsets, top);
    const before = offsets[anchor];
    let learned = false;
    for (let r = plan.firstRow; r < plan.lastRow; r++) {
      // Grid rows stretch their items, so any card in a row reports the row's
      // height - the first one is enough, and it is one rect read per row.
      const node = live.get(r * metrics.columns);
      const height = typeof node?.getBoundingClientRect === 'function' ? node.getBoundingClientRect().height : 0;
      if (height > 0 && Math.abs(height - num(heights[r])) > 0.5) {
        heights[r] = height;
        learned = true;
      }
    }
    if (!learned) return false;
    rebuild();
    // The overscan rows above the fold have just been measured too. Scrolling
    // down, a row growing below the anchor is invisible; scrolling up, one
    // growing above it would shove the page under the thumb, so the scroll
    // moves by the same amount and nothing appears to move at all.
    const shift = offsets[anchor] - before;
    if (Math.abs(shift) > 0.5) scroller.scrollTop = Math.max(0, num(scroller.scrollTop) + shift);
    return true;
  }

  /**
   * Measure what was just painted, and paint again if that changed the plan.
   *
   * Twice, because a window planned on an estimate can render a different set
   * of rows than the estimate predicted, and measuring those can move the plan
   * once more. The bound is there so no layout can spin this.
   */
  function settleLoop() {
    for (let pass = 0; pass < 2; pass++) {
      if (!settle()) return;
      paint();
    }
  }

  /** Read the layout, put the window on it, correct it with what it measured. */
  function refresh() {
    measure();
    paint();
    settleLoop();
    return plan;
  }

  const onScroll = () => {
    if (frame) return;
    frame = schedule(() => {
      frame = 0;
      // A scroll frame that did not move the window costs one plan and nothing
      // else: no measuring, no writes.
      if (paint()) settleLoop();
    });
  };
  const onResize = () => {
    // A resize observer fires for the paint it caused as well as for the ones
    // it did not. Only a box that actually changed can change the window.
    if (num(scroller.clientWidth) === width && num(scroller.clientHeight) === viewportHeight) return;
    refresh();
  };

  scroller.addEventListener?.('scroll', onScroll, { passive: true });
  let observer = null;
  if (typeof view.ResizeObserver === 'function') {
    // The scroller only: observing the host would see the height this helper
    // writes on every paint and call itself back forever.
    observer = new view.ResizeObserver(onResize);
    observer.observe(scroller);
  } else view.addEventListener?.('resize', onResize);

  rebuild();
  refresh();

  return {
    /** The element the items are rendered into. */
    element: host,
    /** What is on screen right now, and the numbers behind it. */
    range: () => ({ ...plan }),
    metrics: () => ({ ...metrics, rows, estimate, height: plan?.height ?? 0,
      measured: heights.reduce((n, h) => n + (h > 0 ? 1 : 0), 0) }),
    /**
     * New items, a new count, or both. Measured rows are dropped with them:
     * after a filter, row 4 holds different assets than the row measured there.
     * The average they produced is kept, because the cards are the same shape.
     */
    update({ count: next, renderItem: build } = {}) {
      if (typeof build === 'function') renderItem = build;
      if (next != null) count = Math.max(0, Math.floor(num(next)));
      heights.length = 0;
      live.clear();
      plan = null;
      rebuild();
      return refresh();
    },
    /** Re-measure and repaint - after a stylesheet change, or a panel opening. */
    refresh,
    /** Bring one item into view, moving no further than it takes. */
    scrollToIndex(index) {
      if (!count) return;
      const item = clamp(Math.floor(num(index)), 0, count - 1);
      const row = Math.floor(item / metrics.columns);
      const top = metrics.head + (offsets ? offsets[row] : row * (estimate + metrics.gap));
      const height = offsets ? offsets[row + 1] - offsets[row] - metrics.gap : estimate;
      const seen = num(scroller.scrollTop);
      if (top < seen) scroller.scrollTop = top;
      else if (top + height > seen + num(scroller.clientHeight)) scroller.scrollTop = top + height - num(scroller.clientHeight);
      if (paint()) settleLoop();
    },
    destroy() {
      if (frame) unschedule(frame);
      frame = 0;
      scroller.removeEventListener?.('scroll', onScroll);
      observer?.disconnect();
      view.removeEventListener?.('resize', onResize);
      live.clear();
      heights.length = 0;
      plan = null;
      host.replaceChildren();
      host.remove?.();
    }
  };
}
