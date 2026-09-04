// Windowing for lists long enough that building them is what costs the time.
//
// The board draws one card per asset, and a real shoot is hundreds of them.
// Every filter keystroke rebuilt the whole grid: 200 cards measured 652ms to
// render and 240ms per keystroke, which is a search box a customer cannot
// type into. This renders only the rows on screen plus a small overscan, and
// stands two spacer cells in for the rows above and below so the scrollbar
// still measures the whole shoot.
//
// Spacers rather than an absolutely positioned window, because of what the
// board's grid already is: `.grid` paints its own hairline frame and lets its
// background through the 1px gaps between cards. A window positioned inside
// that would draw the frame around whichever rows happened to be rendered.
// Two in-flow cells that span every column leave the grid's layout, its
// border and its gaps exactly as they were.
//
// Nothing here is board-specific: the caller supplies the scroller, the count
// and a render callback. Everything else is measured from what the browser
// actually laid out, because a card's height follows its column width and a
// column count follows the window.

const num = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/**
 * The rows to render, and the two spacer heights that hold the rest of the
 * scroll open. Pure arithmetic - every browser measurement arrives as an
 * argument - so the window maths can be checked without a layout.
 *
 * `head` is where the host's first row sits in the scroller's own scroll
 * coordinates: the board's 24px of top padding, plus anything above the grid.
 * `gap` is the row gap, which is why the spacers are not simply `rows * height`:
 * a spacer occupies one row of the grid, so it stands in for the rows it
 * replaces minus the one gap the grid puts back beside it.
 */
export function planWindow({
  count = 0, columns = 1, rowHeight = 0, gap = 0,
  viewport = 0, scrollTop = 0, head = 0, overscan = 2
} = {}) {
  const total = Math.max(0, Math.floor(num(count)));
  const cols = Math.max(1, Math.floor(num(columns, 1)));
  const gutter = Math.max(0, num(gap));
  const pitch = Math.max(0, num(rowHeight)) + gutter;
  const rows = Math.ceil(total / cols);
  if (!total) return { rows: 0, columns: cols, start: 0, end: 0, firstRow: 0, lastRow: 0, lead: 0, trail: 0, height: 0 };
  // Nothing has been measured yet - a board inside a closed panel reports a
  // zero-height card. Rendering the lot is slow; rendering nothing is a blank
  // board, and the first measurement has to come off a rendered card, so the
  // one that recovers is the lot.
  if (pitch <= 0) return { rows, columns: cols, start: 0, end: total, firstRow: 0, lastRow: rows, lead: 0, trail: 0, height: 0 };

  const height = rows * pitch - gutter;
  const view = Math.max(0, num(viewport));
  // A filter that shortens the list leaves the scroll beyond the new end for
  // one frame, until the browser clamps it. Planning against where the scroll
  // will land means that frame is never a blank board.
  const top = clamp(num(scrollTop) - num(head), 0, Math.max(0, height - view));
  const over = Math.max(0, Math.floor(num(overscan)));
  const firstRow = clamp(Math.floor(top / pitch) - over, 0, rows - 1);
  const lastRow = clamp(Math.ceil((top + view) / pitch) + over, firstRow + 1, rows);
  return {
    rows, columns: cols, firstRow, lastRow,
    start: firstRow * cols,
    end: Math.min(total, lastRow * cols),
    lead: firstRow > 0 ? firstRow * pitch - gutter : 0,
    trail: lastRow < rows ? (rows - lastRow) * pitch - gutter : 0,
    height
  };
}

/** How many tracks a computed `grid-template-columns` resolved to, or 0. */
export function trackCount(value) {
  const tracks = String(value ?? '').trim();
  // A grid nobody has laid out yet answers with the authored value. `repeat()`
  // and `minmax()` are not track sizes and counting the words in them would
  // give a column count that is confidently wrong.
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
 * @param {Element} scroller       the element with `overflow-y: auto`
 * @param {object}  options
 * @param {number}  options.count      how many items there are in total
 * @param {(index: number) => Element} options.renderItem  builds one item
 * @param {number} [options.itemHeight] fixed row height; omit to measure one
 * @param {number} [options.estimate]   height to assume until the first measurement
 * @param {number} [options.columns]    fixed column count; omit to read the grid's tracks
 * @param {number} [options.gap]        fixed row gap; omit to read it off the host
 * @param {number} [options.overscan]   rows rendered beyond the viewport, each side
 * @param {Element} [options.host]      container for the items; one is made if omitted
 *
 * The helper appends its own host to the scroller when it makes one, replacing
 * whatever was there - the board it is handed may still be showing an empty
 * state.
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

  let count = Math.max(0, Math.floor(num(opts.count)));
  let renderItem = opts.renderItem;
  let metrics = {
    columns: Math.max(1, Math.floor(num(opts.columns, 1))),
    rowHeight: Math.max(0, num(opts.itemHeight, num(opts.estimate, 260))),
    gap: Math.max(0, num(opts.gap)),
    head: 0
  };
  /** index → node, so scrolling reuses cards instead of rebuilding their images. */
  let live = new Map();
  let plan = null;
  let frame = 0;
  let width = 0, viewportHeight = 0;

  const schedule = typeof view.requestAnimationFrame === 'function'
    ? view.requestAnimationFrame.bind(view) : (fn => view.setTimeout(fn, 16));
  const unschedule = typeof view.cancelAnimationFrame === 'function'
    ? view.cancelAnimationFrame.bind(view) : (id => view.clearTimeout(id));

  /** The scroll offset of the host's first row, padding and borders included. */
  function headOffset(style) {
    if (typeof host.getBoundingClientRect !== 'function' || typeof scroller.getBoundingClientRect !== 'function') return 0;
    const inner = num(host.clientTop) + (style ? num(parseFloat(style.paddingTop)) : 0);
    return Math.max(0, host.getBoundingClientRect().top - scroller.getBoundingClientRect().top
      + num(scroller.scrollTop) + inner);
  }

  /**
   * Read back what the browser laid out. Returns true when something the
   * window depends on moved, which is the caller's cue to paint again.
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
    if (opts.itemHeight == null && plan) {
      // Cards in one grid row are stretched to a common height, so the first
      // one on screen is the row height. Fractional: a 1fr track rarely lands
      // on a whole pixel, and rounding it up drifts a row per hundred.
      const first = live.get(plan.start);
      const measured = typeof first?.getBoundingClientRect === 'function' ? first.getBoundingClientRect().height : 0;
      if (measured > 0) next.rowHeight = measured;
    }
    next.head = headOffset(style);

    const moved = ['columns', 'rowHeight', 'gap', 'head'].some(key => Math.abs(next[key] - metrics[key]) > 0.5);
    metrics = next;
    width = num(scroller.clientWidth);
    viewportHeight = num(scroller.clientHeight);
    return moved;
  }

  /** Put the window on screen. Cheap when the window has not moved. */
  function paint(force = false) {
    const next = planWindow({
      count, columns: metrics.columns, rowHeight: metrics.rowHeight, gap: metrics.gap,
      viewport: num(scroller.clientHeight), scrollTop: num(scroller.scrollTop),
      head: metrics.head, overscan: opts.overscan
    });
    if (!force && plan && plan.start === next.start && plan.end === next.end
      && plan.lead === next.lead && plan.trail === next.trail) return next;

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
    return next;
  }

  /** Paint, then correct the paint with what it measured. */
  function refresh() {
    paint(true);
    // The row height comes off a rendered card, so the first pass is planned
    // on an estimate and the second on the truth. It settles there: the
    // measurement does not depend on which rows were chosen.
    if (measure()) paint(true);
    return plan;
  }

  const onScroll = () => {
    if (frame) return;
    frame = schedule(() => { frame = 0; paint(); });
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

  refresh();

  return {
    /** The element the items are rendered into. */
    element: host,
    /** What is on screen right now, and the numbers behind it. */
    range: () => ({ ...plan }),
    metrics: () => ({ ...metrics }),
    /** New items, a new count, or both. Cached nodes are dropped: after a
     *  filter, index 4 is a different asset than the one held there. */
    update({ count: next, renderItem: build } = {}) {
      if (typeof build === 'function') renderItem = build;
      if (next != null) count = Math.max(0, Math.floor(num(next)));
      live.clear();
      plan = null;
      return refresh();
    },
    /** Re-measure and repaint - after a stylesheet change, or a panel opening. */
    refresh,
    /** Bring one item into view, moving no further than it takes. */
    scrollToIndex(index) {
      if (!count) return;
      const item = clamp(Math.floor(num(index)), 0, count - 1);
      const pitch = metrics.rowHeight + metrics.gap;
      const top = metrics.head + Math.floor(item / metrics.columns) * pitch;
      const seen = num(scroller.scrollTop);
      const bottom = top + metrics.rowHeight - num(scroller.clientHeight);
      if (top < seen) scroller.scrollTop = top;
      else if (bottom > seen) scroller.scrollTop = bottom;
      paint();
    },
    destroy() {
      if (frame) unschedule(frame);
      frame = 0;
      scroller.removeEventListener?.('scroll', onScroll);
      observer?.disconnect();
      view.removeEventListener?.('resize', onResize);
      live.clear();
      plan = null;
      host.replaceChildren();
      host.remove?.();
    }
  };
}
