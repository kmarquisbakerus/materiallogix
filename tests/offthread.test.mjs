// Importing a photograph must not freeze the tab.
//
// Measured in Chromium before this moved: one 48 MP JPEG was 1,125 ms of
// unbroken main-thread work in the three full-resolution draws `analyzeAsset`
// used to make, a 100 MP one 1,876 ms, and a 48 MP Display P3 file another
// 1,250 ms in the colour-managed decode before either. Nothing repainted for
// the duration — the import dialog sat frozen on the file it was working on.
//
// Two things had to become true, and both are asserted here rather than
// described: the analysis has to run where there is no `document`, and it has
// to produce the same record there as it does on the main thread. The browser
// halves of the proof — a real worker, real fixtures, deep-equal records — were
// reproduced in Chromium; what a Node suite can hold is the contract those runs
// depend on, so that undoing one fails a test rather than a customer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFileSync(resolve(ROOT, file), 'utf8');

// `crop.js` opens a MessageChannel at load to yield between heavy items, and a
// started MessagePort holds Node's event loop open for the life of the process
// — the suite would pass and then never exit. Taking the constructor away
// before the first import leaves the yield a resolved promise, which is what it
// already is in any browser without one, and is nothing this file measures.
delete globalThis.MessageChannel;

const { analyzeAsset } = await import('../studio/js/analyze.js');

// --- a canvas small enough to reason about --------------------------------

// Every surface the analysis makes, newest last, so the reduction it performs
// is visible rather than inferred.
let made = [];

/**
 * A 2D surface with the four calls `analyze.js` makes of one.
 *
 * `drawImage` area-averages, which is what a halving step does and what makes
 * the result checkable by hand; the real thing is Skia, and the browser runs
 * above prove the two agree.
 */
class Surface {
  constructor(w = 0, h = 0) { this.resize(w, h); }

  // A DOM canvas is made empty and sized by assignment; an OffscreenCanvas is
  // made at its size. Both land here, so the two paths record the same steps.
  resize(w, h) {
    this.w = w; this.h = h;
    this.data = new Uint8ClampedArray(Math.max(0, w * h * 4));
    if (w && h) made.push(`${w}x${h}`);
  }

  get width() { return this.w; }
  set width(value) { this.resize(value, this.h); }
  get height() { return this.h; }
  set height(value) { this.resize(this.w, value); }

  getContext() {
    if (!this.ctx) this.ctx = new SurfaceContext(this);
    return this.ctx;
  }
}

class SurfaceContext {
  constructor(surface) { this.surface = surface; this.flipX = false; }
  translate() { /* only ever paired with the mirror scale below */ }
  scale(x) { if (x < 0) this.flipX = true; }

  drawImage(source, x, y, w, h) {
    const { width: dw, data: out } = this.surface;
    const sw = source.width, sh = source.height, src = source.data;
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const x0 = Math.floor((dx * sw) / w), x1 = Math.max(x0 + 1, Math.floor(((dx + 1) * sw) / w));
        const y0 = Math.floor((dy * sh) / h), y1 = Math.max(y0 + 1, Math.floor(((dy + 1) * sh) / h));
        let r = 0, g = 0, b = 0, a = 0, n = 0;
        for (let sy = y0; sy < y1 && sy < sh; sy++) {
          for (let sx = x0; sx < x1 && sx < sw; sx++) {
            const i = (sy * sw + sx) * 4;
            r += src[i]; g += src[i + 1]; b += src[i + 2]; a += src[i + 3]; n++;
          }
        }
        const target = ((y + dy) * dw + (this.flipX ? w - 1 - dx : dx) + x) * 4;
        out[target] = r / n; out[target + 1] = g / n; out[target + 2] = b / n; out[target + 3] = a / n;
      }
    }
  }

  getImageData(x, y, w, h) {
    return { data: this.surface.data.slice(0, w * h * 4), width: w, height: h };
  }
}

/** A photograph with detail in it, so the scores are not all zero. */
function photograph(w, h) {
  const source = new Surface(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      source.data[i] = (x * 7 + y * 3) % 256;
      source.data[i + 1] = (x * 3 + y * 11) % 256;
      source.data[i + 2] = ((x ^ y) * 5) % 256;
      source.data[i + 3] = 255;
    }
  }
  return source;
}

async function analyseWith({ document: doc = undefined } = {}) {
  const source = photograph(1024, 768);
  made = [];
  globalThis.OffscreenCanvas = Surface;
  if (doc) globalThis.document = doc; else delete globalThis.document;
  try {
    const record = await analyzeAsset(source, 1024, 768, null, null);
    return { record, made: made.slice() };
  } finally {
    delete globalThis.document;
    delete globalThis.OffscreenCanvas;
  }
}

test('the analysis runs where there is no document', async () => {
  // The worker has no DOM. Reaching for `document.createElement` here is the
  // single thing that kept this work on the main thread.
  const { record } = await analyseWith();
  assert.equal(record.version, 1);
  assert.equal(record.width, 1024);
  assert.equal(record.megapixels, +((1024 * 768) / 1e6).toFixed(2));
  assert.equal(typeof record.sharpness, 'number');
  assert.equal(record.hash.length, 16);
  assert.equal(record.hashMirror.length, 16);
  assert.ok(record.palette.length > 0, 'a record with no palette measured nothing');
});

test('the sample is reduced by halving, not in one jump', async () => {
  // A single 4x reduction is sampled bilinearly and aliases: the same
  // photograph scored 297 on the sharpness index that way and 115 through the
  // browser's own mip chain. Halving is that chain, written down — it is what
  // lets a worker and the main thread measure the same picture.
  const { made: surfaces } = await analyseWith();
  // 1024x768 halved twice to reach the 256px sample, then on down to the 9x8
  // the hash is read off — and the mirrored hash reuses the same chain rather
  // than starting again from full resolution.
  assert.deepEqual(surfaces, [
    '512x384', '256x192', '256x192',
    '128x96', '64x48', '32x24', '16x12', '9x8',
    '128x96', '64x48', '32x24', '16x12', '9x8'
  ], `the reduction was not a halving chain: ${surfaces.join(' ')}`);
});

test('a document and a worker measure the same photograph', async () => {
  // The parity that matters to a customer: whichever thread ran it, the record
  // is the same one. Reproduced in Chromium across six fixtures — JPEG, opaque
  // and alpha PNG, Display P3, an odd-sized frame and a Radiance HDR — by
  // importing each with workers on and with `window.Worker` removed, and
  // deep-equalling the stored records.
  const offThread = await analyseWith();
  const onThread = await analyseWith({ document: { createElement: () => new Surface(0, 0), hidden: false } });
  const { at: offAt, ...off } = offThread.record;
  const { at: onAt, ...on } = onThread.record;
  assert.deepStrictEqual(off, on);
  assert.deepEqual(offThread.made, onThread.made, 'the two threads reduced the picture differently');
});

// --- the boundary ----------------------------------------------------------

const worker = await import('../studio/js/analysis-worker.js');

/** How the next fake worker answers. Set by each test below. */
let respond = () => ({ ok: false, message: 'unset' });
const spawned = [];

class FakeWorker {
  constructor(url, options) {
    this.url = String(url); this.options = options; this.terminated = false;
    spawned.push(this);
  }

  postMessage(message) {
    queueMicrotask(() => {
      const reply = respond(message, this);
      if (reply) this.onmessage?.({ data: { id: message.id, ...reply } });
    });
  }

  terminate() { this.terminated = true; }
}

/** The globals `offThreadAnalysisAvailable` looks for, and a worker it can spawn. */
function browser() {
  globalThis.document = {};
  globalThis.Worker = FakeWorker;
  globalThis.OffscreenCanvas = class {};
  globalThis.createImageBitmap = () => {};
}

function unbrowser() {
  for (const key of ['document', 'Worker', 'OffscreenCanvas', 'createImageBitmap']) delete globalThis[key];
  spawned.length = 0;
}

test('a browser with no worker keeps its analysis', async () => {
  // Node is that browser: no `Worker`, no `OffscreenCanvas`. The answer is
  // null, not a throw, because null is what tells the caller to do the work
  // itself — nobody loses an analysis because a thread was unavailable.
  assert.equal(worker.offThreadAnalysisAvailable(), false);
  assert.equal(await worker.analyzeBlobOffThread(new Blob(['x'])), null);
});

test('the worker hands back the record and the decode that made it', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  browser();
  try {
    const auto = { version: 1, sharpness: 42, hash: 'abcdabcdabcdabcd' };
    respond = () => ({ ok: true, auto, source: 'the-bitmap', w: 4000, h: 3000, colorTransform: null });
    const result = await worker.analyzeBlobOffThread(new Blob(['photo']));
    assert.deepEqual(result, { auto, source: 'the-bitmap', w: 4000, h: 3000, colorTransform: null });
    assert.equal(spawned.length, 1);
    // Self-hosting: the client spawns this very module, so the two sides of the
    // protocol cannot drift apart.
    assert.match(spawned[0].url, /analysis-worker\.js$/);
    assert.deepEqual(spawned[0].options, { type: 'module' });

    // One thread, reused: a library import runs this once per file, and a
    // module worker costs a fetch and a parse to start.
    await worker.analyzeBlobOffThread(new Blob(['second']));
    assert.equal(spawned.length, 1, 'a second import started a second thread');

    // ...and retired when the queue has been quiet, so a session that imports
    // once in the morning is not still holding a thread at lunch.
    t.mock.timers.tick(60_000);
    assert.equal(spawned[0].terminated, true, 'the idle worker was never retired');
    await worker.analyzeBlobOffThread(new Blob(['third']));
    assert.equal(spawned.length, 2, 'a retired worker was not replaced');
    t.mock.timers.tick(60_000);   // leave no thread behind for the next test
  } finally {
    t.mock.timers.reset();
    unbrowser();
  }
});

test('a worker that fails sends the work back to the main thread', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  browser();
  try {
    // The decode threw inside the worker: it reports rather than going silent.
    respond = () => ({ ok: false, message: 'no_pixels' });
    assert.equal(await worker.analyzeBlobOffThread(new Blob(['bad'])), null);

    // The thread itself died. Nothing will ever answer, so every caller waiting
    // on it is failed and the corpse is dropped rather than reused.
    respond = (message, instance) => { instance.onerror?.(new Error('boom')); return null; };
    assert.equal(await worker.analyzeBlobOffThread(new Blob(['dead'])), null);
    assert.ok(spawned.at(-1).terminated, 'a worker that errored was left running');

    respond = () => ({ ok: true, auto: { version: 1 }, source: null, w: 1, h: 1, colorTransform: null });
    const recovered = await worker.analyzeBlobOffThread(new Blob(['next']));
    assert.equal(recovered.auto.version, 1, 'the next import did not get a fresh worker');
  } finally {
    t.mock.timers.reset();
    unbrowser();
  }
});

// --- the wiring ------------------------------------------------------------

test('the import path asks the worker first and keeps the fallback', () => {
  const app = read('studio/js/app.js');
  const body = app.slice(app.indexOf('async function runAnalysis'), app.indexOf('async function analyzeAll'));
  assert.match(body, /analyzeBlobOffThread\(blob\)/, 'the import no longer offers the work to the worker');
  assert.match(body, /await analyzeAsset\(/, 'the main-thread fallback was dropped: a failed worker would lose the analysis');
});

test('an installed app carries the analysis worker offline', () => {
  // Network-first hides this while online. Offline, a missing worker file is
  // not slower — it is every import freezing the tab again.
  const sw = read('studio/sw.js');
  const shell = sw.slice(sw.indexOf('const SHELL = ['), sw.indexOf('];', sw.indexOf('const SHELL = [')));
  assert.match(shell, /'js\/analysis-worker\.js'/);
});
