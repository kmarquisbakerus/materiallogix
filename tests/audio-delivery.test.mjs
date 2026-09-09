import test from 'node:test';
import assert from 'node:assert/strict';
import {
  shelfCoefficients, highpassCoefficients, weightingGainAt, measureLoudness, truePeakDb
} from '../studio/js/loudness.js';
import {
  DELIVERY_TARGETS, DELIVERY_TARGET_IDS, targetLufs, mixForDelivery, deliveryNote
} from '../studio/js/mixer.js';
import {
  ROOM_MODES, captureConstraints, measureReverb, reverbVerdict, REVERB_LIMITS
} from '../studio/js/room-sound.js';

const sine = (seconds, frequency, amplitude, sampleRate) => {
  const out = new Float32Array(Math.round(seconds * sampleRate));
  for (let i = 0; i < out.length; i++) out[i] = amplitude * Math.sin(2 * Math.PI * frequency * i / sampleRate);
  return out;
};

// A repeatable pseudo-random source: a test that depends on Math.random is a
// test that fails on someone else's machine and nobody can reproduce.
const noiseSource = (seed = 1) => {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return (state / 0x100000000) * 2 - 1;
  };
};

// ── the weighting curve ─────────────────────────────────────────────────────

test('the K-weighting filters reproduce the coefficients published in BS.1770-4', () => {
  // Table 1 of the standard, which is stated for 48 kHz only. Deriving them
  // from the analog prototype is what lets a 44.1 kHz take be weighted
  // correctly instead of being weighted as if it were 48; this asserts the
  // derivation lands on the standard's own numbers where the standard speaks.
  const shelf = shelfCoefficients(48000);
  const highpass = highpassCoefficients(48000);
  const close = (actual, expected, what) =>
    assert.ok(Math.abs(actual - expected) < 1e-10, `${what}: ${actual} is not ${expected}`);
  close(shelf.b[0], 1.53512485958697, 'shelf b0');
  close(shelf.b[1], -2.69169618940638, 'shelf b1');
  close(shelf.b[2], 1.19839281085285, 'shelf b2');
  close(shelf.a[1], -1.69065929318241, 'shelf a1');
  close(shelf.a[2], 0.73248077421585, 'shelf a2');
  close(highpass.a[1], -1.99004745483398, 'high-pass a1');
  close(highpass.a[2], 0.99007225036621, 'high-pass a2');
});

test('a steady tone measures the level the standard says it should', () => {
  // L = -0.691 + 10 log10( |H(f)|^2 * a^2 / 2 ) for one channel carrying a
  // sine of amplitude a. Everything after the filter - blocking, gating,
  // summing - is what this checks, against a number derived rather than
  // remembered.
  const sampleRate = 48000;
  const amplitude = 0.5;
  const gain = weightingGainAt(1000, sampleRate);
  const expected = -0.691 + 10 * Math.log10(gain * gain * amplitude * amplitude / 2);
  const { lufs } = measureLoudness([sine(3, 1000, amplitude, sampleRate)], sampleRate);
  assert.ok(Math.abs(lufs - expected) < 0.1, `${lufs.toFixed(2)} LUFS is not the predicted ${expected.toFixed(2)}`);
});

test('doubling the signal raises the measurement by six decibels', () => {
  const sampleRate = 48000;
  const quiet = measureLoudness([sine(3, 1000, 0.2, sampleRate)], sampleRate).lufs;
  const loud = measureLoudness([sine(3, 1000, 0.4, sampleRate)], sampleRate).lufs;
  assert.ok(Math.abs((loud - quiet) - 6.0206) < 0.01, `${(loud - quiet).toFixed(3)} LU is not 6.02`);
});

test('silence is gated out, so a pause does not make the programme quieter', () => {
  // This is the whole point of the relative gate. Without it, a take with a
  // long lead-in measures quiet, gets a large make-up gain, and arrives loud.
  const sampleRate = 48000;
  const tone = sine(3, 1000, 0.5, sampleRate);
  const padded = new Float32Array(tone.length + sampleRate * 6);
  padded.set(tone, sampleRate * 3);
  const bare = measureLoudness([tone], sampleRate);
  const withSilence = measureLoudness([padded], sampleRate);
  const drift = Math.abs(bare.lufs - withSilence.lufs);
  // A plain average over the whole file would lose this much, because only a
  // third of it is programme.
  const ungatedDrop = Math.abs(10 * Math.log10(tone.length / padded.length));
  assert.ok(drift < ungatedDrop / 4,
    `the gate recovered only ${(ungatedDrop - drift).toFixed(2)} dB of the ${ungatedDrop.toFixed(2)} dB a plain average loses`);
  // What is left is the four blocks at each edge that straddle the boundary:
  // half tone, half silence, still inside the relative gate, and counted - a
  // compliant meter counts them too, so this is the residual to expect rather
  // than an error to chase to zero.
  assert.ok(drift < 0.5, `${withSilence.lufs.toFixed(2)} against ${bare.lufs.toFixed(2)} is more than the edge blocks explain`);
  assert.ok(withSilence.gatedBlocks < withSilence.blocks, 'no blocks were gated at all');
});

test('true peak sees what sits between two samples', () => {
  // A sine at a quarter of the sample rate, offset so no sample lands on the
  // crest: every sample is below full scale and the waveform is not.
  const sampleRate = 48000;
  const out = new Float32Array(4096);
  for (let i = 0; i < out.length; i++) out[i] = 0.99 * Math.sin(2 * Math.PI * (sampleRate / 4) * i / sampleRate + Math.PI / 4);
  let samplePeak = 0;
  for (const value of out) samplePeak = Math.max(samplePeak, Math.abs(value));
  const sampleDb = 20 * Math.log10(samplePeak);
  const trueDb = truePeakDb([out]);
  assert.ok(trueDb > sampleDb + 0.5,
    `true peak ${trueDb.toFixed(2)} dBTP did not exceed the sample peak ${sampleDb.toFixed(2)} dBFS`);
});

// ── the three deliveries ────────────────────────────────────────────────────

test('every delivery target is a published number, not a preference', () => {
  assert.deepEqual(DELIVERY_TARGET_IDS, ['podcast', 'voice', 'video']);
  for (const id of DELIVERY_TARGET_IDS) {
    const target = DELIVERY_TARGETS[id];
    assert.ok(target.lufs < 0 && target.lufs > -30, `${id} loudness is not a plausible LUFS target`);
    assert.ok(target.truePeakDb <= -1, `${id} lets a file reach the converter ceiling`);
    assert.ok(target.why.length > 20, `${id} does not say where its number comes from`);
  }
  assert.equal(DELIVERY_TARGETS.podcast.lufs, -16);
  assert.equal(DELIVERY_TARGETS.voice.lufs, -23);
  assert.equal(DELIVERY_TARGETS.video.lufs, -14);
});

test('a mix lands on the loudness its destination asks for', () => {
  const sampleRate = 48000;
  for (const id of DELIVERY_TARGET_IDS) {
    // Quiet enough that the ceiling never binds, so this measures the gain
    // decision on its own.
    const mix = mixForDelivery([sine(3, 1000, 0.05, sampleRate)], sampleRate, id);
    assert.ok(mix.metRequestedLoudness, `${id} could not reach its target`);
    assert.ok(Math.abs(mix.deliveredLufs - mix.requestedLufs) < 0.1,
      `${id} delivered ${mix.deliveredLufs} LUFS against a target of ${mix.requestedLufs}`);
    assert.ok(mix.deliveredTruePeakDb <= DELIVERY_TARGETS[id].truePeakDb + 0.05,
      `${id} delivered ${mix.deliveredTruePeakDb} dBTP over its ceiling`);
  }
});

test('a mono podcast is delivered three decibels lower than a stereo one', () => {
  // A mono file played through two speakers gains about 3 dB, so delivering it
  // at the stereo number lands it loud on the feed.
  assert.equal(targetLufs(DELIVERY_TARGETS.podcast, 2), -16);
  assert.equal(targetLufs(DELIVERY_TARGETS.podcast, 1), -19);
  assert.equal(targetLufs(DELIVERY_TARGETS.voice, 1), -23, 'voice-over has one number for any channel count');
});

test('the ceiling wins, and the file says by how much', () => {
  // A signal already at full scale cannot be lifted to -14 LUFS without going
  // through the true-peak ceiling. It is held down and reported, rather than
  // limited into a different-sounding file behind the customer's back.
  const sampleRate = 48000;
  const random = noiseSource(7);
  const spiky = new Float32Array(sampleRate * 2);
  for (let i = 0; i < spiky.length; i++) spiky[i] = random() * 0.02;
  for (let i = 0; i < spiky.length; i += 977) spiky[i] = i % 1954 ? 0.999 : -0.999;
  const mix = mixForDelivery([spiky], sampleRate, 'video');
  assert.equal(mix.metRequestedLoudness, false, 'this signal cannot reach -14 LUFS under a -1 dBTP ceiling');
  assert.ok(mix.heldDownByPeakDb > 0, 'the shortfall was not reported');
  assert.ok(mix.deliveredTruePeakDb <= DELIVERY_TARGETS.video.truePeakDb + 0.05,
    `delivered ${mix.deliveredTruePeakDb} dBTP over the ceiling`);
  assert.match(deliveryNote(mix), /held there by the -1 dBTP ceiling/);
});

test('a silent take is reported as silent rather than given infinite gain', () => {
  const mix = mixForDelivery([new Float32Array(48000)], 48000, 'podcast');
  assert.equal(mix.silent, true);
  assert.equal(mix.gainDb, 0);
  assert.match(deliveryNote(mix), /silent/);
});

test('an unknown destination is refused', () => {
  assert.throws(() => mixForDelivery([new Float32Array(4800)], 48000, 'tiktok'), /unknown delivery target/);
});

// ── the room ────────────────────────────────────────────────────────────────

test('the room toggle reaches the microphone', () => {
  const keep = captureConstraints('keep').audio;
  const studio = captureConstraints('studio').audio;
  assert.equal(keep.echoCancellation, false, 'keeping the room must not run echo cancellation');
  assert.equal(keep.noiseSuppression, false);
  assert.equal(studio.echoCancellation, true, 'studio clean must ask the browser to cancel what it can');
  assert.equal(studio.noiseSuppression, true);
  // Automatic gain rides the level during a take. It is the one thing a
  // reference must not have done to it, and the mixer sets the delivered level
  // from a measurement afterwards, so it stays off in both modes.
  assert.equal(keep.autoGainControl, false);
  assert.equal(studio.autoGainControl, false);
  assert.equal(captureConstraints('nonsense').audio.echoCancellation, false, 'an unknown mode keeps the room');
});

test('the room is measured from what it does to a decay', () => {
  // Speech-like bursts through a room of known reverberation time: an
  // exponentially decaying noise impulse response, 60 dB down at exactly RT60.
  // The estimator never sees that number; it reads it back off the tails.
  const sampleRate = 8000;
  const impulseResponse = (rt60, seed) => {
    const random = noiseSource(seed);
    const length = Math.round(rt60 * sampleRate);
    const ir = new Float64Array(length);
    for (let i = 0; i < length; i++) ir[i] = random() * Math.pow(10, -3 * (i / sampleRate) / rt60);
    ir[0] = 1;
    return ir;
  };
  const bursts = (seconds, seed) => {
    const random = noiseSource(seed);
    const out = new Float64Array(Math.round(seconds * sampleRate));
    for (let start = 0; start + sampleRate * 0.5 < out.length; start += Math.round(sampleRate * 0.5)) {
      for (let i = 0; i < Math.round(sampleRate * 0.12); i++) out[start + i] = random() * 0.5;
    }
    return out;
  };
  const through = (dry, ir, floorSeed) => {
    const wet = new Float32Array(dry.length);
    for (let i = 0; i < dry.length; i++) {
      if (!dry[i]) continue;
      const limit = Math.min(ir.length, dry.length - i);
      for (let k = 0; k < limit; k++) wet[i + k] += dry[i] * ir[k];
    }
    const random = noiseSource(floorSeed);
    for (let i = 0; i < wet.length; i++) wet[i] += random() * 1e-4;
    return wet;
  };

  for (const rt60 of [0.25, 0.9]) {
    const wet = through(bursts(3, 11), impulseResponse(rt60, 23), 31);
    const measured = measureReverb(wet, sampleRate);
    assert.ok(measured.decays >= 3, `only ${measured.decays} decays found at RT60 ${rt60}`);
    const error = Math.abs(measured.decaySeconds - rt60) / rt60;
    assert.ok(error < 0.35,
      `RT60 ${rt60} s read back as ${measured.decaySeconds} s (${(error * 100).toFixed(0)}% out)`);
  }

  // And a dry signal is not reported as a room.
  const dry = measureReverb(bursts(3, 11), sampleRate);
  assert.ok(dry.decaySeconds === null || dry.decaySeconds < REVERB_LIMITS.clean,
    `an unreverberated signal was read as a ${dry.decaySeconds} s room`);
});

test('the verdict says what the customer can do about it', () => {
  assert.equal(reverbVerdict(0.2).status, 'pass');
  assert.equal(reverbVerdict(0.5).status, 'advisory');
  assert.equal(reverbVerdict(null).status, 'unknown');
  // A room this live cannot be taken out of a reference afterwards, so asking
  // for studio clean is the one place it stops the recording rather than
  // warning about it.
  assert.equal(reverbVerdict(1.4, 'keep').status, 'advisory');
  assert.equal(reverbVerdict(1.4, 'studio').status, 'blocked');
  assert.match(reverbVerdict(1.4, 'studio').label, /record somewhere softer/);
});

test('studio clean adds no room to a rendered take', () => {
  assert.equal(ROOM_MODES.keep.roomToneDb, -58, 'keeping the room still lays a tone bed');
  assert.equal(ROOM_MODES.studio.roomToneDb, null, 'studio clean must add no tone bed');
  assert.equal(ROOM_MODES.studio.breathDb, null, 'studio clean must add no breath');
});
