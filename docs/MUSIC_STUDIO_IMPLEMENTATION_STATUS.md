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
- Unprocessed mono PCM microphone capture on the same audio clock as backing
  playback, four-beat count-in, permission-request cancellation and microphone
  cleanup. Takes are bounded by available memory and a ten-minute ceiling.
  Hardware input/output latency is not yet calibrated or independently verified.
- Beat Maker with six synthesized drums, editable steps, swing, strengths,
  volumes, starter patterns and source-backed arrangement parts.
- Nine synthesized instrument voices, note/chord editing, starter patterns and a
  sampler using imported audio. Notes and original samples are saved with the
  project. Built-in voices are not a professionally sampled acoustic library.
- Generated drum and instrument parts keep editable patterns. Updating a part
  preserves its positions and mix settings; undo restores its previous audio.
- Adjustable mix starting points, effects comparison, polarity inversion,
  mono listening, part naming and undoable track removal. Detailed editing stays
  in optional sections in Guided mode.
- IndexedDB autosave, explicit recovery and portable `.mlxmusic` project files
  containing original audio and arrangement edits. Failed decoding leaves the
  current arrangement intact; failed recording decoding retains the take.
- Offline render and PCM WAV encoder foundations, interval looping and equal-
  power crossfade math. These foundations are not a delivered DJ workspace or a
  customer-authorized finished-song export path.
- Free Music playback carries an audible preview mark. Covered Music playback
  is clean; originals remain unchanged. A missing required mark blocks playback.
  This is a copying deterrent, not protection against operating-system recording
  or client-code modification. Clean exports still require server authorization.

## Testing boundary

The automated Node suite covers project validation, clip edits and undo/redo,
WAV bytes, project packaging, guidance, controller behavior, source restrictions,
audio graph scheduling, effect parameter initialization, microphone lifecycle,
offline import graphs and existing site regressions.

The new automated checks cover synthesized waveforms, timing and output bytes,
sampled-instrument persistence, generated-part updates and capture interruption.
The browser journey now includes creation, native AudioWorklet capture with a
synthetic microphone, project download, IndexedDB recovery and offline WAV
rendering. CI retains desktop/phone screenshots, a portable project and
clean/marked diagnostic WAVs for visual and audio inspection. The journey now
also captures Photo, Video and Voice editing at desktop and phone sizes.

Verification on 2026-09-07: all 510 Node tests passed, including free-preview
policy, required-mark failures and playback cleanup. CI run 34158505653 passed
all 72 existing browser-journey checks, the Music journey, all five browser CSP
checks and deployment-package validation at commit 204b248. The first Music
run had stopped at the instrument selector's accessible name; the correction
passed in that rerun. The site-integrity workflow also passed.

The actual clean and marked WAVs from that run were independently decoded with
FFmpeg: 48 kHz, stereo, 24-bit PCM, 400,800 frames and 8.35 seconds each, nonzero
audio and no clipped samples. The clean sample peak was -3.63 dBFS and the marked
sample peak -6.72 dBFS. The added preview mark was measurable after decoding.
These are engine diagnostics with synthetic microphone input, not customer-
authorized exports, true-peak/loudness certification or listening approval.

Music desktop and phone screenshots were visually inspected. The follow-up
checks cover internal editor overflow, enlarged text and drum controls as well;
the narrow-screen drum grid now wraps into four columns. Those changes require
their own CI result. The broader suite screenshots and full visual/device
acceptance remain outstanding.

Audio graph and microphone unit tests use doubles; processor tests also execute
the capture algorithm over sample buffers. They do not certify audible
quality, browser codecs, device latency, keyboard/screen-reader behavior, native
IndexedDB recovery or rendered layout. The repository's CI runs the browser
journeys in Chromium. Visual inspection, real-device and listening acceptance
remain outstanding; do not infer them from a passing Node suite.

## Release gates still open

1. Browser/device tests of the complete recording, editing, playback, recovery
   and delivery journeys, including failure and accessibility paths.
2. Complete Standard and Pro entitlements plus a verified Music billing and
   delivery contract. No Voice billing substitution or invented usage charge.
3. Finished-song WAV/MP3 delivery, stems, clipping protection, loudness metering
   and mastering acceptance. These are not exposed as working paid exports.
4. Full DJ interface, decks, cues, beat grids, sync, headphone routing, controller
   support, set capture and the documented Standard/Pro differentiation.
5. Expressive keyboard/MIDI performance and import, richer instrument controls,
   sound-library acceptance, automation, comping, timing/pitch correction and the
   other competitive requirements in `MUSIC_STUDIO_PRODUCT_STANDARD.md`.
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
