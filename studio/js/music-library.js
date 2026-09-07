/**
 * The source catalog contains only enabled integrations. Local recordings and
 * files are the current sources. A streaming adapter must enforce its own
 * provider-authorized operations before it can be added to this catalog.
 */

export const MUSIC_SOURCE_CAPABILITIES = Object.freeze({
  local: Object.freeze({
    id: 'local', label: 'Files on this device', connectable: true,
    editable: true, djPlayback: true, offline: true, stems: true
  })
});

export const EDITABLE_AUDIO_TYPES = Object.freeze([
  'audio/wav', 'audio/x-wav', 'audio/aiff', 'audio/x-aiff', 'audio/flac',
  'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/opus', 'audio/webm'
]);

const AUDIO_EXTENSIONS = /\.(wav|wave|aif|aiff|flac|mp3|m4a|aac|ogg|oga|opus|webm)$/i;

export function supportedLocalAudio(file) {
  if (!file || typeof file.name !== 'string') return false;
  const type = String(file.type || '').toLowerCase();
  return EDITABLE_AUDIO_TYPES.includes(type) || (!type && AUDIO_EXTENSIONS.test(file.name));
}

export function sourceAvailability(sourceId) {
  if (sourceId !== 'local') {
    return { available: false, reason: 'This music source is unavailable. Use a recording or a supported audio file from this device.' };
  }
  return { available: true, reason: '' };
}

export function assertDeckSource(sourceId) {
  const state = sourceAvailability(sourceId);
  if (!state.available) throw new Error(state.reason);
  return MUSIC_SOURCE_CAPABILITIES.local;
}
