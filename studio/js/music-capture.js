import { encodeWav } from './music-session.js';

const modules = new WeakMap();

export class MusicCapture {
  constructor() { this.state = 'idle'; }
  async prepare(context, { mediaDevices = globalThis.navigator?.mediaDevices, WorkletNode = globalThis.AudioWorkletNode } = {}) {
    if (this.state !== 'idle') throw new Error('A recording is already in progress.');
    if (!mediaDevices?.getUserMedia || !context.audioWorklet || !WorkletNode) {
      throw new Error('Recording with a backing track needs microphone and AudioWorklet support. Try a current browser over HTTPS, or add an audio file.');
    }
    this.state = 'requesting'; this.context = context; this.error = null; this.result = null;
    const token = {}; this.token = token;
    try {
      const cancelled = new Promise(resolve => this.cancelRequest = () => resolve(null));
      const requested = mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false } }).then(stream => {
        if (this.token !== token) { stream.getTracks().forEach(track => track.stop()); return null; }
        return stream;
      });
      const stream = await Promise.race([requested, cancelled]);
      if (!stream || this.token !== token) return;
      this.stream = stream;
      if (!modules.has(context)) {
        const loading = context.audioWorklet.addModule(new URL('./music-capture-worklet.js', import.meta.url));
        modules.set(context, loading); loading.catch(() => modules.delete(context));
      }
      await Promise.race([modules.get(context), cancelled]);
      if (this.token !== token) return;
      this.node = new WorkletNode(context, 'materiallogix-music-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit' });
      this.input = context.createMediaStreamSource(stream);
      this.silent = context.createGain(); this.silent.gain.value = 0;
      this.input.connect(this.node).connect(this.silent).connect(context.destination);
      this.state = 'ready';
    } catch (error) { if (this.token === token) { this.release(); this.state = 'idle'; } throw error; }
    finally { if (this.token === token) this.cancelRequest = null; }
  }
  startAt(when, { maxFrames } = {}) {
    if (this.state !== 'ready') throw new Error('The microphone is not ready.');
    if (!Number.isFinite(when) || when <= this.context.currentTime || !Number.isSafeInteger(maxFrames) || maxFrames < 1 || maxFrames > this.context.sampleRate * 600) {
      throw new Error('The recording start or duration is invalid. Try recording again.');
    }
    this.chunks = []; this.frames = 0; this.maxFrames = maxFrames;
    this.finished = new Promise(resolve => this.resolve = resolve);
    this.node.port.onmessage = ({ data }) => {
      if (this.state !== 'recording' && this.state !== 'stopping') return;
      if (data.type === 'samples') {
        if (!(data.samples instanceof Float32Array) || this.frames + data.samples.length > this.maxFrames) {
          this.finish('The recording exceeded the available memory. Your captured take has been kept.'); return;
        }
        this.chunks.push(data.samples); this.frames += data.samples.length;
      }
      if (data.type === 'finished') this.finish(data.error);
    };
    this.node.onprocessorerror = () => this.finish('Recording stopped unexpectedly. Any captured audio has been kept.');
    this.state = 'recording'; this.startTime = Math.round(when * this.context.sampleRate) / this.context.sampleRate;
    this.node.port.postMessage({ type: 'start', frame: Math.round(when * this.context.sampleRate), maxFrames });
    return this.startTime;
  }
  finish(message = null) {
    if (!this.resolve) return;
    clearTimeout(this.stopTimeout);
    this.error = message ? new Error(message) : null;
    try {
      if (this.frames) {
        const samples = new Float32Array(this.frames); let offset = 0;
        for (const chunk of this.chunks) { samples.set(chunk, offset); offset += chunk.length; }
        this.result = encodeWav([samples], this.context.sampleRate, 16);
      }
    } catch (error) { this.error = error; }
    this.chunks = []; this.release(); this.state = 'stopping';
    const resolve = this.resolve; this.resolve = null; resolve(this.result);
  }
  release() {
    this.token = null; this.cancelRequest?.(); this.cancelRequest = null;
    this.stream?.getTracks().forEach(track => track.stop()); this.stream = null;
    this.input?.disconnect(); this.node?.disconnect(); this.silent?.disconnect();
    this.node?.port.close(); this.input = null; this.node = null; this.silent = null;
  }
  async stop() {
    if (this.state === 'requesting' || this.state === 'ready') { this.release(); this.state = 'idle'; return null; }
    if (this.state === 'idle') return null;
    if (this.state === 'recording') {
      this.state = 'stopping'; this.node.port.postMessage({ type: 'stop' });
      // A suspended audio device may never acknowledge the final render block.
      this.stopTimeout = setTimeout(() => this.finish('The audio device stopped responding. Any captured audio has been kept.'), 2000);
    }
    const blob = await this.finished; this.state = 'idle'; return blob;
  }
}

export function countIn(context, startTime, tempo, beats = 4) {
  const nodes = [];
  for (let i = 0; i < beats; i++) {
    const at = startTime - (beats - i) * 60 / tempo;
    const oscillator = context.createOscillator(), level = context.createGain();
    oscillator.frequency.value = i === 0 ? 880 : 660;
    level.gain.setValueAtTime(0, at); level.gain.linearRampToValueAtTime(0.1, at + 0.003);
    level.gain.exponentialRampToValueAtTime(0.001, at + 0.06);
    oscillator.connect(level).connect(context.destination); oscillator.start(at); oscillator.stop(at + 0.07);
    oscillator.onended = () => { oscillator.disconnect(); level.disconnect(); };
    nodes.push({ oscillator, level });
  }
  return () => { for (const { oscillator, level } of nodes) { try { oscillator.stop(); } catch { /* Already stopped. */ } oscillator.disconnect(); level.disconnect(); } };
}
