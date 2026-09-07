/**
 * The mixer: one finished file, three places it can be going.
 *
 * A podcast, a voice-over and a video are not the same delivery. Each platform
 * normalises to its own loudness and rejects or reduces anything over its
 * true-peak ceiling, so a file mixed for one arrives wrong at the other two -
 * quiet on a podcast feed, or turned down on a video platform after the fact.
 * The customer picks where it is going and the numbers follow from that.
 *
 * Nothing here is a taste decision. Each target is a published delivery spec,
 * measured with `loudness.js` (ITU-R BS.1770-4) and recorded on the file, so a
 * delivery record can state the level it actually shipped at rather than the
 * level it was aiming for.
 */
import { measureLoudness, truePeakDb } from './loudness.js';

export const DELIVERY_TARGETS = Object.freeze({
  podcast: Object.freeze({
    id: 'podcast',
    label: 'Podcast',
    lufs: -16,
    truePeakDb: -1,
    tolerance: 1,
    // Apple Podcasts and the speech-led streaming recommendation both sit at
    // -16 LUFS for stereo. A mono episode is delivered at -19 because a mono
    // file played through two speakers gains about 3 dB.
    monoLufs: -19,
    why: 'Podcast apps normalise speech programme to about -16 LUFS.'
  }),
  voice: Object.freeze({
    id: 'voice',
    label: 'Voice-over',
    lufs: -23,
    truePeakDb: -1,
    tolerance: 0.5,
    // EBU R 128. US broadcast delivery is -24 LKFS under ATSC A/85; the
    // difference is one decibel and the ceiling is the same.
    why: 'Broadcast voice-over is delivered at -23 LUFS (EBU R 128).'
  }),
  video: Object.freeze({
    id: 'video',
    label: 'Video',
    lufs: -14,
    truePeakDb: -1,
    tolerance: 1,
    why: 'Video platforms normalise to about -14 LUFS; a louder master is turned down.'
  })
});

export const DELIVERY_TARGET_IDS = Object.freeze(Object.keys(DELIVERY_TARGETS));

/** The loudness this target wants for this channel count. */
export function targetLufs(target, channelCount) {
  return channelCount === 1 && typeof target.monoLufs === 'number' ? target.monoLufs : target.lufs;
}

const applyGain = (channels, gainDb) => {
  const gain = Math.pow(10, gainDb / 20);
  return channels.map(channel => {
    const out = new Float32Array(channel.length);
    for (let i = 0; i < channel.length; i++) out[i] = channel[i] * gain;
    return out;
  });
};

/**
 * Mix one rendered take for one destination.
 *
 * The gain is whatever moves the measured programme loudness onto the target.
 * If that would put the true peak over the ceiling the gain is reduced until
 * it does not, and the shortfall is reported rather than papered over: pulling
 * a peak down with a limiter changes how the take sounds, and this is not the
 * place to make that decision silently. `metRequestedLoudness` is false in
 * exactly that case, and `heldDownByPeakDb` says by how much.
 */
export function mixForDelivery(channels, sampleRate, targetId) {
  const target = DELIVERY_TARGETS[targetId];
  if (!target) throw new Error(`unknown delivery target: ${targetId}`);
  const wanted = targetLufs(target, channels.length);
  const measured = measureLoudness(channels, sampleRate);
  if (!Number.isFinite(measured.lufs)) {
    return {
      target: target.id, channels, gainDb: 0, requestedLufs: wanted,
      measuredLufs: null, deliveredLufs: null, deliveredTruePeakDb: null,
      metRequestedLoudness: false, heldDownByPeakDb: 0, silent: true
    };
  }

  const wantedGainDb = wanted - measured.lufs;
  const peakBefore = truePeakDb(channels);
  const headroomDb = target.truePeakDb - peakBefore;
  const gainDb = Math.min(wantedGainDb, headroomDb);
  const mixed = applyGain(channels, gainDb);
  const delivered = measureLoudness(mixed, sampleRate);
  return {
    target: target.id,
    channels: mixed,
    gainDb: +gainDb.toFixed(2),
    requestedLufs: wanted,
    measuredLufs: +measured.lufs.toFixed(2),
    deliveredLufs: +delivered.lufs.toFixed(2),
    deliveredTruePeakDb: +truePeakDb(mixed).toFixed(2),
    metRequestedLoudness: gainDb >= wantedGainDb - 1e-9,
    heldDownByPeakDb: +Math.max(0, wantedGainDb - gainDb).toFixed(2),
    silent: false
  };
}

/** One line for the delivery record, stating what shipped rather than what was asked for. */
export function deliveryNote(mix) {
  const target = DELIVERY_TARGETS[mix.target];
  if (mix.silent) return `${target.label}: nothing to measure — the take is silent.`;
  const head = `${target.label}: ${mix.deliveredLufs} LUFS, true peak ${mix.deliveredTruePeakDb} dBTP`;
  return mix.metRequestedLoudness
    ? `${head} (target ${mix.requestedLufs} LUFS).`
    : `${head} — ${mix.heldDownByPeakDb} dB under the ${mix.requestedLufs} LUFS target, held there by the ${target.truePeakDb} dBTP ceiling.`;
}
