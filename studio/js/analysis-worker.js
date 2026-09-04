// Decode and analysis, off the main thread.
//
// Importing a photograph used to freeze the tab: measured on this Chromium,
// one 48 MP JPEG was 1,100 ms of unbroken main-thread work in `analyzeAsset`
// and a 48 MP Display P3 file another 1,252 ms in the colour-managed decode
// before it. Nothing repaints in that window — no click lands, and the import
// dialog sits frozen on the file it is already working on. None of it needs
// the DOM: `createImageBitmap` and `OffscreenCanvas` do the same job here.
//
// One file is both halves of the boundary on purpose. The client at the bottom
// spawns this same module as its worker, so the two sides cannot drift apart,
// and an install carries one file instead of two.
import { analyzeAsset } from './analyze.js';
import { inspectColorMetadata, parseRadianceHdr, toneMapLinearBt2020ToSrgb } from './color-management.js';

/** Profiles `decodeColorManagedBlob` converts rather than hands to the decoder. */
const CONVERTED_PROFILES = ['display-p3', 'adobe-rgb', 'cmyk'];

const startsWithAscii = (bytes, text) => text.length <= bytes.length
  && [...text].every((character, index) => bytes[index] === character.charCodeAt(0));

/**
 * What `decodeColorManagedBlob` does, on a surface a worker can make.
 *
 * The colour maths is imported, not copied — only the line that needs a
 * `document` is re-expressed here, because `OffscreenCanvas` is the one thing
 * this side of the boundary has that the shared module cannot use. The
 * `willReadFrequently` and `colorSpace` arguments match it exactly: they decide
 * whether the surface is CPU- or GPU-backed, and that decides the pixels.
 */
async function decodeForAnalysis(blob) {
  const head = new Uint8Array(await blob.slice(0, 1024 * 1024).arrayBuffer());
  const radiance = (startsWithAscii(head, '#?RADIANCE') || startsWithAscii(head, '#?RGBE'))
    ? parseRadianceHdr(new Uint8Array(await blob.arrayBuffer())) : null;
  if (radiance) {
    const converted = toneMapLinearBt2020ToSrgb(radiance.linearBt2020);
    const canvas = new OffscreenCanvas(radiance.width, radiance.height);
    const context = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true });
    context.putImageData(new ImageData(converted.pixels, radiance.width, radiance.height), 0, 0);
    return { source: canvas, w: radiance.width, h: radiance.height, colorTransform: {
      conversion: converted.toneMap, conversionAccepted: true, toneMappingApplied: true,
      sourceDynamicRangeStops: radiance.dynamicRangeStops, sourceMaximumLinear: +radiance.maximumLinear.toFixed(6),
      clippedChannelFraction: converted.clippedChannelFraction
    } };
  }

  const metadata = await inspectColorMetadata(blob);
  const converts = CONVERTED_PROFILES.includes(metadata.profile);
  const bitmap = await createImageBitmap(blob, converts
    ? { colorSpaceConversion: 'default', premultiplyAlpha: 'none' } : undefined);
  if (!converts) return { source: bitmap, w: bitmap.width, h: bitmap.height, colorTransform: null };

  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true });
  context.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  return { source: canvas, w: canvas.width, h: canvas.height, colorTransform: {
    conversion: 'browser-icc-to-srgb', conversionAccepted: metadata.profile === 'display-p3', toneMappingApplied: false
  } };
}

/** The decode the caller gets back, so this thread's work is not thrown away. */
const handOver = decoded => decoded.source instanceof OffscreenCanvas
  // Detaching the canvas is the point: the bitmap moves, it is not copied.
  ? decoded.source.transferToImageBitmap()
  : decoded.source;

// --- the worker side -------------------------------------------------------

if (typeof DedicatedWorkerGlobalScope !== 'undefined' && self instanceof DedicatedWorkerGlobalScope) {
  self.onmessage = async ({ data }) => {
    const id = data?.id;
    try {
      const decoded = await decodeForAnalysis(data.blob);
      if (!decoded?.w || !decoded?.h) throw new Error('no_pixels');
      const auto = await analyzeAsset(decoded.source, decoded.w, decoded.h, data.blob, decoded.colorTransform);
      const source = handOver(decoded);
      self.postMessage({ id, ok: true, auto, source, w: decoded.w, h: decoded.h,
        colorTransform: decoded.colorTransform }, [source]);
    } catch (error) {
      // Never a rejection: the caller falls back to the main thread on a reply
      // it can read, and hangs forever on one that never arrives.
      self.postMessage({ id, ok: false, message: String(error?.message || error) });
    }
  };
}

// --- the client side -------------------------------------------------------

// One worker, kept between imports — a module worker costs a fetch and a parse
// to start, and a library import runs this once per file. It is retired when
// the queue has been empty for this long, so a session that imports once in the
// morning is not still holding a thread at lunch.
const IDLE_MS = 15_000;
// A wedged worker cannot be detected, only waited out. The whole record took
// 484 ms for a 100 MP photograph when this was measured, and the largest file
// anyone has reported took thirteen seconds through the old path — a minute is
// past any honest answer, after which the main thread does the work itself
// rather than leaving the import with nothing.
const REPLY_TIMEOUT_MS = 60_000;

let worker = null;
let sequence = 0;
let idleTimer = null;
const waiting = new Map();

function retire() {
  if (waiting.size || !worker) return;
  worker.terminate();
  worker = null;
}

function scheduleRetirement() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(retire, IDLE_MS);
}

/** Fail everyone waiting and drop the worker: a dead one answers nothing. */
function abandon(reason) {
  for (const [, entry] of waiting) { clearTimeout(entry.timer); entry.reject(reason); }
  waiting.clear();
  worker?.terminate();
  worker = null;
}

function analysisWorker() {
  if (worker) return worker;
  worker = new Worker(import.meta.url, { type: 'module' });
  worker.onmessage = ({ data }) => {
    const entry = waiting.get(data?.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    waiting.delete(data.id);
    scheduleRetirement();
    if (data.ok) entry.resolve(data); else entry.reject(new Error(data.message || 'analysis_failed'));
  };
  worker.onerror = () => abandon(new Error('analysis_worker_error'));
  worker.onmessageerror = () => abandon(new Error('analysis_worker_message_error'));
  return worker;
}

/** Everything that has to be true before any of this is worth trying. */
export function offThreadAnalysisAvailable() {
  // `document` is the test for "this is the main thread": the worker imports
  // this same module, and a worker must never spawn another one.
  return typeof document !== 'undefined' && typeof Worker === 'function'
    && typeof OffscreenCanvas === 'function' && typeof createImageBitmap === 'function';
}

/**
 * Decode and analyse `blob` on the worker.
 *
 * Resolves to `{ auto, source, w, h, colorTransform }` — the same record
 * `analyzeAsset` returns, plus the decode that produced it — or to null when
 * there is no worker to be had or the worker could not finish. Null is not an
 * error: it means the caller does the work here, and nobody loses an analysis
 * because a thread failed.
 */
export async function analyzeBlobOffThread(blob) {
  if (!blob || !offThreadAnalysisAvailable()) return null;
  const id = ++sequence;
  try {
    clearTimeout(idleTimer);
    const instance = analysisWorker();
    const reply = await new Promise((resolve, reject) => {
      // `abandon` rejects this entry along with the rest: dropping it first
      // would leave this caller waiting on a worker nobody is listening to.
      const timer = setTimeout(() => abandon(new Error('analysis_worker_timeout')), REPLY_TIMEOUT_MS);
      waiting.set(id, { resolve, reject, timer });
      instance.postMessage({ id, blob });
    });
    return { auto: reply.auto, source: reply.source, w: reply.w, h: reply.h, colorTransform: reply.colorTransform };
  } catch {
    waiting.delete(id);
    scheduleRetirement();
    return null;
  }
}
