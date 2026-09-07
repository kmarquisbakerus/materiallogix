import { activeLicense } from './license.js';
import { musicTier } from './music-session.js';

export async function musicPlaybackPolicy(resolveLicense = activeLicense) {
  try { const tier = musicTier(await resolveLicense()); return { tier, watermarked: tier === 'preview' }; }
  catch { return { tier: 'preview', watermarked: true }; }
}

export async function loadMusicPreviewStamp(context, request = globalThis.fetch) {
  try {
    const response = await request(new URL('../assets/preview-stamp.wav', import.meta.url), { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('Preview mark unavailable');
    const buffer = await context.decodeAudioData(await response.arrayBuffer());
    if (!Number.isFinite(buffer.duration) || buffer.duration < 0.1 || buffer.duration > 6) throw new Error('Invalid preview mark');
    return buffer;
  } catch { throw new Error('The required audio preview mark could not load. Reconnect and try Play again. Your project is unchanged.'); }
}

// This discourages copying a preview. It does not prevent operating-system
// capture or modification of client code. Clean delivery requires server authorization.
export class MusicPreviewOutput {
  constructor(context, stamp = null) {
    this.context = context; this.input = context.createGain(); this.input.connect(context.destination);
    this.stamp = stamp; this.minimumSeconds = stamp?.duration || 0;
    if (stamp) {
      const length = Math.ceil(context.sampleRate * 8);
      this.loop = context.createBuffer(1, length, context.sampleRate);
      const data = this.loop.getChannelData(0);
      const channels = Array.from({ length: stamp.numberOfChannels }, (_, i) => stamp.getChannelData(i));
      for (let i = 0; i < Math.min(length, stamp.length); i++) data[i] = channels.reduce((sum, channel) => sum + channel[i], 0) / channels.length;
    }
  }
  start(when = this.context.currentTime) {
    this.stop();
    if (!this.loop) return;
    this.input.gain.value = 0.6;
    const source = this.context.createBufferSource(), level = this.context.createGain();
    source.buffer = this.loop; source.loop = true; level.gain.value = 0.7;
    source.connect(level).connect(this.context.destination); source.start(when);
    this.source = source; this.level = level;
  }
  stop() {
    if (this.source) { try { this.source.stop(); } catch { /* Already ended. */ } this.source.disconnect(); }
    this.level?.disconnect(); this.source = null; this.level = null; this.input.gain.value = 1;
  }
  dispose() { this.stop(); this.input.disconnect(); }
}
