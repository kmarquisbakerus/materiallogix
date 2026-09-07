import test from 'node:test';
import assert from 'node:assert/strict';
import { beatPreset, beatEvents, createBeat, validateBeat, renderBeat, drumSound, DRUMS } from '../studio/js/music-beats.js';
import { createSession, createTrack, SessionHistory, validateSession, encodeWav } from '../studio/js/music-session.js';
import { packProject, unpackProject, projectSnapshot } from '../studio/js/music-project.js';
import { applyMixStarter } from '../studio/js/music-mix.js';

test('beat events keep whole bars aligned while swing delays only alternate steps', () => {
  const beat = createBeat(); beat.bars = 2; beat.swing = 0.5;
  beat.rows[0].steps = Array(16).fill(1);
  const straight = beatEvents({ ...beat, swing: 0 }, 120), swung = beatEvents(beat, 120);
  assert.equal(swung.seconds, 4); assert.equal(swung.events.length, 32);
  for (let i = 0; i < 32; i++) assert.equal(swung.events[i].at - straight.events[i].at, i % 2 ? 0.0625 : 0);
  assert.equal(swung.events[16].at, 2);
});

test('drum synthesis produces finite, distinct, reproducible audio without sample downloads', () => {
  const voices = DRUMS.map(drum => drumSound(drum.id, 48000));
  for (let i = 0; i < voices.length; i++) {
    assert.ok(voices[i].every(Number.isFinite)); assert.ok(voices[i].some(value => Math.abs(value) > 0.05));
    assert.deepEqual(voices[i], drumSound(DRUMS[i].id, 48000));
    for (let j = 0; j < i; j++) assert.notDeepEqual(voices[i], voices[j]);
  }
});

test('dense beats fit the promised duration and have headroom in the actual WAV samples', async () => {
  const beat = createBeat(); beat.bars = 2;
  for (const row of beat.rows) { row.level = 1; row.steps.fill(1); }
  for (const rate of [44100, 48000]) {
    const rendered = renderBeat(beat, 120, rate);
    assert.equal(rendered.samples.length, 4 * rate);
    assert.ok(rendered.samples.every(value => Number.isFinite(value) && Math.abs(value) <= 0.850001));
    assert.equal(Math.abs(rendered.samples.at(-1)), 0);
    const wav = new DataView(await encodeWav([rendered.samples], rate, 16).arrayBuffer());
    assert.equal(wav.getUint32(24, true), rate); assert.equal(wav.getUint16(22, true), 1);
    assert.equal(wav.getUint32(40, true), 4 * rate * 2);
    let peak = 0; for (let i = 44; i < wav.byteLength; i += 2) peak = Math.max(peak, Math.abs(wav.getInt16(i, true)));
    assert.ok(peak > 10000 && peak < 28000);
  }
});

test('silent or malformed patterns fail before allocating output audio', () => {
  assert.throws(() => renderBeat(createBeat(), 120), /Turn on/);
  assert.throws(() => beatPreset('unknown'), /available/);
  const beat = beatPreset('rap'); beat.rows[0].steps[0] = NaN;
  assert.throws(() => validateBeat(beat), /invalid/);
  assert.throws(() => renderBeat(beatPreset('rap'), 0), /beat speed/);
  assert.throws(() => renderBeat(beatPreset('rap'), 120, Infinity), /sample rate/);
});

test('old projects gain an empty beat and saved patterns survive undo and portable recovery', async () => {
  const old = createSession(); delete old.beat;
  assert.deepEqual(validateSession(old).beat, createBeat());
  const history = new SessionHistory(createSession());
  history.change(song => song.beat = beatPreset('rap'));
  const selected = structuredClone(history.session.beat);
  history.change(song => song.beat.rows[0].steps[0] = 0);
  history.undo(); assert.deepEqual(history.session.beat, selected);
  const restored = await unpackProject(packProject(projectSnapshot(history.session, new Map())));
  assert.deepEqual(restored.session.beat, selected);
});

test('mix starting points preserve arrangement and balance and can be undone', () => {
  const session = createSession(), track = createTrack('My voice'); track.gainDb = -5; track.pan = -0.2;
  session.tracks.push(track); const original = structuredClone(track), history = new SessionHistory(session);
  history.change(song => applyMixStarter(song.tracks[0], 'rap'));
  assert.equal(history.session.tracks[0].gainDb, -5); assert.equal(history.session.tracks[0].pan, -0.2);
  assert.equal(history.session.tracks[0].compression, 0.35);
  history.undo(); assert.deepEqual(history.session.tracks[0], original);
  assert.throws(() => applyMixStarter(track, 'invented'), /available/);
});
