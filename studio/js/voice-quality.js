export const VOICE_ACCEPTANCE_SCRIPT = Object.freeze([
  'MaterialLogix turns careful direction into a finished performance.',
  'Can we make the pacing feel confident, human, and precise?',
  'Numbers matter: twenty-seven products, three regions, and one clear deadline.',
  'Pause here—then land the final phrase without sounding mechanical.'
]);

const vector = profile => [profile.pace, profile.exaggeration, profile.cfgWeight, profile.temperature];
const distance = (a, b) => Math.hypot(...a.map((value, index) => value - b[index]));

export function auditVoiceProfiles(profiles = [], minimumDistance = 0.055) {
  const findings = [];
  const ids = new Set();
  for (const profile of profiles) {
    if (!profile.id || ids.has(profile.id)) findings.push(`duplicate_or_missing_id:${profile.id || 'missing'}`);
    ids.add(profile.id);
    if (!profile.locale || !profile.region || !profile.description || !profile.personality || !profile.attitude || !profile.cadence || !profile.avoid) findings.push(`incomplete_metadata:${profile.id}`);
    if (profile.status !== 'local-performance-profile') findings.push(`unapproved_status:${profile.id}`);
  }
  let closest = Infinity;
  for (let i = 0; i < profiles.length; i++) for (let j = i + 1; j < profiles.length; j++) {
    const separation = distance(vector(profiles[i]), vector(profiles[j]));
    closest = Math.min(closest, separation);
    if (separation < minimumDistance) findings.push(`profiles_too_similar:${profiles[i].id}:${profiles[j].id}`);
  }
  return {
    status: findings.length ? 'blocked' : 'pass',
    profiles: profiles.length,
    closestParameterDistance: Number.isFinite(closest) ? +closest.toFixed(4) : null,
    findings,
    distinctTimbresVerified: false,
    humanListeningPanelRequired: true
  };
}

export function voiceReferenceConsent({ ownerConfirmed, releaseConfirmed, purpose, retentionAccepted } = {}) {
  const authorizedSource = ownerConfirmed === true || releaseConfirmed === true;
  const complete = authorizedSource && purpose === 'voice_conditioning' && retentionAccepted === true;
  return { status: complete ? 'pass' : 'blocked', authorizedSource, purpose: purpose || null, retentionAccepted: retentionAccepted === true };
}
