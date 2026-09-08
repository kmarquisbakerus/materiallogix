import test from 'node:test';
import assert from 'node:assert/strict';
import { MusicPreviewOutput, loadMusicPreviewStamp, musicPlaybackPolicy } from '../studio/js/music-preview.js';
import { MusicStudio } from '../studio/js/music-studio.js';

test('free, wrong-product, suspended and unverifiable Music playback stays marked', async () => {
  for (const license of [null, { plan: 'free' }, { plan: 'single', selected_product: 'voice' }, { plan: 'suspended:pro' }]) {
    assert.deepEqual(await musicPlaybackPolicy(async () => license), { tier: 'preview', watermarked: true });
  }
  assert.equal((await musicPlaybackPolicy(async () => { throw new Error('offline'); })).watermarked, true);
  for (const license of [{ plan: 'full' }, { plan: 'single', selected_product: 'music' }, { plan: 'single_pro', selected_product: 'music' }, { plan: 'pro' }]) {
    assert.equal((await musicPlaybackPolicy(async () => license)).watermarked, false);
  }
});

test('a missing or unusable required mark blocks playback with a recovery action', async () => {
  const response = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) });
  const context = { decodeAudioData: async () => ({ duration: 0 }) };
  await assert.rejects(loadMusicPreviewStamp(context, response), /Reconnect and try Play/);
  await assert.rejects(loadMusicPreviewStamp(context, async () => ({ ok: false })), /required audio preview mark/);
  await assert.rejects(loadMusicPreviewStamp(context, async () => { throw new Error('offline'); }), /project is unchanged/);
  context.decodeAudioData = async () => ({ duration: 1 });
  assert.equal((await loadMusicPreviewStamp(context, response)).duration, 1);
});

function graph() {
  const nodes = [], sources = [];
  const node = () => {
    const value = { gain: { value: 1 }, outputs: [], connect(next) { this.outputs.push(next); return next; }, disconnect() { this.disconnected = true; },
      start(time) { this.when = time; }, stop() { this.stopped = true; this.onended?.(); } };
    nodes.push(value); return value;
  };
  return { sampleRate: 100, currentTime: 2, destination: {}, nodes, sources,
    createGain: node,
    createBufferSource() { const source = node(); sources.push(source); return source; },
    createBuffer(numberOfChannels, length, sampleRate) {
      const channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
      return { numberOfChannels, length, sampleRate, duration: length / sampleRate, getChannelData: i => channels[i] };
    }
  };
}

test('the audible mark starts with playback, repeats and leaves source samples untouched', () => {
  const context = graph(), stamp = context.createBuffer(2, 100, 100);
  stamp.getChannelData(0).fill(0.4); stamp.getChannelData(1).fill(0.2);
  const original = stamp.getChannelData(0).slice(), output = new MusicPreviewOutput(context, stamp);
  output.start(3.5);
  const source = context.sources[0];
  assert.equal(source.when, 3.5); assert.equal(source.loop, true); assert.equal(source.buffer.duration, 8);
  assert.ok(Math.abs(source.buffer.getChannelData(0)[0] - 0.3) < 0.00001);
  assert.equal(source.buffer.getChannelData(0)[100], 0); assert.ok(output.input.gain.value < 1);
  assert.deepEqual(stamp.getChannelData(0), original);
  output.start(5); assert.equal(source.stopped, true); assert.equal(source.disconnected, true);
  output.dispose(); assert.equal(output.input.disconnected, true); assert.equal(context.sources[1].stopped, true);
  assert.ok(context.nodes.every(n => n.disconnected));
});

test('covered playback has no mark or attenuation', () => {
  const context = graph(), output = new MusicPreviewOutput(context);
  output.start(); assert.equal(context.sources.length, 0); assert.equal(output.input.gain.value, 1);
  output.dispose();
});

test('stopping playback does not wait for a network entitlement check', async () => {
  const studio = Object.create(MusicStudio.prototype); let stopped = false;
  Object.assign(studio, { stopBeatPreview() {}, preparePlayback() { assert.fail('pause requested a license check'); }, render() {},
    transport: { playing: true, current: () => 4, stop() { stopped = true; } } });
  await studio.action('play'); assert.equal(stopped, true); assert.equal(studio.position, 4);
});

test('stopping a note cancels its end callback, effect node and watermark', () => {
  const studio = Object.create(MusicStudio.prototype), context = graph(); let markStopped = false;
  studio.beatPreview = context.createBufferSource(); studio.previewLevel = context.createGain();
  studio.beatPreview.onended = () => assert.fail('a stopped preview scheduled stale cleanup');
  studio.output = { stop() { markStopped = true; } };
  studio.stopBeatPreview();
  assert.ok(markStopped); assert.equal(studio.beatPreview, null); assert.equal(studio.previewLevel, null);
  assert.ok(context.nodes.every(n => n.disconnected));
});
