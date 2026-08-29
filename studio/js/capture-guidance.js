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
