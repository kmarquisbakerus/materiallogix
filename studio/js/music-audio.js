import { audibleTracks, bound, clipEnvelope, sessionDuration, validateSession } from './music-session.js';

const gain = db => db <= -60 ? 0 : 10 ** (db / 20);

export function clipWindow(clip, start, end) {
  const first = Math.max(start, clip.start), last = Math.min(end, clip.start + clip.duration);
  return last > first ? { at: first - start, offset: clip.offset + first - clip.start,
    duration: last - first, clipTime: first - clip.start } : null;
}

export function crossfadeGains(position) {
  const x = bound(position, -1, 1, 0);
  return { a: Math.cos((x + 1) * Math.PI / 4), b: Math.sin((x + 1) * Math.PI / 4) };
}

function roomImpulse(context) {
  const length = Math.round(context.sampleRate * 1.2), buffer = context.createBuffer(2, length, context.sampleRate);
  let seed = 8237;
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; data[i] = (seed / 4294967296 * 2 - 1) * (1 - i / length) ** 3; }
  }
  return buffer;
}

export function connectTrack(context, track, destination, tempo = 120) {
  const input = context.createGain(), low = context.createBiquadFilter(), mid = context.createBiquadFilter(), high = context.createBiquadFilter();
  low.type = 'lowshelf'; low.frequency.value = 180;
  mid.type = 'peaking'; mid.frequency.value = 1500; mid.Q.value = 0.8;
  high.type = 'highshelf'; high.frequency.value = 6500;
  const compressor = context.createDynamicsCompressor(), fader = context.createGain(), pan = context.createStereoPanner();
  compressor.knee.value = 12; compressor.attack.value = 0.01; compressor.release.value = 0.2;
  input.connect(low).connect(mid).connect(high).connect(compressor).connect(fader).connect(pan).connect(destination);
  const reverb = context.createConvolver(), room = context.createGain();
  reverb.buffer = roomImpulse(context); pan.connect(reverb).connect(room).connect(destination);
  const delay = context.createDelay(2), delayLevel = context.createGain();
  delay.delayTime.value = 60 / bound(tempo, 40, 240, 120) / 2;
  pan.connect(delay).connect(delayLevel).connect(destination);
  const nodes = [input, low, mid, high, compressor, fader, pan, reverb, room, delay, delayLevel];
  let initial = true;
  const set = (param, value) => {
    param.cancelScheduledValues(context.currentTime);
    if (initial) param.setValueAtTime(value, context.currentTime);
    else param.setTargetAtTime(value, context.currentTime, 0.005);
  };
  const update = t => {
    set(low.gain, bound(t.lowDb, -18, 18, 0)); set(mid.gain, bound(t.midDb, -18, 18, 0)); set(high.gain, bound(t.highDb, -18, 18, 0));
    set(fader.gain, gain(bound(t.gainDb, -60, 12, 0))); set(pan.pan, bound(t.pan, -1, 1, 0));
    set(compressor.threshold, -6 - 30 * bound(t.compression, 0, 1));
    set(compressor.ratio, 1 + 7 * bound(t.compression, 0, 1));
    set(room.gain, bound(t.room, 0, 1) * 0.5); set(delayLevel.gain, bound(t.delay, 0, 1) * 0.5);
  };
  update(track); initial = false;
  return { input, update, dispose: () => nodes.forEach(node => node.disconnect()) };
}

function schedule(context, track, input, sources, start, end, when) {
  const running = [];
  for (const clip of track.clips) {
    const win = clipWindow(clip, start, end);
    if (!win) continue;
    const audio = sources.get(clip.sourceId)?.buffer;
    if (!audio || win.offset + win.duration > audio.duration + 0.002) throw new Error('A clip refers to missing or incomplete audio.');
    const source = context.createBufferSource(), envelope = context.createGain();
    source.buffer = audio;
    const at = when + win.at, finish = win.clipTime + win.duration;
    envelope.gain.setValueAtTime(clipEnvelope(clip, win.clipTime), at);
    const points = [clip.fadeIn, clip.duration - clip.fadeOut].filter(t => t > win.clipTime && t < finish).sort((a, b) => a - b);
    for (const time of points) envelope.gain.linearRampToValueAtTime(clipEnvelope(clip, time), at + time - win.clipTime);
    const finalLevel = clip.fadeOut && finish >= clip.duration ? 0 : clipEnvelope(clip, Math.max(0, finish - 1 / context.sampleRate));
    envelope.gain.linearRampToValueAtTime(finalLevel, at + win.duration);
    source.connect(envelope).connect(input); source.start(at, win.offset, win.duration);
    source.onended = () => { source.disconnect(); envelope.disconnect(); };
    running.push(source);
  }
  return running;
}

export function verifyAudioSources(session, sources) {
  for (const track of session.tracks) for (const clip of track.clips) {
    const buffer = sources.get(clip.sourceId)?.buffer;
    if (!buffer || clip.offset + clip.duration > buffer.duration + 0.002) throw new Error('The project is missing audio needed by a clip.');
  }
}

export class MusicTransport {
  constructor(context, sources) { this.context = context; this.sources = sources; this.playing = false; this.position = 0; this.nodes = []; this.chains = new Map(); }
  async play(raw, position = 0) {
    const session = validateSession(raw); verifyAudioSources(session, this.sources);
    if (!sessionDuration(session)) throw new Error('Import or record audio before playing.');
    this.stop(); const generation = this.generation; await this.context.resume();
    if (generation !== this.generation) return;
    this.session = session; this.start = bound(position, 0, sessionDuration(session));
    if (session.loop.enabled && (this.start < session.loop.start || this.start >= session.loop.end)) this.start = session.loop.start;
    this.origin = this.context.currentTime + 0.03;
    this.master = this.context.createGain(); this.master.gain.value = gain(session.masterDb);
    this.meter = this.context.createAnalyser(); this.meter.fftSize = 1024;
    this.master.connect(this.meter).connect(this.context.destination);
    for (const track of audibleTracks(session)) this.chains.set(track.id, connectTrack(this.context, track, this.master, session.tempo));
    this.playing = true;
    try {
      this.scheduleWindow(this.start, session.loop.enabled ? session.loop.end : sessionDuration(session), this.origin);
      if (session.loop.enabled) {
        this.nextLoop = this.origin + session.loop.end - this.start;
        this.timer = setInterval(() => {
          // A suspended tab may miss many timer ticks. Resume at the current
          // loop boundary instead of allocating every missed repetition.
          const span = session.loop.end - session.loop.start;
          if (this.nextLoop < this.context.currentTime) this.nextLoop += Math.ceil((this.context.currentTime - this.nextLoop) / span) * span;
          while (this.nextLoop < this.context.currentTime + 0.25) {
            this.scheduleWindow(session.loop.start, session.loop.end, this.nextLoop);
            this.nextLoop += session.loop.end - session.loop.start;
          }
        }, 40);
      }
    } catch (error) { this.stop(); throw error; }
  }
  scheduleWindow(start, end, when) {
    for (const track of audibleTracks(this.session)) {
      const added = schedule(this.context, track, this.chains.get(track.id).input, this.sources, start, end, when);
      this.nodes = this.nodes.filter(node => node.__endsAt > this.context.currentTime);
      for (const node of added) node.__endsAt = when + end - start;
      this.nodes.push(...added);
    }
  }
  current() {
    if (!this.playing) return this.position;
    const elapsed = Math.max(0, this.context.currentTime - this.origin), time = this.start + elapsed;
    const loop = this.session.loop;
    return loop.enabled && time >= loop.end ? loop.start + (time - loop.end) % (loop.end - loop.start) : Math.min(time, sessionDuration(this.session));
  }
  updateTrack(track) { this.chains.get(track.id)?.update(track); }
  updateMaster(db) { if (this.master) this.master.gain.setTargetAtTime(gain(bound(db, -60, 6)), this.context.currentTime, 0.005); }
  stop() {
    this.generation = (this.generation || 0) + 1;
    this.position = this.current(); this.playing = false; clearInterval(this.timer);
    for (const source of this.nodes) { try { source.stop(); } catch { /* Already finished. */ } source.disconnect(); }
    this.nodes = []; for (const chain of this.chains.values()) chain.dispose(); this.chains.clear();
    this.master?.disconnect(); this.meter?.disconnect(); this.master = null; this.meter = null;
  }
}

export async function renderMusic(raw, sources, { sampleRate = 48000, trackId = null, OfflineContext = globalThis.OfflineAudioContext } = {}) {
  const session = validateSession(raw); verifyAudioSources(session, sources);
  // Stems share the full arrangement's duration, including effect tails.
  const contentSeconds = sessionDuration(session);
  const seconds = contentSeconds + (contentSeconds && session.tracks.some(t => t.room || t.delay) ? 1.5 : 0);
  if (trackId) {
    const track = session.tracks.find(t => t.id === trackId);
    if (!track) throw new Error('The requested stem does not exist.');
    session.tracks = [{ ...track, mute: false, solo: false }];
  }
  if (!seconds) throw new Error('There is no audio to export.');
  if (![44100, 48000, 96000].includes(sampleRate)) throw new Error('Unsupported sample rate.');
  if (seconds * sampleRate * 8 > 256 * 1024 * 1024) throw new Error('This mix exceeds the current browser render memory limit. Shorten the arrangement before exporting.');
  if (!OfflineContext) throw new Error('This browser cannot render audio.');
  const context = new OfflineContext(2, Math.ceil(seconds * sampleRate), sampleRate);
  const master = context.createGain(); master.gain.value = gain(session.masterDb); master.connect(context.destination);
  const chains = [];
  try {
    for (const track of audibleTracks(session)) {
      const chain = connectTrack(context, track, master, session.tempo); chains.push(chain);
      schedule(context, track, chain.input, sources, 0, seconds, 0);
    }
    return await context.startRendering();
  } finally { chains.forEach(chain => chain.dispose()); master.disconnect(); }
}

export class MusicRecorder {
  constructor() { this.state = 'idle'; }
  async start({ deviceId = null, mediaDevices = navigator.mediaDevices, Recorder = globalThis.MediaRecorder } = {}) {
    if (this.state !== 'idle') throw new Error('A recording is already in progress.');
    this.state = 'requesting';
    const requestToken = {}; this.requestToken = requestToken;
    try {
      if (!mediaDevices?.getUserMedia || !Recorder) throw new Error('Microphone recording is unavailable in this browser.');
      const cancelled = new Promise(resolve => this.cancelRequest = () => resolve(null));
      const requested = mediaDevices.getUserMedia({ audio: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), echoCancellation: false, noiseSuppression: false, autoGainControl: false } }).then(stream => {
        if (this.requestToken !== requestToken || this.state !== 'requesting') { stream.getTracks().forEach(t => t.stop()); return null; }
        return stream;
      });
      this.stream = await Promise.race([requested, cancelled]); this.cancelRequest = null;
      if (!this.stream || this.state !== 'requesting') { this.release(); return; }
      const recorder = new Recorder(this.stream), chunks = [];
      this.recorder = recorder; this.error = null;
      this.finished = new Promise((resolve, reject) => {
        recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
        recorder.onerror = () => {
          const error = new Error('Recording failed. Check your microphone and try again. Your existing tracks are unchanged.');
          if (this.recorder === recorder) { this.error = error; this.release(); }
          reject(error);
        };
        recorder.onstop = () => { const blob = new Blob(chunks, { type: recorder.mimeType }); if (this.recorder === recorder) this.release(); resolve(blob); };
      });
      this.finished.catch(() => {});
      this.recorder.start(1000); this.state = 'recording';
    } catch (error) { this.release(); throw error; }
  }
  release() { this.stream?.getTracks().forEach(t => t.stop()); this.stream = null; this.state = 'idle'; }
  async stop() {
    if (this.state === 'requesting') { this.state = 'cancelled'; this.cancelRequest?.(); return null; }
    if (this.state !== 'recording') return null;
    this.state = 'stopping'; this.recorder.stop(); return this.finished;
  }
}
