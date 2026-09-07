import { createBeat, validateBeat } from './music-beats.js';
import { createInstrumentPattern, validateInstrumentPattern } from './music-instruments.js';

const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
export const bound = (value, min, max, fallback = min) => Math.min(max, Math.max(min, finite(value, fallback)));
const uid = () => crypto.randomUUID();
export const SESSION_LIMITS = Object.freeze({ tracks: 128, clips: 4096, seconds: 7200 });

export function createSession() {
  return { version: 1, id: uid(), name: 'Untitled song', mode: 'guided', tempo: 120,
    masterDb: -6, loop: { enabled: false, start: 0, end: 8 }, beat: createBeat(), instrument: createInstrumentPattern(), tracks: [] };
}

export function createTrack(name = 'Audio track') {
  return { id: uid(), name: String(name).slice(0, 120), gainDb: 0, pan: 0, mute: false, solo: false, bypass: false, polarity: false,
    lowDb: 0, midDb: 0, highDb: 0, compression: 0, room: 0, delay: 0, generated: null, clips: [] };
}

export function createClip(sourceId, duration, start = 0) {
  if (typeof sourceId !== 'string' || !sourceId || !Number.isFinite(duration) || duration <= 0) throw new Error('The audio has no usable duration.');
  start = bound(start, 0, SESSION_LIMITS.seconds - 0.001);
  return { id: uid(), sourceId, start, offset: 0,
    duration: Math.min(duration, SESSION_LIMITS.seconds - start), fadeIn: 0, fadeOut: 0, gainDb: 0 };
}

export function sessionDuration(session) {
  return Math.max(0, ...session.tracks.flatMap(t => t.clips.map(c => c.start + c.duration)));
}

export function audibleTracks(session) {
  const solo = session.tracks.some(t => t.solo && !t.mute);
  return session.tracks.filter(t => !t.mute && (!solo || t.solo));
}

export function clipEnvelope(clip, time) {
  if (time < 0 || time >= clip.duration) return 0;
  const attack = clip.fadeIn ? Math.min(1, time / clip.fadeIn) : 1;
  const release = clip.fadeOut ? Math.min(1, (clip.duration - time) / clip.fadeOut) : 1;
  return Math.min(attack, release) * 10 ** (clip.gainDb / 20);
}

export function editClip(clip, patch, sourceDuration) {
  if (!Number.isFinite(sourceDuration) || sourceDuration < 0.001) throw new Error('This audio is too short to edit.');
  const next = { ...clip, ...patch, id: clip.id, sourceId: clip.sourceId };
  next.start = bound(next.start, 0, SESSION_LIMITS.seconds - 0.001);
  next.offset = bound(next.offset, 0, Math.max(0, sourceDuration - 0.001));
  next.duration = bound(next.duration, 0.001, Math.min(sourceDuration - next.offset, SESSION_LIMITS.seconds - next.start));
  next.fadeIn = bound(next.fadeIn, 0, next.duration / 2);
  next.fadeOut = bound(next.fadeOut, 0, next.duration / 2);
  next.gainDb = bound(next.gainDb, -60, 12, 0);
  return next;
}

export function splitClip(track, clipId, time) {
  const index = track.clips.findIndex(c => c.id === clipId);
  const clip = track.clips[index];
  if (!clip || !Number.isFinite(time) || time <= clip.start + 0.001 || time >= clip.start + clip.duration - 0.001) {
    throw new Error('Place the playhead inside the selected clip to split it.');
  }
  const leftDuration = time - clip.start;
  const left = { ...clip, duration: leftDuration, fadeIn: Math.min(clip.fadeIn, leftDuration / 2), fadeOut: 0 };
  const right = { ...clip, id: uid(), start: time, offset: clip.offset + leftDuration,
    duration: clip.duration - leftDuration, fadeIn: 0, fadeOut: Math.min(clip.fadeOut, (clip.duration - leftDuration) / 2) };
  track.clips.splice(index, 1, left, right);
  return right;
}

export function duplicateClip(track, clipId) {
  const clip = track.clips.find(c => c.id === clipId);
  if (!clip) throw new Error('Select a clip first.');
  if (clip.start + 2 * clip.duration > SESSION_LIMITS.seconds) throw new Error('The duplicate would exceed the project duration limit.');
  const copy = { ...clip, id: uid(), start: clip.start + clip.duration };
  track.clips.push(copy);
  return copy;
}

export function validateSession(raw) {
  if (!raw || raw.version !== 1 || !Array.isArray(raw.tracks) || raw.tracks.length > SESSION_LIMITS.tracks) throw new Error('This is not a supported music project.');
  const session = createSession();
  session.id = typeof raw.id === 'string' ? raw.id : session.id;
  session.name = String(raw.name || 'Untitled song').slice(0, 120);
  session.mode = raw.mode === 'advanced' ? 'advanced' : 'guided';
  session.tempo = bound(raw.tempo, 40, 240, 120);
  session.masterDb = bound(raw.masterDb, -60, 6, -6);
  session.beat = validateBeat(raw.beat);
  session.instrument = validateInstrumentPattern(raw.instrument);
  session.loop.start = bound(raw.loop?.start, 0, SESSION_LIMITS.seconds - 0.01);
  session.loop.end = bound(raw.loop?.end, session.loop.start + 0.01, SESSION_LIMITS.seconds, session.loop.start + 8);
  session.loop.enabled = raw.loop?.enabled === true;
  const ids = new Set();
  let count = 0;
  const unique = id => { if (typeof id !== 'string' || !id || ids.has(id)) throw new Error('The project contains duplicate or missing identifiers.'); ids.add(id); return id; };
  session.tracks = raw.tracks.map(value => {
    if (!value || !Array.isArray(value.clips)) throw new Error('A project track is invalid.');
    const track = createTrack(value.name);
    track.id = unique(value.id);
    for (const k of ['gainDb', 'lowDb', 'midDb', 'highDb']) track[k] = bound(value[k], k === 'gainDb' ? -60 : -18, k === 'gainDb' ? 12 : 18, 0);
    track.pan = bound(value.pan, -1, 1, 0);
    for (const k of ['compression', 'room', 'delay']) track[k] = bound(value[k], 0, 1);
    track.mute = value.mute === true; track.solo = value.solo === true;
    track.bypass = value.bypass === true; track.polarity = value.polarity === true;
    if (value.generated !== null && value.generated !== undefined) {
      const g = value.generated;
      if (!g || !['beat', 'instrument'].includes(g.kind) || typeof g.sourceId !== 'string' || !g.sourceId || !Number.isFinite(g.duration) || g.duration <= 0 || !Number.isFinite(g.tempo) || g.tempo < 40 || g.tempo > 240) throw new Error('A generated part is invalid.');
      track.generated = { kind: g.kind, sourceId: g.sourceId, duration: g.duration, tempo: g.tempo,
        pattern: g.kind === 'beat' ? validateBeat(g.pattern) : validateInstrumentPattern(g.pattern) };
    }
    track.clips = value.clips.map(c => {
      if (++count > SESSION_LIMITS.clips || !c || typeof c.sourceId !== 'string' || !c.sourceId) throw new Error('The project has invalid clips.');
      if (![c.start, c.offset, c.duration, c.fadeIn, c.fadeOut, c.gainDb].every(Number.isFinite) || c.duration <= 0 || c.start < 0 || c.offset < 0 || c.start + c.duration > SESSION_LIMITS.seconds) throw new Error('A clip contains invalid timing.');
      return { id: unique(c.id), sourceId: c.sourceId, start: c.start, offset: c.offset,
        duration: c.duration, fadeIn: bound(c.fadeIn, 0, c.duration / 2), fadeOut: bound(c.fadeOut, 0, c.duration / 2), gainDb: bound(c.gainDb, -60, 12, 0) };
    });
    return track;
  });
  return session;
}

export class SessionHistory {
  constructor(session) { this.session = session; this.undoStack = []; this.redoStack = []; }
  change(action) {
    const before = structuredClone(this.session);
    try { action(this.session); this.session = validateSession(this.session); }
    catch (error) { this.session = before; throw error; }
    this.undoStack.push(before);
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
  }
  undo() { if (!this.undoStack.length) return false; this.redoStack.push(this.session); this.session = this.undoStack.pop(); return true; }
  redo() { if (!this.redoStack.length) return false; this.undoStack.push(this.session); this.session = this.redoStack.pop(); return true; }
}

export function replaceGeneratedPart(track, sourceId, duration, pattern, tempo) {
  const previous = track.generated;
  if (!previous) throw new Error('Choose a beat or instrument part to update.');
  const clips = track.clips.map(clip => {
    if (clip.sourceId !== previous.sourceId) return clip;
    if (clip.offset >= duration) throw new Error('This pattern is shorter than a trimmed part. Lengthen the pattern or add it as a new part.');
    const untrimmed = clip.offset === 0 && Math.abs(clip.duration - previous.duration) < 0.002;
    const length = untrimmed ? duration : Math.min(clip.duration, duration - clip.offset);
    if (clip.start + length > SESSION_LIMITS.seconds) throw new Error('The updated part would go beyond the project limit. Move it earlier first.');
    return { ...clip, sourceId, duration: length, fadeIn: Math.min(clip.fadeIn, length / 2), fadeOut: Math.min(clip.fadeOut, length / 2) };
  });
  track.clips = clips; track.generated = { ...previous, sourceId, duration, pattern: structuredClone(pattern), tempo };
}

export function musicTier(license) {
  if (!license) return 'preview';
  const selected = license.selected_product || license.selectedProduct;
  if (license.plan === 'pro' || (license.plan === 'single_pro' && selected === 'music')) return 'pro';
  if (license.plan === 'full' || (license.plan === 'single' && selected === 'music')) return 'standard';
  return 'preview';
}

export const trackLimit = tier => tier === 'pro' ? 128 : 32;

export function encodeWav(channels, sampleRate, bits = 24) {
  if (![16, 24].includes(bits) || !Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000 || ![1, 2].includes(channels.length)) throw new Error('Unsupported WAV format.');
  const frames = channels[0].length;
  if (!frames || channels.some(c => !(c instanceof Float32Array) || c.length !== frames)) throw new Error('Audio channels must have equal, nonempty lengths.');
  const bytes = bits / 8, dataSize = frames * channels.length * bytes;
  if (dataSize > 512 * 1024 * 1024) throw new Error('The WAV is too large for this browser export.');
  const output = new ArrayBuffer(44 + dataSize), view = new DataView(output);
  const ascii = (offset, text) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
  ascii(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); ascii(8, 'WAVE'); ascii(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels.length, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * channels.length * bytes, true);
  view.setUint16(32, channels.length * bytes, true); view.setUint16(34, bits, true); ascii(36, 'data'); view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let i = 0; i < frames; i++) for (const channel of channels) {
    if (!Number.isFinite(channel[i])) throw new Error('Audio contains invalid samples.');
    const sample = Math.max(-1, Math.min(1, channel[i]));
    const value = Math.round(sample * (sample < 0 ? 2 ** (bits - 1) : 2 ** (bits - 1) - 1));
    if (bits === 16) view.setInt16(offset, value, true);
    else { view.setUint8(offset, value & 255); view.setUint8(offset + 1, (value >> 8) & 255); view.setUint8(offset + 2, (value >> 16) & 255); }
    offset += bytes;
  }
  return new Blob([output], { type: 'audio/wav' });
}
