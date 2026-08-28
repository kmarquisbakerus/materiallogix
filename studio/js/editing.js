const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));

const clampByte = value => Math.max(0, Math.min(255, Math.round(value)));
const smoothstep = (edge0, edge1, value) => {
  const t = clamp((value - edge0) / Math.max(0.0001, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

export const EDIT_DEFAULTS = Object.freeze({
  mode: 'guided',
  adjustments: Object.freeze({
    exposure: 0, contrast: 0, highlights: 0, shadows: 0,
    temperature: 0, tint: 0, saturation: 0, vibrance: 0,
    denoise: 0, blur: 0, sharpen: 0, grain: 0, vignette: 0
  }),
  pixelGrid: Object.freeze({ enabled: false, columns: 12, sensitivity: 55 })
});

export function ensureEditState(asset) {
  asset.edit = asset.edit || {};
  asset.edit.mode = asset.edit.mode === 'advanced' ? 'advanced' : 'guided';
  asset.edit.adjustments = { ...EDIT_DEFAULTS.adjustments, ...(asset.edit.adjustments || {}) };
  asset.edit.pixelGrid = { ...EDIT_DEFAULTS.pixelGrid, ...(asset.edit.pixelGrid || {}) };
  return asset.edit;
}

export function previewFilter(adjustments = {}) {
  const a = { ...EDIT_DEFAULTS.adjustments, ...adjustments };
  const exposure = Math.pow(2, clamp(a.exposure, -2, 2));
  const contrast = 1 + clamp(a.contrast, -100, 100) / 100;
  const saturation = 1 + clamp(a.saturation, -100, 100) / 100 + clamp(a.vibrance, -100, 100) / 250;
  const hue = clamp(a.temperature, -100, 100) * -0.08 + clamp(a.tint, -100, 100) * 0.05;
  const blur = clamp(a.blur, 0, 20) / 4;
  return `brightness(${exposure}) contrast(${contrast}) saturate(${Math.max(0, saturation)}) hue-rotate(${hue}deg) blur(${blur}px)`;
}

/**
 * Bounded joint-bilateral cleanup for camera noise. The range weight prevents
 * pixels on opposite sides of a strong colour or luminance boundary from
 * bleeding together, while the fixed 3×3 neighbourhood keeps runtime bounded.
 */
export function edgeAwareDenoiseRgba(input, width, height, amount = 0) {
  const w = Math.trunc(Number(width));
  const h = Math.trunc(Number(height));
  if (w < 1 || h < 1 || !input || input.length !== w * h * 4) {
    throw new TypeError('Denoise requires a complete RGBA buffer and positive dimensions.');
  }
  const source = new Uint8ClampedArray(input);
  const strength = clamp(amount, 0, 100) / 100;
  if (!strength || w < 3 || h < 3) return source;

  const output = new Uint8ClampedArray(source);
  const rangeSigma = 10 + strength * 34;
  const rangeDenominator = 2 * rangeSigma * rangeSigma;
  const baseMix = 0.18 + strength * 0.74;
  const luma = index => 0.2126 * source[index] + 0.7152 * source[index + 1] + 0.0722 * source[index + 2];
  const offsets = [
    [-1, -1, 0.68], [0, -1, 1], [1, -1, 0.68],
    [-1, 0, 1],                    [1, 0, 1],
    [-1, 1, 0.68],  [0, 1, 1],  [1, 1, 0.68]
  ];

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const center = (y * w + x) * 4;
      const centerLuma = luma(center);
      const horizontal = Math.abs(luma(center - 4) - luma(center + 4));
      const vertical = Math.abs(luma(center - w * 4) - luma(center + w * 4));
      const edgeProtection = smoothstep(32, 96, Math.max(horizontal, vertical));
      const mix = baseMix * (1 - edgeProtection * 0.94);
      let weightSum = 1;
      const sum = [source[center], source[center + 1], source[center + 2]];

      for (const [dx, dy, spatialWeight] of offsets) {
        const neighbor = ((y + dy) * w + x + dx) * 4;
        const dr = source[neighbor] - source[center];
        const dg = source[neighbor + 1] - source[center + 1];
        const db = source[neighbor + 2] - source[center + 2];
        const colorDistance2 = (dr * dr + dg * dg + db * db) / 3;
        const lumaDistance = luma(neighbor) - centerLuma;
        const weight = spatialWeight * Math.exp(-(colorDistance2 + lumaDistance * lumaDistance) / rangeDenominator);
        weightSum += weight;
        sum[0] += source[neighbor] * weight;
        sum[1] += source[neighbor + 1] * weight;
        sum[2] += source[neighbor + 2] * weight;
      }

      for (let channel = 0; channel < 3; channel++) {
        const filtered = sum[channel] / weightSum;
        output[center + channel] = clampByte(source[center + channel] + (filtered - source[center + channel]) * mix);
      }
      output[center + 3] = source[center + 3];
    }
  }
  return output;
}

/**
 * Apply every visible photo adjustment to a rendered canvas. This is the
 * authoritative preview/export path; previewFilter remains a lightweight CSS
 * approximation for surfaces that cannot read pixels.
 */
export function applyPixelAdjustments(canvas, adjustments = {}) {
  const a = { ...EDIT_DEFAULTS.adjustments, ...adjustments };
  const width = canvas.width;
  const height = canvas.height;
  if (!width || !height) return canvas;
  if (!Object.values(a).some(value => Math.abs(Number(value) || 0) > 0.0001)) return canvas;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const blur = clamp(a.blur, 0, 20) / 4;
  if (blur > 0) {
    const copy = document.createElement('canvas');
    copy.width = width; copy.height = height;
    copy.getContext('2d').drawImage(canvas, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.filter = `blur(${blur}px)`;
    ctx.drawImage(copy, 0, 0);
    ctx.filter = 'none';
  }

  const image = ctx.getImageData(0, 0, width, height);
  if (clamp(a.denoise, 0, 100) > 0) {
    image.data.set(edgeAwareDenoiseRgba(image.data, width, height, a.denoise));
  }
  const data = image.data;
  const exposure = Math.pow(2, clamp(a.exposure, -2, 2));
  const contrast = 1 + clamp(a.contrast, -100, 100) / 100;
  const highlights = clamp(a.highlights, -100, 100) / 100;
  const shadows = clamp(a.shadows, -100, 100) / 100;
  const temperature = clamp(a.temperature, -100, 100) / 100;
  const tint = clamp(a.tint, -100, 100) / 100;
  const saturation = clamp(a.saturation, -100, 100) / 100;
  const vibrance = clamp(a.vibrance, -100, 100) / 100;
  const grain = clamp(a.grain, 0, 100) / 100;
  const vignette = clamp(a.vignette, 0, 100) / 100;
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const maxRadius = Math.max(1, Math.hypot(cx, cy));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      let r = data[i] * exposure;
      let g = data[i + 1] * exposure;
      let b = data[i + 2] * exposure;

      r = (r - 128) * contrast + 128;
      g = (g - 128) * contrast + 128;
      b = (b - 128) * contrast + 128;

      const toneLuma = clamp((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255, 0, 1);
      const highlightMask = smoothstep(0.42, 1, toneLuma);
      const shadowMask = 1 - smoothstep(0, 0.58, toneLuma);
      const toneDelta = 72 * (highlights * highlightMask + shadows * shadowMask);
      r += toneDelta; g += toneDelta; b += toneDelta;

      r += temperature * 24 + tint * 11;
      g -= tint * 20;
      b -= temperature * 24 - tint * 11;

      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const maxChannel = Math.max(r, g, b);
      const minChannel = Math.min(r, g, b);
      const chroma = clamp((maxChannel - minChannel) / 255, 0, 1);
      const vibranceStrength = vibrance * (1 - chroma) * 0.85;
      const colorScale = Math.max(0, 1 + saturation + vibranceStrength);
      r = luma + (r - luma) * colorScale;
      g = luma + (g - luma) * colorScale;
      b = luma + (b - luma) * colorScale;

      if (grain > 0) {
        const hash = Math.sin((x + 1) * 12.9898 + (y + 1) * 78.233) * 43758.5453;
        const noise = ((hash - Math.floor(hash)) * 2 - 1) * grain * 22;
        r += noise; g += noise; b += noise;
      }

      if (vignette > 0) {
        const radius = Math.hypot(x - cx, y - cy) / maxRadius;
        const edge = smoothstep(0.34, 1, radius);
        const gain = 1 - edge * vignette * 0.72;
        r *= gain; g *= gain; b *= gain;
      }

      data[i] = clampByte(r);
      data[i + 1] = clampByte(g);
      data[i + 2] = clampByte(b);
    }
  }

  const sharpen = clamp(a.sharpen, 0, 100) / 100;
  if (sharpen > 0 && width > 2 && height > 2) {
    const source = new Uint8ClampedArray(data);
    const amount = sharpen * 0.9;
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = (y * width + x) * 4;
        for (let channel = 0; channel < 3; channel++) {
          const center = source[i + channel];
          const neighbors = source[i - 4 + channel] + source[i + 4 + channel] +
            source[i - width * 4 + channel] + source[i + width * 4 + channel];
          data[i + channel] = clampByte(center + amount * (center * 4 - neighbors));
        }
      }
    }
  }

  ctx.putImageData(image, 0, 0);
  return canvas;
}

export function pixelGridReview(source, width, height, columns = 12, sensitivity = 55) {
  const cols = Math.round(clamp(columns, 6, 32));
  const rows = Math.max(4, Math.round(cols * height / Math.max(1, width)));
  const canvas = document.createElement('canvas');
  canvas.width = cols * 4;
  canvas.height = rows * 4;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const cell = (cx, cy) => {
    let r = 0, g = 0, b = 0, l = 0, l2 = 0, n = 0;
    for (let y = cy * 4; y < cy * 4 + 4; y++) for (let x = cx * 4; x < cx * 4 + 4; x++) {
      const i = (y * canvas.width + x) * 4;
      const rr = pixels[i], gg = pixels[i + 1], bb = pixels[i + 2];
      const yy = 0.2126 * rr + 0.7152 * gg + 0.0722 * bb;
      r += rr; g += gg; b += bb; l += yy; l2 += yy * yy; n++;
    }
    const mean = l / n;
    return { r: r / n, g: g / n, b: b / n, l: mean, variance: Math.max(0, l2 / n - mean * mean) };
  };
  const stats = Array.from({ length: rows }, (_, y) => Array.from({ length: cols }, (_, x) => cell(x, y)));
  const tiles = [];
  const threshold = 22 + (100 - clamp(sensitivity, 0, 100)) * 0.55;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const here = stats[y][x];
    const neighbors = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]
      .filter(([nx, ny]) => nx >= 0 && ny >= 0 && nx < cols && ny < rows)
      .map(([nx, ny]) => stats[ny][nx]);
    const discontinuity = neighbors.reduce((sum, n) => sum + Math.hypot(here.r - n.r, here.g - n.g, here.b - n.b), 0) / Math.max(1, neighbors.length);
    const textureMismatch = neighbors.reduce((sum, n) => sum + Math.abs(Math.sqrt(here.variance) - Math.sqrt(n.variance)), 0) / Math.max(1, neighbors.length);
    const score = Math.round(discontinuity * 0.72 + textureMismatch * 2.1);
    if (score >= threshold) tiles.push({ x, y, score, level: score >= threshold * 1.65 ? 'high' : 'review' });
  }
  return { cols, rows, tiles, threshold: Math.round(threshold) };
}

export function pixelGridOverlay(report) {
  const overlay = document.createElement('div');
  overlay.className = 'pixel-grid-overlay';
  overlay.style.setProperty('--grid-cols', report.cols);
  overlay.style.setProperty('--grid-rows', report.rows);
  for (const tile of report.tiles) {
    const mark = document.createElement('span');
    mark.className = `pixel-grid-tile ${tile.level}`;
    mark.style.gridColumn = String(tile.x + 1);
    mark.style.gridRow = String(tile.y + 1);
    mark.title = `Continuity review score ${tile.score}`;
    overlay.append(mark);
  }
  return overlay;
}
