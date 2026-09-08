import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, createTrack, createClip, editClip, splitClip, duplicateClip, validateSession, SessionHistory, audibleTracks, clipEnvelope, musicTier, encodeWav } from '../studio/js/music-session.js';
import { packProject, unpackProject, projectSnapshot } from '../studio/js/music-project.js';
import { musicGuidance, microphoneHelp } from '../studio/js/music-guidance.js';

const fixture = () => { const s = createSession(), t = createTrack('Voice'); t.clips.push(createClip('take', 10, 2)); s.tracks.push(t); return s; };

test('new songs start guided and changing mode leaves audio untouched', () => {
  const s = fixture(); assert.equal(s.mode, 'guided');
  const before = structuredClone(s.tracks); s.mode = 'advanced';
  assert.deepEqual(validateSession(s).tracks, before);
});
test('splitting keeps source offsets and duplication does not mutate original audio', () => {
  const t = fixture().tracks[0]; const original = t.clips[0];
  const right = splitClip(t, original.id, 6);
  assert.equal(t.clips[0].duration, 4); assert.equal(right.offset, 4); assert.equal(right.duration, 6);
  assert.equal(duplicateClip(t, right.id).start, 12);
  assert.throws(() => splitClip(t, original.id, 2), /inside/);
});
test('clip editing preserves identity and clamps trims and fades to the source', () => {
  const c = createClip('take', 5);
  const edited = editClip(c, { id: 'spoof', sourceId: 'spoof', offset: 4, duration: 10, fadeIn: 3, fadeOut: 3 }, 5);
  assert.equal(edited.id, c.id); assert.equal(edited.sourceId, 'take'); assert.equal(edited.duration, 1);
  assert.equal(edited.fadeIn, 0.5); assert.equal(edited.fadeOut, 0.5);
  assert.throws(() => editClip(c, {}, NaN), /short/);
  assert.ok(createClip('take', 5, 7200).duration < 0.002);
});
test('history undoes and redoes edits and rolls back invalid changes atomically', () => {
  const h = new SessionHistory(fixture());
  h.change(s => s.tracks[0].gainDb = -12); h.undo(); assert.equal(h.session.tracks[0].gainDb, 0);
  h.redo(); assert.equal(h.session.tracks[0].gainDb, -12);
  const before = structuredClone(h.session);
  assert.throws(() => h.change(s => s.tracks[0].clips[0].duration = Infinity));
  assert.deepEqual(h.session, before);
});
test('mute and solo choose the audible tracks consistently', () => {
  const s = fixture(); s.tracks.push(createTrack('Beat')); s.tracks[0].solo = true;
  assert.deepEqual(audibleTracks(s).map(t => t.name), ['Voice']);
  s.tracks[0].mute = true; assert.deepEqual(audibleTracks(s).map(t => t.name), ['Beat']);
});
test('invalid project timing and duplicate identifiers fail before playback', () => {
  const s = fixture(); s.tracks[0].clips.push(structuredClone(s.tracks[0].clips[0]));
  assert.throws(() => validateSession(s), /duplicate/);
  s.tracks[0].clips.pop(); s.tracks[0].clips[0].offset = -1;
  assert.throws(() => validateSession(s), /timing/);
});
test('fades are linear and silent outside their clip', () => {
  const c = { ...createClip('take', 10), fadeIn: 2, fadeOut: 2 };
  assert.equal(clipEnvelope(c, 0), 0); assert.equal(clipEnvelope(c, 1), 0.5);
  assert.equal(clipEnvelope(c, 9), 0.5); assert.equal(clipEnvelope(c, 10), 0);
});
test('music access does not mistake a single Voice licence for Music', () => {
  assert.equal(musicTier({ plan: 'single_pro', selected_product: 'voice' }), 'preview');
  assert.equal(musicTier({ plan: 'single_pro', selected_product: 'music' }), 'pro');
  assert.equal(musicTier(null), 'preview');
});
test('16-bit and 24-bit WAV headers and signed samples are correct', async () => {
  for (const bits of [16, 24]) {
    const blob = encodeWav([new Float32Array([-1, 0, 1])], 48000, bits);
    const v = new DataView(await blob.arrayBuffer());
    assert.equal(v.getUint16(34, true), bits); assert.equal(v.getUint32(24, true), 48000);
    assert.equal(v.getUint32(40, true), 3 * bits / 8);
    if (bits === 16) { assert.equal(v.getInt16(44, true), -32768); assert.equal(v.getInt16(48, true), 32767); }
    else assert.deepEqual([...new Uint8Array(v.buffer, 44)], [0, 0, 128, 0, 0, 0, 255, 255, 127]);
  }
  assert.throws(() => encodeWav([new Float32Array([NaN])], 48000), /invalid samples/);
});
test('portable project round trips original source bytes and nondestructive edits', async () => {
  const session = fixture(), bytes = new Uint8Array([1, 5, 9, 255]);
  const snapshot = projectSnapshot(session, new Map([['take', { name: 'My take.wav', blob: new Blob([bytes], { type: 'audio/wav' }) }]]));
  const packed = packProject(snapshot), restored = await unpackProject(packed);
  assert.deepEqual(restored.session, session);
  assert.deepEqual(new Uint8Array(await restored.audio[0].blob.arrayBuffer()), bytes);
  await assert.rejects(unpackProject(packed.slice(0, packed.size - 1)), /invalid source/);
  await assert.rejects(unpackProject(new Blob([packed, 'extra'])), /incomplete/);
  assert.throws(() => projectSnapshot(session, new Map()), /missing/);
});
test('guided steps follow actual progress and give recovery a priority', () => {
  assert.equal(musicGuidance(createSession()).action, 'import');
  assert.equal(musicGuidance(fixture()).action, 'play');
  assert.equal(musicGuidance(fixture(), { recording: true }).label, 'Finish recording');
  assert.equal(musicGuidance(fixture(), { saveError: true }).action, 'save');
  assert.match(microphoneHelp({ name: 'NotAllowedError' }), /site settings/);
  assert.match(microphoneHelp({ name: 'NotFoundError' }), /Connect a microphone/);
});
