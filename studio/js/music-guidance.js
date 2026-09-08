// Guidance describes real next actions. Changing mode never changes audio.
export function musicGuidance(session, { recording = false, playing = false, saveError = false } = {}) {
  if (saveError) return { title: 'Keep your work safe', text: 'Automatic saving is unavailable. Choose Save project to keep a copy on this device.', action: 'save', label: 'Save project' };
  if (recording) return { title: 'Your microphone is recording', text: 'Perform your song or rap. Choose Finish recording when you are done. Use headphones so the microphone does not pick up your speakers.', action: 'record', label: 'Finish recording' };
  if (!session.tracks.some(t => t.clips.length)) return { title: 'Start with your sound', text: 'Add a beat or song from this device, or choose Record microphone to make your own. Only use audio you have permission to use.', action: 'import', label: 'Add audio' };
  if (playing) return { title: 'Listen to your song', text: 'Check that you can hear each part clearly. Pause before moving or cutting a part. Lower the volume if you hear distortion.', action: 'play', label: 'Pause playback' };
  return { title: 'Listen, then adjust', text: 'Press Play to hear your parts together. Change a part’s volume, or record another part. Save project keeps the original audio and your edits together.', action: 'play', label: 'Play song' };
}

export function microphoneHelp(error) {
  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') return 'Microphone access was not allowed. Allow the microphone in your browser’s site settings, then try Record microphone again. You can still add an audio file.';
  if (error?.name === 'NotFoundError') return 'No microphone was found. Connect a microphone, check your device settings, then try again. You can still add an audio file.';
  if (error?.name === 'NotReadableError') return 'Your microphone could not be opened. Check whether another app is using it, then try again. Your existing tracks are unchanged.';
  return error?.message || 'Recording could not start. Check your microphone and try again. Your existing tracks are unchanged.';
}
