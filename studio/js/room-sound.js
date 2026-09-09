/**
 * The room, and whether it comes with you.
 *
 * Two customers record the same script. One is in a treated corner and wants
 * the take to sound like the room they are in; the other is at a kitchen table
 * and wants it to sound like a booth. Until now neither had a say: capture ran
 * with echo cancellation and noise suppression switched off - correct for a
 * cloning reference, wrong for anyone in a live room - and every rendered take
 * had a room-tone bed and a breath added to it whether it wanted one or not.
 *
 * What this can and cannot do, stated plainly because the difference matters:
 *
 *   - On a RENDERED take the room is ours. `studio` adds no tone bed and no
 *     breath, so the file is as clean as the engine made it.
 *   - On a RECORDING the room is already in the signal. Echo cancellation
 *     removes what the speakers played back into the microphone and noise
 *     suppression removes steady noise; neither removes reverberation. A
 *     recording made in a live room stays a recording made in a live room, and
 *     for a voice reference it is worse than that: the reverberation is
 *     cloned along with the voice and every future take carries it.
 *
 * So `studio` mode does the two things it can do, and then measures the third
 * and says so, rather than claiming a booth it cannot deliver.
 */

export const ROOM_MODES = Object.freeze({
  keep: Object.freeze({
    id: 'keep',
    label: 'Keep the room',
    blurb: 'The space you recorded in stays in the take.',
    roomToneDb: -58,
    breathDb: -34
  }),
  studio: Object.freeze({
    id: 'studio',
    label: 'Studio clean',
    blurb: 'No added room, and a reference recorded in a live one is refused rather than cloned.',
    roomToneDb: null,
    breathDb: null
  })
});

export const roomMode = id => ROOM_MODES[id] || ROOM_MODES.keep;

/**
 * Microphone constraints for a mode.
 *
 * `keep` takes the signal untouched, which is what a cloning reference wants:
 * the processing below is built for conference calls and it moves formants.
 * `studio` accepts that trade to get rid of what it can.
 */
export function captureConstraints(modeId) {
  const studio = roomMode(modeId).id === 'studio';
  return {
    audio: {
      echoCancellation: studio,
      noiseSuppression: studio,
      // Automatic gain stays off in both. It rides the level during a take,
      // which is the one thing a reference must not have done to it, and the
      // mixer sets the delivered level from a measurement afterwards.
      autoGainControl: false
    }
  };
}

// Reverberation is read off the decays that speech leaves behind: every time a
// talker stops, the room keeps going, and how fast that falls away is the
// room. Framed at 10 ms so a 60 ms tail is still six points to fit a line to.
const FRAME_SECONDS = 0.02;
const HOP_SECONDS = 0.01;
const MIN_DROP_DB = 12;      // a decay shorter than this is not a decay
const MIN_FRAMES = 6;        // and neither is one over less than 60 ms
const FLOOR_MARGIN_DB = 8;   // stop before the tail reaches the noise floor
const PEAK_MARGIN_DB = 25;   // only start from something clearly above it

/**
 * Estimated reverberation time in seconds (the RT60 convention: how long the
 * room takes to fall 60 dB), the number of decays it was taken from, and the
 * noise floor it was measured against. `decaySeconds` is null when the signal
 * offers no usable decay - too short, too quiet, or wall-to-wall speech.
 */
export function measureReverb(samples, sampleRate) {
  const frame = Math.max(1, Math.round(FRAME_SECONDS * sampleRate));
  const hop = Math.max(1, Math.round(HOP_SECONDS * sampleRate));
  const levels = [];
  for (let start = 0; start + frame <= samples.length; start += hop) {
    let energy = 0;
    for (let i = start; i < start + frame; i++) energy += samples[i] * samples[i];
    levels.push(10 * Math.log10(energy / frame + 1e-12));
  }
  if (levels.length < MIN_FRAMES * 3) return { decaySeconds: null, decays: 0, noiseFloorDb: null };

  const sorted = [...levels].sort((a, b) => a - b);
  const noiseFloorDb = sorted[Math.floor(sorted.length * 0.1)];
  const estimates = [];

  for (let i = 1; i < levels.length - MIN_FRAMES; i++) {
    // Start only at a local maximum that is clearly programme, not floor.
    if (levels[i] < noiseFloorDb + PEAK_MARGIN_DB) continue;
    if (levels[i] < levels[i - 1] || levels[i] < levels[i + 1]) continue;
    const run = [levels[i]];
    for (let j = i + 1; j < levels.length; j++) {
      // A decay is monotonic; one frame of noise is allowed to sit 1 dB above
      // its predecessor before the run is called finished.
      if (levels[j] > run[run.length - 1] + 1) break;
      if (levels[j] < noiseFloorDb + FLOOR_MARGIN_DB) break;
      run.push(levels[j]);
    }
    const drop = run[0] - run[run.length - 1];
    if (run.length < MIN_FRAMES || drop < MIN_DROP_DB) continue;
    // Least squares over dB against seconds; the slope is the decay rate.
    const n = run.length;
    const meanT = ((n - 1) / 2) * HOP_SECONDS;
    const meanL = run.reduce((sum, value) => sum + value, 0) / n;
    let num = 0, den = 0;
    for (let k = 0; k < n; k++) {
      const t = k * HOP_SECONDS - meanT;
      num += t * (run[k] - meanL);
      den += t * t;
    }
    const slope = den > 0 ? num / den : 0;
    if (slope >= -1) continue;
    const rt60 = -60 / slope;
    if (rt60 >= 0.05 && rt60 <= 3) estimates.push(rt60);
    i += run.length - 1;
  }

  if (!estimates.length) return { decaySeconds: null, decays: 0, noiseFloorDb: +noiseFloorDb.toFixed(1) };
  estimates.sort((a, b) => a - b);
  const median = estimates.length % 2
    ? estimates[(estimates.length - 1) / 2]
    : (estimates[estimates.length / 2 - 1] + estimates[estimates.length / 2]) / 2;
  return { decaySeconds: +median.toFixed(3), decays: estimates.length, noiseFloorDb: +noiseFloorDb.toFixed(1) };
}

// A voice booth runs about 0.15-0.3 s. A furnished room is 0.4-0.6. A kitchen,
// a stairwell or a bathroom is 0.8 and up, and at that point the room is a
// second voice on the recording - one that a cloned profile then keeps.
export const REVERB_LIMITS = Object.freeze({ clean: 0.35, live: 0.8 });

export function reverbVerdict(decaySeconds, modeId = 'keep') {
  if (decaySeconds === null || decaySeconds === undefined) {
    return { status: 'unknown', label: 'No usable pause to measure the room from.' };
  }
  const seconds = decaySeconds.toFixed(2);
  if (decaySeconds <= REVERB_LIMITS.clean) {
    return { status: 'pass', label: `Room decay ${seconds} s — close to a booth.` };
  }
  if (decaySeconds <= REVERB_LIMITS.live) {
    return {
      status: 'advisory',
      label: `Room decay ${seconds} s — the room is audible and will be cloned with the voice.`
    };
  }
  return {
    status: roomMode(modeId).id === 'studio' ? 'blocked' : 'advisory',
    label: `Room decay ${seconds} s — this room is a second voice on the recording. `
      + 'Nothing downstream can take it out; record somewhere softer, or closer to the microphone.'
  };
}
