// Capture microphone PCM on the same audio clock as arrangement playback.
// The output stays silent: monitoring must not feed speakers into a microphone.
class MusicCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.startFrame = Infinity; this.endFrame = Infinity; this.done = false;
    this.chunk = new Float32Array(4096); this.used = 0; this.frames = 0;
    this.port.onmessage = ({ data }) => {
      if (data.type === 'start') {
        if (!Number.isSafeInteger(data.frame) || data.frame < currentFrame ||
            !Number.isSafeInteger(data.maxFrames) || data.maxFrames <= 0 || this.startFrame !== Infinity) {
          this.finish('Recording could not start on time. Please try again.'); return;
        }
        this.startFrame = data.frame; this.endFrame = data.frame + data.maxFrames;
      }
      if (data.type === 'stop') this.finish();
    };
  }
  flush() {
    if (!this.used) return;
    const samples = this.chunk.slice(0, this.used);
    this.port.postMessage({ type: 'samples', samples }, [samples.buffer]); this.used = 0;
  }
  finish(error = null) {
    if (this.done) return;
    this.done = true; this.flush(); this.port.postMessage({ type: 'finished', frames: this.frames, error });
  }
  process(inputs, outputs) {
    for (const output of outputs) for (const channel of output) channel.fill(0);
    if (this.done) return false;
    const length = outputs[0]?.[0]?.length || inputs[0]?.[0]?.length || 0;
    const from = Math.max(0, this.startFrame - currentFrame);
    const to = Math.min(length, this.endFrame - currentFrame);
    if (to > from) {
      const channels = inputs[0];
      if (!channels?.length) { this.finish('The microphone stopped sending audio. Your captured take has been kept.'); return false; }
      for (let i = from; i < to; i++) {
        let sample = 0;
        for (const channel of channels) sample += channel[i] / channels.length;
        if (!Number.isFinite(sample)) { this.finish('The microphone returned invalid audio. Your captured take has been kept.'); return false; }
        this.chunk[this.used++] = sample; this.frames++;
        if (this.used === this.chunk.length) this.flush();
      }
    }
    if (currentFrame + length >= this.endFrame) this.finish();
    return !this.done;
  }
}

registerProcessor('materiallogix-music-capture', MusicCaptureProcessor);
