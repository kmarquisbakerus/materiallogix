# MaterialLogix Music Studio product standard

MaterialLogix Music is a paid, local-first production workspace. It is not a
single-file audio enhancer. A release must support a complete path from capture
or import through arrangement, editing, mixing, mastering, and delivery.

Music processing and rendering run on the customer's device. Instruments,
sampling, effects, mixing, mastering, stem processing and finished-file rendering
must not send audio to a cloud processor or offer cloud rendering as a fallback.
Large projects require an efficient local engine and tested device requirements.
Music has no cloud-rendering fee. Account/entitlement requests and separately
approved provider-library access are not audio-processing routes.

It serves two complete use cases:

1. **Production** for singers, rappers, musicians, podcasters, and producers.
2. **DJ performance** for preparing, mixing, recording, and delivering sets.

## Competitive floor

The product standard was checked against the current paid products below.

| Product | Paid-product capabilities used as the floor |
| --- | --- |
| Adobe Audition | Multitrack recording and mixing, waveform and spectral editing, restoration, effects, looping, routing/EQ, loudness delivery, and automatic music re-timing |
| Ableton Live Standard | Unlimited audio/MIDI tracks, linked-track editing, audio slicing, automation/modulation, instruments, EQ, compression, limiting, reverb, delay, looping, and screen-reader support |
| Logic Pro | Recording, comping, time/pitch correction, arrangement, effects, routing, automation, stem separation, chord/tempo tools, and assisted mastering |
| FL Studio Producer and above | Audio recording, full song arrangement, automation clips, instruments/effects, mixing, mastering, and stem separation |
| Fender Studio Pro | Songwriting and arrangement, Audio-to-Note, native stem separation, mixing, and integrated mastering |

Official references:

- https://www.adobe.com/products/audition.html
- https://helpx.adobe.com/audition/desktop/introduction/whats-new.html
- https://www.ableton.com/en/live/compare-editions/
- https://www.apple.com/logic-pro/
- https://www.image-line.com/fl-studio/pricing
- https://www.presonus.com/products/studio-one-pro

## Four supported workflows

Guided and Advanced are interface choices, not quality restrictions. A user can
switch between them without changing or losing the project.

| Capability | Standard Guided | Standard Advanced | Pro Guided | Pro Advanced |
| --- | --- | --- | --- | --- |
| Record/import and arrange | Guided setup, templates, count-in | Full timeline and clip tools | Guided setup plus take selection | Full timeline, take lanes and linked editing |
| Track controls | Plain-language balance controls | Gain, pan, mute, solo, sends | Source-aware balance assistant | Gain/pan, groups, sends, buses and automation |
| Editing | Trim, split, move, duplicate, fades | Sample-positioned edits and loop regions | Assisted timing/pitch suggestions | Warp, pitch, comping and transient controls |
| Sound | Role presets with adjustable intensity | EQ, compressor, gate, saturation, delay and reverb | Adaptive source-aware presets | Parametric/dynamic EQ, multiband dynamics and effect chains |
| Mix and master | Mix check and delivery-target master | Metering, master chain and loudness target | Comparative mix assistant | Automation, reference comparison and adjustable mastering |
| Delivery | WAV/MP3 master and project package | WAV/MP3 master and project package | Master, stems and alternate versions | Master, stems, groups, alternate versions and delivery report |

## DJ workspace

Standard provides two decks, local-library import, waveforms, BPM and key
analysis, cue points, loops, pitch/tempo, sync, EQ, filters, gain, channel faders,
crossfader, headphone cue, master metering, set recording, and keyboard/controller
operation. Guided mode adds beat-match, transition, gain, and phrasing guidance;
Advanced exposes the same signal path directly.

Pro adds four decks, eight performance pads per deck, saved beat grids, linked
loops, stem controls when the source licence permits them, sampler banks,
automated transition envelopes, MIDI mapping, set-history/export reports, and
lossless/high-resolution delivery.

## Audio sources

- Customer-owned or properly licensed DRM-free WAV, AIFF, FLAC, MP3, AAC/M4A,
  OGG, and Opus files may be imported and edited locally.
- Microphone and instrument recordings belong in the same local workflow.
- Subscription-library connections may be offered only for operations verified
  as permitted for MaterialLogix by the provider. Another application's access,
  a consumer subscription, or a developer key does not establish that permission.
- Before enabling a connector, verify the applicable agreement, permitted
  platforms and territories, required consumer subscription, implemented adapter,
  and passing integration tests. No provider sign-in or connection button is
  offered for an unavailable integration.
- Treat library browsing, playback, DJ mixing, offline caching, stem processing,
  recording, and export as separate permissions. Permission for one operation
  does not authorize the others. Enforce restrictions in the processing and
  delivery paths as well as the interface; unknown or expired permission blocks
  the affected operation. Do not extract protected streams or bypass DRM.
- Local-file selection does not verify ownership, usage rights, protection, or
  decodability. Validate the actual audio before import and require the user to
  have the necessary rights for the intended use.

## Release acceptance

- Every visible control changes audible output or project state and has a test.
- Undo and redo cover every destructive edit.
- Autosave restores the project and never stores audio in analytics or logs.
- Record, import, playback, seeking, looping, and export are exercised in a real browser.
- Standard supports at least 32 tracks and Pro at least 128; neither tier limits
  song duration below two hours.
- Exported WAV files have correct headers, sample rate, channel count, duration,
  clipping protection, and an explicit loudness/true-peak result.
- Pro-only actions fail closed when the current licence is not Pro.
- Streaming-source operations require both current provider permission for
  MaterialLogix and the consumer entitlement required by that provider. A Pro
  licence does not override a source restriction. Tests must cover unavailable
  adapters, expired authorization, subscription loss, and mixed-source exports.
- Keyboard-only and screen-reader paths cover transport, track controls, the
  timeline, dialogs, and export.
- The DJ path covers deck loading, cueing, looping, sync, crossfading, headphone
  cue, set recording, and clean shutdown without leaving a microphone or audio
  device active.
