// Controller tests use decoded-audio doubles. They do not certify browser
// codecs, microphone hardware, audible fidelity, or rendered layout.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MusicStudio } from '../studio/js/music-studio.js';
import { createSession, createTrack, createClip, SessionHistory } from '../studio/js/music-session.js';
import { instrumentPreset } from '../studio/js/music-instruments.js';

function workspace() {
  const w = Object.create(MusicStudio.prototype);
  Object.assign(w, { history: new SessionHistory(createSession()), sources: new Map(), position: 0, revision: 0,
    render() {}, autosave() {}, say(message) { this.message = message; } });
  w.decode = async (blob, name, id = crypto.randomUUID()) => ({ id, name, blob, bytes: 40, buffer: { duration: 2 } });
  return w;
}
function audio(name = 'Beat.wav') { return Object.assign(new Blob(['audio'], { type: 'audio/wav' }), { name }); }

test('adding audio creates real clip arrangements, not sample placeholders', async () => {
  const w = workspace(); await w.importFiles([audio('Beat.wav'), audio('Rap.wav')]);
  assert.equal(w.session.tracks.length, 2); assert.equal(w.sources.size, 2);
  assert.equal(w.session.tracks[1].name, 'Rap.wav'); assert.equal(w.session.tracks[0].clips[0].duration, 2);
  assert.equal(w.history.undoStack.length, 1);
});
test('a corrupt file cannot partially add a batch or remove current tracks', async () => {
  const w = workspace(); await w.importFiles([audio()]);
  const before = structuredClone(w.session), decode = w.decode;
  w.decode = async (...args) => { if (args[1] === 'Broken.wav') throw new Error('not audio'); return decode(...args); };
  await assert.rejects(w.importFiles([audio('Good.wav'), audio('Broken.wav')]), /not audio/);
  assert.deepEqual(w.session, before); assert.equal(w.sources.size, 1);
});
test('unsupported imports and track overflow fail before decoding', async () => {
  const w = workspace(); w.decode = () => { throw new Error('unexpected decode'); };
  await assert.rejects(w.importFiles([Object.assign(new Blob(['x'], { type: 'text/html' }), { name: 'file.wav' })]), /Choose an audio file/);
  for (let i = 0; i < 32; i++) w.session.tracks.push(createTrack());
  await assert.rejects(w.importFiles([audio()]), /32 tracks/);
});
test('guided and advanced switches preserve audio and remain undoable', async () => {
  const w = workspace(); await w.importFiles([audio()]); const tracks = structuredClone(w.session.tracks);
  await w.action('advanced'); assert.equal(w.session.mode, 'advanced'); assert.deepEqual(w.session.tracks, tracks);
  await w.action('guided'); assert.equal(w.session.mode, 'guided'); assert.deepEqual(w.session.tracks, tracks);
  await w.action('undo'); assert.equal(w.session.mode, 'advanced');
});
test('changing a mix control updates playback without stopping the song', async () => {
  const w = workspace(); await w.importFiles([audio()]); const updates = [];
  w.transport = { updateTrack: t => updates.push(t.gainDb), updateMaster: db => updates.push(db), stop: () => assert.fail('mix control stopped playback') };
  w.mixChange(s => s.tracks[0].gainDb = -12);
  assert.deepEqual(updates, [-12, -6]); assert.equal(w.session.tracks[0].gainDb, -12);
});
test('a chosen listening position survives non-playing edits', () => {
  const w = workspace(); w.position = 10; w.transport = { playing: false, current: () => 0, stop() {} };
  w.change(s => s.name = 'New name'); assert.equal(w.position, 10);
});
test('missing audio in a restored project never replaces the current song', async () => {
  const w = workspace(); await w.importFiles([audio()]); const before = structuredClone(w.session);
  const incoming = createSession(), track = createTrack(); track.clips.push(createClip('missing', 2)); incoming.tracks.push(track);
  await assert.rejects(w.restore({ session: incoming, audio: [] }), /missing audio/);
  assert.deepEqual(w.session, before);
});
test('a valid recovered project restores both its audio and editing mode', async () => {
  const w = workspace(), session = createSession(), track = createTrack();
  session.mode = 'advanced'; track.clips.push(createClip('take', 2)); session.tracks.push(track);
  await w.restore({ session, audio: [{ id: 'take', name: 'Take.wav', blob: audio() }] });
  assert.equal(w.session.mode, 'advanced'); assert.equal(w.sources.get('take').name, 'Take.wav');
});
test('failed decoding preserves the unprocessed microphone take and stops backing audio', async () => {
  const w = workspace(); let stopped = false;
  w.recordStarted = 1; w.recordAt = 3; w.recorder = { stop: async () => audio('Take.wav') };
  w.transport = { stop: () => stopped = true };
  w.decode = async () => { throw new Error('decoder unavailable'); };
  await assert.rejects(w.record(), /decoder unavailable/);
  assert.ok(stopped); assert.ok(w.pendingTake instanceof Blob); assert.equal(w.recordStarted, null);
  assert.equal(w.session.tracks.length, 0); assert.equal(w.position, 3);
});
test('new recording cannot overwrite an unsaved take', async () => {
  const w = workspace(); w.pendingTake = audio();
  await assert.rejects(w.record(), /Save your unprocessed/);
  assert.ok(w.pendingTake.size > 0);
});
test('removing a track is undoable and keeps original audio available for restoration', async () => {
  const w = workspace(); await w.importFiles([audio()]); const id = w.session.tracks[0].id;
  await w.action('remove-track', { closest: selector => selector === '[data-track]' ? { dataset: { track: id } } : null });
  assert.equal(w.session.tracks.length, 0); assert.equal(w.sources.size, 1);
  await w.action('undo'); assert.equal(w.session.tracks[0].id, id);
});
test('updating an instrument preserves mix settings and undo restores its audio and editable notes', () => {
  const w = workspace(), pattern = instrumentPreset('chords');
  const first = { id: 'first', name: 'Keys', buffer: { duration: 8.35 }, blob: audio(), bytes: 40 };
  w.commitGeneratedSource(first, 'instrument', pattern, 2);
  const trackId = w.session.tracks[0].id;
  w.change(s => s.tracks[0].gainDb = -12);
  const second = { ...first, id: 'second' }, updated = { ...pattern, voice: 'electric' };
  w.commitGeneratedSource(second, 'instrument', updated, 0, trackId);
  assert.equal(w.session.tracks.length, 1); assert.equal(w.session.tracks[0].clips[0].start, 2);
  assert.equal(w.session.tracks[0].gainDb, -12); assert.equal(w.session.tracks[0].generated.pattern.voice, 'electric');
  w.history.undo(); assert.equal(w.session.tracks[0].clips[0].sourceId, 'first'); assert.equal(w.session.tracks[0].generated.pattern.voice, 'piano');
  assert.equal(w.sources.size, 2);
});
test('an update that would discard a trimmed part fails atomically and removes unused new audio', () => {
  const w = workspace(), pattern = instrumentPreset('chords');
  w.commitGeneratedSource({ id: 'first', name: 'Keys', buffer: { duration: 8 }, blob: audio(), bytes: 40 }, 'instrument', pattern, 0);
  w.change(s => { const clip = s.tracks[0].clips[0]; clip.offset = 5; clip.duration = 3; });
  const before = structuredClone(w.session);
  assert.throws(() => w.commitGeneratedSource({ id: 'short', buffer: { duration: 2 } }, 'instrument', pattern, 0, w.session.tracks[0].id), /shorter than a trimmed/);
  assert.deepEqual(w.session, before); assert.equal(w.sources.has('short'), false);
});
test('Music styling is restricted to its dialog and launchers use existing button classes', () => {
  const css = readFileSync(new URL('../studio/css/music.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const match of css.matchAll(/([^{}]+)\{/g)) {
    if (match[1].trim().startsWith('@media ')) continue;
    for (const selector of match[1].split(',')) assert.ok(selector.trim().startsWith('.music-dialog '), selector);
  }
  for (const page of ['index.html', 'voice.html']) {
    const html = readFileSync(new URL(`../studio/${page}`, import.meta.url), 'utf8');
    assert.match(html, /class="btn sm" type="button" data-open-music/);
    assert.match(html, /src="js\/music-launcher.js"/);
  }
});
