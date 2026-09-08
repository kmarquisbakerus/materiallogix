export const INSTRUMENTS = Object.freeze([
  ['piano', 'Piano keys'], ['electric', 'Electric piano'], ['organ', 'Organ'],
  ['bass', 'Bass'], ['pluck', 'Plucked strings'], ['strings', 'String ensemble'],
  ['pad', 'Synth pad'], ['lead', 'Synth lead'], ['flute', 'Flute tone'], ['sampler', 'Your sample']
].map(([id, name]) => Object.freeze({ id, name })));

export const noteName = pitch => `${['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][pitch % 12]}${Math.floor(pitch / 12) - 1}`;
export const noteFrequency = pitch => 440 * 2 ** ((pitch - 69) / 12);

export function createInstrumentPattern() {
  return { voice: 'piano', bars: 4, notes: [], sample: null };
}

export function validateInstrumentPattern(raw) {
  if (raw === undefined) return createInstrumentPattern();
  if (!raw || !INSTRUMENTS.some(i => i.id === raw.voice) || !Number.isInteger(raw.bars) || raw.bars < 1 || raw.bars > 32 || !Array.isArray(raw.notes) || raw.notes.length > 128) throw new Error('The instrument pattern is invalid.');
  const ids = new Set();
  const notes = raw.notes.map(note => {
    if (!note || typeof note.id !== 'string' || !note.id || ids.has(note.id) || !Number.isInteger(note.pitch) || note.pitch < 24 || note.pitch > 96 || !Number.isInteger(note.step) || note.step < 0 || note.step > 15 || !Number.isInteger(note.length) || note.length < 1 || note.step + note.length > 16 || !Number.isFinite(note.velocity) || note.velocity < 0.01 || note.velocity > 1) throw new Error('An instrument note is invalid.');
    ids.add(note.id); return { id: note.id, pitch: note.pitch, step: note.step, length: note.length, velocity: note.velocity };
  });
  let sample = null;
  if (raw.sample !== null && raw.sample !== undefined) {
    const s = raw.sample;
    if (!s || typeof s.sourceId !== 'string' || !s.sourceId || !Number.isInteger(s.rootNote) || s.rootNote < 24 || s.rootNote > 96 || !Number.isFinite(s.offset) || s.offset < 0 || !Number.isFinite(s.duration) || s.duration <= 0 || s.duration > 30) throw new Error('The instrument sample is invalid.');
    sample = { sourceId: s.sourceId, rootNote: s.rootNote, offset: s.offset, duration: s.duration };
  }
  return { voice: raw.voice, bars: raw.bars, notes, sample };
}

export function addInstrumentNotes(pattern, { pitch = 60, step = 0, length = 4, velocity = 0.8, chord = 'single' } = {}) {
  const chords = { single: [0], major: [0, 4, 7], minor: [0, 3, 7], seventh: [0, 4, 7, 10] };
  if (!Object.hasOwn(chords, chord)) throw new Error('Choose a supported chord.');
  if (pattern.notes.length + chords[chord].length > 128) throw new Error('This pattern has reached its note limit. Remove a note before adding another.');
  const notes = chords[chord].map(interval => ({ id: crypto.randomUUID(), pitch: pitch + interval, step, length, velocity }));
  const validated = validateInstrumentPattern({ ...pattern, notes: [...pattern.notes, ...notes] });
  pattern.notes = validated.notes;
}

export function instrumentPreset(name, voice = 'piano') {
  const pattern = createInstrumentPattern(); pattern.voice = voice;
  if (name === 'chords') { addInstrumentNotes(pattern, { pitch: 60, length: 8, chord: 'major' }); addInstrumentNotes(pattern, { pitch: 57, step: 8, length: 8, chord: 'minor' }); }
  else if (name === 'bassline') for (const [pitch, step, length] of [[36, 0, 4], [36, 6, 2], [43, 8, 4], [39, 14, 2]]) addInstrumentNotes(pattern, { pitch, step, length });
  else if (name === 'melody') for (const [pitch, step] of [[60, 0], [64, 4], [67, 8], [64, 12]]) addInstrumentNotes(pattern, { pitch, step, length: 3 });
  else if (name !== 'empty') throw new Error('Choose an available instrument starter.');
  return pattern;
}

export function synthNote(voice, pitch, seconds, sampleRate, velocity = 0.8) {
  if (!INSTRUMENTS.some(i => i.id === voice && i.id !== 'sampler') || !Number.isInteger(pitch) || pitch < 24 || pitch > 96 || !Number.isFinite(seconds) || seconds <= 0 || seconds > 24 || ![44100, 48000, 96000].includes(sampleRate) || !Number.isFinite(velocity) || velocity <= 0 || velocity > 1) throw new Error('Unsupported instrument note.');
  const release = ['pad', 'strings'].includes(voice) ? 0.35 : 0.12;
  const attack = voice === 'pad' ? 0.22 : voice === 'strings' ? 0.08 : voice === 'flute' ? 0.035 : 0.003;
  const frequency = noteFrequency(pitch), length = Math.ceil((seconds + release) * sampleRate), out = new Float32Array(length);
  const partials = Math.min(voice === 'pad' || voice === 'strings' || voice === 'lead' ? 10 : 6, Math.floor(sampleRate * 0.45 / frequency));
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate, envelope = Math.min(1, t / attack) * (t <= seconds ? 1 : Math.max(0, 1 - (t - seconds) / release));
    const phase = 2 * Math.PI * frequency * t;
    let value = 0;
    for (let harmonic = 1; harmonic <= partials; harmonic++) {
      let weight, detune = 1;
      if (voice === 'piano') weight = Math.exp(-t * (1.6 + harmonic * 0.65)) / harmonic ** 1.5 * (harmonic === 1 ? 1 : 0.3 + velocity);
      else if (voice === 'electric') weight = [0, 1, 0.15, 0.32, 0.05, 0.1, 0.03][harmonic] * Math.exp(-t * (1 + harmonic * 0.6));
      else if (voice === 'organ') weight = [0, 1, 0.5, 0.35, 0.3, 0.08, 0.12][harmonic];
      else if (voice === 'bass') weight = harmonic === 1 ? 1 : 0.5 / harmonic ** 2 * Math.exp(-t * 4);
      else if (voice === 'pluck') weight = Math.exp(-t * (3 + harmonic)) / harmonic;
      else if (voice === 'flute') weight = harmonic === 1 ? 1 : harmonic === 2 ? 0.1 : 0.02 / harmonic;
      else { weight = 1 / harmonic ** (voice === 'lead' ? 1.1 : voice === 'strings' ? 1.35 : 2.2); detune = 1 + Math.sin(t * 5) * 0.001; }
      value += Math.sin(phase * harmonic * detune) * weight;
      if (voice === 'strings' || voice === 'pad') value += Math.sin(phase * harmonic * 1.002) * weight * 0.4;
    }
    out[i] = value * envelope * velocity * 0.25;
  }
  out[length - 1] = 0; return out;
}

function sampledNote(sample, buffer, pitch, seconds, sampleRate, velocity) {
  if (!buffer || sample.offset + sample.duration > buffer.duration + 0.002) throw new Error('Choose a sample that is available in this project.');
  const ratio = 2 ** ((pitch - sample.rootNote) / 12), rate = buffer.sampleRate / sampleRate * ratio;
  const frames = Math.min(Math.ceil((seconds + 0.12) * sampleRate), Math.floor(sample.duration * buffer.sampleRate / rate));
  const out = new Float32Array(frames), channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  for (let i = 0; i < frames; i++) {
    const at = sample.offset * buffer.sampleRate + i * rate, first = Math.floor(at), fraction = at - first;
    let value = 0;
    for (const channel of channels) value += ((channel[first] || 0) * (1 - fraction) + (channel[first + 1] || 0) * fraction) / channels.length;
    out[i] = value * velocity * Math.min(1, i / (sampleRate * 0.003)) * Math.min(1, (frames - 1 - i) / (sampleRate * 0.012));
  }
  return out;
}

export function renderInstrument(raw, tempo, sampleRate = 48000, sources = new Map()) {
  const pattern = validateInstrumentPattern(raw);
  if (!Number.isFinite(tempo) || tempo < 40 || tempo > 240 || ![44100, 48000, 96000].includes(sampleRate)) throw new Error('Unsupported tempo or sample rate.');
  if (!pattern.notes.length) throw new Error('Add a note, a chord or a starter before listening.');
  if (pattern.voice === 'sampler' && !pattern.sample) throw new Error('Choose an imported sound for your sample first.');
  const stepTime = 60 / tempo / 4, seconds = pattern.bars * 16 * stepTime + 0.35;
  const length = Math.ceil(seconds * sampleRate);
  const noteFrames = pattern.notes.reduce((sum, n) => sum + Math.ceil((n.length * stepTime + 0.35) * sampleRate), 0);
  if (length * 4 > 64 * 1024 * 1024 || noteFrames > 12 * 1024 * 1024) throw new Error('This instrument part is too large. Use fewer bars or notes.');
  const samples = new Float32Array(length), cache = new Map();
  for (const note of pattern.notes) {
    const key = `${note.pitch}:${note.length}:${note.velocity}`;
    if (!cache.has(key)) cache.set(key, pattern.voice === 'sampler'
      ? sampledNote(pattern.sample, sources.get(pattern.sample.sourceId)?.buffer, note.pitch, note.length * stepTime, sampleRate, note.velocity)
      : synthNote(pattern.voice, note.pitch, note.length * stepTime, sampleRate, note.velocity));
    const sound = cache.get(key);
    for (let bar = 0; bar < pattern.bars; bar++) {
      const start = Math.round((bar * 16 + note.step) * stepTime * sampleRate);
      for (let i = 0; i < sound.length && start + i < length; i++) samples[start + i] += sound[i];
    }
  }
  let peak = 0; for (const value of samples) { if (!Number.isFinite(value)) throw new Error('The instrument produced invalid audio.'); peak = Math.max(peak, Math.abs(value)); }
  if (peak > 0.85) for (let i = 0; i < samples.length; i++) samples[i] *= 0.85 / peak;
  return { samples, sampleRate, seconds: length / sampleRate, musicalSeconds: pattern.bars * 16 * stepTime };
}
