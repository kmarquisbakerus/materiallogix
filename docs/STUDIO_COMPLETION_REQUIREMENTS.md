# Studio completion requirements

Complete the existing Music work before changing prices or publishing a customer release. Preserve the current site layout, branding, typography and shared appearance. Additional controls use the existing design.

All Music audio processing and rendering must remain on the customer's device.
There is no Music cloud-rendering route, fallback or surcharge. Project scale
must be solved with local processing and measured device requirements.

## Customer workflows

| Workflow | Required working path | Release evidence |
| --- | --- | --- |
| Make a song or rap | Start with a beat or imported backing; add keys, bass or another instrument; record vocals; edit, mix, master and deliver | Completed project and actual authorized WAV/MP3 outputs, with audible comparison |
| Write instrumental music | Play or enter notes and chords; choose useful instruments; import samples; arrange and revise parts | Editable notes, retained samples, repeatable rendering and project recovery |
| Mix recordings | Balance multiple tracks; route groups and sends; use EQ, dynamics, effects, automation and references | Controls alter the intended signal, original comparison works, stems align |
| DJ | Prepare a local library; load decks; cue, beat-match, transition, monitor headphones and capture a set | Full set without interruption; tested controller and output routing |
| Continue in another Studio | Use a consistent “Use in…” action throughout Photo, Video, Voice and Music for compatible material | End-to-end handoff, including delivered output, without lost media, mismatched entitlement or duplicate charges |

## Connected work across the suite

Every Studio participates in the same handoff workflow. Music remains an audio
workspace; making a music video opens Video with the song attached. The existing
site layout stays in place. Do not require downloading and uploading again on the
same device.

| Source | Destination | Required result |
| --- | --- | --- |
| Photo | Video | Edited image available as a still, background, title image or cover |
| Photo | Music / Voice | Artwork attached to the project and compatible finished-audio metadata |
| Voice | Music | Voice take on an editable audio track, ready to arrange with instruments |
| Voice | Video | Narration on the timeline, with timing and volume controls |
| Music | Video | Song or selected stem attached as soundtrack, with timing and volume controls |
| Music | Voice | Selected vocal recording available for supported voice cleanup; no automatic voice training or consent reuse |
| Video | Photo | Selected frame available for image editing and return to the video project |
| Video | Music / Voice | Selected audio available for mixing or supported voice cleanup; video editing stays in Video |

- Use the same destination names and handoff controls in Guided and Advanced.
  Offer compatible roles, such as soundtrack or artwork, instead of forcing
  every media type into every editor.
- Save the source project and retain the exact revision used. Keep originals and
  editable settings; a handoff must not flatten or overwrite the source project.
- Identify the imported item by its readable name and source Studio. Allow
  returning to that source and explicitly accepting a newer revision. Repeated
  clicks must not create duplicate tracks or replace newer edits.
- Carry source identity, media bytes, timing, quality, preview restrictions and
  an existing output receipt. Client metadata never grants a paid entitlement.
  A free source preview cannot become clean by moving to a paid destination.
- A transfer is not a finished export and consumes no export minutes. Reusing
  an already authorized source does not bill for that source again. A new
  finished video can use video allowance; the customer sees the destination
  quote before export. Retry or redownload of the same completed output is free.
- Retain a recoverable transfer if the destination cannot open, storage fills,
  or import fails. Preserve the source if the user cancels. Keep all Music
  processing local; a destination's cloud option does not authorize uploading
  the source audio.
- Verify every row with actual source and destination media, reload recovery,
  preview/paid combinations and final exported output. A navigation button or
  saved reference alone does not pass this requirement.

## Suite pricing requirements

Use the suite's existing plan ladder with explicit included monthly finished-
output minutes at each applicable level. Music uses audio minutes; Video uses
video minutes; Photo uses a separate image allowance. Do not describe the same
shared allowance as independently available in full for every Studio. Free
accounts pay a higher export rate than paid-plan overages. Consume included
allowance first, show the complete overage quote before work, and count delivered
duration rather than editing time. Exact allowances and prices require catalog
and billing reconciliation before activation. Music has no cloud surcharge.

## Guided mode across every Studio

- Begin with the customer's goal and a useful default. Keep the next action visible.
- Use the same names for the same actions: Add audio/media, Record, Play/Preview, Undo, Save project, Open project, Recover last save and Export.
- Separate saving editable work from delivering a finished output. Explain both at the point of action.
- Show only the controls needed for the current step. Place specialist controls in clearly named optional sections; keep them reachable in Guided mode.
- Preserve the project and output quality when switching to Advanced. Guided is not a lower-quality audio or image pipeline.
- Prefer readable note names, percentages and concrete examples over unexplained jargon. Explain professional units when they are useful.
- Keep focus on the control being used after an update. Preserve open editing sections, label controls, expose toggled states, and support keyboard and screen readers.
- Give errors a recovery action and preserve the existing project. Explain price and allowance before a billable operation.
- Test on a narrow screen and at 200% text enlargement. Do not call the experience easy based only on labels or automated checks.

These requirements apply the principles of [clear instructions](https://www.w3.org/WAI/WCAG2/supplemental/patterns/o4p07-step-instructions/), [clear task steps](https://www.w3.org/WAI/WCAG2/supplemental/patterns/o1p04-clear-steps/) and [consistent identification](https://www.w3.org/WAI/WCAG21/Understanding/consistent-identification.html). [Ableton Note](https://www.ableton.com/en/note/) provides a paid-product reference for combining beat, melody, instrument and sample creation. These references inform behavior; they do not replace the existing site's design.

## Music feature completion

| Area | Added in the current work | Still required before the full promised release |
| --- | --- | --- |
| Beat creation | Six synthesized drums; editable 16-step patterns, swing, strength, volume, starters and arrangement parts | Larger patterns, sample chopping, pad performance and full MIDI capture |
| Instruments | Nine synthesized voices, note/chord starters and editing, sample playback from imported audio, editable generated parts | Expressive live keyboard performance, sustain, MIDI recording/import, richer sound controls and accepted sound-library quality |
| Recording | Audio-clock scheduling with backing playback, count-in, separate mono PCM take, cancellation and partial-take preservation | Measured device latency, calibration, input selection, instrument interfaces, take lanes and comping |
| Track mixing | Volume, pan, mute, solo, three-band EQ, compression, room, echo, sound starters, bypass comparison, polarity and mono monitoring | Routing and groups, sends, sidechain, automation, expanded processors and reference comparison |
| Mastering and output | Existing offline render and WAV encoding foundations | Master chain, independently verified loudness/true peak, clipping protection, MP3, stems, metadata and authorized delivery |
| DJ | Existing crossfade math only | Complete two-/four-deck workflows, cues, grids, tempo/key analysis, sync, loops, pads, controller support, headphones and set recording |
| Projects | Original media, generated note/drum patterns, sampled instruments, undo/redo, portable files and device recovery | Large-project streaming/memory design and full two-hour/128-track Pro acceptance |
| Provider libraries | Local sources only | Provider-specific MaterialLogix approval and implemented/tested adapters for each permitted operation |

Standard and Pro remain subject to the full matrix in `MUSIC_STUDIO_PRODUCT_STANDARD.md`. Newly added code is not proof of professional audio quality, device compatibility or a completed paid plan.

## Detailed release checks

1. **Capture and editing:** cancelled/denied microphone, delayed permission, interrupted input, stale starts, zero-length takes, clipping, decode failures, trims at boundaries, repeated notes/clips, undo/redo, and mode changes.
2. **Recovery:** interrupted saves, storage quota, reload/offline recovery, portable file reopening, missing or malformed media, older projects, and preservation of original samples and editable generated parts.
3. **Audio delivery:** decode the actual delivered file; verify codec/container, sample rate, bit depth, channels, duration, start/end samples, effect tails, stereo balance, loudness, true peak and stem alignment. Listen to voice, drums, instruments and complete mixes. Verify MP3 in an independent decoder.
4. **Photo/video delivery:** verify the advertised dimensions, color profile, transparency, frame rate, trim duration, audio sync, watermark rules, metadata and included files for each supported output.
5. **Billing and permissions:** Music is its own product; no Voice substitution. Test valid/expired/wrong-product plans, Standard versus Pro, free preview, repeated requests, interrupted delivery, failed renders, settlement and void/refund recovery. Reconcile client, backend and live catalog before activation.
6. **Security and reliability:** content-security policy, microphone/output cleanup, input limits, malformed projects, unavailable provider permissions, offline boundaries, retained URLs, private audio handling and update compatibility. Verify that Music processing never uploads audio or invokes a remote rendering service.
7. **Usability:** complete journeys in Guided and Advanced with keyboard, screen reader, narrow screen, zoom and error recovery. Confirm the same concepts and actions across Photo, Video, Voice and Music.
8. **Customer acceptance:** provide clearly labeled files from actual supported export flows, plus diagnostic samples where relevant. Record which sound and output the customer accepted. Diagnostic generation is not proof that paid export works.
9. **Release:** run the complete verification suite, resolve blockers, push verified source, reconcile feature claims/prices/checkout and help, then deploy the accepted offering to the existing website. Check production purchase, license activation, restore, export and rollback after release.

The browser journey uses a synthetic microphone and a stubbed backend. Passing it would verify browser execution, not physical hardware, live billing or listening quality. Those remain separate acceptance checks.
