import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { MusicCapture } from '../studio/js/music-capture.js';

function processor() {
  let Class;
  const messages = [];
  const scope = vm.createContext({ Float32Array, currentFrame: 0, AudioWorkletProcessor: class { constructor() { this.port = { postMessage: data => messages.push(data) }; } }, registerProcessor: (_, value) => Class = value });
  vm.runInContext(readFileSync(new URL('../studio/js/music-capture-worklet.js', import.meta.url), 'utf8'), scope);
  const node = new Class();
  return { messages, command: data => node.port.onmessage({ data }), process(frame, values, size = values?.length || 8) {
    scope.currentFrame = frame;
    const output = new Float32Array(size).fill(7);
    node.process([values ? [new Float32Array(values)] : []], [[output]]);
    assert.ok(output.every(value => value === 0), 'microphone was monitored into the output');
  } };
}

test('capture begins on the requested sample and stops at the exact frame limit across varying blocks', () => {
  const p = processor(); p.command({ type: 'start', frame: 3, maxFrames: 10 });
  p.process(0, [0, 1, 2, 3, 4, 5, 6, 7]); p.process(8, [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
  assert.deepEqual(p.messages.filter(m => m.type === 'samples').flatMap(m => [...m.samples]), [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.equal(p.messages.at(-1).frames, 10); assert.equal(p.messages.at(-1).error, null);
});

test('cancelling during count-in produces no audio and reports completion once', () => {
  const p = processor(); p.command({ type: 'start', frame: 20, maxFrames: 100 });
  p.process(0, [1, 2, 3, 4]); p.command({ type: 'stop' }); p.command({ type: 'stop' });
  assert.equal(p.messages.length, 1); assert.equal(p.messages[0].frames, 0);
});

test('a disconnected microphone preserves already captured frames and reports the interruption', () => {
  const p = processor(); p.command({ type: 'start', frame: 0, maxFrames: 100 });
  p.process(0, [0.1, 0.2]); p.process(2, null);
  assert.equal(p.messages[0].samples.length, 2); assert.match(p.messages.at(-1).error, /stopped sending/);
});

test('late arm messages cannot silently create a misaligned take', () => {
  const p = processor(); p.process(32, [0, 0]); p.command({ type: 'start', frame: 0, maxFrames: 100 });
  assert.match(p.messages.at(-1).error, /on time/); assert.equal(p.messages.at(-1).frames, 0);
});

function device() {
  let stopped = 0;
  const nodes = [];
  const make = () => { const n = { connect(next) { return next; }, disconnect() { this.disconnected = true; }, gain: { value: 1 } }; nodes.push(n); return n; };
  const context = { sampleRate: 48000, currentTime: 0, destination: {}, audioWorklet: { addModule: async () => {} }, createMediaStreamSource: make, createGain: make };
  class WorkletNode {
    constructor() { nodes.push(this); this.messages = []; this.port = { postMessage: data => this.messages.push(data), close: () => this.closed = true }; }
    connect(next) { return next; }
    disconnect() { this.disconnected = true; }
  }
  const stream = { getTracks: () => [{ stop: () => stopped++ }] };
  return { context, WorkletNode, stream, nodes, stopped: () => stopped, mediaDevices: { getUserMedia: async () => stream } };
}

test('PCM capture creates a real WAV and releases the device on normal finish', async () => {
  const d = device(), capture = new MusicCapture();
  await capture.prepare(d.context, d); capture.startAt(1, { maxFrames: 48000 }); const node = capture.node;
  node.port.onmessage({ data: { type: 'samples', samples: new Float32Array([0, 0.5, -0.5]) } });
  const stopping = capture.stop(); assert.equal(capture.state, 'stopping');
  node.port.onmessage({ data: { type: 'finished', frames: 3 } });
  const wav = new DataView(await (await stopping).arrayBuffer());
  assert.equal(wav.getUint32(40, true), 6); assert.equal(wav.getInt16(46, true), 16384);
  assert.equal(d.stopped(), 1); assert.ok(d.nodes.every(n => n.disconnected)); assert.ok(node.closed);
  assert.equal(capture.state, 'idle');
});

test('cancellation while the device prompt is open releases a later granted microphone', async () => {
  const d = device(), capture = new MusicCapture(); let grant;
  const pending = capture.prepare(d.context, { ...d, mediaDevices: { getUserMedia: () => new Promise(resolve => grant = resolve) } });
  await capture.stop(); await pending; assert.equal(capture.state, 'idle');
  grant(d.stream); await Promise.resolve(); assert.equal(d.stopped(), 1); assert.equal(d.nodes.length, 0);
});

test('cancelling a slow worklet load does not strand the microphone or open a recorder later', async () => {
  const d = device(), capture = new MusicCapture(); let ready;
  d.context.audioWorklet.addModule = () => new Promise(resolve => ready = resolve);
  const preparing = capture.prepare(d.context, d);
  for (let i = 0; i < 4; i++) await Promise.resolve();
  assert.ok(ready); await capture.stop(); await preparing; ready(); await Promise.resolve();
  assert.equal(d.stopped(), 1); assert.equal(capture.state, 'idle'); assert.equal(d.nodes.length, 0);
});

test('processor failure retains received audio and cannot leak a live microphone', async () => {
  const d = device(), capture = new MusicCapture(); await capture.prepare(d.context, d); capture.startAt(1, { maxFrames: 48000 });
  capture.node.port.onmessage({ data: { type: 'samples', samples: new Float32Array([0.25, 0.5]) } });
  capture.node.onprocessorerror();
  assert.equal((await capture.stop()).size, 48); assert.match(capture.error.message, /unexpectedly/); assert.equal(d.stopped(), 1);
});
