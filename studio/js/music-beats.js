// Original synthesized drum voices. No third-party sample library is required.
export const DRUMS = Object.freeze([
  ['kick', 'Kick'], ['snare', 'Snare'], ['hat', 'Closed hi-hat'],
  ['openHat', 'Open hi-hat'], ['clap', 'Clap'], ['tom', 'Low tom']
].map(([id, name]) => Object.freeze({ id, name })));

export function createBeat() {
  return { swing: 0, bars: 4, rows: DRUMS.map(drum => ({ id: drum.id, level: 0.8, steps: Array(16).fill(0) })) };
}

export function validateBeat(raw) {
  if (raw === undefined) return createBeat();
  if (!raw || !Number.isFinite(raw.swing) || raw.swing < 0 || raw.swing > 0.6 || !Number.isInteger(raw.bars) || raw.bars < 1 || raw.bars > 32 || !Array.isArray(raw.rows) || raw.rows.length !== DRUMS.length) throw new Error('The saved beat pattern is invalid.');
  return { swing: raw.swing, bars: raw.bars, rows: DRUMS.map(drum => {
    const row = raw.rows.find(r => r?.id === drum.id);
    if (!row || !Number.isFinite(row.level) || row.level < 0 || row.level > 1 || !Array.isArray(row.steps) || row.steps.length !== 16 || !row.steps.every(v => Number.isFinite(v) && v >= 0 && v <= 1)) throw new Error('The saved drum steps are invalid.');
    return { id: drum.id, level: row.level, steps: [...row.steps] };
  }) };
}

export function beatPreset(name) {
  const beat = createBeat();
  const patterns = {
    rap: { kick: [0, 6, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14] },
    dance: { kick: [0, 4, 8, 12], clap: [4, 12], openHat: [2, 6, 10, 14], hat: [0, 4, 8, 12] },
    empty: {}
  };
  if (!Object.hasOwn(patterns, name)) throw new Error('Choose one of the available beat starters.');
  for (const row of beat.rows) for (const index of patterns[name][row.id] || []) row.steps[index] = 1;
  return beat;
}

export function beatEvents(raw, tempo) {
  const beat = validateBeat(raw);
  if (!Number.isFinite(tempo) || tempo < 40 || tempo > 240) throw new Error('Choose a beat speed from 40 to 240 beats per minute.');
  const stepTime = 60 / tempo / 4;
  const events = [];
  for (let bar = 0; bar < beat.bars; bar++) for (const row of beat.rows) row.steps.forEach((velocity, step) => {
    if (velocity && row.level) events.push({ id: row.id, at: (bar * 16 + step + (step % 2 ? beat.swing : 0)) * stepTime, level: velocity * row.level });
  });
  return { events: events.sort((a, b) => a.at - b.at), seconds: beat.bars * 4 * 60 / tempo };
}

export function drumSound(id, sampleRate) {
  if (!DRUMS.some(d => d.id === id) || !Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new Error('Unsupported drum voice or sample rate.');
  const duration = { kick: 0.6, snare: 0.24, hat: 0.07, openHat: 0.32, clap: 0.2, tom: 0.45 }[id];
  const samples = new Float32Array(Math.ceil(duration * sampleRate));
  let seed = 1709 + DRUMS.findIndex(d => d.id === id), phase = 0, previous = 0;
  for (let i = 0; i < samples.length; i++) {
    const time = i / sampleRate;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = seed / 4294967296 * 2 - 1, highNoise = (noise - previous) * 0.5; previous = noise;
    let value;
    if (id === 'kick' || id === 'tom') {
      const frequency = id === 'kick' ? 45 + 100 * Math.exp(-time * 32) : 100 + 90 * Math.exp(-time * 18);
      phase += 2 * Math.PI * frequency / sampleRate;
      value = Math.sin(phase) * Math.exp(-time * (id === 'kick' ? 8 : 11));
    } else if (id === 'snare') value = (0.75 * noise + 0.25 * Math.sin(2 * Math.PI * 180 * time)) * Math.exp(-time * 23);
    else if (id === 'clap') {
      const burst = time < 0.035 ? Math.exp(-(time % 0.012) * 200) : Math.exp(-(time - 0.035) * 28) * 0.65;
      value = highNoise * burst;
    } else value = highNoise * Math.exp(-time * (id === 'hat' ? 65 : 14));
    // Short fades avoid discontinuities at clip boundaries.
    samples[i] = value * Math.min(1, time / 0.001) * Math.min(1, (duration - time) / 0.01);
  }
  return samples;
}

export function renderBeat(raw, tempo, sampleRate = 48000) {
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new Error('Unsupported beat sample rate.');
  const { events, seconds } = beatEvents(raw, tempo);
  if (!events.length) throw new Error('Turn on a drum step or choose a beat starter first.');
  const length = Math.ceil(seconds * sampleRate);
  if (length * 4 > 64 * 1024 * 1024) throw new Error('This beat is too long for one part. Choose fewer bars.');
  const samples = new Float32Array(length), voices = new Map();
  for (const event of events) {
    if (!voices.has(event.id)) voices.set(event.id, drumSound(event.id, sampleRate));
    const sound = voices.get(event.id), start = Math.round(event.at * sampleRate);
    for (let i = 0; i < sound.length && start + i < length; i++) samples[start + i] += sound[i] * event.level;
  }
  let peak = 0; for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  const gain = peak > 0.85 ? 0.85 / peak : 1;
  const fade = Math.min(length, Math.ceil(sampleRate * 0.004));
  for (let i = 0; i < length; i++) samples[i] *= gain * Math.min(1, (length - 1 - i) / fade);
  return { samples, sampleRate, seconds: length / sampleRate };
}
