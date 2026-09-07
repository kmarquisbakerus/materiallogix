// Adjustable starting points, not source analysis or automatic mastering.
export const MIX_STARTERS = Object.freeze({
  original: { label: 'Original sound', lowDb: 0, midDb: 0, highDb: 0, compression: 0, room: 0, delay: 0 },
  rap: { label: 'Rap vocal', lowDb: -2, midDb: 2, highDb: 1, compression: 0.35, room: 0.04, delay: 0 },
  singing: { label: 'Singing voice', lowDb: -1, midDb: 1, highDb: 2, compression: 0.25, room: 0.16, delay: 0.06 },
  drums: { label: 'Drums and beats', lowDb: 2, midDb: -1, highDb: 1, compression: 0.2, room: 0, delay: 0 },
  bass: { label: 'Bass', lowDb: 1, midDb: 1, highDb: -3, compression: 0.3, room: 0, delay: 0 },
  acoustic: { label: 'Acoustic instrument', lowDb: -1, midDb: 0, highDb: 1, compression: 0.1, room: 0.12, delay: 0 },
  speech: { label: 'Spoken voice', lowDb: -2, midDb: 1, highDb: 0, compression: 0.2, room: 0, delay: 0 }
});

export function applyMixStarter(track, name) {
  if (!Object.hasOwn(MIX_STARTERS, name)) throw new Error('Choose one of the available sound starting points.');
  for (const field of ['lowDb', 'midDb', 'highDb', 'compression', 'room', 'delay']) track[field] = MIX_STARTERS[name][field];
  track.bypass = false;
}
