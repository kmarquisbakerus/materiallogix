import test from 'node:test';
import assert from 'node:assert/strict';
import { INSTRUMENTS, noteName, noteFrequency, synthNote, renderInstrument, instrumentPreset, createInstrumentPattern, addInstrumentNotes, validateInstrumentPattern } from '../studio/js/music-instruments.js';
import { createSession, SessionHistory } from '../studio/js/music-session.js';
import { packProject, unpackProject, projectSnapshot } from '../studio/js/music-project.js';

test('instrument pitches follow equal temperament and expose readable note names', () => {
  assert.equal(noteFrequency(69), 440); assert.equal(noteFrequency(81), 880); assert.equal(noteName(60), 'C4');
});
test('every built-in instrument creates finite, bounded, non-silent notes with clean endings', () => {
  const results = [];
  for (const { id } of INSTRUMENTS.filter(i => i.id !== 'sampler')) {
    const samples = synthNote(id, 60, 0.2, 48000);
    assert.ok(samples.every(value => Number.isFinite(value) && Math.abs(value) < 1));
    assert.ok(samples.some(value => Math.abs(value) > 0.01));
    assert.equal(samples[0], 0); assert.equal(samples.at(-1), 0);
    for (const previous of results) assert.notDeepEqual(samples, previous);
    results.push(samples);
  }
});
test('chords add simultaneous pitches and invalid high chords never partially change the pattern', () => {
  const pattern = createInstrumentPattern(); addInstrumentNotes(pattern, { pitch: 60, chord: 'minor' });
  assert.deepEqual(pattern.notes.map(n => n.pitch), [60, 63, 67]);
  assert.ok(pattern.notes.every(n => n.step === 0 && n.length === 4));
  const before = structuredClone(pattern);
  assert.throws(() => addInstrumentNotes(pattern, { pitch: 96, chord: 'major' }), /invalid/);
  assert.deepEqual(pattern, before);
});
test('rendered patterns keep bar timing, release tails and clipping headroom', () => {
  const pattern = instrumentPreset('chords', 'piano'); pattern.bars = 2;
  const result = renderInstrument(pattern, 120, 48000);
  assert.equal(result.musicalSeconds, 4); assert.ok(Math.abs(result.seconds - 4.35) < 1 / 48000);
  assert.ok(result.samples.every(v => Number.isFinite(v) && Math.abs(v) <= 0.850001));
  assert.ok(result.samples.slice(48000, 48000 + 400).some(v => Math.abs(v) > 0.01));
});
test('sampler uses the selected original audio and preserves it in an otherwise empty project', async () => {
  const samples = new Float32Array(4800); for (let i = 0; i < samples.length; i++) samples[i] = Math.sin(i * 2 * Math.PI * 440 / 48000) * 0.5;
  const source = { id: 'instrument-source', name: 'Own.wav', blob: new Blob(['original']), buffer: { duration: 0.1, sampleRate: 48000, numberOfChannels: 1, getChannelData: () => samples } };
  const sources = new Map([[source.id, source]]), session = createSession();
  session.instrument = instrumentPreset('melody', 'sampler'); session.instrument.sample = { sourceId: source.id, rootNote: 60, offset: 0, duration: 0.1 };
  const result = renderInstrument(session.instrument, 120, 48000, sources);
  assert.ok(result.samples.some(v => Math.abs(v) > 0.1));
  const restored = await unpackProject(packProject(projectSnapshot(session, sources)));
  assert.equal(restored.audio.length, 1); assert.equal(await restored.audio[0].blob.text(), 'original');
  assert.deepEqual(restored.session.instrument, session.instrument);
  assert.throws(() => renderInstrument(session.instrument, 120, 48000, new Map()), /sample.*available/);
});
test('instrument selections and edited notes survive mode changes and undo', () => {
  const history = new SessionHistory(createSession()); history.change(s => s.instrument = instrumentPreset('bassline', 'bass'));
  const original = structuredClone(history.session.instrument);
  history.change(s => s.mode = 'advanced'); assert.deepEqual(history.session.instrument, original);
  history.change(s => s.instrument.notes[0].pitch = 40); history.undo(); assert.deepEqual(history.session.instrument, original);
  assert.throws(() => validateInstrumentPattern({ ...original, voice: 'nonexistent' }), /invalid/);
});
