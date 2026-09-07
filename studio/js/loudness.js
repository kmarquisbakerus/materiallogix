/**
 * Loudness, measured the way the platforms measure it.
 *
 * Every delivery target a customer picks - a podcast, a voice-over, a video -
 * is a number in LUFS and a ceiling in dBTP, and the platform will renormalise
 * anything that misses. Guessing at it with peak level does not work: two files
 * that peak at the same sample can differ by ten decibels of loudness, and the
 * one that arrives quiet stays quiet.
 *
 * This is ITU-R BS.1770-4: K-weight, block, gate, average. The filters are
 * built from the analog prototype rather than copied from the 48 kHz table in
 * the standard, so a 44.1 or 96 kHz file is weighted correctly instead of
 * being weighted as if it were 48 - and the test asserts that at 48 kHz the
 * derivation reproduces the standard's own published coefficients.
 */

// The two stages of the K weighting curve, as their analog prototypes.
// (Constants from the standard's filter design; the 48 kHz coefficient table
// in BS.1770-4 Table 1 is what these produce at fs = 48000.)
const SHELF = { f0: 1681.974450955533, gainDb: 3.999843853973347, q: 0.7071752369554196 };
const HIGHPASS = { f0: 38.13547087602444, q: 0.5003270373238773 };

/** High-shelf stage: the head-related boost above about 1.7 kHz. */
export function shelfCoefficients(sampleRate) {
  const k = Math.tan(Math.PI * SHELF.f0 / sampleRate);
  const vh = Math.pow(10, SHELF.gainDb / 20);
  const vb = Math.pow(vh, 0.4996667741545416);
  const a0 = 1 + k / SHELF.q + k * k;
  return {
    b: [
      (vh + vb * k / SHELF.q + k * k) / a0,
      2 * (k * k - vh) / a0,
      (vh - vb * k / SHELF.q + k * k) / a0
    ],
    a: [1, 2 * (k * k - 1) / a0, (1 - k / SHELF.q + k * k) / a0]
  };
}

/** Second stage: the RLB high-pass that discounts what a listener cannot hear. */
export function highpassCoefficients(sampleRate) {
  const k = Math.tan(Math.PI * HIGHPASS.f0 / sampleRate);
  const a0 = 1 + k / HIGHPASS.q + k * k;
  return {
    b: [1, -2, 1],
    a: [1, 2 * (k * k - 1) / a0, (1 - k / HIGHPASS.q + k * k) / a0]
  };
}

function biquad(samples, { b, a }) {
  const out = new Float64Array(samples.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const x0 = samples[i];
    const y0 = b[0] * x0 + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
    out[i] = y0;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
  }
  return out;
}

/** The K-weighted signal, which is what every level below is measured on. */
export function kWeight(samples, sampleRate) {
  return biquad(biquad(samples, shelfCoefficients(sampleRate)), highpassCoefficients(sampleRate));
}

/** The response of the weighting curve at one frequency, as a linear gain. */
export function weightingGainAt(frequency, sampleRate) {
  const w = 2 * Math.PI * frequency / sampleRate;
  const response = ({ b, a }) => {
    const real = b[0] + b[1] * Math.cos(w) + b[2] * Math.cos(2 * w);
    const imag = -(b[1] * Math.sin(w) + b[2] * Math.sin(2 * w));
    const dreal = a[0] + a[1] * Math.cos(w) + a[2] * Math.cos(2 * w);
    const dimag = -(a[1] * Math.sin(w) + a[2] * Math.sin(2 * w));
    return Math.sqrt((real * real + imag * imag) / (dreal * dreal + dimag * dimag));
  };
  return response(shelfCoefficients(sampleRate)) * response(highpassCoefficients(sampleRate));
}

// Channel weights from BS.1770-4 Table 3. Left, right and centre count once;
// the two surrounds count for about 1.5 dB more each. Nothing here renders
// surround yet, so the list exists to keep the formula honest rather than to
// be exercised.
const CHANNEL_WEIGHTS = [1.0, 1.0, 1.0, 1.41, 1.41];

const BLOCK_SECONDS = 0.4;      // gating block length
const BLOCK_OVERLAP = 0.75;     // blocks step by a quarter of their length
const ABSOLUTE_GATE_LUFS = -70; // silence is not part of the programme
const RELATIVE_GATE_LU = -10;   // nor is anything ten units under the rest of it

const levelOf = energies =>
  -0.691 + 10 * Math.log10(energies.reduce((sum, value, index) =>
    sum + (CHANNEL_WEIGHTS[index] ?? 1.0) * value, 0));

/**
 * Integrated loudness in LUFS, and the block energies it was computed from.
 * `channels` is an array of Float32Array/Float64Array, one per channel.
 */
export function measureLoudness(channels, sampleRate) {
  if (!channels.length || !channels[0].length) return { lufs: -Infinity, blocks: 0, gatedBlocks: 0 };
  const weighted = channels.map(channel => kWeight(channel, sampleRate));
  const blockLength = Math.round(BLOCK_SECONDS * sampleRate);
  const step = Math.round(blockLength * (1 - BLOCK_OVERLAP));
  const length = weighted[0].length;
  if (length < blockLength) return { lufs: -Infinity, blocks: 0, gatedBlocks: 0 };

  const blocks = [];
  for (let start = 0; start + blockLength <= length; start += step) {
    blocks.push(weighted.map(channel => {
      let energy = 0;
      for (let i = start; i < start + blockLength; i++) energy += channel[i] * channel[i];
      return energy / blockLength;
    }));
  }

  const loud = blocks.filter(energies => levelOf(energies) > ABSOLUTE_GATE_LUFS);
  if (!loud.length) return { lufs: -Infinity, blocks: blocks.length, gatedBlocks: 0 };

  // The relative gate is taken against the mean of what survived the absolute
  // one, so a passage of quiet does not drag the programme level down with it.
  const mean = index => loud.reduce((sum, energies) => sum + energies[index], 0) / loud.length;
  const threshold = levelOf(channels.map((_, index) => mean(index))) + RELATIVE_GATE_LU;
  const kept = loud.filter(energies => levelOf(energies) > threshold);
  if (!kept.length) return { lufs: -Infinity, blocks: blocks.length, gatedBlocks: 0 };
  const keptMean = index => kept.reduce((sum, energies) => sum + energies[index], 0) / kept.length;
  return {
    lufs: levelOf(channels.map((_, index) => keptMean(index))),
    blocks: blocks.length,
    gatedBlocks: kept.length
  };
}

/**
 * True peak in dBTP. A file can sit at 0 dBFS on every sample and still clip a
 * converter between them, which is why every delivery ceiling in this file is
 * a true-peak ceiling. Four-times oversampling is the minimum BS.1770-4 asks
 * for; the interpolation is a windowed sinc over the neighbouring samples.
 */
export function truePeakDb(channels, oversample = 4) {
  const taps = 16;
  let peak = 0;
  for (const channel of channels) {
    for (let i = 0; i < channel.length; i++) {
      peak = Math.max(peak, Math.abs(channel[i]));
      for (let phase = 1; phase < oversample; phase++) {
        const offset = phase / oversample;
        let sum = 0;
        for (let tap = -taps; tap <= taps; tap++) {
          const index = i + tap;
          if (index < 0 || index >= channel.length) continue;
          const x = Math.PI * (offset - tap);
          const sinc = Math.abs(x) < 1e-9 ? 1 : Math.sin(x) / x;
          // Hann window over the tap range keeps the ringing of a bare sinc
          // out of the estimate.
          const window = 0.5 * (1 + Math.cos(Math.PI * (offset - tap) / (taps + 1)));
          sum += channel[index] * sinc * window;
        }
        peak = Math.max(peak, Math.abs(sum));
      }
    }
  }
  return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
}
