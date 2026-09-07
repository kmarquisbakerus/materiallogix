// Real-browser Music journey. The microphone is synthetic; billing is not exercised.
// Files rendered below are engine diagnostics, not purchased customer exports.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';
import { studioContext } from './harness.mjs';
import { unpackProject } from '../../studio/js/music-project.js';

const site = await serve(), base = `http://127.0.0.1:${site.address().port}`;
const folder = await mkdtemp(join(tmpdir(), 'materiallogix-music-'));
const executablePath = process.env.JOURNEY_CHROME || process.env.CHROME_PATH;
let browser;
try {
  browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const handle = await studioContext(browser), { page, context } = handle;
  await context.grantPermissions(['microphone'], { origin: base });
  await page.goto(`${base}/studio/voice.html?dev=1`, { waitUntil: 'load' });
  const open = async () => {
    await page.locator('details').filter({ has: page.locator('[data-open-music]') }).locator('summary').click();
    await page.locator('[data-open-music]').click(); await page.locator('.music-dialog').waitFor({ state: 'visible' });
  };
  await open();
  const dialog = page.locator('.music-dialog');
  const ready = () => page.waitForFunction(() => !document.querySelector('.music-dialog')?.hasAttribute('aria-busy'));
  const action = async name => { await dialog.locator(`[data-music-action="${name}"]`).click(); await ready(); };
  await dialog.getByLabel('Song name', { exact: true }).fill('Music journey');
  await dialog.getByLabel('Song name', { exact: true }).press('Tab'); await ready();
  assert.equal(await dialog.locator('[data-music-action="guided"]').getAttribute('aria-pressed'), 'true');
  await dialog.locator('[data-section="beat-maker"] > summary').click();
  await dialog.locator('[data-music-action="beat-preset"][data-preset="rap"]').click(); await ready();
  assert.equal(await dialog.locator('[data-section="custom-drums"]').getAttribute('open'), null);
  await action('beat-add'); assert.equal(await dialog.locator('[data-track]').count(), 1);
  await dialog.locator('[data-section="instruments"] > summary').click();
  await dialog.locator('[data-music-action="instrument-preset"][data-preset="chords"]').click(); await ready();
  await action('instrument-add'); assert.equal(await dialog.locator('[data-track]').count(), 2);
  await action('play');
  await page.waitForFunction(() => Number(document.querySelector('.music-dialog output')?.textContent.split(':')[1]) > 0.1);
  await action('play'); await action('start');

  // Edit the stored note pattern through the same controls used by a customer.
  await dialog.locator('[data-track]').nth(1).locator('[data-music-action="edit-generated"]').click(); await ready();
  await dialog.getByLabel('Instrument sound', { exact: true }).selectOption('electric'); await ready();
  await action('instrument-add'); assert.equal(await dialog.locator('[data-track]').count(), 2);
  await action('undo'); await action('redo');

  // AudioWorklet capture executes in Chromium, not a graph or device double.
  await action('record');
  await page.waitForFunction(() => document.querySelector('.music-dialog output')?.textContent.startsWith('Recording 0:00.'));
  await page.waitForFunction(() => {
    const text = document.querySelector('.music-dialog output')?.textContent || '';
    return text.startsWith('Recording ') && Number(text.split(':').at(-1)) >= 0.5;
  });
  await action('record'); assert.equal(await dialog.locator('[data-track]').count(), 3);
  assert.equal(await dialog.locator('[data-music-action="record"]').textContent(), 'Record microphone');
  assert.equal(await dialog.locator('[data-music-action="take"]').count(), 0);

  const save = page.waitForEvent('download'); await action('save'); const projectFile = await save;
  const projectPath = join(folder, 'music.mlxmusic'); await projectFile.saveAs(projectPath);
  const project = await unpackProject(new Blob([await readFile(projectPath)]));
  assert.equal(project.session.tracks.length, 3); assert.equal(project.session.tracks[1].generated.pattern.voice, 'electric');
  assert.equal(project.audio.length, 3);
  const recorded = new DataView(await project.audio[2].blob.arrayBuffer());
  assert.equal(recorded.getUint16(22, true), 1); assert.equal(recorded.getUint16(34, true), 16);
  assert.ok(recorded.getUint32(40, true) > recorded.getUint32(24, true) * 0.4 * 2);

  // Reload and recover through native IndexedDB rather than importing a mock snapshot.
  await action('close'); await page.reload({ waitUntil: 'load' }); await open(); await action('recover');
  assert.equal(await dialog.locator('[data-track]').count(), 3);
  assert.equal(await dialog.getByLabel('Song name', { exact: true }).inputValue(), 'Music journey');

  const rendered = await page.evaluate(async () => {
    const { MusicProjectStore } = await import('./js/music-project.js');
    const { renderMusic } = await import('./js/music-audio.js');
    const { encodeWav } = await import('./js/music-session.js');
    const snapshot = await new MusicProjectStore().latest(), audio = new AudioContext(), sources = new Map();
    try {
      for (const item of snapshot.audio) sources.set(item.id, { ...item, buffer: await audio.decodeAudioData(await item.blob.arrayBuffer()) });
      const mix = await renderMusic(snapshot.session, sources);
      const channels = [mix.getChannelData(0), mix.getChannelData(1)];
      let energy = 0, peak = 0;
      for (const channel of channels) for (const sample of channel) { if (!Number.isFinite(sample)) throw new Error('Invalid rendered audio'); energy += sample * sample; peak = Math.max(peak, Math.abs(sample)); }
      const blob = encodeWav(channels, mix.sampleRate, 24), header = new DataView(await blob.slice(0, 44).arrayBuffer());
      return { seconds: mix.duration, peak, rms: Math.sqrt(energy / mix.length / 2), rate: header.getUint32(24, true), channels: header.getUint16(22, true), bits: header.getUint16(34, true), bytes: blob.size, frames: mix.length };
    } finally { await audio.close(); }
  });
  assert.equal(rendered.rate, 48000); assert.equal(rendered.channels, 2); assert.equal(rendered.bits, 24);
  assert.equal(rendered.bytes, 44 + rendered.frames * 6); assert.ok(rendered.rms > 0.005 && rendered.peak < 1);
  assert.ok(rendered.seconds >= 8 && rendered.seconds < 10);
  console.log('Music browser journey passed: creation, editable patterns, synthetic microphone capture, project download, IndexedDB recovery and real offline WAV rendering.', rendered);

  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await dialog.evaluate(element => element.scrollWidth > element.clientWidth + 2);
  assert.equal(overflow, false, 'Music dialog overflows at phone width');
  assert.equal(await dialog.getByText(/Finished-song delivery/).count(), 1);
  assert.deepEqual(handle.errors, []);
  await context.close();
} finally { await browser?.close(); site.close(); await rm(folder, { recursive: true, force: true }); }
