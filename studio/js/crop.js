// Crop maths and rendering.
// Crops are stored normalized (0..1) against the source, so the same decision
// re-exports correctly at any pixel size.
import { applyPixelAdjustments } from './editing.js';

/** Largest centered crop of `src` that matches the surface aspect ratio. */
export function defaultCrop(srcW, srcH, surface) {
  const target = surface.w / surface.h;
  const source = srcW / srcH;
  if (source > target) {
    const w = target / source;
    return { x: (1 - w) / 2, y: 0, w, h: 1 };
  }
  const h = source / target;
  return { x: 0, y: (1 - h) / 2, w: 1, h };
}

export function clampCrop(crop) {
  // Math.max(0, NaN) is NaN, so a single bad number used to survive clamping
  // and reach the renderer as a crop with no position. Restored projects and
  // degenerate pointer maths can both produce one.
  const finite = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
  const w = Math.min(1, Math.max(0.02, finite(crop?.w, 1)));
  const h = Math.min(1, Math.max(0.02, finite(crop?.h, 1)));
  return {
    x: Math.min(1 - w, Math.max(0, finite(crop?.x, 0))),
    y: Math.min(1 - h, Math.max(0, finite(crop?.y, 0))),
    w,
    h
  };
}

/** Zoom about the crop centre. factor > 1 zooms in (smaller crop window). */
export function zoomCrop(crop, factor) {
  const cx = crop.x + crop.w / 2;
  const cy = crop.y + crop.h / 2;
  const w = crop.w / factor;
  const h = crop.h / factor;
  return clampCrop({ x: cx - w / 2, y: cy - h / 2, w, h });
}

export function panCrop(crop, dx, dy) {
  return clampCrop({ ...crop, x: crop.x + dx, y: crop.y + dy });
}

/** Degrees the straighten tool accepts, clamped at render so stored state can never leak a corner. */
const MAX_STRAIGHTEN_DEG = 15;

export function straightenRad(value) {
  const deg = Math.max(-MAX_STRAIGHTEN_DEG, Math.min(MAX_STRAIGHTEN_DEG, Number(value) || 0));
  return deg * Math.PI / 180;
}

/** Zoom that keeps a w×h frame fully covered by its own rotated copy. */
export function straightenCover(rad, w, h) {
  const a = Math.abs(rad);
  return Math.cos(a) + Math.max(w / h, h / w) * Math.sin(a);
}

/** Draw a crop region into its destination rect, tilted and auto-zoomed when straightening. */
export function drawStraightened(ctx, source, sx, sy, sw, sh, dx, dy, dw, dh, rad, clip) {
  if (!rad) return ctx.drawImage(source, sx, sy, sw, sh, dx, dy, dw, dh);
  ctx.save();
  if (clip) { ctx.beginPath(); ctx.rect(dx, dy, dw, dh); ctx.clip(); }
  ctx.translate(dx + dw / 2, dy + dh / 2);
  ctx.rotate(rad);
  ctx.scale(straightenCover(rad, dw, dh), straightenCover(rad, dw, dh));
  ctx.drawImage(source, sx, sy, sw, sh, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
}

/**
 * True when the crop window no longer matches the surface ratio — which means
 * the export would distort. Used to snap after a manual resize.
 */
export function snapToRatio(crop, srcW, srcH, surface) {
  const target = surface.w / surface.h;
  const pxW = crop.w * srcW;
  const pxH = crop.h * srcH;
  const current = pxW / pxH;
  if (Math.abs(current - target) < 0.001) return crop;
  const cx = crop.x + crop.w / 2;
  const cy = crop.y + crop.h / 2;
  let w, h;
  if (current > target) {
    h = crop.h;
    w = (h * srcH * target) / srcW;
  } else {
    w = crop.w;
    h = (w * srcW) / target / srcH;
  }
  return clampCrop({ x: cx - w / 2, y: cy - h / 2, w, h });
}

/** Destination rect the crop occupies inside a surface for a given fill. */
export function placementRect(srcW, srcH, crop, surface, fill = 'crop') {
  if (fill === 'crop') return { x: 0, y: 0, w: surface.w, h: surface.h };
  const sw = crop.w * srcW;
  const sh = crop.h * srcH;
  const scale = Math.min(surface.w / sw, surface.h / sh);
  return { x: (surface.w - sw * scale) / 2, y: (surface.h - sh * scale) / 2, w: sw * scale, h: sh * scale };
}

/**
 * Maps normalized source coordinates into a rendered placement, straighten
 * included, so edits anchored to the photograph land on the right pixels.
 */
export function adjustmentFrame(crop, rect, rotate = 0) {
  const rad = straightenRad(rotate);
  const cover = straightenCover(rad, rect.w, rect.h);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const point = (nx, ny) => {
    const lx = rect.x + ((nx - crop.x) / crop.w) * rect.w - cx;
    const ly = rect.y + ((ny - crop.y) / crop.h) * rect.h - cy;
    return [cx + (lx * cos - ly * sin) * cover, cy + (lx * sin + ly * cos) * cover];
  };
  const unpoint = (x, y) => {
    const lx = (x - cx) / cover;
    const ly = (y - cy) / cover;
    const ux = lx * cos + ly * sin + cx;
    const uy = -lx * sin + ly * cos + cy;
    return [crop.x + ((ux - rect.x) / rect.w) * crop.w, crop.y + ((uy - rect.y) / rect.h) * crop.h];
  };
  return { point, unpoint, radius: nr => Math.abs(Number(nr) || 0) * (rect.w / crop.w) * cover };
}

/**
 * Render one placement to an offscreen canvas at full surface resolution.
 * `fill` is 'crop' (cover), 'contain' (letterbox on flat colour) or
 * 'blur' (letterbox over a blurred, over-scaled copy of the same frame).
 */
export function renderCrop(source, srcW, srcH, crop, surface, fill = 'crop', target = null, adjustments = null) {
  // Callers that render in a loop should pass a scratch canvas. Allocating a
  // fresh one per placement means a fresh GPU texture per placement and adds
  // avoidable readback overhead during large exports.
  const canvas = target || document.createElement('canvas');
  canvas.width = surface.w;
  canvas.height = surface.h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';

  const sx = crop.x * srcW;
  const sy = crop.y * srcH;
  const sw = crop.w * srcW;
  const sh = crop.h * srcH;
  const rad = straightenRad(adjustments?.rotate);

  if (fill === 'crop') {
    drawStraightened(ctx, source, sx, sy, sw, sh, 0, 0, surface.w, surface.h, rad, false);
    return adjustments
      ? applyPixelAdjustments(canvas, adjustments, adjustmentFrame(crop, { x: 0, y: 0, w: surface.w, h: surface.h }, adjustments.rotate))
      : canvas;
  }

  // Letterboxed modes: fit the crop inside the frame, then fill the gutters.
  const rect = placementRect(srcW, srcH, crop, surface, fill);
  const { x: dx, y: dy, w: dw, h: dh } = rect;

  // Always lay down an opaque ground first. A canvas blur samples transparent
  // black outside the drawn rect, so without this the gutters come back with
  // alpha < 255 and every platform composites them differently.
  ctx.fillStyle = '#0d0d0f';
  ctx.fillRect(0, 0, surface.w, surface.h);

  if (fill === 'blur') {
    const radius = Math.round(Math.max(surface.w, surface.h) * 0.04);
    // Overscan far enough that the blur's own faded edge falls off-canvas,
    // straighten swing included.
    const cover = Math.max(surface.w / sw, surface.h / sh) * (1.15 + (radius * 4) / Math.max(surface.w, surface.h))
      * straightenCover(rad, surface.w, surface.h);
    const bw = sw * cover;
    const bh = sh * cover;
    if (rad) {
      ctx.save();
      ctx.translate(surface.w / 2, surface.h / 2);
      ctx.rotate(rad);
      ctx.translate(-surface.w / 2, -surface.h / 2);
    }
    ctx.filter = `blur(${radius}px)`;
    ctx.drawImage(source, sx, sy, sw, sh, (surface.w - bw) / 2, (surface.h - bh) / 2, bw, bh);
    ctx.filter = 'none';
    if (rad) ctx.restore();
  }

  drawStraightened(ctx, source, sx, sy, sw, sh, dx, dy, dw, dh, rad, true);
  return adjustments ? applyPixelAdjustments(canvas, adjustments, adjustmentFrame(crop, rect, adjustments.rotate)) : canvas;
}

/**
 * Encode a canvas to bytes.
 *
 * Deliberately synchronous. `toBlob` and `convertToBlob` are async and get
 * clamped to roughly one call per second once the tab is backgrounded — which
 * is precisely what happens when someone kicks off a long export and switches
 * away. `toDataURL` runs on the calling thread and is immune, at the cost of a
 * base64 round trip that costs about a millisecond.
 */
export function canvasToBytes(canvas, mime = 'image/jpeg', quality = 0.92) {
  const url = canvas.toDataURL(mime, quality);
  const binary = atob(url.slice(url.indexOf(',') + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Hand control back to the event loop between heavy items. setTimeout is
 * clamped to 1s in background tabs; a MessageChannel round trip is not.
 */
const yieldChannel = typeof MessageChannel === 'function' ? new MessageChannel() : null;
export function yieldToLoop() {
  if (!yieldChannel) return Promise.resolve();
  return new Promise(resolve => {
    yieldChannel.port1.onmessage = () => resolve();
    yieldChannel.port2.postMessage(0);
  });
}

/** Loads an <img> that is safe to draw to a canvas (same-origin blob URL). */
export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode image'));
    img.src = url;
  });
}

/** Grabs a still from a video at `time` seconds for crop preview and export. */
export function grabVideoFrame(url, time = 0) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.onloadeddata = () => {
      video.currentTime = Math.min(time, Math.max(0, video.duration - 0.05));
    };
    video.onseeked = () => {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0);
      resolve({ canvas, width: video.videoWidth, height: video.videoHeight, duration: video.duration });
    };
    video.onerror = () => reject(new Error('Could not decode video'));
    video.src = url;
  });
}

/**
 * Proof watermark: heavy tiled text across the ENTIRE frame, faces included.
 * A corner logo is a two-second inpaint; a full-frame tile at real opacity
 * means "removing" it regenerates the subject itself — at proof resolution,
 * what comes out is worth less than the render fee. Stock-agency model.
 */
export function applyProofWatermark(canvas, label = 'PROOF — NOT FOR PRODUCTION — DO NOT COPY') {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const diag = Math.hypot(w, h);
  const size = Math.max(12, Math.round(diag / 34));

  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(-Math.atan2(h, w));               // the screen diagonal
  // The site's editorial serif — brand-consistent even on the paywall.
  ctx.font = `600 ${size}px Fraunces, "Iowan Old Style", Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const text = `${label}   ·   `;
  const stepX = ctx.measureText(text).width;

  // Six bands sweeping the whole frame — smaller type, total coverage:
  // nothing escapes, and the image stays fully visible between the lines.
  const bandStep = diag / 9;
  for (let offset = -diag * 0.44; offset <= diag * 0.44; offset += bandStep) {
    for (let x = -diag; x <= diag; x += stepX) {
      ctx.fillStyle = 'rgba(0,0,0,0.38)';
      ctx.fillText(text, x + size / 16, offset + size / 16);
      ctx.fillStyle = 'rgba(255,255,255,0.44)';
      ctx.fillText(text, x, offset);
    }
  }
  ctx.restore();
  return canvas;
}

/** Proofs also ship small: cap the long edge so full-res never leaves. */
export function proofSurface(surface, maxEdge = 960) {
  const k = Math.min(1, maxEdge / Math.max(surface.w, surface.h));
  return { ...surface, w: Math.max(2, Math.round(surface.w * k / 2) * 2), h: Math.max(2, Math.round(surface.h * k / 2) * 2) };
}
