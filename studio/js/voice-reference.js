const SUPPORTED_EXTENSIONS = new Set(['wav', 'mp3', 'm4a', 'aac', 'ogg', 'oga', 'webm', 'flac']);

export function supportedVoiceReference({ name = '', type = '' } = {}) {
  const extension = String(name).toLowerCase().split('.').pop();
  return String(type).startsWith('audio/') && SUPPORTED_EXTENSIONS.has(extension);
}

export function assessVoiceReference(buffer, { minimumSeconds = 10, recommendedSeconds = 20 } = {}) {
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
  return {
    status: reasons.length ? 'blocked' : 'pass', reasons,
    advisories: buffer.duration < recommendedSeconds ? ['longer_sample_recommended'] : [],
    metrics: {
      durationSeconds: +buffer.duration.toFixed(2), activeFraction: +activeFraction.toFixed(3),
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
