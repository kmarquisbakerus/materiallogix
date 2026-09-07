import test from 'node:test';
import assert from 'node:assert/strict';
import { MusicTransport, MusicRecorder, clipWindow, crossfadeGains, renderMusic, connectTrack } from '../studio/js/music-audio.js';
import { createSession, createTrack, createClip } from '../studio/js/music-session.js';

class Param {
  constructor() { this.value = 1; this.events = []; }
  cancelScheduledValues() {}
  setValueAtTime(value, time) { this.value = value; this.events.push(['set', value, time]); }
  setTargetAtTime(value, time) { this.value = value; this.events.push(['target', value, time]); }
  linearRampToValueAtTime(value, time) { this.value = value; this.events.push(['ramp', value, time]); }
}
class Node {
  constructor() { for (const key of ['gain', 'frequency', 'Q', 'pan', 'threshold', 'ratio', 'knee', 'attack', 'release', 'delayTime']) this[key] = new Param(); this.outputs = []; }
  connect(next) { this.outputs.push(next); return next; }
  disconnect() { this.disconnected = true; }
  start(...args) { this.startArgs = args; }
  stop() { this.stopped = true; this.onended?.(); }
}
class Context {
  constructor(channels = 2, length = 100, sampleRate = 48000) { Object.assign(this, { channels, length, sampleRate, currentTime: 0, destination: new Node(), nodes: [], sources: [] }); Context.instances.push(this); }
  static instances = [];
  createGain() { const n = new Node(); this.nodes.push(n); return n; }
  createBiquadFilter() { return this.createGain(); }
  createDynamicsCompressor() { return this.createGain(); }
  createStereoPanner() { return this.createGain(); }
  createConvolver() { return this.createGain(); }
  createDelay() { return this.createGain(); }
  createAnalyser() { return this.createGain(); }
  createBufferSource() { const n = this.createGain(); this.sources.push(n); return n; }
  createBuffer(channels, length, sampleRate) { const data = Array.from({ length: channels }, () => new Float32Array(length)); return { duration: length / sampleRate, getChannelData: i => data[i] }; }
  async resume() {}
  async startRendering() { return { duration: this.length / this.sampleRate }; }
}
const fixture = () => {
  const s = createSession(), t = createTrack('Beat'); t.clips.push(createClip('audio', 4, 2)); s.tracks.push(t);
  return { s, t, sources: new Map([['audio', { buffer: { duration: 4 } }]]) };
};

test('clip windows translate arrangement positions to original source offsets', () => {
  const c = { start: 2, offset: 4, duration: 6 };
  assert.deepEqual(clipWindow(c, 3, 6), { at: 0, offset: 5, duration: 3, clipTime: 1 });
  assert.equal(clipWindow(c, 8, 10), null);
});
test('crossfader has equal power and reaches both deck endpoints', () => {
  for (const position of [-1, -0.4, 0, 0.8, 1]) { const { a, b } = crossfadeGains(position); assert.ok(Math.abs(a * a + b * b - 1) < 1e-10); }
  assert.equal(crossfadeGains(-1).a, 1); assert.equal(crossfadeGains(-1).b, 0);
  assert.equal(crossfadeGains(1).b, 1);
});
test('effect controls initialize immediately instead of leaking default wet gain', () => {
  const context = new Context(), chain = connectTrack(context, createTrack(), context.destination);
  const changed = context.nodes.flatMap(n => Object.values(n).filter(p => p instanceof Param).flatMap(p => p.events));
  assert.ok(changed.length > 5); assert.ok(changed.every(event => event[0] === 'set'));
  chain.update({ ...createTrack(), room: 0.5 });
  assert.ok(context.nodes.some(n => n.gain.events.some(e => e[0] === 'target' && e[1] === 0.25)));
  chain.dispose(); assert.ok(context.nodes.every(n => n.disconnected));
});
test('playback schedules exact source offsets and stop releases all active nodes', async () => {
  const { s, sources } = fixture(), context = new Context(), transport = new MusicTransport(context, sources);
  await transport.play(s, 3);
  assert.deepEqual(context.sources[0].startArgs, [0.03, 1, 3]);
  context.currentTime = 1.03; assert.equal(transport.current(), 4);
  transport.stop(); assert.equal(transport.playing, false); assert.ok(context.sources[0].stopped);
  assert.ok(context.nodes.every(n => n.disconnected));
});
test('stop during audio resume cannot start stale playback later', async () => {
  const { s, sources } = fixture(), context = new Context(); let release;
  context.resume = () => new Promise(resolve => release = resolve);
  const transport = new MusicTransport(context, sources), pending = transport.play(s);
  transport.stop(); release(); await pending;
  assert.equal(transport.playing, false); assert.equal(context.sources.length, 0);
});
test('rendering rejects missing audio and stems retain full-song alignment', async () => {
  const { s, t, sources } = fixture(); s.tracks.push({ ...createTrack('Room'), room: 0.5 });
  const result = await renderMusic(s, sources, { trackId: t.id, OfflineContext: Context });
  assert.equal(result.duration, 7.5);
  await assert.rejects(renderMusic(s, new Map(), { OfflineContext: Context }), /missing audio/);
  await assert.rejects(renderMusic(s, sources, { sampleRate: 2, OfflineContext: Context }), /sample rate/);
});

class Recorder {
  constructor() { this.mimeType = 'audio/webm'; }
  start() {}
  stop() { this.ondataavailable({ data: new Blob(['take']) }); this.onstop(); }
}
test('recording requests unprocessed audio and stops microphone tracks when finished', async () => {
  let constraints, stopped = 0;
  const mediaDevices = { getUserMedia: async c => { constraints = c; return { getTracks: () => [{ stop: () => stopped++ }] }; } };
  const recording = new MusicRecorder(); await recording.start({ mediaDevices, Recorder });
  assert.equal(recording.state, 'recording');
  assert.deepEqual(constraints.audio, { echoCancellation: false, noiseSuppression: false, autoGainControl: false });
  assert.equal(await (await recording.stop()).text(), 'take');
  assert.equal(stopped, 1); assert.equal(recording.state, 'idle');
});
test('cancelling a pending microphone request releases a late-granted device', async () => {
  let resolve, stopped = 0;
  const recording = new MusicRecorder();
  const pending = recording.start({ mediaDevices: { getUserMedia: () => new Promise(r => resolve = r) }, Recorder });
  await recording.stop(); await pending; assert.equal(recording.state, 'idle');
  resolve({ getTracks: () => [{ stop: () => stopped++ }] }); await Promise.resolve();
  assert.equal(stopped, 1); assert.equal(recording.state, 'idle');
});
test('denied microphone permission leaves the recorder available for a retry', async () => {
  const recording = new MusicRecorder();
  await assert.rejects(recording.start({ mediaDevices: { getUserMedia: async () => { throw new Error('denied'); } }, Recorder }), /denied/);
  assert.equal(recording.state, 'idle');
});
