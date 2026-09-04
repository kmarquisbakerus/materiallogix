import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectColorMetadata, detectHdrSignal, colorExportDecision, COLOR_PROFILE_ACCEPTANCE } from '../studio/js/color-management.js';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A minimal PNG carrying the given chunks, in order, before IDAT. */
function png(chunks = []) {
  const parts = [...PNG_SIGNATURE];
  const push = (type, payload) => {
    const length = payload.length;
    parts.push((length >>> 24) & 255, (length >>> 16) & 255, (length >>> 8) & 255, length & 255);
    for (const ch of type) parts.push(ch.charCodeAt(0));
    parts.push(...payload);
    parts.push(0, 0, 0, 0); // CRC is not read by the inspector
  };
  push('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
  for (const [type, payload] of chunks) push(type, payload);
  push('IDAT', [0, 0, 0, 0]);
  push('IEND', []);
  return new Uint8Array(parts);
}

/** An ISOBMFF colr box declaring nclx colour signalling. */
function heifWithNclx(transfer) {
  const head = new TextEncoder().encode('....ftypheic....colrnclx');
  const body = new Uint8Array(head.length + 7);
  body.set(head);
  body.set([0x00, 0x09, (transfer >> 8) & 255, transfer & 255, 0x00, 0x09, 0x80], head.length);
  return body;
}

test('a plain image is not HDR', () => {
  assert.equal(detectHdrSignal(png()), false);
  assert.equal(detectHdrSignal(new Uint8Array(64)), false);
  assert.equal(detectHdrSignal(null), false);
  assert.equal(detectHdrSignal(undefined), false);
});

test('compressed bytes that happen to spell a marker are not HDR', () => {
  // The whole point: "HLG" and "nclx" occur by chance in ordinary image data.
  for (const marker of ['hlg', 'HLG', 'nclx', 'cICP', 'PQ Transfer']) {
    const bytes = new Uint8Array(4096);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31) % 256;
    bytes.set(new TextEncoder().encode(marker), 2000);
    assert.equal(detectHdrSignal(bytes), false, `"${marker}" in pixel data must not signal HDR`);
  }
});

test('a random megabyte is never mistaken for HDR', async () => {
  let flagged = 0;
  for (let attempt = 0; attempt < 12; attempt++) {
    const bytes = new Uint8Array(1024 * 256);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (Math.random() * 256) | 0;
    if (detectHdrSignal(bytes)) flagged++;
  }
  assert.equal(flagged, 0, 'ordinary photographs must not be blocked from export by chance');
});

test('a PNG cICP chunk declaring PQ or HLG is HDR', () => {
  for (const transfer of [16, 18]) {
    assert.equal(detectHdrSignal(png([['cICP', [9, transfer, 0, 1]]])), true, `transfer ${transfer}`);
  }
});

test('a PNG cICP chunk declaring an ordinary transfer is not HDR', () => {
  for (const transfer of [1, 8, 13]) {
    assert.equal(detectHdrSignal(png([['cICP', [9, transfer, 0, 1]]])), false, `transfer ${transfer}`);
  }
});

test('an ISOBMFF nclx box declaring PQ or HLG is HDR', () => {
  assert.equal(detectHdrSignal(heifWithNclx(16)), true, 'PQ');
  assert.equal(detectHdrSignal(heifWithNclx(18)), true, 'HLG');
  assert.equal(detectHdrSignal(heifWithNclx(1)), false, 'BT.709 is not HDR');
});

test('an ICC profile that names a PQ or HLG curve is HDR', () => {
  const profile = new TextEncoder().encode('desc....SMPTE ST 2084 (PQ) transfer');
  assert.equal(detectHdrSignal(png(), { iccProfile: profile }), true);
  assert.equal(detectHdrSignal(png(), { iccProfile: new TextEncoder().encode('sRGB IEC61966-2.1') }), false);
  assert.equal(detectHdrSignal(png(), { iccProfile: null }), false);
});

test('a Radiance source is always HDR', () => {
  assert.equal(detectHdrSignal(new Uint8Array(8), { radiance: { width: 4, height: 4 } }), true);
});

test('inspection reports an untagged PNG as the sRGB fallback, not HDR', async () => {
  const report = await inspectColorMetadata(new Blob([png()], { type: 'image/png' }));
  assert.equal(report.hdrSignaled, false);
  assert.equal(report.profile, 'untagged-srgb-fallback');
  assert.equal(colorExportDecision(report).allowed, true, 'an ordinary photo must be deliverable');
});

test('inspection still blocks a real HDR file until it is tone-mapped', async () => {
  const report = await inspectColorMetadata(new Blob([png([['cICP', [9, 16, 0, 1]]])], { type: 'image/png' }));
  assert.equal(report.hdrSignaled, true);
  assert.equal(colorExportDecision(report).allowed, false);
  assert.equal(colorExportDecision({ ...report, toneMappingApplied: true, profile: 'bt2020-linear', conversionAccepted: true }).allowed, true);
});

test('inspection never throws on junk input', async () => {
  for (const input of [null, undefined, {}, new Blob([], { type: 'image/png' })]) {
    const report = await inspectColorMetadata(input);
    assert.equal(typeof report.hdrSignaled, 'boolean', JSON.stringify(input));
  }
});

test('every profile the acceptance table names has a delivery decision', () => {
  for (const profile of Object.keys(COLOR_PROFILE_ACCEPTANCE)) {
    const decision = colorExportDecision({ profile });
    assert.equal(typeof decision.allowed, 'boolean', profile);
    assert.ok(decision.reason, `${profile} must explain itself`);
  }
});
