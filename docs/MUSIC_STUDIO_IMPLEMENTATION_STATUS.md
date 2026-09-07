# Music Studio implementation status

Development branch: `workstream/music-studio-release`.
This is an incremental implementation, not a completed Standard or Pro release.

## Existing site appearance

The marketing pages, existing workspace layout, shared theme, typography and
branding are unchanged. Music is opened by one existing-style button in the
Studio and Voice More menus. Its additional CSS is scoped to the Music dialog.
There is no replacement site, framework migration or live deployment.

## Implemented in this branch

- Guided mode is the default. Next-step instructions reflect empty projects,
  recording, playback and autosave failures. Microphone errors explain recovery.
- Guided volume controls use percentages. Optional sound and trim controls carry
  plain-language explanations. Advanced mode exposes technical levels without
  changing audio data. Switching modes, edits and mix changes are undoable.
- Local audio import, source-backed waveforms, multiple simultaneous tracks,
  playback/seek, per-track mute/solo, volume and stereo balance.
- Nondestructive clip movement, source trimming, splits, repeats and fades.
- Three-band EQ, dynamics compression, room effect and a tempo-linked echo in
  the playback graph. Mix adjustments update playing audio.
- Unprocessed microphone capture, permission-request cancellation, microphone
  cleanup and bounded ten-minute takes. Recording is separate from backing-track
  playback; this is not latency-compensated overdubbing.
- IndexedDB autosave, explicit recovery and portable `.mlxmusic` project files
  containing original audio and arrangement edits. Failed decoding leaves the
  current arrangement intact; failed recording decoding retains the take.
- Offline render and PCM WAV encoder foundations, interval looping and equal-
  power crossfade math. These foundations are not a delivered DJ workspace or a
  customer-authorized finished-song export path.

## Testing boundary

The automated Node suite covers project validation, clip edits and undo/redo,
WAV bytes, project packaging, guidance, controller behavior, source restrictions,
audio graph scheduling, effect parameter initialization, microphone lifecycle,
offline import graphs and existing site regressions.

Verification on 2026-09-07: 477 Node tests passed, including 35 Music-specific
tests. The site-integrity check passed and the diff whitespace check was clean.

Audio graph and microphone unit tests use doubles. They do not certify audible
quality, browser codecs, device latency, keyboard/screen-reader behavior, native
IndexedDB recovery or rendered layout. This environment's static-site preview
does not support the supervised browser-testing path. Browser and real-device
acceptance remain outstanding; do not infer them from a passing Node suite.

## Release gates still open

1. Browser/device tests of the complete recording, editing, playback, recovery
   and delivery journeys, including failure and accessibility paths.
2. Complete Standard and Pro entitlements plus a verified Music billing and
   delivery contract. No Voice billing substitution or invented usage charge.
3. Finished-song WAV/MP3 delivery, stems, clipping protection, loudness metering
   and mastering acceptance. These are not exposed as working paid exports.
4. Full DJ interface, decks, cues, beat grids, sync, headphone routing, controller
   support, set capture and the documented Standard/Pro differentiation.
5. Instruments/MIDI, automation, comping, timing/pitch correction and the other
   competitive requirements in `MUSIC_STUDIO_PRODUCT_STANDARD.md`.
6. Provider-specific approval and working adapters before subscription-library
   connections. Only local audio is currently enabled; permission is not inferred
   from a consumer subscription or another application's integration.
7. Performance/large-project validation. Current safety caps are 32 tracks,
   64 MB per imported source and 256 MB decoded audio. These do not meet the
   complete 128-track/two-hour Pro target. The lower-memory renderer is also
   bounded independently.

## Guided-mode acceptance for every capability

Guided mode is not a lesser-quality product. Each implemented capability must
offer a clear goal, a sensible default, plain-language controls, a way to listen
and compare, an obvious next step, undo where appropriate, and actionable error
recovery. Put detailed controls behind a clearly named optional section instead
of requiring beginners to understand specialist terminology. Both modes must use
the same underlying project and audio pipeline. Validate this with actual users
and keyboard/screen-reader testing, not labels alone.
