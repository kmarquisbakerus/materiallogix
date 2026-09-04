// Turn-speed coaching. One target rate per capture, used both to pace the
// person live and to show them afterwards where they drifted.

// Durations are set by motion blur, not by the grader: frames are sampled
// evenly across the clip, so the per-frame jump limit rarely binds. Slower
// turns give the detector a sharper face to find.
export const PACE = Object.freeze({
  face: { sweepDeg: 180, seconds: 16, maxJumpDeg: 40, start: -90 },
  body: { sweepDeg: 360, seconds: 20, maxJumpDeg: 60, start: 0 }
});

export function paceTarget(kind) {
  const pace = PACE[kind];
  if (!pace) throw new Error('Unknown capture kind.');
  return { ...pace, degreesPerSecond: pace.sweepDeg / pace.seconds };
}

/** Where the person should be pointing at this moment in the take. */
export function idealAngle(kind, elapsedSeconds) {
  const { sweepDeg, seconds, start } = paceTarget(kind);
  // Math.max(0, NaN) is NaN, and a NaN angle draws a guide with no needle.
  const elapsed = Number(elapsedSeconds);
  const progress = Number.isFinite(elapsed) ? Math.max(0, Math.min(1, elapsed / seconds)) : 0;
  return start + sweepDeg * progress;
}

/**
 * Per-frame verdict from a finished take. Rates each step against the target
 * rather than the failure threshold, so "a bit fast" still reads as a note.
 */
export function paceTrace(kind, coverage = {}, durationSeconds) {
  const { degreesPerSecond, maxJumpDeg, seconds, sweepDeg } = paceTarget(kind);
  const samples = coverage.samples || [];
  const frames = coverage.frames || samples.length;
  if (samples.length < 2 || !frames) return { steps: [], verdict: 'unknown' };
  const perFrame = (durationSeconds || seconds) / frames;

  let fast = 0, slow = 0;
  const steps = [];
  for (let i = 1; i < samples.length; i++) {
    let delta = Math.abs(samples[i].yaw - samples[i - 1].yaw);
    if (kind === 'body') { delta %= 360; if (delta > 180) delta = 360 - delta; }
    const elapsed = Math.max(perFrame, (samples[i].frame - samples[i - 1].frame) * perFrame);
    const rate = delta / elapsed;
    const ratio = rate / degreesPerSecond;
    const verdict = delta / Math.max(1, samples[i].frame - samples[i - 1].frame) > maxJumpDeg ? 'too-fast'
      : ratio > 1.5 ? 'fast'
      : ratio < 0.5 ? 'slow'
      : 'good';
    if (verdict === 'too-fast' || verdict === 'fast') fast++;
    if (verdict === 'slow') slow++;
    steps.push({ atSeconds: +(samples[i].frame * perFrame).toFixed(2), rate: +rate.toFixed(1), verdict });
  }
  // Rushing wins over idling: someone who turns too fast finishes early and
  // then holds still, and the stillness is the symptom, not the fault.
  const overshot = steps.some(step => step.verdict === 'too-fast');
  const covered = steps.reduce((total, step) => total + step.rate * perFrame, 0);
  const finishedEarly = steps.length > 2
    && covered >= sweepDeg * 0.9
    && steps.at(-1).verdict === 'slow';
  const verdict = overshot || finishedEarly || fast > slow ? 'fast'
    : slow > 0 ? 'slow'
    : 'good';
  return {
    steps,
    targetRate: degreesPerSecond,
    fastSteps: fast,
    slowSteps: slow,
    finishedEarly,
    verdict: fast === 0 && slow === 0 ? 'good' : verdict,
    advice: fast === 0 && slow === 0 ? 'Turn speed was steady.'
      : verdict === 'fast'
        ? `Spread the turn over the full ${seconds} seconds — about ${Math.round(degreesPerSecond)}° a second.`
        : `Keep moving — about ${Math.round(degreesPerSecond)}° a second.`
  };
}

const COLOR = { good: '#4c9a72', fast: '#c8a04a', 'too-fast': '#b4544a', slow: '#6b7ba8' };

/** A bar of the take: green where the pace held, marked where it did not. */
export function paceTraceSvg(trace, width = 320, height = 34) {
  const steps = trace.steps || [];
  if (!steps.length) return '';
  const span = steps[steps.length - 1].atSeconds || steps.length;
  const bars = steps.map((step, index) => {
    const previous = index ? steps[index - 1].atSeconds : 0;
    const x = (previous / span) * width;
    const w = Math.max(1.5, ((step.atSeconds - previous) / span) * width);
    return `<rect x="${x.toFixed(1)}" y="6" width="${w.toFixed(1)}" height="16" fill="${COLOR[step.verdict]}" />`;
  }).join('');
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" `
    + `aria-label="${trace.advice}"><rect x="0" y="6" width="${width}" height="16" fill="#2a2a2e" />`
    + `${bars}<text x="0" y="32" font-size="9" fill="#8b8b93">start</text>`
    + `<text x="${width}" y="32" font-size="9" fill="#8b8b93" text-anchor="end">end</text></svg>`;
}

/** Live guide: a marker sweeping at the target rate for the person to follow. */
export function paceGuideSvg(kind, elapsedSeconds, size = 160) {
  const { seconds, sweepDeg, start } = paceTarget(kind);
  const progress = Math.max(0, Math.min(1, elapsedSeconds / seconds));
  const centre = size / 2;
  const radius = centre - 14;
  const angle = ((start + sweepDeg * progress) - 90) * Math.PI / 180;
  const x = centre + radius * Math.cos(angle);
  const y = centre + radius * Math.sin(angle);
  const arc = kind === 'body' ? 360 : sweepDeg;
  const remaining = Math.max(0, seconds - elapsedSeconds);
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" `
    + `aria-label="Turn guide, ${remaining.toFixed(0)} seconds left">`
    + `<circle cx="${centre}" cy="${centre}" r="${radius}" fill="none" stroke="#2a2a2e" stroke-width="8" `
    + `stroke-dasharray="${(arc / 360) * 2 * Math.PI * radius} ${2 * Math.PI * radius}" />`
    + `<circle cx="${centre}" cy="${centre}" r="${radius}" fill="none" stroke="#c9a227" stroke-width="8" `
    + `stroke-linecap="round" stroke-dasharray="${progress * (arc / 360) * 2 * Math.PI * radius} ${2 * Math.PI * radius}" />`
    + `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="7" fill="#c9a227" />`
    + `<text x="${centre}" y="${centre + 5}" font-size="20" fill="#e8e8ea" text-anchor="middle">`
    + `${Math.ceil(remaining)}</text></svg>`;
}

/** Ticks per turn. Even spacing in angle means even spacing in time. */
export function tickPlan(kind, ticks = 12) {
  const { seconds } = paceTarget(kind);
  const out = [];
  for (let i = 1; i <= ticks; i++) {
    const at = (seconds * i) / ticks;
    const progress = i / ticks;
    // Falling pitch over the last fifth says "ease off, you are nearly there".
    const hz = progress > 0.8 ? 880 - (progress - 0.8) * 5 * 300 : 880;
    out.push({ at: +at.toFixed(2), hz: Math.round(hz), last: i === ticks });
  }
  return out;
}

function beep(ctx, hz, when, ms = 40, gain = 0.18) {
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.frequency.value = hz;
  osc.type = 'sine';
  amp.gain.setValueAtTime(0, when);
  amp.gain.linearRampToValueAtTime(gain, when + 0.005);
  amp.gain.exponentialRampToValueAtTime(0.0001, when + ms / 1000);
  osc.connect(amp).connect(ctx.destination);
  osc.start(when);
  osc.stop(when + ms / 1000 + 0.02);
}

/**
 * Run the turn guide: a sweeping marker plus a tick to turn to. Must be
 * started from a tap so phones allow the audio. Returns a stop function.
 */
export function runPaceGuide({ kind, mount, silent = false, onDone } = {}) {
  const { seconds } = paceTarget(kind);
  let ctx = null;
  if (!silent) {
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      const base = ctx.currentTime + 0.1;
      for (const tick of tickPlan(kind)) {
        beep(ctx, tick.hz, base + tick.at, tick.last ? 220 : 40, tick.last ? 0.22 : 0.18);
      }
    } catch { ctx = null; }
  }
  const started = performance.now();
  let frame = 0;
  const draw = () => {
    const elapsed = (performance.now() - started) / 1000;
    if (mount) mount.innerHTML = paceGuideSvg(kind, elapsed);
    if (elapsed >= seconds) {
      stop();
      if (typeof onDone === 'function') onDone();
      return;
    }
    frame = requestAnimationFrame(draw);
  };
  const stop = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    if (ctx) ctx.close().catch(() => {});
    ctx = null;
  };
  draw();
  return stop;
}
