// Deterministic delivery color contract. Browser canvas output is explicitly
// treated as sRGB; conversions below let fixtures quantify drift instead of
// relying on visual impressions alone.

export const COLOR_PIPELINE = Object.freeze({
  inputPolicy: 'embedded-profile-or-srgb-fallback',
  workingSpace: 'srgb-linear',
  deliverySpace: 'srgb',
  renderingIntent: 'relative-colorimetric',
  alphaMode: 'unpremultiplied-for-analysis',
  version: 2
});

const BT2020_PRIMARIES = Object.freeze([0.708, 0.292, 0.17, 0.797, 0.131, 0.046, 0.3127, 0.329]);
const HDR_MAX_PIXELS = 16_777_216;
const HDR_MAX_DIMENSION = 8192;

export const COLOR_PROFILE_ACCEPTANCE = Object.freeze({
  srgb: 'accepted',
  'untagged-srgb-fallback': 'accepted',
  'display-p3': 'accepted-browser-conversion',
  'bt2020-linear': 'accepted-radiance-tone-map',
  // Adobe's official profile cannot be bundled with application software under
  // the end-user license. Keep delivery blocked until the owner accepts a
  // separate bundling agreement and a real encoded fixture passes acceptance.
  'adobe-rgb': 'blocked-bundling-license-and-fixture',
  cmyk: 'blocked-no-accepted-conversion',
  'embedded-icc-unclassified': 'blocked-unclassified-profile'
});

export const srgbToLinear = value => {
  const c = Math.max(0, Math.min(1, Number(value) || 0));
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

export const linearToSrgb = value => {
  const c = Math.max(0, Math.min(1, Number(value) || 0));
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
};

export function rgbToLab([r, g, b]) {
  const [rl, gl, bl] = [r, g, b].map(value => srgbToLinear(value / 255));
  const x = (0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl) / 0.95047;
  const y = 0.2126729 * rl + 0.7151522 * gl + 0.072175 * bl;
  const z = (0.0193339 * rl + 0.119192 * gl + 0.9503041 * bl) / 1.08883;
  const f = v => v > 216 / 24389 ? Math.cbrt(v) : (24389 / 27 * v + 16) / 116;
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

export function deltaE76(a, b) {
  const aa = rgbToLab(a), bb = rgbToLab(b);
  return Math.hypot(aa[0] - bb[0], aa[1] - bb[1], aa[2] - bb[2]);
}

export function colorBenchmark(expected = [], observed = [], tolerance = 2.5) {
  if (!expected.length || expected.length !== observed.length) {
    return { status: 'blocked', reason: 'invalid_benchmark_samples', patches: 0 };
  }
  const errors = expected.map((rgb, index) => deltaE76(rgb, observed[index]));
  const meanDeltaE = errors.reduce((sum, value) => sum + value, 0) / errors.length;
  const maxDeltaE = Math.max(...errors);
  return {
    status: maxDeltaE <= tolerance ? 'pass' : 'blocked',
    patches: errors.length,
    meanDeltaE: +meanDeltaE.toFixed(3),
    maxDeltaE: +maxDeltaE.toFixed(3),
    tolerance
  };
}

export function colorExportDecision(color = {}) {
  const profile = color.profile || 'unknown';
  if (color.hdrSignaled && !color.toneMappingApplied) {
    return { allowed: false, reason: 'hdr_tone_map_required' };
  }
  if (profile === 'bt2020-linear' && color.toneMappingApplied && color.conversionAccepted) {
    return { allowed: true, reason: 'radiance_hdr_tone_mapped_to_srgb' };
  }
  if (profile === 'display-p3') {
    return color.conversionAccepted
      ? { allowed: true, reason: 'display_p3_converted_to_srgb' }
      : { allowed: false, reason: 'display_p3_conversion_unverified' };
  }
  if (profile === 'adobe-rgb') return { allowed: false, reason: 'adobe_rgb_bundling_license_and_fixture_required' };
  if (profile === 'cmyk') return { allowed: false, reason: 'cmyk_conversion_unaccepted' };
  if (profile === 'embedded-icc-unclassified') return { allowed: false, reason: 'embedded_profile_unclassified' };
  if (profile === 'unknown') return { allowed: false, reason: 'color_profile_unknown' };
  return { allowed: true, reason: profile === 'srgb' ? 'embedded_srgb' : 'untagged_srgb_fallback' };
}

const ICC_RGB_COLORANTS = Object.freeze({
  srgb: {
    rXYZ: [0.43604, 0.22244, 0.01390], gXYZ: [0.38510, 0.71693, 0.09708], bXYZ: [0.14307, 0.06062, 0.71393]
  },
  'display-p3': {
    rXYZ: [0.51512, 0.24120, 0], gXYZ: [0.29198, 0.69225, 0.04182], bXYZ: [0.15710, 0.06656, 0.78308]
  },
  'adobe-rgb': {
    rXYZ: [0.60976, 0.31112, 0.01948], gXYZ: [0.20524, 0.62566, 0.06089], bXYZ: [0.14922, 0.06322, 0.74484]
  }
});

const readU32 = (bytes, offset) => (bytes[offset] * 0x1000000) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3];
const readS15Fixed16 = (bytes, offset) => {
  const unsigned = readU32(bytes, offset);
  const signed = unsigned > 0x7fffffff ? unsigned - 0x100000000 : unsigned;
  return signed / 65536;
};
const ascii = (bytes, start, length) => String.fromCharCode(...bytes.slice(start, start + length));

const startsWithAscii = (bytes, text) => text.length <= bytes.length
  && [...text].every((character, index) => bytes[index] === character.charCodeAt(0));

function parseRadianceHeader(bytes) {
  if (!(bytes instanceof Uint8Array) || (!startsWithAscii(bytes, '#?RADIANCE') && !startsWithAscii(bytes, '#?RGBE'))) return null;
  let headerEnd = -1;
  for (let index = 0; index + 1 < bytes.length; index++) {
    if (bytes[index] === 10 && bytes[index + 1] === 10) { headerEnd = index + 2; break; }
    if (index + 3 < bytes.length && bytes[index] === 13 && bytes[index + 1] === 10 && bytes[index + 2] === 13 && bytes[index + 3] === 10) {
      headerEnd = index + 4; break;
    }
  }
  if (headerEnd < 0) throw new Error('radiance_header_incomplete');
  let resolutionEnd = headerEnd;
  while (resolutionEnd < bytes.length && bytes[resolutionEnd] !== 10 && bytes[resolutionEnd] !== 13) resolutionEnd++;
  const header = new TextDecoder('ascii').decode(bytes.slice(0, headerEnd));
  const resolution = new TextDecoder('ascii').decode(bytes.slice(headerEnd, resolutionEnd)).trim();
  const match = /^-Y\s+(\d+)\s+\+X\s+(\d+)$/.exec(resolution);
  if (!match) throw new Error('radiance_orientation_unsupported');
  const height = Number(match[1]), width = Number(match[2]);
  if (!width || !height || width > HDR_MAX_DIMENSION || height > HDR_MAX_DIMENSION || width * height > HDR_MAX_PIXELS) {
    throw new Error('radiance_dimensions_unsupported');
  }
  if (!/^FORMAT=32-bit_rle_rgbe$/m.test(header)) throw new Error('radiance_format_unsupported');
  const primaryText = /^PRIMARIES=([^\r\n]+)$/m.exec(header)?.[1];
  const primaries = primaryText?.trim().split(/\s+/).map(Number);
  if (!primaries || primaries.length !== 8 || primaries.some((value, index) => !Number.isFinite(value) || Math.abs(value - BT2020_PRIMARIES[index]) > 0.0002)) {
    throw new Error('radiance_bt2020_primaries_required');
  }
  const exposure = Number(/^EXPOSURE=([^\r\n]+)$/m.exec(header)?.[1] || 1);
  if (!Number.isFinite(exposure) || exposure <= 0 || exposure > 100) throw new Error('radiance_exposure_invalid');
  while (resolutionEnd < bytes.length && (bytes[resolutionEnd] === 10 || bytes[resolutionEnd] === 13)) resolutionEnd++;
  return { width, height, exposure, dataOffset: resolutionEnd, header };
}

function decodeRadianceChannels(bytes, header) {
  const { width, height } = header;
  const rgbe = new Uint8Array(width * height * 4);
  let offset = header.dataOffset;
  if (width < 8 || width > 32767) {
    const required = width * height * 4;
    if (offset + required !== bytes.length) throw new Error('radiance_flat_data_invalid');
    rgbe.set(bytes.slice(offset));
    return rgbe;
  }
  for (let y = 0; y < height; y++) {
    if (offset + 4 > bytes.length || bytes[offset] !== 2 || bytes[offset + 1] !== 2
      || ((bytes[offset + 2] << 8) | bytes[offset + 3]) !== width) throw new Error('radiance_scanline_invalid');
    offset += 4;
    const channels = [new Uint8Array(width), new Uint8Array(width), new Uint8Array(width), new Uint8Array(width)];
    for (const channel of channels) {
      let x = 0;
      while (x < width) {
        if (offset >= bytes.length) throw new Error('radiance_rle_truncated');
        const code = bytes[offset++];
        if (code > 128) {
          const run = code - 128;
          if (!run || x + run > width || offset >= bytes.length) throw new Error('radiance_rle_run_invalid');
          channel.fill(bytes[offset++], x, x + run); x += run;
        } else {
          if (!code || x + code > width || offset + code > bytes.length) throw new Error('radiance_rle_literal_invalid');
          channel.set(bytes.slice(offset, offset + code), x); offset += code; x += code;
        }
      }
    }
    for (let x = 0; x < width; x++) for (let channel = 0; channel < 4; channel++) rgbe[(y * width + x) * 4 + channel] = channels[channel][x];
  }
  if (offset !== bytes.length) throw new Error('radiance_trailing_data');
  return rgbe;
}

export function parseRadianceHdr(bytes) {
  const header = parseRadianceHeader(bytes);
  if (!header) return null;
  const rgbe = decodeRadianceChannels(bytes, header);
  const linearBt2020 = new Float32Array(header.width * header.height * 3);
  let maximumLinear = 0, minimumPositive = Infinity;
  for (let pixel = 0; pixel < header.width * header.height; pixel++) {
    const exponent = rgbe[pixel * 4 + 3];
    if (!exponent) continue;
    const scale = 2 ** (exponent - 136) / header.exposure;
    for (let channel = 0; channel < 3; channel++) {
      const value = rgbe[pixel * 4 + channel] * scale;
      linearBt2020[pixel * 3 + channel] = value;
      maximumLinear = Math.max(maximumLinear, value);
      if (value > 0) minimumPositive = Math.min(minimumPositive, value);
    }
  }
  const dynamicRangeStops = maximumLinear > 0 && Number.isFinite(minimumPositive)
    ? Math.log2(maximumLinear / minimumPositive) : 0;
  return { width: header.width, height: header.height, linearBt2020, maximumLinear,
    dynamicRangeStops: +dynamicRangeStops.toFixed(3), exposure: header.exposure };
}

const acesToneMap = value => {
  const x = Math.max(0, Number(value) || 0);
  return Math.max(0, Math.min(1, (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14)));
};

export function toneMapLinearBt2020ToSrgb(linearBt2020) {
  if (!(linearBt2020 instanceof Float32Array) || linearBt2020.length % 3) throw new Error('hdr_linear_pixels_invalid');
  const output = new Uint8ClampedArray(linearBt2020.length / 3 * 4);
  let clippedChannels = 0;
  for (let pixel = 0; pixel < linearBt2020.length / 3; pixel++) {
    const r2020 = Math.max(0, linearBt2020[pixel * 3]);
    const g2020 = Math.max(0, linearBt2020[pixel * 3 + 1]);
    const b2020 = Math.max(0, linearBt2020[pixel * 3 + 2]);
    const sourceLuma = 0.2627 * r2020 + 0.6780 * g2020 + 0.0593 * b2020;
    const mappedLuma = acesToneMap(sourceLuma);
    const scale = sourceLuma > 1e-8 ? mappedLuma / sourceLuma : 0;
    const r = (1.660491 * r2020 - 0.587641 * g2020 - 0.07285 * b2020) * scale;
    const g = (-0.12455 * r2020 + 1.1329 * g2020 - 0.00835 * b2020) * scale;
    const b = (-0.018151 * r2020 - 0.100579 * g2020 + 1.11873 * b2020) * scale;
    for (const [channel, value] of [r, g, b].entries()) {
      if (value < 0 || value > 1) clippedChannels++;
      output[pixel * 4 + channel] = Math.round(linearToSrgb(Math.max(0, Math.min(1, value))) * 255);
    }
    output[pixel * 4 + 3] = 255;
  }
  return { pixels: output, clippedChannelFraction: +(clippedChannels / linearBt2020.length).toFixed(6),
    toneMap: 'aces-luminance-v1', deliverySpace: 'srgb' };
}

export async function decodeColorManagedBlob(blob) {
  if (!blob?.arrayBuffer) return null;
  const head = new Uint8Array(await blob.slice(0, 1024 * 1024).arrayBuffer());
  const radiance = (startsWithAscii(head, '#?RADIANCE') || startsWithAscii(head, '#?RGBE'))
    ? parseRadianceHdr(new Uint8Array(await blob.arrayBuffer())) : null;
  if (radiance) {
    const converted = toneMapLinearBt2020ToSrgb(radiance.linearBt2020);
    const canvas = document.createElement('canvas');
    canvas.width = radiance.width; canvas.height = radiance.height;
    const context = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true });
    context.putImageData(new ImageData(converted.pixels, radiance.width, radiance.height), 0, 0);
    return { source: canvas, w: radiance.width, h: radiance.height, colorTransform: {
      conversion: converted.toneMap, conversionAccepted: true, toneMappingApplied: true,
      sourceDynamicRangeStops: radiance.dynamicRangeStops, sourceMaximumLinear: +radiance.maximumLinear.toFixed(6),
      clippedChannelFraction: converted.clippedChannelFraction
    } };
  }
  const metadata = await inspectColorMetadata(blob);
  if (!['display-p3', 'adobe-rgb', 'cmyk'].includes(metadata.profile)) return null;
  if (typeof createImageBitmap !== 'function') return null;
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'default', premultiplyAlpha: 'none' });
  const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
  const context = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true });
  context.drawImage(bitmap, 0, 0); bitmap.close?.();
  return { source: canvas, w: canvas.width, h: canvas.height, colorTransform: {
    conversion: 'browser-icc-to-srgb', conversionAccepted: metadata.profile === 'display-p3', toneMappingApplied: false
  } };
}

export function extractJpegIcc(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const parts = [];
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) { offset++; continue; }
    const marker = bytes[offset + 1];
    if (marker === 0xd9 || marker === 0xda) break;
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2 || offset + 2 + length > bytes.length) break;
    const payload = offset + 4;
    if (marker === 0xe2 && length >= 16 && ascii(bytes, payload, 12) === 'ICC_PROFILE\0') {
      parts.push({ sequence: bytes[payload + 12], count: bytes[payload + 13], data: bytes.slice(payload + 14, offset + 2 + length) });
    }
    offset += 2 + length;
  }
  if (!parts.length) return null;
  parts.sort((a, b) => a.sequence - b.sequence);
  const count = parts[0].count;
  if (count !== parts.length || parts.some((part, index) => part.count !== count || part.sequence !== index + 1)) return null;
  const size = parts.reduce((sum, part) => sum + part.data.length, 0);
  const profile = new Uint8Array(size);
  let at = 0;
  for (const part of parts) { profile.set(part.data, at); at += part.data.length; }
  return profile;
}

export function readIccRgbColorants(profile) {
  if (!(profile instanceof Uint8Array) || profile.length < 132) return null;
  const tagCount = readU32(profile, 128);
  if (!Number.isSafeInteger(tagCount) || tagCount < 1 || tagCount > 256 || 132 + tagCount * 12 > profile.length) return null;
  const result = {};
  for (let index = 0; index < tagCount; index++) {
    const entry = 132 + index * 12;
    const tag = ascii(profile, entry, 4);
    if (!['rXYZ', 'gXYZ', 'bXYZ'].includes(tag)) continue;
    const offset = readU32(profile, entry + 4);
    const size = readU32(profile, entry + 8);
    if (size < 20 || offset + 20 > profile.length || ascii(profile, offset, 4) !== 'XYZ ') return null;
    result[tag] = [0, 1, 2].map(component => readS15Fixed16(profile, offset + 8 + component * 4));
  }
  return result.rXYZ && result.gXYZ && result.bXYZ ? result : null;
}

export function classifyIccRgbColorants(colorants, tolerance = 0.035) {
  if (!colorants) return null;
  let best = null;
  for (const [profile, expected] of Object.entries(ICC_RGB_COLORANTS)) {
    const error = ['rXYZ', 'gXYZ', 'bXYZ'].reduce((total, tag) => total + colorants[tag].reduce((sum, value, index) => sum + (value - expected[tag][index]) ** 2, 0), 0) ** 0.5;
    if (!best || error < best.error) best = { profile, error };
  }
  return best && best.error <= tolerance ? best.profile : null;
}


// --- HDR signalling --------------------------------------------------------
// Colour signalling lives in named container structures, so it is read from
// those structures. Scanning the whole file as text for short markers such as
// "HLG" matches compressed image bytes by luck: measured against ordinary
// one-megabyte images, that approach flagged more than half of them as HDR and
// blocked them from export.

// SMPTE ST 2084 (PQ) and ARIB STD-B67 (HLG) transfer characteristics.
const HDR_TRANSFER = Object.freeze(new Set([16, 18]));

/** Contents of the first PNG chunk of `type`, or null. Colour chunks precede IDAT. */
function pngChunk(bytes, type) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 8 || signature.some((byte, index) => bytes[index] !== byte)) return null;
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = readU32(bytes, offset);
    if (!Number.isSafeInteger(length) || length < 0 || offset + 12 + length > bytes.length + 12) return null;
    const name = ascii(bytes, offset + 4, 4);
    if (name === type) return bytes.subarray(offset + 8, Math.min(bytes.length, offset + 8 + length));
    if (name === 'IDAT' || name === 'IEND') return null;
    offset += 12 + length;
  }
  return null;
}

/** The nclx payload of an ISOBMFF `colr` box (HEIF, AVIF, MP4), or null. */
function isobmffNclx(bytes) {
  // A colr box is `size(4) 'colr' colour_type(4) …`; requiring the exact eight
  // bytes "colrnclx" makes a chance match effectively impossible.
  for (let index = 0; index + 8 <= bytes.length; index++) {
    if (bytes[index] !== 0x63 || bytes[index + 1] !== 0x6f || bytes[index + 2] !== 0x6c || bytes[index + 3] !== 0x72) continue;
    if (ascii(bytes, index + 4, 4) !== 'nclx') continue;
    return bytes.subarray(index + 8, Math.min(bytes.length, index + 8 + 7));
  }
  return null;
}

/** PQ or HLG named in an ICC profile's own description, not in pixel data. */
function iccDescribesHdr(profile) {
  if (!(profile instanceof Uint8Array) || !profile.length) return false;
  const text = new TextDecoder('latin1').decode(profile);
  return /PQ\s*Transfer|\bHLG\b|SMPTE\s*ST\s*2084|ARIB\s*STD-B67/i.test(text);
}

/**
 * Does this file declare high dynamic range? Evidence only - detecting it never
 * tone-maps anything, it only stops an untone-mapped file being delivered.
 */
export function detectHdrSignal(bytes, { radiance = null, iccProfile = null } = {}) {
  if (radiance) return true;
  if (!(bytes instanceof Uint8Array)) return false;

  const cicp = pngChunk(bytes, 'cICP');
  if (cicp && cicp.length >= 2 && HDR_TRANSFER.has(cicp[1])) return true;

  const nclx = isobmffNclx(bytes);
  if (nclx && nclx.length >= 4 && HDR_TRANSFER.has((nclx[2] << 8) | nclx[3])) return true;

  return iccDescribesHdr(iccProfile);
}

export async function inspectColorMetadata(blob, colorTransform = null) {
  if (!blob?.slice) return { profile: 'unknown', embedded: false, hdrSignaled: false, delivery: COLOR_PIPELINE.deliverySpace };
  const bytes = new Uint8Array(await blob.slice(0, 1024 * 1024).arrayBuffer());
  const text = new TextDecoder('latin1').decode(bytes);
  const mime = String(blob.type || '').toLowerCase();
  const radiance = parseRadianceHeader(bytes);
  const jpegIcc = /jpe?g/.test(mime) ? extractJpegIcc(bytes) : null;
  const matrixProfile = classifyIccRgbColorants(readIccRgbColorants(jpegIcc));
  const embedded = Boolean(jpegIcc) || /ICC_PROFILE|iCCP|\bICCP\b/.test(text);
  const explicitSrgb = /\bsRGB\b/.test(text);
  const p3 = /Display[ _-]?P3|DCI[ _-]?P3/i.test(text);
  const adobeRgb = /Adobe[ _-]?RGB/i.test(text);
  const cmyk = /prtrCMYK|COLOR_REP\s+["']?CMYK|\bCMYK_(?:C|M|Y|K)\b/i.test(text);
  const hdrSignaled = detectHdrSignal(bytes, { radiance, iccProfile: jpegIcc });
  let profile = 'untagged-srgb-fallback';
  if (radiance) profile = 'bt2020-linear';
  else if (cmyk) profile = 'cmyk';
  else if (p3 || matrixProfile === 'display-p3') profile = 'display-p3';
  else if (adobeRgb || matrixProfile === 'adobe-rgb') profile = 'adobe-rgb';
  else if (explicitSrgb || matrixProfile === 'srgb') profile = 'srgb';
  else if (embedded) profile = 'embedded-icc-unclassified';
  return { mime, profile, embedded: Boolean(radiance) || embedded, cmyk, hdrSignaled, delivery: COLOR_PIPELINE.deliverySpace,
    policy: COLOR_PIPELINE.inputPolicy, toneMappingApplied: Boolean(colorTransform?.toneMappingApplied),
    conversion: colorTransform?.conversion || null, conversionAccepted: Boolean(colorTransform?.conversionAccepted),
    sourceDynamicRangeStops: colorTransform?.sourceDynamicRangeStops ?? null,
    sourceMaximumLinear: colorTransform?.sourceMaximumLinear ?? null,
    clippedChannelFraction: colorTransform?.clippedChannelFraction ?? null };
}
