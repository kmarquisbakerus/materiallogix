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
  // A default only covers undefined; a capture that produced no report at all
  // hands over null, and advice is exactly what that case needs.
  const report = coverage || {};
  const notes = [];
  if (kind === 'face') {
    if ((report.yawSpreadDeg || 0) < 120) notes.push('Turn further — all the way to each profile.');
    if ((report.gaps || []).length > 1) notes.push('Turn slower through the middle.');
  }
  if (kind === 'body') {
    if ((report.coveredBuckets || 0) < 7) notes.push('Complete the full circle without stopping.');
  }
  for (const flag of report.flags || []) notes.push(flag);
  return notes;
}

// --- age and guardianship gate -------------------------------------------
// References capture a real person's face, body, or voice. That is for
// adults; 13-17 only with a parent or guardian consenting and present;
// under 13 never. The acknowledgment is stored locally with its timestamp
// and the capture flows refuse to start without it.
export const GUARDIAN_ACK_KEY = 'mlx:capture-age-ack';
export const GUARDIAN_ACK_TEXT = 'I confirm I am 18 or older — or I am 13–17 and my parent or legal guardian consents to this capture and is present. References of anyone under 13 are not permitted.';

/**
 * Has this subject been acknowledged for this purpose?
 *
 * The flag used to be one global key: whoever used the browser first answered
 * for every person captured afterwards, possibly years later, and the AUP says
 * the confirmation is taken "before any capture". It is now keyed to the
 * subject and the purpose, so a new subject is a new question.
 *
 * Called with no subject it answers the old question - is there a blanket
 * acknowledgment on this browser - which is what the pre-subject call sites
 * still ask while they are migrated.
 */
export function guardianAckGiven(subject = '', purpose = 'capture') {
  try {
    if (!String(subject).trim()) return Boolean(localStorage.getItem(GUARDIAN_ACK_KEY));
    return Boolean(localStorage.getItem(subjectAckKey(subject, purpose)));
  } catch { return false; }
}

const subjectAckKey = (subject, purpose) =>
  `${GUARDIAN_ACK_KEY}:${purpose}:${String(subject).trim().toLowerCase()}`;

/**
 * Confirm age and guardian consent before a capture, and write a record of it.
 *
 * `options.subject` names who the capture is of. Without it the confirmation
 * is the old blanket one, which is why every capture path should pass it.
 * `options.record` is the durable writer (`store.recordConsent`), injected so
 * this module stays free of a storage dependency and so a test can watch what
 * would be written.
 */
export function ensureGuardianAck(options = {}, doc = document) {
  // Tolerate the original ensureGuardianAck(document) shape: a Document has
  // querySelector, an options bag does not.
  if (options && typeof options.querySelector === 'function') { doc = options; options = {}; }
  const { subject = '', purpose = 'capture', record = null } = options;
  if (guardianAckGiven(subject, purpose)) return Promise.resolve(true);
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
      const at = new Date().toISOString();
      try {
        localStorage.setItem(GUARDIAN_ACK_KEY, at);
        if (String(subject).trim()) localStorage.setItem(subjectAckKey(subject, purpose), at);
      } catch { /* still allowed this session */ }
      // The flag makes the dialog stop asking. The record is the thing that can
      // be produced when somebody asks what was agreed, so a failure to write
      // it must not be silent.
      if (record && String(subject).trim()) {
        Promise.resolve(record({ subject, purpose, statement: GUARDIAN_ACK_TEXT, granted: true,
          evidence: { surface: 'guardian-ack-dialog', acknowledgedAt: at } }))
          .catch(error => console.error('The consent record could not be stored:', error));
      }
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
