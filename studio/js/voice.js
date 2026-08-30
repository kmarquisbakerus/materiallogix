// Local voice performance and finishing utilities.
//
// Any TTS engine renders words; this layer renders a PERFORMANCE. It sits on
// top of whichever engine is plugged in (Kokoro or another free model via the
// bridge, or even a human VO file) and does three jobs:
//
//   1. performancePlan(script)  — text → direction: segments, pauses, breaths,
//      emphasis, pacing that varies the way a person's actually does.
//   2. humanizeBuffer(audio)    — voice finishing: breath support,
//      room tone instead of digital silence, micro-timing, gentle glue
//      compression. Pure Web Audio, free, runs on this machine.
//   3. voiceTells(audio)        — measurements of the too-perfect tells
//      (digital-zero floor, metronome pacing, flat loudness), mirroring the
//      image-quality diagnostics: they direct review and never replace it.
//
// Consent rule carried from identity packs: voices come from packs the user
// owns — their own recording or released talent. Never scraped audio.

// --- 1. performance planning (pure; node-testable) --------------------------

const PAUSE_MS = { '.': 420, '!': 380, '?': 470, ',': 220, ';': 300, ':': 280, '—': 320, '…': 500 };
const LONG_SENTENCE = 18;   // words; beyond this we split at commas

// Deterministic per-index wobble so plans are stable across runs and tests.
const wobble = (i, spread) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return (x - Math.floor(x) - 0.5) * 2 * spread;
};

/**
 * @param {string} script  Markup: *word* = emphasis, ... = long beat,
 *                         blank line = paragraph (breath + reset).
 * @returns {{segments: Array, totalWords: number}}
 */
export function performancePlan(script) {
  const paragraphs = String(script || '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const segments = [];
  let idx = 0;

  for (const para of paragraphs) {
    // Split into sentences, keeping the terminator.
    const sentences = para.match(/[^.!?…]+[.!?…]+["')\]]*|[^.!?…]+$/g) || [];
    let first = true;
    for (const sentence of sentences) {
      // Long sentences get split at commas so the voice can actually breathe.
      const words = sentence.trim().split(/\s+/);
      const clauses = words.length > LONG_SENTENCE
        ? sentence.split(/(?<=,)/)
        : [sentence];
      for (let c = 0; c < clauses.length; c++) {
        const raw = clauses[c].trim();
        if (!raw) continue;
        const emphasis = [];
        const text = raw
          .replace(/\*([^*]+)\*/g, (_, w) => { emphasis.push(w.toLowerCase()); return w; })
          .replace(/\s+/g, ' ');
        for (const w of text.split(' ')) {
          if (w.length > 3 && w === w.toUpperCase() && /[A-Z]/.test(w)) emphasis.push(w.toLowerCase());
        }
        const tail = text.slice(-1);
        const isQuestion = /\?/.test(text);
        const isExclamation = /!/.test(text);
        const wordCount = text.split(' ').length;
        const intent = isQuestion ? 'invite' : isExclamation ? 'lift' : wordCount < 6 ? 'land' : c < clauses.length - 1 ? 'carry' : 'settle';
        segments.push({
          text,
          emphasis,
          // Short lines land slower (they are the punches); long runs move.
          rate: +(1 + (wordCount > 12 ? 0.04 : wordCount < 5 ? -0.05 : 0) + wobble(idx, 0.025)).toFixed(3),
          // Questions lift, statements settle.
          pitch: +(isQuestion ? 1.02 : 1 + wobble(idx + 7, 0.012)).toFixed(3),
          intent,
          energy: +(1 + (isExclamation ? 0.08 : wordCount < 6 ? 0.035 : -0.01) + emphasis.length * 0.025 + wobble(idx + 23, 0.025)).toFixed(3),
          pauseAfterMs: Math.round((PAUSE_MS[tail] || 260) * (1 + wobble(idx + 13, 0.15))),
          breathBefore: first || (wordCount >= 10 && idx % 3 !== 1),
          paragraphStart: first
        });
        first = false;
        idx++;
      }
    }
    if (segments.length) segments[segments.length - 1].pauseAfterMs += 320;   // paragraph settle
  }
  return { segments, totalWords: segments.reduce((n, s) => n + s.text.split(' ').length, 0) };
}

/** Rough read time at ~150 wpm adjusted by the plan's own pauses. */
export function planDuration(plan) {
  const speech = (plan.totalWords / 150) * 60;
  const pauses = plan.segments.reduce((n, s) => n + s.pauseAfterMs, 0) / 1000;
  const breaths = plan.segments.filter(s => s.breathBefore).length * 0.32;
  return +(speech + pauses + breaths).toFixed(1);
}

/**
 * The inverse of planDuration: how many words fit a video of this length,
 * spoken at a profile's pace (1.0 = the 150 wpm base). Reserves a breath of
 * lead-in and lead-out so reads never slam the cut points.
 */
export function wordBudgetForSeconds(seconds, pace = 1.0) {
  const usable = Math.max(0, seconds - 1.2);
  const words = Math.floor(usable * (150 / 60) * pace);
  return Math.max(0, words);
}

// --- 2. the human post-chain (browser; Web Audio) ---------------------------

/** A synthesized breath: band-passed noise with a soft swell. Reads as human. */
function breathBuffer(ctx, seconds = 0.3, gainDb = -34) {
  const buf = ctx.createBuffer(1, Math.round(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buf.getChannelData(0);
  let lp = 0;
  const g = Math.pow(10, gainDb / 20);
  for (let i = 0; i < d.length; i++) {
    const env = Math.sin((i / d.length) * Math.PI) ** 1.6;          // swell
    lp = lp * 0.72 + (Math.random() * 2 - 1) * 0.28;                // hiss → airflow
    d[i] = lp * env * g;
  }
  return buf;
}

/**
 * Take rendered speech and make it breathe. Adds head/tail room tone, a breath
 * at the front, gentle glue compression, and a constant low room-tone bed so
 * there is never digital-zero silence anywhere in the file.
 */
export async function humanizeBuffer(input, {
  roomToneDb = -58, breathDb = -34, headSeconds = 0.5, tailSeconds = 0.6,
  presenceDb = 0.8, airDb = -1.4, movementDb = 0.7
} = {}) {
  const sr = input.sampleRate;
  const outLength = Math.round((headSeconds + tailSeconds) * sr) + input.length;
  const ctx = new OfflineAudioContext(1, outLength, sr);

  // A restrained voice chain: slight presence, softened synthetic sibilance,
  // phrase-level movement, then gentle mic-bus compression. The goal is not an
  // audible effect; it is to remove the too-perfect spectral/dynamic shape.
  const src = ctx.createBufferSource();
  src.buffer = input;
  const presence = ctx.createBiquadFilter();
  presence.type = 'peaking'; presence.frequency.value = 2800; presence.Q.value = 0.75; presence.gain.value = presenceDb;
  const air = ctx.createBiquadFilter();
  air.type = 'highshelf'; air.frequency.value = 6200; air.gain.value = airDb;
  const movement = ctx.createGain();
  const base = Math.pow(10, -0.8 / 20);
  const delta = Math.pow(10, movementDb / 20) - 1;
  movement.gain.setValueAtTime(base, headSeconds);
  const duration = input.duration;
  for (let t = 0; t <= duration; t += 1.7) {
    const human = base * (1 + Math.sin(t * 1.31 + 0.6) * delta * 0.55 + Math.sin(t * 0.47) * delta * 0.3);
    movement.gain.linearRampToValueAtTime(human, headSeconds + Math.min(duration, t));
  }
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20; comp.knee.value = 12; comp.ratio.value = 2.4;
  comp.attack.value = 0.012; comp.release.value = 0.22;
  src.connect(presence).connect(air).connect(movement).connect(comp).connect(ctx.destination);
  src.start(headSeconds);

  // Breath just before the first word.
  const breath = ctx.createBufferSource();
  breath.buffer = breathBuffer(ctx, 0.3, breathDb);
  breath.connect(ctx.destination);
  breath.start(Math.max(0, headSeconds - 0.28));

  // Room tone across the whole file: silence in a real room is never zero.
  const tone = ctx.createBuffer(1, outLength, sr);
  const td = tone.getChannelData(0);
  const tg = Math.pow(10, roomToneDb / 20);
  let lp = 0;
  for (let i = 0; i < td.length; i++) {
    lp = lp * 0.94 + (Math.random() * 2 - 1) * 0.06;
    td[i] = lp * tg;
  }
  const toneSrc = ctx.createBufferSource();
  toneSrc.buffer = tone;
  toneSrc.connect(ctx.destination);
  toneSrc.start(0);

  return ctx.startRendering();
}

// --- 3. the "sounds AI" tells (browser; operates on an AudioBuffer) ---------

export function voiceTells(buffer) {
  const d = buffer.getChannelData(0);
  const sr = buffer.sampleRate;
  const win = Math.round(sr * 0.05);
  const rms = [];
  for (let i = 0; i + win <= d.length; i += win) {
    let sum = 0;
    for (let j = i; j < i + win; j++) sum += d[j] * d[j];
    rms.push(Math.sqrt(sum / win));
  }
  const speech = rms.filter(v => v > 0.01);
  const quiet = rms.filter(v => v <= 0.01);
  const mean = speech.reduce((a, b) => a + b, 0) / (speech.length || 1);
  const variance = speech.reduce((a, b) => a + (b - mean) ** 2, 0) / (speech.length || 1);
  const floor = quiet.length ? Math.min(...quiet) : 0;

  // Pause rhythm: a metronome reads as a machine.
  const pauses = [];
  let run = 0;
  for (const v of rms) {
    if (v <= 0.01) run++;
    else { if (run >= 2) pauses.push(run); run = 0; }
  }
  const pMean = pauses.reduce((a, b) => a + b, 0) / (pauses.length || 1);
  const pVar = pauses.reduce((a, b) => a + (b - pMean) ** 2, 0) / (pauses.length || 1);

  let peak = 0, energy = 0, diffEnergy = 0, clipped = 0, transients = 0;
  for (let i = 0; i < d.length; i++) {
    const a = Math.abs(d[i]); peak = Math.max(peak, a); energy += d[i] * d[i];
    if (a >= 0.995) clipped++;
    if (i) { const delta = d[i] - d[i - 1]; diffEnergy += delta * delta; if (Math.abs(delta) > 0.32) transients++; }
  }
  const totalRms = Math.sqrt(energy / Math.max(1, d.length));
  const crestFactorDb = totalRms ? 20 * Math.log10(peak / totalRms) : 0;
  const sibilanceIndex = energy ? Math.sqrt(diffEnergy / energy) : 0;
  const clipPercent = d.length ? clipped / d.length * 100 : 0;

  return {
    silenceFloorDb: floor > 0 ? +(20 * Math.log10(floor)).toFixed(1) : -Infinity,
    loudnessCv: mean ? +(Math.sqrt(variance) / mean).toFixed(3) : 0,
    pauseCount: pauses.length,
    pauseJitter: pMean ? +(Math.sqrt(pVar) / pMean).toFixed(3) : 0,
    crestFactorDb: +crestFactorDb.toFixed(1),
    sibilanceIndex: +sibilanceIndex.toFixed(3),
    clipPercent: +clipPercent.toFixed(3),
    transientClicks: transients,
    tells: [
      ...(floor === 0 ? ['digital-zero silence (no room tone)'] : []),
      ...(mean && Math.sqrt(variance) / mean < 0.18 ? ['flat loudness (no human dynamics)'] : []),
      ...(pauses.length > 3 && pMean && Math.sqrt(pVar) / pMean < 0.2 ? ['metronome pausing'] : [])
      ,...(clipPercent > 0.02 ? ['clipping at full scale'] : [])
      ,...(transients > Math.max(2, buffer.duration * 0.8) ? ['click-like transients'] : [])
      ,...(sibilanceIndex > 0.42 ? ['hard synthetic sibilance'] : [])
      ,...(crestFactorDb < 5 ? ['over-compressed dynamics'] : [])
    ]
  };
}

/**
 * Preview stamp for unlicensed renders: the spoken mark is inserted at the
 * start, the middle, and the end, so no crop can remove all three. The free
 * tier stays fully audible - and unmistakably a preview.
 */
export async function stampPreview(voiceBuffer, stampBuffer) {
  const sr = voiceBuffer.sampleRate;
  const stamp = stampBuffer.sampleRate === sr ? stampBuffer : stampBuffer; // same-rate expected
  const gap = Math.round(sr * 0.25);
  const s3 = stamp.length * 3 + gap * 6;
  const ctx = new OfflineAudioContext(1, voiceBuffer.length + s3, sr);

  const place = (buf, at) => {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(at / sr);
  };
  const half = Math.floor(voiceBuffer.length / 2);
  // head stamp | first half | mid stamp | second half | tail stamp
  place(stamp, 0);
  const firstHalf = ctx.createBuffer(1, half, sr);
  firstHalf.copyToChannel(voiceBuffer.getChannelData(0).slice(0, half), 0);
  place(firstHalf, stamp.length + gap);
  place(stamp, stamp.length + gap + half + gap);
  const secondHalf = ctx.createBuffer(1, voiceBuffer.length - half, sr);
  secondHalf.copyToChannel(voiceBuffer.getChannelData(0).slice(half), 0);
  const at2 = stamp.length + gap + half + gap + stamp.length + gap;
  place(secondHalf, at2);
  place(stamp, at2 + (voiceBuffer.length - half) + gap);
  return ctx.startRendering();
}
