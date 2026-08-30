// What to tell someone before they capture. Every line maps to something the
// analyzers actually measure, so advice and grading never drift apart.
import { voiceSampleLimits, voiceMethod, FINE_TUNE_MINIMUM_SECONDS } from './voice-reference.js';

// captureCoverage: 120° spread, 30° buckets, one face, jumps under 40°.
export const FACE_GUIDANCE = Object.freeze({
  title: 'Facial reference',
  target: 'Left profile to right profile, about sixteen seconds.',
  steps: Object.freeze([
    'Hold the camera at eye level, an arm away.',
    'Keep the laptop or camera still. You turn; the computer does not.',
    'Start looking fully left. Turn slowly to fully right.',
    'Take about sixteen seconds. Rushing blurs the turn.',
    'Even light on both sides. No cap, no sunglasses.',
    'One person in frame.'
  ]),
  graded: 'Graded on how much of the turn we can see, so the ends matter most.'
});

// captureCoverageBody: 7 of 8 45° buckets, jumps under 60°.
export const BODY_GUIDANCE = Object.freeze({
  title: 'Full-body reference',
  target: 'One full turn, about twenty seconds.',
  steps: Object.freeze([
    'Whole body in frame, head to feet, with room to spare.',
    'The camera stays put. You turn in place through one full circle.',
    'Take about twenty seconds. A quick spin blurs the sides.',
    'Plain background. Fitted clothes read better than loose ones.',
    'Keep arms slightly away from your sides.'
  ]),
  graded: 'Graded in eight segments around the circle; seven of eight passes.'
});

const minutes = seconds => Math.round(seconds / 60);
const span = seconds => {
  const value = minutes(seconds);
  if (value < 60) return `${value} minutes`;
  const hours = value / 60;
  return hours === 1 ? 'one hour' : `${hours} hours`;
};

/** Voice guidance for a plan, phrased around what that plan can actually do. */
export function voiceGuidance(plan) {
  const limits = voiceSampleLimits(plan);
  const trains = limits.method === 'train';
  const cap = span(limits.maximumSeconds);
  const floor = minutes(FINE_TUNE_MINIMUM_SECONDS);
  return {
    title: trains ? 'Voice training' : 'Voice reference',
    target: trains
      ? `Read for ${floor} minutes or more. This plan accepts up to ${cap}.`
      : `Read for two to five minutes. This plan accepts up to ${cap}.`,
    steps: Object.freeze([
      'One quiet room. No music, no television, nobody else talking.',
      'Read at your normal pace in your normal voice.',
      'Pause for a breath between sentences.',
      'Stay the same distance from the microphone throughout.',
      trains
        ? 'Read varied material — statements, questions, numbers, names.'
        : 'Read something with a range of sounds, not one flat sentence.'
    ]),
    graded: trains
      ? `Under ${floor} minutes we use the recording as a reference instead of training on it, and say so.`
      : 'We pick the strongest passage from what you record, so more material is a better pick.'
  };
}

/** One entry point for the three capture flows. */
export function guidanceFor(kind, plan) {
  if (kind === 'face') return FACE_GUIDANCE;
  if (kind === 'body') return BODY_GUIDANCE;
  if (kind === 'voice') return voiceGuidance(plan);
  throw new Error('Unknown capture kind.');
}

/** Plain follow-up when a capture scores badly. */
export function retryAdvice(kind, coverage = {}) {
  const notes = [];
  if (kind === 'face') {
    if ((coverage.yawSpreadDeg || 0) < 120) notes.push('Turn further — all the way to each profile.');
    if ((coverage.gaps || []).length > 1) notes.push('Turn slower through the middle.');
  }
  if (kind === 'body') {
    if ((coverage.coveredBuckets || 0) < 7) notes.push('Complete the full circle without stopping.');
  }
  for (const flag of coverage.flags || []) notes.push(flag);
  return notes;
}

// --- age and guardianship gate -------------------------------------------
// References capture a real person's face, body, or voice. That is for
// adults; 13-17 only with a parent or guardian consenting and present;
// under 13 never. The acknowledgment is stored locally with its timestamp
// and the capture flows refuse to start without it.
export const GUARDIAN_ACK_KEY = 'mlx:capture-age-ack';
export const GUARDIAN_ACK_TEXT = 'I confirm I am 18 or older — or I am 13–17 and my parent or legal guardian consents to this capture and is present. References of anyone under 13 are not permitted.';

export function guardianAckGiven() {
  try { return Boolean(localStorage.getItem(GUARDIAN_ACK_KEY)); } catch { return false; }
}

export function ensureGuardianAck(doc = document) {
  if (guardianAckGiven()) return Promise.resolve(true);
  return new Promise(resolve => {
    const dlg = doc.createElement('dialog');
    dlg.className = 'guardian-ack';
    const box = doc.createElement('input'); box.type = 'checkbox'; box.id = 'guardianAckBox';
    const label = doc.createElement('label');
    const labelText = doc.createElement('span'); labelText.textContent = GUARDIAN_ACK_TEXT;
    label.append(box, labelText);
    const heading = doc.createElement('h2'); heading.textContent = 'Before you capture anyone';
    const go = doc.createElement('button'); go.type = 'button'; go.textContent = 'Continue'; go.className = 'btn primary'; go.disabled = true;
    const cancel = doc.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Not now'; cancel.className = 'btn';
    box.onchange = () => { go.disabled = !box.checked; };
    const finish = ok => { dlg.close(); dlg.remove(); resolve(ok); };
    go.onclick = () => {
      try { localStorage.setItem(GUARDIAN_ACK_KEY, new Date().toISOString()); } catch { /* still allowed this session */ }
      finish(true);
    };
    cancel.onclick = () => finish(false);
    dlg.oncancel = () => finish(false);
    const foot = doc.createElement('div'); foot.className = 'foot'; foot.append(cancel, go);
    dlg.append(heading, label, foot);
    doc.body.append(dlg);
    dlg.showModal();
  });
}
