const SUPPORTED_EXTENSIONS = new Set(['wav', 'mp3', 'm4a', 'aac', 'ogg', 'oga', 'webm', 'flac']);

export function supportedVoiceReference({ name = '', type = '' } = {}) {
  const extension = String(name).toLowerCase().split('.').pop();
  return String(type).startsWith('audio/') && SUPPORTED_EXTENSIONS.has(extension);
}

// How much audio a plan may submit, and what is done with it. A real
// fine-tune needs thirty minutes; below that the reference is prompted, not
// trained, so Starter is honestly zero-shot.
const FINE_TUNE_MINIMUM_SECONDS = 30 * 60;

const VOICE_PLANS = Object.freeze({
  // No licence, an unrecognised one, or a suspended one. Below the cheapest
  // paid tier on purpose: falling back to Voice Starter's limits handed a free
  // preview exactly what a paying customer bought.
  preview: {
    method: 'prompt',
    minimumSeconds: 10,
    recommendedSeconds: 60,
    maximumSeconds: 60
  },
  voice_starter: {
    method: 'prompt',
    minimumSeconds: 10,
    recommendedSeconds: 120,
    maximumSeconds: 300
  },
  single: {
    method: 'train',
    minimumSeconds: 10,
    recommendedSeconds: FINE_TUNE_MINIMUM_SECONDS,
    maximumSeconds: 3600
  },
  // The Pro tiers were added to the price list and never added here, so they
  // fell through to the fallback and a $39 Pro Studio customer could not train
  // a voice at all while a $15 Single Studio customer could. A tier must never
  // be worse than the one beneath it.
  single_pro: {
    method: 'train',
    minimumSeconds: 10,
    recommendedSeconds: 2 * 3600,
    maximumSeconds: 2 * 3600
  },
  full: {
    method: 'train',
    minimumSeconds: 10,
    recommendedSeconds: 2 * 3600,
    maximumSeconds: 2 * 3600
  },
  pro: {
    method: 'train',
    minimumSeconds: 10,
    recommendedSeconds: 2 * 3600,
    maximumSeconds: 2 * 3600
  }
});

/** Every plan the price list sells, so a new tier cannot fall through unseen. */
export const VOICE_LADDER_PLANS = Object.freeze(Object.keys(VOICE_PLANS));

export function voiceSampleLimits(plan) {
  const id = String(plan ?? '');
  if (id.startsWith('suspended:')) return VOICE_PLANS.preview;
  // The fallback is the least a licence can buy, never the cheapest paid tier.
  return VOICE_PLANS[id] || VOICE_PLANS.preview;
}

/**
 * Prompting or training, for this plan and this much audio. A train-capable
 * plan still prompts until enough audio exists to train on.
 */
export function voiceMethod(plan, seconds) {
  const limits = voiceSampleLimits(plan);
  if (limits.method !== 'train') return 'prompt';
  const usable = Math.min(Number(seconds) || 0, limits.maximumSeconds);
  return usable >= FINE_TUNE_MINIMUM_SECONDS ? 'train' : 'prompt';
}

export { FINE_TUNE_MINIMUM_SECONDS };

export function assessVoiceReference(buffer, options = {}) {
  const limits = voiceSampleLimits(options.plan);
  const minimumSeconds = options.minimumSeconds ?? limits.minimumSeconds;
  const recommendedSeconds = options.recommendedSeconds ?? limits.recommendedSeconds;
  const maximumSeconds = options.maximumSeconds ?? limits.maximumSeconds;
  if (!buffer || !Number.isFinite(buffer.duration) || buffer.duration < minimumSeconds) {
    return { status: 'blocked', reasons: ['reference_too_short'], advisories: [] };
  }
  const channel = buffer.getChannelData(0);
  const windowSize = Math.max(1, Math.round(buffer.sampleRate * 0.02));
  const windows = [];
  let clipped = 0;
  for (let offset = 0; offset < channel.length; offset += windowSize) {
    let energy = 0;
    const end = Math.min(channel.length, offset + windowSize);
    for (let index = offset; index < end; index++) {
      const sample = channel[index];
      energy += sample * sample;
      if (Math.abs(sample) >= 0.995) clipped++;
    }
    windows.push(Math.sqrt(energy / Math.max(1, end - offset)));
  }
  const sorted = [...windows].sort((a, b) => a - b);
  const active = windows.filter(value => value >= 0.012);
  const activeFraction = active.length / Math.max(1, windows.length);
  const clippedFraction = clipped / Math.max(1, channel.length);
  const noiseFloor = sorted[Math.floor(sorted.length * 0.2)] || 0;
  const activeMedian = [...active].sort((a, b) => a - b)[Math.floor(active.length / 2)] || 0;
  const separationDb = 20 * Math.log10((activeMedian + 1e-8) / (noiseFloor + 1e-8));
  const reasons = [];
  if (activeFraction < 0.35) reasons.push('reference_mostly_silent');
  if (clippedFraction > 0.005) reasons.push('reference_clipped');
  if (activeMedian < 0.018 || separationDb < 10) reasons.push('reference_noisy_or_unclear');
  // Over the plan limit is trimmed, never rejected.
  const usableSeconds = Math.min(buffer.duration, maximumSeconds);
  const advisories = [];
  if (usableSeconds < recommendedSeconds) advisories.push('longer_sample_recommended');
  if (buffer.duration > maximumSeconds) advisories.push('sample_capped_at_plan_limit');
  return {
    status: reasons.length ? 'blocked' : 'pass', reasons, advisories,
    limits: { minimumSeconds, recommendedSeconds, maximumSeconds },
    metrics: {
      durationSeconds: +buffer.duration.toFixed(2), usableSeconds: +usableSeconds.toFixed(2),
      activeFraction: +activeFraction.toFixed(3),
      clippedPercent: +(clippedFraction * 100).toFixed(3), separationDb: +separationDb.toFixed(1)
    }
  };
}

export function audioBufferToWav(buffer) {
  const length = buffer.length;
  const bytes = new ArrayBuffer(44 + length * 2);
  const view = new DataView(bytes);
  const write = (offset, value) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  write(0, 'RIFF'); view.setUint32(4, 36 + length * 2, true); write(8, 'WAVEfmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, 'data');
  view.setUint32(40, length * 2, true);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, data[i])) * 32767, true);
  return new Blob([bytes], { type: 'audio/wav' });
}
