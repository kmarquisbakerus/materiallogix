import { canvasToBytes, renderCrop } from './crop.js';
import { colorExportDecision } from './color-management.js';
import { applyPixelAdjustments } from './editing.js';

export const PRINT_PPI = 300;
export const PRINT_REVIEW_PPI = 220;
export const PRINT_BLEED_INCHES = 0.125;

export const PRINT_PRESETS = Object.freeze([
  Object.freeze({ id: '4x6', label: '4 × 6 in', widthInches: 4, heightInches: 6 }),
  Object.freeze({ id: '5x7', label: '5 × 7 in', widthInches: 5, heightInches: 7 }),
  Object.freeze({ id: '8x10', label: '8 × 10 in', widthInches: 8, heightInches: 10 }),
  Object.freeze({ id: 'letter', label: 'US Letter · 8.5 × 11 in', widthInches: 8.5, heightInches: 11 }),
  Object.freeze({ id: '12x12', label: '12 × 12 in', widthInches: 12, heightInches: 12 })
]);

const PRESET_BY_ID = new Map(PRINT_PRESETS.map(preset => [preset.id, preset]));
const round = value => +value.toFixed(4);

function cropForRatio(sourceWidth, sourceHeight, targetWidth, targetHeight) {
  const sourceRatio = sourceWidth / sourceHeight;
  const targetRatio = targetWidth / targetHeight;
  if (sourceRatio > targetRatio) {
    const width = targetRatio / sourceRatio;
    return { x: (1 - width) / 2, y: 0, w: width, h: 1 };
  }
  const height = sourceRatio / targetRatio;
  return { x: 0, y: (1 - height) / 2, w: 1, h: height };
}

/**
 * Builds an exact, distortion-free print plan. The source quality decision is
 * based on the pixels that will actually be printed after crop or contain.
 */
export function planPrint({
  presetId = '8x10', orientation = 'portrait', fit = 'crop', bleed = false,
  sourceWidth, sourceHeight, ppi = PRINT_PPI
} = {}) {
  const preset = PRESET_BY_ID.get(presetId);
  if (!preset) throw new Error('unknown_print_size');
  if (!['portrait', 'landscape'].includes(orientation)) throw new Error('invalid_print_orientation');
  if (!['crop', 'contain'].includes(fit)) throw new Error('invalid_print_fit');
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth < 1 || sourceHeight < 1) {
    throw new Error('invalid_source_dimensions');
  }
  if (!Number.isInteger(ppi) || ppi < PRINT_REVIEW_PPI || ppi > 1200) throw new Error('invalid_print_ppi');

  const isLandscape = orientation === 'landscape' && preset.widthInches !== preset.heightInches;
  const trimWidthInches = isLandscape ? preset.heightInches : preset.widthInches;
  const trimHeightInches = isLandscape ? preset.widthInches : preset.heightInches;
  const bleedInches = bleed ? PRINT_BLEED_INCHES : 0;
  const bleedPixels = Math.round(bleedInches * ppi);
  const trimPixelWidth = Math.round(trimWidthInches * ppi);
  const trimPixelHeight = Math.round(trimHeightInches * ppi);
  const pixelWidth = trimPixelWidth + bleedPixels * 2;
  const pixelHeight = trimPixelHeight + bleedPixels * 2;
  const outputWidthInches = trimWidthInches + bleedInches * 2;
  const outputHeightInches = trimHeightInches + bleedInches * 2;
  const crop = fit === 'crop'
    ? cropForRatio(sourceWidth, sourceHeight, pixelWidth, pixelHeight)
    : { x: 0, y: 0, w: 1, h: 1 };
  const effectivePpi = Math.min(
    sourceWidth * crop.w / outputWidthInches,
    sourceHeight * crop.h / outputHeightInches
  );
  const quality = effectivePpi >= PRINT_PPI ? 'ready' : effectivePpi >= PRINT_REVIEW_PPI ? 'review' : 'blocked';

  return Object.freeze({
    presetId, presetLabel: preset.label, orientation, fit, ppi,
    trimWidthInches, trimHeightInches, bleedInches, bleedPixels,
    trimPixelWidth, trimPixelHeight, pixelWidth, pixelHeight,
    outputWidthInches: round(outputWidthInches), outputHeightInches: round(outputHeightInches),
    crop: Object.freeze({ ...crop }),
    effectivePpi: Math.floor(effectivePpi), quality,
    canExport: quality !== 'blocked'
  });
}

/** Print delivery is always an sRGB JPEG; unsupported input profiles stay blocked. */
export function printColorDecision(color = {}) {
  const decision = colorExportDecision(color);
  return Object.freeze({ ...decision, outputProfile: decision.allowed ? 'srgb' : null });
}

/** Render at exact print pixels without changing the source aspect ratio. */
export function renderPrint(source, sourceWidth, sourceHeight, plan, adjustments = null) {
  if (!plan?.canExport) throw new Error('insufficient_source_resolution');
  if (plan.fit === 'crop') {
    return renderCrop(source, sourceWidth, sourceHeight, plan.crop,
      { w: plan.pixelWidth, h: plan.pixelHeight }, 'crop', null, adjustments);
  }
  const canvas = document.createElement('canvas');
  canvas.width = plan.pixelWidth;
  canvas.height = plan.pixelHeight;
  const context = canvas.getContext('2d');
  context.imageSmoothingQuality = 'high';
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  const scale = Math.min(canvas.width / sourceWidth, canvas.height / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  context.drawImage(source, 0, 0, sourceWidth, sourceHeight,
    (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
  return adjustments ? applyPixelAdjustments(canvas, adjustments) : canvas;
}

function requireJpeg(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error('invalid_jpeg');
  }
}

function jfifSegment(bytes) {
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) throw new Error('malformed_jpeg_segment');
    const marker = bytes[offset + 1];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2 || offset + length + 2 > bytes.length) throw new Error('malformed_jpeg_segment');
    if (marker === 0xe0 && length >= 16 &&
        String.fromCharCode(...bytes.slice(offset + 4, offset + 9)) === 'JFIF\0') return { offset, length };
    offset += length + 2;
  }
  return null;
}

/** Writes a JFIF density declaration without recompressing image pixels. */
export function setJpegDensity(bytes, ppi = PRINT_PPI) {
  requireJpeg(bytes);
  if (!Number.isInteger(ppi) || ppi < 1 || ppi > 65535) throw new Error('invalid_jpeg_density');
  const existing = jfifSegment(bytes);
  if (existing) {
    const output = bytes.slice();
    output[existing.offset + 11] = 1;
    output[existing.offset + 12] = ppi >>> 8;
    output[existing.offset + 13] = ppi & 0xff;
    output[existing.offset + 14] = ppi >>> 8;
    output[existing.offset + 15] = ppi & 0xff;
    return output;
  }
  const segment = Uint8Array.from([
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00,
    0x01, 0x01, 0x01, ppi >>> 8, ppi & 0xff, ppi >>> 8, ppi & 0xff, 0x00, 0x00
  ]);
  const output = new Uint8Array(bytes.length + segment.length);
  output.set(bytes.slice(0, 2), 0);
  output.set(segment, 2);
  output.set(bytes.slice(2), segment.length + 2);
  return output;
}

export function readJpegDensity(bytes) {
  requireJpeg(bytes);
  const segment = jfifSegment(bytes);
  if (!segment) return null;
  const units = bytes[segment.offset + 11];
  const x = (bytes[segment.offset + 12] << 8) | bytes[segment.offset + 13];
  const y = (bytes[segment.offset + 14] << 8) | bytes[segment.offset + 15];
  return { units: units === 1 ? 'ppi' : units === 2 ? 'ppcm' : 'aspect-only', x, y };
}

export function encodePrintJpeg(canvas, ppi = PRINT_PPI, quality = 0.94) {
  return setJpegDensity(canvasToBytes(canvas, 'image/jpeg', quality), ppi);
}
