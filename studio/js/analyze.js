// Automated pre-flight analysis.
//
// Everything here is pure canvas + typed-array maths: no model downloads, no
// API calls, no cost, works offline. These checks do not replace the human
// reviewer — they tell the reviewer where to look, and they hard-block the
// mistakes that are objectively measurable (upscaling, crops that dump the
// subject under platform UI, re-using a rejected asset, missing alt text).

import { SURFACE_BY_ID } from './model.js';
import { inspectColorMetadata } from './color-management.js';

const SAMPLE_W = 256;   // analysis resolution: comparable scores across assets
const GRID = 32;        // energy map resolution

// --- sampling --------------------------------------------------------------

function sample(source, w, h) {
  const sw = SAMPLE_W;
  const sh = Math.max(1, Math.round((h / w) * sw));
  const c = document.createElement('canvas');
  c.width = sw; c.height = sh;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, sw, sh);
  return { data: ctx.getImageData(0, 0, sw, sh), w: sw, h: sh };
}

function toGray({ data, w, h }) {
  const g = new Float32Array(w * h);
  const d = data.data;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    g[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  }
  return g;
}

// --- sharpness -------------------------------------------------------------

function laplacian(gray, w, h) {
  const out = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      out[i] = Math.abs(4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w]);
    }
  }
  return out;
}

function sharpnessScore(lap) {
  let sum = 0, sum2 = 0, n = 0;
  for (let i = 0; i < lap.length; i++) { sum += lap[i]; sum2 += lap[i] * lap[i]; n++; }
  const mean = sum / n;
  return Math.round(sum2 / n - mean * mean);
}

// --- exposure --------------------------------------------------------------

function exposure({ data }) {
  const d = data.data;
  let blown = 0, crushed = 0, sum = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    if (l > 250) blown++;
    if (l < 6) crushed++;
    sum += l; n++;
  }
  return {
    blown: +(blown / n).toFixed(4),
    crushed: +(crushed / n).toFixed(4),
    meanLuma: Math.round(sum / n)
  };
}

const percentile = (values, fraction) => {
  if (!values.length) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.max(0, Math.floor((ordered.length - 1) * fraction)))];
};

/**
 * Estimate visible camera noise from low-gradient areas. Strong boundaries are
 * excluded so hair, fabric weave, typography, and object edges are not treated
 * as noise merely because they contain fine detail.
 */
export function estimateCameraNoise({ data, w, h }) {
  const pixels = data?.data || data;
  const width = Math.trunc(Number(w));
  const height = Math.trunc(Number(h));
  if (!pixels || width < 3 || height < 3 || pixels.length !== width * height * 4) {
    return { class: 'unavailable', score: 0, lumaResidual: 0, chromaResidual: 0, sampledPixels: 0, confidence: 0, suggestedReduction: 0 };
  }
  const lumaResiduals = [];
  const chromaResiduals = [];
  const stride = Math.max(1, Math.floor(Math.sqrt((width * height) / 32000)));
  const lumaAt = index => 0.2126 * pixels[index] + 0.7152 * pixels[index + 1] + 0.0722 * pixels[index + 2];
  for (let y = 1; y < height - 1; y += stride) {
    for (let x = 1; x < width - 1; x += stride) {
      const center = (y * width + x) * 4;
      const neighbors = [center - 4, center + 4, center - width * 4, center + width * 4];
      const neighborLuma = neighbors.map(lumaAt);
      const boundary = Math.max(
        Math.abs(neighborLuma[0] - neighborLuma[1]),
        Math.abs(neighborLuma[2] - neighborLuma[3]),
        ...neighborLuma.map(value => Math.abs(value - lumaAt(center)))
      );
      if (boundary > 72) continue;
      const localLuma = neighborLuma.reduce((sum, value) => sum + value, 0) / 4;
      lumaResiduals.push(Math.abs(lumaAt(center) - localLuma));
      let chroma = 0;
      for (const [first, second] of [[0, 1], [2, 1]]) {
        const centerDifference = pixels[center + first] - pixels[center + second];
        const localDifference = neighbors.reduce((sum, index) => sum + pixels[index + first] - pixels[index + second], 0) / 4;
        chroma += Math.abs(centerDifference - localDifference);
      }
      chromaResiduals.push(chroma / 2);
    }
  }
  const lumaResidual = percentile(lumaResiduals, 0.75);
  const chromaResidual = percentile(chromaResiduals, 0.75);
  const score = lumaResidual * 0.72 + chromaResidual * 0.28;
  const category = score < 1.5 ? 'clean' : score < 4.5 ? 'light' : score < 9 ? 'visible' : 'heavy';
  const suggestedReduction = category === 'heavy' ? 65 : category === 'visible' ? 45 : category === 'light' ? 20 : 0;
  const eligible = lumaResiduals.length;
  const possible = Math.ceil((width - 2) / stride) * Math.ceil((height - 2) / stride);
  return {
    class: category,
    score: +score.toFixed(2),
    lumaResidual: +lumaResidual.toFixed(2),
    chromaResidual: +chromaResidual.toFixed(2),
    sampledPixels: eligible,
    confidence: +Math.min(1, eligible / Math.max(1, possible * 0.35)).toFixed(3),
    suggestedReduction
  };
}

// --- energy map (where the visual interest lives) --------------------------

function energyGrid(gray, w, h) {
  const grid = new Float32Array(GRID * GRID);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = gray[i - 1] - gray[i + 1];
      const gy = gray[i - w] - gray[i + w];
      const mag = Math.hypot(gx, gy);
      const cell = Math.min(GRID - 1, Math.floor((y / h) * GRID)) * GRID
                 + Math.min(GRID - 1, Math.floor((x / w) * GRID));
      grid[cell] += mag;
    }
  }
  let total = 0;
  for (const v of grid) total += v;
  if (total > 0) for (let i = 0; i < grid.length; i++) grid[i] /= total;
  return Array.from(grid, v => +v.toFixed(5));
}

/** Share of total image energy inside a normalized rect. */
export function energyIn(grid, rect) {
  if (!grid) return null;
  let sum = 0;
  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      const cx = (gx + 0.5) / GRID;
      const cy = (gy + 0.5) / GRID;
      if (cx >= rect.x && cx < rect.x + rect.w && cy >= rect.y && cy < rect.y + rect.h) {
        sum += grid[gy * GRID + gx];
      }
    }
  }
  return sum;
}

/**
 * Of the energy kept by `crop`, how much lands under the surface's UI bands.
 * This is the check that catches "the face is behind the TikTok caption".
 */
export function energyUnderUi(grid, crop, surface) {
  const kept = energyIn(grid, crop);
  if (!kept) return 0;
  const bands = [];
  if (surface.safeTop) bands.push({ x: 0, y: 0, w: 1, h: surface.safeTop });
  if (surface.safeBottom) bands.push({ x: 0, y: 1 - surface.safeBottom, w: 1, h: surface.safeBottom });
  if (surface.safeRight) bands.push({ x: 1 - surface.safeRight, y: 0, w: surface.safeRight, h: 1 });
  if (surface.safeLeft) bands.push({ x: 0, y: 0, w: surface.safeLeft, h: 1 });
  if (!bands.length) return 0;

  // Bands are in *placement* space; map them back into source space.
  let covered = 0;
  const seen = new Set();
  for (const b of bands) {
    for (let gy = 0; gy < GRID; gy++) {
      for (let gx = 0; gx < GRID; gx++) {
        const key = gy * GRID + gx;
        if (seen.has(key)) continue;
        const cx = (gx + 0.5) / GRID;
        const cy = (gy + 0.5) / GRID;
        if (cx < crop.x || cx >= crop.x + crop.w || cy < crop.y || cy >= crop.y + crop.h) continue;
        const px = (cx - crop.x) / crop.w;
        const py = (cy - crop.y) / crop.h;
        if (px >= b.x && px < b.x + b.w && py >= b.y && py < b.y + b.h) {
          covered += grid[key];
          seen.add(key);
        }
      }
    }
  }
  return covered / kept;
}

/**
 * Energy-driven auto-reframe. Slides a window of the surface's aspect ratio
 * across the source at several zoom levels and keeps the frame that holds the
 * most visual interest while staying clear of the platform's UI bands.
 * This is the "reframe all surfaces" button — the crop nobody wants to do by hand.
 */
export function smartCrop(grid, srcW, srcH, surface, base, faces = []) {
  if (!grid || !srcW || !srcH) return base;
  const scales = [1, 0.88, 0.76, 0.64, 0.52];
  const steps = 14;
  let best = { score: -Infinity, crop: base };

  for (const scale of scales) {
    const w = Math.min(1, base.w * scale);
    const h = Math.min(1, base.h * scale);
    const maxX = 1 - w;
    const maxY = 1 - h;
    for (let i = 0; i <= steps; i++) {
      for (let j = 0; j <= steps; j++) {
        const crop = { x: (maxX * i) / steps, y: (maxY * j) / steps, w, h };
        const kept = energyIn(grid, crop);
        const hidden = energyUnderUi(grid, crop, surface);
        // Thirds bonus: reward energy concentrated off dead centre.
        const upper = energyIn(grid, { x: crop.x, y: crop.y, w: crop.w, h: crop.h * 0.62 });
        const thirds = kept ? Math.min(0.06, Math.abs(upper / kept - 0.62)) : 0;
        // Faces outrank everything: a crop that keeps them whole and clear of
        // UI wins even if it sheds background energy.
        let faceScore = 0;
        for (const f of faces) {
          const r = faceCropReport(f, crop, surface);
          if (r.state === 'clear') faceScore += 0.5;
          else if (r.state === 'near-ui') faceScore += 0.15;
          else if (r.state === 'cropped') faceScore -= 0.6;
          else if (r.state === 'under-ui') faceScore -= 0.8;
        }
        // Tighter frames must earn their crop, so mild penalty for zooming in.
        const score = kept - 1.8 * hidden * kept - thirds - (1 - scale) * 0.12 + faceScore;
        if (score > best.score) best = { score, crop };
      }
    }
  }
  return best.crop;
}

/** Fraction of rect `a`'s area that lies inside rect `b` (both normalized). */
export function rectOverlapFrac(a, b) {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const area = a.w * a.h;
  return area > 0 ? (ix * iy) / area : 0;
}

/** Map a source-space rect into placement space for a given crop window. */
export function toPlacementSpace(rect, crop) {
  return {
    x: (rect.x - crop.x) / crop.w,
    y: (rect.y - crop.y) / crop.h,
    w: rect.w / crop.w,
    h: rect.h / crop.h
  };
}

function surfaceBands(surface) {
  const bands = [];
  if (surface.safeTop) bands.push({ x: 0, y: 0, w: 1, h: surface.safeTop, name: 'top chrome' });
  if (surface.safeBottom) bands.push({ x: 0, y: 1 - surface.safeBottom, w: 1, h: surface.safeBottom, name: 'caption block' });
  if (surface.safeRight) bands.push({ x: 1 - surface.safeRight, y: 0, w: surface.safeRight, h: 1, name: 'right rail' });
  if (surface.safeLeft) bands.push({ x: 0, y: 0, w: surface.safeLeft, h: 1, name: 'left UI' });
  return bands;
}

/** How badly a detected face fares under this crop on this surface. */
export function faceCropReport(face, crop, surface) {
  const inCrop = rectOverlapFrac(face, crop);
  if (inCrop < 0.02) return { state: 'outside', inCrop, band: null };
  const placed = toPlacementSpace(face, crop);
  let worst = 0, worstBand = null;
  for (const band of surfaceBands(surface)) {
    const f = rectOverlapFrac(placed, band);
    if (f > worst) { worst = f; worstBand = band.name; }
  }
  if (inCrop < 0.6) return { state: 'cropped', inCrop, band: null };
  if (worst > 0.5) return { state: 'under-ui', inCrop, band: worstBand, underFrac: worst };
  if (worst > 0.25) return { state: 'near-ui', inCrop, band: worstBand, underFrac: worst };
  return { state: 'clear', inCrop, band: null };
}

// --- 360 capture coverage ----------------------------------------------------
// Identity packs are only as good as their angle coverage. BlazeFace keypoints
// give a workable head-yaw estimate: the nose tip's position between the two
// ear points reads 0.5 dead-frontal and slides toward an ear as the head turns.

/** Approximate yaw in degrees: 0 = frontal, negative = subject's right turn. */
export function estimateYawDeg(keypoints) {
  if (!keypoints || keypoints.length < 6) return null;
  const nose = keypoints[2], rightEar = keypoints[4], leftEar = keypoints[5];
  const span = leftEar.x - rightEar.x;
  if (Math.abs(span) < 1e-4) return null;
  const r = (nose.x - rightEar.x) / span;          // 0..1 across the head
  return Math.round(Math.max(-95, Math.min(95, (r - 0.5) * 190)));
}

/**
 * Judge a set of per-frame detections from a turntable video.
 * @param {Array<{faces: Array}>} frames  geometry per extracted frame
 * @returns coverage report with gaps and flags for the reviewer
 */
export function captureCoverage(frames) {
  const yaws = [];
  const flags = [];
  let missing = 0, crowded = 0;
  frames.forEach((f, i) => {
    const faces = f?.faces || [];
    if (faces.length === 0) { missing++; return; }
    if (faces.length > 1) { crowded++; }
    const yaw = estimateYawDeg(faces[0].keypoints);
    if (yaw != null) yaws.push({ frame: i, yaw });
  });
  if (missing) flags.push(`${missing} frame(s) have no detectable face — too fast, too dark, or turned past profile.`);
  if (crowded) flags.push(`${crowded} frame(s) contain more than one face — capture one person at a time.`);

  // Coverage in 30° buckets across -90..90.
  const buckets = new Set(yaws.map(y => Math.max(-3, Math.min(2, Math.floor(y.yaw / 30)))));
  const gaps = [];
  for (let b = -3; b <= 2; b++) {
    if (!buckets.has(b)) gaps.push(`${b * 30}° to ${(b + 1) * 30}°`);
  }
  const spread = yaws.length
    ? Math.max(...yaws.map(y => y.yaw)) - Math.min(...yaws.map(y => y.yaw))
    : 0;

  // Big yaw jumps between consecutive frames mean the turn was too fast.
  let fastTurns = 0;
  for (let i = 1; i < yaws.length; i++) {
    if (Math.abs(yaws[i].yaw - yaws[i - 1].yaw) > 40) fastTurns++;
  }
  if (fastTurns) flags.push(`${fastTurns} jump(s) over 40° between frames — turn about half as fast.`);

  return {
    frames: frames.length,
    facesFound: frames.length - missing,
    yawSpreadDeg: spread,
    coveredBuckets: buckets.size,
    gaps,
    flags,
    verdict: spread >= 120 && gaps.length <= 1 && !crowded && missing <= 1
      ? 'good'
      : spread >= 60 ? 'partial' : 'poor'
  };
}

// --- full-body 360 orientation ------------------------------------------------
// A body on a turntable is readable ALL the way around: the shoulder line's
// projected width gives the turn angle, and whether the face is visible
// disambiguates front from back. That is why body packs verify a true 360
// while face packs verify the front 180.

const FRONT_SPAN = 0.72;   // shoulder span / torso length when square to camera

/** 0 = facing camera, 90 = subject's left profile, 180 = back, 270 = right. */
export function estimateBodyYawDeg(body) {
  if (!body?.lShoulder || !body?.rShoulder || !body?.lHip || !body?.rHip) return null;
  const midHip = { x: (body.lHip.x + body.rHip.x) / 2, y: (body.lHip.y + body.rHip.y) / 2 };
  const midSh = { x: (body.lShoulder.x + body.rShoulder.x) / 2, y: (body.lShoulder.y + body.rShoulder.y) / 2 };
  const torso = Math.hypot(midSh.x - midHip.x, midSh.y - midHip.y);
  if (torso < 1e-4) return null;
  const span = (body.lShoulder.x - body.rShoulder.x) / torso;   // signed
  const s = Math.max(-1, Math.min(1, span / FRONT_SPAN));
  const facing = (body.nose?.v ?? 1) >= 0.5;
  let yaw = facing
    ? Math.asin(s) * 180 / Math.PI                    // -90..90, 0 = front
    : 180 - Math.asin(s) * 180 / Math.PI;             // 90..270, 180 = back
  return Math.round(((yaw % 360) + 360) % 360);
}

/** Coverage verdict for a full-body turntable, in 45-degree buckets of 360. */
export function captureCoverageBody(frames) {
  const yaws = [];
  const flags = [];
  let missing = 0;
  frames.forEach((f, i) => {
    const yaw = estimateBodyYawDeg(f?.body);
    if (yaw == null) { missing++; return; }
    yaws.push({ frame: i, yaw });
  });
  if (missing) flags.push(`${missing} frame(s) with no trackable body - too close, cropped, or too dark.`);

  const buckets = new Set(yaws.map(y => Math.floor(((y.yaw % 360) + 360) % 360 / 45)));
  const gaps = [];
  for (let b = 0; b < 8; b++) {
    if (!buckets.has(b)) gaps.push(`${b * 45}°-${(b + 1) * 45}°`);
  }
  let fastTurns = 0;
  for (let i = 1; i < yaws.length; i++) {
    let d = Math.abs(yaws[i].yaw - yaws[i - 1].yaw) % 360;
    if (d > 180) d = 360 - d;
    if (d > 60) fastTurns++;
  }
  if (fastTurns) flags.push(`${fastTurns} jump(s) over 60° between frames - spin about half as fast.`);

  return {
    frames: frames.length,
    bodiesFound: frames.length - missing,
    coveredBuckets: buckets.size,
    gaps,
    flags,
    verdict: buckets.size >= 7 && missing <= 1 && !fastTurns ? 'good'
      : buckets.size >= 5 ? 'partial' : 'poor'
  };
}

// --- perceptual hash (dHash) ----------------------------------------------

function dHash(source) {
  const c = document.createElement('canvas');
  c.width = 9; c.height = 8;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, 9, 8);
  const d = ctx.getImageData(0, 0, 9, 8).data;
  const lum = (x, y) => {
    const i = (y * 9 + x) * 4;
    return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  };
  let hex = '';
  for (let y = 0; y < 8; y++) {
    let nibble = 0, bits = 0, row = '';
    for (let x = 0; x < 8; x++) {
      nibble = (nibble << 1) | (lum(x, y) < lum(x + 1, y) ? 1 : 0);
      if (++bits === 4) { row += nibble.toString(16); nibble = 0; bits = 0; }
    }
    hex += row;
  }
  return hex;
}

export function hammingDistance(a, b) {
  if (!a || !b || a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
}

// --- palette ---------------------------------------------------------------

function palette({ data }) {
  const d = data.data;
  const bins = new Map();
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    const key = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
    bins.set(key, (bins.get(key) || 0) + 1);
  }
  const total = [...bins.values()].reduce((a, b) => a + b, 0) || 1;
  return [...bins.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([key, n]) => {
      const r = ((key >> 8) & 15) * 17, g = ((key >> 4) & 15) * 17, b = (key & 15) * 17;
      return { hex: '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join(''), pct: +(n / total).toFixed(3) };
    });
}

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const rgbDistance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Closest distance from any brand colour to any dominant colour, 0..441. */
export function paletteMatch(assetPalette, brandHexes) {
  if (!assetPalette?.length || !brandHexes?.length) return null;
  const brand = brandHexes.map(hexToRgb).filter(Boolean);
  if (!brand.length) return null;
  let best = Infinity;
  for (const b of brand) {
    for (const p of assetPalette) {
      const rgb = hexToRgb(p.hex);
      if (rgb) best = Math.min(best, rgbDistance(b, rgb));
    }
  }
  return Math.round(best);
}

export const brandHexesFrom = text => (text || '').match(/#[0-9a-fA-F]{6}\b/g) || [];

// --- skin-detail continuity hint -------------------------------------------
// Not AI detection. A cheap signal that skin-tone regions carry far less
// high-frequency detail than the rest of the frame, which is the single most
// common tell reviewers describe as "looks AI".

function skinSmoothness({ data, w, h }, gray, lap) {
  const d = data.data;
  let skinN = 0, skinHF = 0, otherN = 0, otherHF = 0;
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
    const isSkin = cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173 && gray[p] > 40 && gray[p] < 245;
    if (isSkin) { skinN++; skinHF += lap[p]; } else { otherN++; otherHF += lap[p]; }
  }
  const skinFrac = skinN / (w * h);
  if (skinFrac < 0.03) return null;

  const skinDetail = skinHF / skinN;
  const otherDetail = otherN ? otherHF / otherN : 0;
  // A tight portrait can be almost entirely skin, and a studio backdrop carries
  // no detail either — in both cases the relative comparison is meaningless, so
  // fall back to an absolute floor calibrated on the 256px analysis sample.
  const ABSOLUTE_REF = 6;
  const ratio = otherDetail > 0.5
    ? skinDetail / otherDetail
    : Math.min(1.5, skinDetail / ABSOLUTE_REF);
  return {
    skinFraction: +skinFrac.toFixed(3),
    ratio: +ratio.toFixed(3),
    basis: otherDetail > 0.5 ? 'relative' : 'absolute'
  };
}

// --- provenance ------------------------------------------------------------
// Reads what the file already declares. Free, and the only honest source of
// truth about origin — everything else is inference.

const MARKERS = [
  ['c2pa', /c2pa|jumbf|urn:uuid:.*c2pa/i],
  ['contentCredentials', /contentcredentials|Content Credentials/i],
  ['aiDigitalSource', /trainedAlgorithmicMedia|compositeWithTrainedAlgorithmicMedia|algorithmicMedia/i],
  ['xmp', /<x:xmpmeta|adobe:ns:meta/i]
];

export async function readProvenance(blob) {
  try {
    const head = new Uint8Array(await blob.slice(0, 512 * 1024).arrayBuffer());
    const text = new TextDecoder('latin1').decode(head);
    const found = {};
    for (const [key, re] of MARKERS) found[key] = re.test(text);
    const soft = /(?:Software|CreatorTool)[\x00-\x20"'>:=]{0,8}([\x20-\x7e]{3,40})/.exec(text);
    return { ...found, tool: soft ? soft[1].replace(/[<"'].*$/, '').trim() : null };
  } catch {
    return { c2pa: false, contentCredentials: false, aiDigitalSource: false, xmp: false, tool: null };
  }
}

// --- the entry point -------------------------------------------------------

export async function analyzeAsset(source, w, h, blob, colorTransform = null) {
  const s = sample(source, w, h);
  const gray = toGray(s);
  const lap = laplacian(gray, s.w, s.h);
  return {
    version: 1,
    at: new Date().toISOString(),
    width: w,
    height: h,
    megapixels: +((w * h) / 1e6).toFixed(2),
    bytes: blob?.size || 0,
    hash: dHash(source),
    sharpness: sharpnessScore(lap),
    exposure: exposure(s),
    cameraNoise: estimateCameraNoise(s),
    energy: energyGrid(gray, s.w, s.h),
    palette: palette(s),
    skin: skinSmoothness(s, gray, lap),
    provenance: blob ? await readProvenance(blob) : null,
    color: blob ? await inspectColorMetadata(blob, colorTransform) : null
  };
}

// --- issue derivation ------------------------------------------------------

const issue = (level, code, message, fix) => ({ level, code, message, fix });

export function assetIssues(asset, allAssets, project) {
  const out = [];
  const a = asset.auto;
  if (!a) return [issue('info', 'not-analyzed', 'Automated checks have not run on this asset yet.', 'Run checks')];

  if (a.sharpness < 40) {
    out.push(issue('warn', 'soft', `Low detail (sharpness index ${a.sharpness}). Reads soft at full size.`, 'Regenerate at higher resolution or pick a sharper take.'));
  }
  if (a.exposure.blown > 0.06) {
    out.push(issue('warn', 'blown', `${Math.round(a.exposure.blown * 100)}% of the frame is blown out.`, 'Recover highlights before shipping.'));
  }
  if (a.exposure.crushed > 0.12) {
    out.push(issue('info', 'crushed', `${Math.round(a.exposure.crushed * 100)}% of the frame is crushed to black.`));
  }
  if (a.cameraNoise?.class === 'visible' || a.cameraNoise?.class === 'heavy') {
    const label = a.cameraNoise.class === 'heavy' ? 'Heavy camera noise' : 'Visible camera noise';
    out.push(issue('warn', 'camera-noise', `${label} may soften fine detail.`, 'Try Noise cleanup, then review skin, hair, and fabric at full size.'));
  }
  if (a.color?.cmyk || a.color?.profile === 'cmyk') {
    out.push(issue('block', 'cmyk-conversion-required',
      'A CMYK source profile was detected, but no accepted conversion is available.',
      'Convert to sRGB through a verified color-managed workflow, then re-import.'));
  }
  if (a.color?.hdrSignaled && !a.color?.toneMappingApplied) {
    out.push(issue('block', 'hdr-tone-map-required',
      'HDR color signaling was detected, but no accepted tone map was applied.',
      'Convert through the approved HDR-to-sRGB delivery path before export.'));
  } else if (a.color?.profile === 'adobe-rgb') {
    out.push(issue('block', 'adobe-rgb-acceptance-required',
      'This wide-gamut source cannot be delivered until the profile license and encoded conversion fixture are accepted.',
      'Convert to embedded sRGB through a verified color-managed workflow, then re-import.'));
  } else if (a.color?.profile === 'embedded-icc-unclassified') {
    out.push(issue('block', 'embedded-profile-unclassified',
      'The embedded color profile could not be classified safely.',
      'Convert to embedded sRGB through a verified color-managed workflow, then re-import.'));
  } else if (a.color?.profile === 'display-p3' && !a.color?.conversionAccepted) {
    out.push(issue('block', 'display-p3-conversion-unverified',
      'Display P3 was detected, but this decode did not complete the accepted sRGB conversion.',
      'Re-open the source in a supported browser or convert it to embedded sRGB.'));
  } else if (a.color?.profile && !['srgb', 'untagged-srgb-fallback'].includes(a.color.profile)) {
    out.push(issue('info', 'color-profile-recorded',
      `Input color profile recorded as ${a.color.profile}; delivery remains sRGB.`,
      'Review brand and skin-tone benchmark patches before final approval.'));
  }
  if (a.skin && a.skin.ratio < 0.35) {
    out.push(issue('warn', 'waxy-skin', `Skin regions retain ${Math.round(a.skin.ratio * 100)}% of the frame's detail level.`, 'Review skin-detail continuity at 100% before approving.'));
  }
  if (asset.kind === 'video' && asset.temporal?.samples?.length) {
    const t = asset.temporal;
    if (t.sharpnessMin < 25) {
      out.push(issue('warn', 'video-soft-section', `Motion QA found a soft section (lowest sampled sharpness ${t.sharpnessMin}).`, 'Review the indicated timeline samples and replace or trim the soft section.'));
    }
    if (t.blownMax > 0.1) {
      out.push(issue('warn', 'video-blown-section', `A sampled video section has ${Math.round(t.blownMax * 100)}% clipped highlights.`, 'Review exposure across the full timeline.'));
    }
    if (t.crushedMax > 0.25) {
      out.push(issue('warn', 'video-dark-section', `A sampled video section has ${Math.round(t.crushedMax * 100)}% crushed blacks.`, 'Check fades and dark sections before delivery.'));
    }
  }

  // Geometry: point the human at what the models found.
  if (asset.geometry) {
    const hands = asset.geometry.hands || [];
    if (hands.length) {
      out.push(issue('info', 'hands-present', `${hands.length} hand(s) detected. The landmark model cannot count fingers on a bad hand, so loupe each one before approving.`));
    }
    if (!asset.geometry.faces?.length && asset.role === 'candidate') {
      out.push(issue('info', 'no-face', 'No face detected. Fine for product shots; a miss worth checking on people shots.'));
    }
  }

  // Near-duplicate of something already rejected.
  const dead = new Set(['rejected', 'needs-new-generation']);
  for (const other of allAssets) {
    if (other.id === asset.id || !other.auto?.hash) continue;
    const dist = hammingDistance(a.hash, other.auto.hash);
    if (dist <= 6) {
      if (dead.has(other.status) || other.role === 'rejected-example') {
        out.push(issue('block', 'dupe-rejected', `Near-identical to a rejected asset (${other.filename}, distance ${dist}).`, 'Do not ship. Generate a genuinely different take.'));
      } else if (dist <= 3) {
        out.push(issue('info', 'dupe', `Near-identical to ${other.filename} (distance ${dist}).`));
      }
    }
  }

  // Brand palette.
  const brandHexes = brandHexesFrom(project?.brief?.brandRules);
  if (brandHexes.length) {
    const d = paletteMatch(a.palette, brandHexes);
    if (d != null && d > 120) {
      out.push(issue('info', 'palette', `No dominant colour is close to the brand palette (nearest distance ${d}).`));
    }
  }

  // Provenance.
  const hasApproved = Object.values(asset.placements || {}).some(p => p.decision === 'approved');
  if (hasApproved && !asset.provenance && !a.provenance?.c2pa) {
    out.push(issue('warn', 'provenance', 'Approved but no provenance recorded and no Content Credentials in the file.', 'Record the source, model, and licence.'));
  }
  if (hasApproved && !asset.altText) {
    out.push(issue('block', 'alt', 'Approved with no alt text.', 'Write alt text before export.'));
  }
  if (a.provenance?.aiDigitalSource) {
    out.push(issue('info', 'ai-declared', 'File declares AI-generated provenance metadata. Some placements require disclosure.'));
  }
  return out;
}

export function placementIssues(asset, surfaceId, project) {
  const surface = SURFACE_BY_ID[surfaceId];
  const p = asset.placements?.[surfaceId];
  const out = [];
  if (!surface || !p) return out;

  const srcW = asset.width, srcH = asset.height;
  if (srcW && srcH) {
    const cropPxW = p.crop.w * srcW;
    const cropPxH = p.crop.h * srcH;
    const factor = Math.max(surface.w / cropPxW, surface.h / cropPxH);
    if (factor > 1.6) {
      out.push(issue('block', 'upscale', `Export would upscale ${factor.toFixed(1)}× (${Math.round(cropPxW)}×${Math.round(cropPxH)} → ${surface.w}×${surface.h}).`, 'Zoom out, or use a higher-resolution source.'));
    } else if (factor > 1.05) {
      out.push(issue('warn', 'upscale-soft', `Export upscales ${factor.toFixed(2)}×. Acceptable for feed, risky for a hero.`));
    }
  }

  const faces = asset.geometry?.faces || [];
  for (const face of faces) {
    const r = faceCropReport(face, p.crop, surface);
    if (r.state === 'under-ui') {
      out.push(issue('block', 'face-under-ui', `A detected face sits ${Math.round((r.underFrac || 0) * 100)}% under the ${r.band}.`, 'Reframe so the face clears the platform UI.'));
    } else if (r.state === 'cropped') {
      out.push(issue('block', 'face-cropped', `This crop cuts a detected face to ${Math.round(r.inCrop * 100)}% visible.`, 'Reframe to keep the face whole, or deny this placement.'));
    } else if (r.state === 'near-ui') {
      out.push(issue('warn', 'face-near-ui', `A detected face runs ${Math.round((r.underFrac || 0) * 100)}% into the ${r.band}.`));
    }
  }

  const grid = asset.auto?.energy;
  if (grid) {
    const kept = energyIn(grid, p.crop);
    if (kept != null && kept < 0.35) {
      out.push(issue('warn', 'energy-lost', `This crop keeps only ${Math.round(kept * 100)}% of the frame's visual interest.`, 'Reframe, or give this placement its own composition.'));
    }
    const underUi = energyUnderUi(grid, p.crop, surface);
    if (underUi > 0.3) {
      out.push(issue('block', 'under-ui', `${Math.round(underUi * 100)}% of the subject sits under ${surface.label} UI (caption, rail, or chrome).`, 'Reframe so the subject clears the safe zones.'));
    } else if (underUi > 0.18) {
      out.push(issue('warn', 'near-ui', `${Math.round(underUi * 100)}% of the subject sits under platform UI.`));
    }
  }

  if (srcW && srcH && p.fill === 'crop') {
    const srcRatio = srcW / srcH;
    const dstRatio = surface.w / surface.h;
    const stretch = Math.max(srcRatio / dstRatio, dstRatio / srcRatio);
    if (stretch > 2.6) {
      out.push(issue('info', 'ratio', `Source is ${srcRatio.toFixed(2)}:1, placement is ${dstRatio.toFixed(2)}:1. Blur fill or a dedicated composition usually reads better.`));
    }
  }
  return out;
}

/** Whole-project preflight, run before an export is allowed. */
export function preflight(project, assets) {
  const items = [];
  for (const asset of assets) {
    const approved = Object.entries(asset.placements || {}).filter(([, p]) => p.decision === 'approved');
    if (!approved.length) continue;
    for (const i of assetIssues(asset, assets, project)) items.push({ ...i, asset: asset.filename, assetId: asset.id });
    for (const [sid] of approved) {
      for (const i of placementIssues(asset, sid, project)) {
        items.push({ ...i, asset: asset.filename, assetId: asset.id, surface: SURFACE_BY_ID[sid]?.label || sid });
      }
    }
  }
  // Surfaces in scope with nothing approved.
  for (const sid of project.surfaces || []) {
    const has = assets.some(a => a.placements?.[sid]?.decision === 'approved');
    if (!has) {
      items.push(issue('warn', 'gap', `No approved asset for ${SURFACE_BY_ID[sid]?.label || sid}.`, 'Ship incomplete only on purpose.'));
    }
  }
  const rank = { block: 0, warn: 1, info: 2 };
  items.sort((a, b) => rank[a.level] - rank[b.level]);
  return {
    items,
    blocks: items.filter(i => i.level === 'block').length,
    warns: items.filter(i => i.level === 'warn').length
  };
}
