import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MUSIC_SOURCE_CAPABILITIES, supportedLocalAudio, sourceAvailability, assertDeckSource
} from '../studio/js/music-library.js';

test('customer-owned audio formats can enter the production and DJ workspaces', () => {
  for (const name of ['take.wav', 'beat.flac', 'song.mp3', 'set.aiff', 'loop.ogg']) {
    assert.equal(supportedLocalAudio({ name, type: '' }), true, name);
  }
  assert.equal(supportedLocalAudio({ name: 'playlist.json', type: 'application/json' }), false);
});

test('a file extension cannot disguise a declared non-audio payload', () => {
  assert.equal(supportedLocalAudio({ name: 'not-a-song.mp3', type: 'text/html' }), false);
  assert.equal(supportedLocalAudio({ name: 'take', type: 'audio/wav' }), true);
});

test('the current source catalog contains only the enabled local source', () => {
  assert.deepEqual(Object.keys(MUSIC_SOURCE_CAPABILITIES), ['local']);
});

test('a caller approval flag cannot enable an unavailable streaming adapter', () => {
  for (const id of ['spotify', 'apple_music', 'amazon_music', 'tidal_dj', 'beatport_streaming', 'soundcloud_dj']) {
    assert.equal(sourceAvailability(id, { [id]: true }).available, false);
    assert.throws(() => assertDeckSource(id, { [id]: true }), /unavailable/);
  }
});

test('a local file is a deck source without a subscription connection', () => {
  assert.deepEqual(sourceAvailability('local'), { available: true, reason: '' });
  assert.equal(assertDeckSource('local').id, 'local');
});

test('unknown, inherited, malformed, and remote source identifiers are rejected', () => {
  for (const id of [undefined, null, {}, ['local'], '', 'constructor', '__proto__', 'toString', 'https://example.com/song.mp3']) {
    assert.equal(sourceAvailability(id).available, false);
    assert.throws(() => assertDeckSource(id), /supported audio file/);
  }
});
