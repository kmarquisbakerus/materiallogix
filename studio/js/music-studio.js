import { createSession, createTrack, createClip, editClip, splitClip, duplicateClip, SessionHistory, sessionDuration, validateSession, encodeWav, replaceGeneratedPart } from './music-session.js';
import { MusicTransport, verifyAudioSources } from './music-audio.js';
import { MusicCapture, countIn } from './music-capture.js';
import { DRUMS, beatPreset, renderBeat } from './music-beats.js';
import { MIX_STARTERS, applyMixStarter } from './music-mix.js';
import { INSTRUMENTS, noteName, createInstrumentPattern, addInstrumentNotes, instrumentPreset, renderInstrument } from './music-instruments.js';
import { musicPlaybackPolicy, loadMusicPreviewStamp, MusicPreviewOutput } from './music-preview.js';
import { supportedLocalAudio } from './music-library.js';
import { MusicProjectStore, projectSnapshot, packProject, unpackProject } from './music-project.js';
import { musicGuidance, microphoneHelp } from './music-guidance.js';
import { downloadBlob } from './download.js';

const el = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
const button = (text, action, primary = false) => {
  const node = el('button', text, `btn sm${primary ? ' primary' : ''}`);
  node.type = 'button'; node.dataset.musicAction = action; return node;
};
const timeText = value => `${Math.floor(value / 60)}:${(value % 60).toFixed(1).padStart(4, '0')}`;
const safeName = name => (name || 'Untitled song').replace(/[^\p{L}\p{N} _.-]/gu, '_').slice(0, 100);
const MAX_DECODED = 256 * 1024 * 1024;

export class MusicStudio {
  constructor() {
    this.history = new SessionHistory(createSession()); this.sources = new Map();
    this.store = new MusicProjectStore(); this.recorder = new MusicCapture();
    this.recordBacking = true; this.countBeats = 4; this.recordStarted = null;
    this.notePitch = 60; this.noteStep = 0; this.noteLength = 4;
    this.playbackPolicy = { tier: 'preview', watermarked: true };
    this.position = 0; this.revision = 0; this.savedRevision = 0;
    this.dialog = el('dialog', undefined, 'music-dialog');
    this.dialog.setAttribute('aria-label', 'Music Studio');
    this.dialog.append(el('h2', 'Music Studio', 'dlg-head'));
    this.body = el('div', undefined, 'dlg-body');
    this.notice = el('p', 'Your audio stays on this device.', 'music-notice');
    this.notice.setAttribute('role', 'status'); this.notice.setAttribute('aria-live', 'polite');
    this.content = el('div'); this.body.append(this.notice, this.content);
    const foot = el('div', undefined, 'dlg-foot'); foot.append(button('Close', 'close'));
    this.dialog.append(this.body, foot); document.body.append(this.dialog);
    this.audioInput = el('input'); this.audioInput.type = 'file'; this.audioInput.multiple = true;
    this.audioInput.accept = 'audio/*,.wav,.aiff,.aif,.flac,.mp3,.m4a,.aac,.ogg,.opus,.webm'; this.audioInput.hidden = true;
    this.projectInput = el('input'); this.projectInput.type = 'file'; this.projectInput.accept = '.mlxmusic'; this.projectInput.hidden = true;
    this.dialog.append(this.audioInput, this.projectInput);
    this.audioInput.addEventListener('change', () => { const files = [...this.audioInput.files]; this.audioInput.value = ''; if (files.length) this.run(() => this.importFiles(files)); });
    this.projectInput.addEventListener('change', () => { const file = this.projectInput.files[0]; this.projectInput.value = ''; if (file) this.run(async () => this.restore(await unpackProject(file))); });
    this.dialog.addEventListener('click', e => {
      const target = e.target.closest('[data-music-action]');
      if (target?.dataset.musicAction === 'cancel-request' && this.recorder.state === 'requesting') {
        this.recorder.stop(); this.say('Microphone request cancelled. You can dismiss the browser’s permission prompt.'); return;
      }
      if (target && !target.disabled) this.run(() => this.action(target.dataset.musicAction, target));
    });
    this.dialog.addEventListener('cancel', e => { e.preventDefault(); this.run(() => this.action('close')); });
    this.dialog.addEventListener('close', () => { this.transport?.stop(); this.stopBeatPreview(); clearInterval(this.clock); });
    window.addEventListener('beforeunload', e => {
      if (this.pendingTake || this.recorder.state !== 'idle' || this.busy || this.revision !== this.savedRevision) { e.preventDefault(); e.returnValue = ''; }
    });
  }
  get session() { return this.history.session; }
  async audio() {
    if (!this.context) {
      const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Context) throw new Error('Audio editing is unavailable in this browser. Try a browser with Web Audio support.');
      this.context = new Context(); this.transport = new MusicTransport(this.context, this.sources);
    }
    await this.context.resume(); return this.context;
  }
  open() {
    if (this.dialog.open) return;
    this.render(); this.dialog.showModal();
    this.clock = setInterval(() => this.tick(), 100);
  }
  async preparePlayback() {
    const context = await this.audio(), policy = await musicPlaybackPolicy();
    if (!this.output || policy.watermarked !== this.playbackPolicy.watermarked) {
      const stamp = policy.watermarked ? await loadMusicPreviewStamp(context) : null;
      this.output?.dispose(); this.output = new MusicPreviewOutput(context, stamp); this.transport.output = this.output;
    }
    this.playbackPolicy = policy;
    if (this.previewLabel) this.previewLabel.textContent = policy.watermarked ? 'Free preview · audio watermark during playback' : 'Music plan active · clean playback';
    return context;
  }
  say(message, error = false) {
    this.notice.textContent = message;
    this.notice.setAttribute('role', error ? 'alert' : 'status');
  }
  async run(action) {
    if (this.busy) return;
    this.busy = true; this.dialog.setAttribute('aria-busy', 'true'); this.lock();
    try { await action(); }
    catch (error) { if (this.pendingTake) this.render(); this.say(error?.message || 'This action could not finish. Your existing project is unchanged.', true); }
    finally {
      this.busy = false; this.dialog.removeAttribute('aria-busy'); this.lock(); this.updateGuide();
      if (this.focusAfterRun?.isConnected && !this.focusAfterRun.disabled) this.focusAfterRun.focus({ preventScroll: true });
      this.focusAfterRun = null;
    }
  }
  lock() {
    const recording = this.recorder.state !== 'idle';
    for (const node of this.dialog.querySelectorAll('button, input, select')) {
      const action = node.dataset.musicAction;
      if (action === 'cancel-request') { node.disabled = false; continue; }
      node.disabled = this.busy || (recording && !['record', 'next'].includes(action)) || node.dataset.unavailable === 'true';
    }
  }
  change(action) {
    this.stopBeatPreview();
    if (this.transport?.playing) this.position = this.transport.current(); this.transport?.stop();
    this.history.change(action); this.revision++; this.render(); this.autosave();
  }
  mixChange(action) {
    this.history.change(action);
    for (const track of this.session.tracks) this.transport?.updateTrack(track);
    this.transport?.updateMaster(this.session.masterDb);
    this.revision++; this.render(); this.autosave();
  }
  autosave() {
    const revision = this.revision;
    let snapshot;
    try { snapshot = projectSnapshot(this.session, this.sources); }
    catch (error) { this.saveError = true; this.say(error.message, true); this.updateGuide(); return; }
    this.store.save(snapshot).then(() => {
      this.savedRevision = Math.max(this.savedRevision, revision); this.saveError = false;
      this.say('Saved on this device. Save project also makes a portable backup.'); this.updateGuide();
    }).catch(error => { this.saveError = true; this.say(error.message, true); this.updateGuide(); });
  }
  async decode(blob, name, id = crypto.randomUUID(), already = 0) {
    if (!blob.size || blob.size > 64 * 1024 * 1024) throw new Error('Choose an audio file smaller than 64 MB. Your current song is unchanged.');
    const context = await this.audio();
    let buffer;
    try { buffer = await context.decodeAudioData(await blob.arrayBuffer()); }
    catch { throw new Error(`“${String(name).slice(0, 120)}” could not be opened as audio. Try a WAV, MP3, or another supported audio file.`); }
    const bytes = buffer.length * buffer.numberOfChannels * 4;
    if (buffer.duration < 0.001 || buffer.duration > 7200 || bytes + already > MAX_DECODED) throw new Error('This audio is too large for the current browser session. Try a shorter file. Your current song is unchanged.');
    return { id, name: String(name).slice(0, 120), blob, buffer, bytes };
  }
  async importFiles(files) {
    if (this.session.tracks.length + files.length > 32) throw new Error('This workspace currently supports 32 tracks. Save this song before starting another project.');
    this.say('Opening your audio…');
    let bytes = [...this.sources.values()].reduce((sum, s) => sum + s.bytes, 0);
    const decoded = [];
    for (const file of files) {
      if (!supportedLocalAudio(file)) throw new Error('Choose an audio file, not a playlist link or protected subscription download.');
      const source = await this.decode(file, file.name, undefined, bytes); bytes += source.bytes; decoded.push(source);
    }
    // Decode the entire batch first: an unsupported file cannot partially edit a song.
    this.transport?.stop();
    for (const source of decoded) this.sources.set(source.id, source);
    this.change(s => {
      for (const source of decoded) {
        const track = createTrack(source.name); track.clips.push(createClip(source.id, source.buffer.duration)); s.tracks.push(track);
      }
    });
    this.say('Your audio is ready. Press Play to hear the parts together.');
  }
  async restore(snapshot) {
    const session = validateSession(snapshot.session);
    const sources = new Map(); let bytes = 0;
    this.say('Opening the saved project…');
    for (const raw of snapshot.audio) {
      const source = await this.decode(raw.blob, raw.name, raw.id, bytes); bytes += source.bytes; sources.set(source.id, source);
    }
    verifyAudioSources(session, sources);
    // Keep the old project in a portable file before replacing this workspace.
    if (this.session.tracks.length) this.saveProject();
    this.transport?.stop(); this.sources.clear(); for (const [id, source] of sources) this.sources.set(id, source);
    this.history = new SessionHistory(session); this.position = 0; this.revision++;
    this.editBeatTrack = null; this.editInstrumentTrack = null;
    this.render(); this.autosave(); this.say('Project opened. Your audio and edits are ready.');
  }
  saveProject() {
    downloadBlob(packProject(projectSnapshot(this.session, this.sources)), `${safeName(this.session.name)}.mlxmusic`);
    this.say('Project download started. Keep that file to reopen your song and its original audio.');
  }
  async record() {
    this.stopBeatPreview();
    if (this.recordStarted !== null && this.recordStarted !== undefined) {
      this.transport?.stop(); this.stopCountIn?.(); this.stopCountIn = null;
      this.say('Finishing your recording…');
      const blob = await this.recorder.stop();
      const recordingError = this.recorder.error; this.recorder.error = null;
      this.recordStarted = null; this.position = this.recordAt;
      if (blob?.size) {
        // Preserve the take if decoding or storage fails.
        this.pendingTake = blob;
        const used = [...this.sources.values()].reduce((sum, s) => sum + s.bytes, 0);
        const source = await this.decode(blob, `Recording ${this.session.tracks.length + 1}`, undefined, used);
        this.sources.set(source.id, source);
        this.change(s => { const track = createTrack(source.name); track.clips.push(createClip(source.id, source.buffer.duration, this.recordAt)); s.tracks.push(track); });
        this.pendingTake = null;
        this.say(recordingError?.message || 'Recording added. Play it with your other parts. Use Move or trim if your microphone timing needs adjusting.', !!recordingError);
      } else {
        this.say(recordingError?.message || 'Recording cancelled before any audio was captured. Your song is unchanged.', !!recordingError);
      }
      this.render(); return;
    }
    if (this.pendingTake) throw new Error('Save your unprocessed recording before making another take.');
    if (this.session.tracks.length >= 32) throw new Error('This song has reached the current 32-track limit.');
    if (this.transport?.playing) this.position = this.transport.current(); this.transport?.stop();
    await this.preparePlayback(); this.recordAt = this.position;
    const used = [...this.sources.values()].reduce((sum, s) => sum + s.bytes, 0);
    const seconds = Math.min(600, 7200 - this.recordAt, Math.floor((MAX_DECODED - used) / 8 / this.context.sampleRate), Math.floor((64 * 1024 * 1024 - 44) / 2 / this.context.sampleRate));
    if (seconds < 1) throw new Error('There is not enough room for another take. Save this project before starting a new song.');
    this.say('Allow microphone access when your browser asks.');
    const cancel = button('Cancel microphone request', 'cancel-request'); this.content.append(cancel);
    try { await this.recorder.prepare(this.context); }
    catch (error) { throw new Error(microphoneHelp(error)); }
    finally { cancel.remove(); }
    if (this.recorder.state !== 'ready') return;
    try {
      const beats = this.countBeats || 0;
      const when = Math.ceil((this.context.currentTime + 0.2 + beats * 60 / this.session.tempo) * this.context.sampleRate) / this.context.sampleRate;
      if (this.recordBacking && sessionDuration(this.session) > this.recordAt) await this.transport.play(this.session, this.recordAt, { when, loop: false });
      this.recordStarted = this.recorder.startAt(when, { maxFrames: Math.floor(seconds * this.context.sampleRate) });
      this.stopCountIn = countIn(this.context, when, this.session.tempo, beats);
      this.render(); this.say(`Use headphones. ${beats ? 'Wait for the count-in, then perform.' : 'Recording is starting.'} Choose Finish recording when done. This take can last up to ${Math.floor(seconds / 60)} minutes ${Math.round(seconds % 60)} seconds.`);
    } catch (error) { this.transport.stop(); this.stopCountIn?.(); await this.recorder.stop(); this.recordStarted = null; throw error; }
  }
  async action(action, target) {
    if (action === 'next') return this.action(this.guideState.action);
    if (action === 'close') {
      if (this.recorder.state !== 'idle') throw new Error('Choose Finish recording before closing so your take can be kept.');
      this.dialog.close(); return;
    }
    if (action === 'import') return this.audioInput.click();
    if (action === 'open') return this.projectInput.click();
    if (action === 'save') return this.saveProject();
    if (action === 'recover') { const snapshot = await this.store.latest(); if (!snapshot) throw new Error('There is no saved Music project on this device yet. Choose Add audio or Open project to begin.'); return this.restore(snapshot); }
    if (action === 'take') { if (this.pendingTake) { downloadBlob(this.pendingTake, `recording.${this.pendingTake.type.includes('wav') ? 'wav' : this.pendingTake.type.includes('mp4') ? 'm4a' : 'webm'}`); this.pendingTake = null; this.render(); } return; }
    if (action === 'backing') { this.recordBacking = !this.recordBacking; this.render(); return; }
    if (action === 'count-in') { this.countBeats = this.countBeats ? 0 : 4; this.render(); return; }
    if (action === 'loop') { this.change(s => s.loop.enabled = !s.loop.enabled); return; }
    if (action === 'mono') { await this.audio(); this.transport.monitorMono(!this.transport.mono); this.render(); return; }
    if (action === 'record') return this.record();
    if (action === 'beat-preset') { this.change(s => s.beat = beatPreset(target.dataset.preset)); return; }
    if (action === 'beat-step') {
      this.change(s => { const row = s.beat.rows.find(r => r.id === target.dataset.drum), step = Number(target.dataset.step); row.steps[step] = row.steps[step] ? 0 : 1; }); return;
    }
    if (action === 'beat-listen') return this.listenBeat();
    if (action === 'beat-add') return this.addBeat();
    if (action === 'beat-new') { this.editBeatTrack = null; this.render(); return; }
    if (action === 'instrument-voice') { this.change(s => s.instrument.voice = target.dataset.voice); return; }
    if (action === 'instrument-preset') {
      this.change(s => { const sample = s.instrument.sample; s.instrument = instrumentPreset(target.dataset.preset, s.instrument.voice); s.instrument.sample = sample; }); return;
    }
    if (action === 'instrument-note') { this.change(s => addInstrumentNotes(s.instrument, { pitch: this.notePitch, step: this.noteStep, length: Math.min(this.noteLength, 16 - this.noteStep), chord: target.dataset.chord })); return; }
    if (action === 'instrument-remove') { this.change(s => s.instrument.notes = s.instrument.notes.filter(n => n.id !== target.dataset.note)); return; }
    if (action === 'instrument-key') { this.notePitch = Number(target.dataset.pitch); return this.listenInstrument(this.notePitch); }
    if (action === 'instrument-listen') return this.listenInstrument();
    if (action === 'instrument-add') return this.addInstrument();
    if (action === 'instrument-new') { this.editInstrumentTrack = null; this.render(); return; }
    if (action === 'instrument-sample') { const source = this.sources.get(target.dataset.source); if (!source) throw new Error('Add an audio file first.'); this.change(s => { s.instrument.voice = 'sampler'; s.instrument.sample = { sourceId: source.id, rootNote: 60, offset: 0, duration: Math.min(3, source.buffer.duration) }; }); return; }
    if (action === 'play') {
      this.stopBeatPreview();
      if (this.transport?.playing) { this.position = this.transport.current(); this.transport.stop(); }
      else { await this.preparePlayback(); if (this.position >= sessionDuration(this.session)) this.position = 0; await this.transport.play(this.session, this.position); }
      this.render(); return;
    }
    if (action === 'start') { this.transport?.stop(); this.position = 0; this.render(); return; }
    if (action === 'undo' || action === 'redo') {
      this.transport?.stop(); if (this.history[action]()) { this.revision++; this.render(); this.autosave(); } return;
    }
    if (action === 'guided' || action === 'advanced') { this.change(s => s.mode = action); return; }
    const trackId = target?.closest('[data-track]')?.dataset.track;
    const clipId = target?.closest('[data-clip]')?.dataset.clip;
    if (action === 'edit-generated') {
      const track = this.session.tracks.find(t => t.id === trackId); if (!track?.generated) throw new Error('Choose a generated part first.');
      const { kind, pattern } = track.generated;
      if (kind === 'beat') this.editBeatTrack = trackId; else this.editInstrumentTrack = trackId;
      this.change(s => s[kind === 'beat' ? 'beat' : 'instrument'] = structuredClone(pattern));
      const section = [...this.content.querySelectorAll('details[data-section]')].find(d => d.dataset.section === (kind === 'beat' ? 'beat-maker' : 'instruments'));
      if (section) { section.open = true; this.focusAfterRun = section.querySelector('summary'); section.scrollIntoView({ block: 'nearest' }); }
      this.say('Pattern opened for editing. Update the part when ready; Undo can restore its previous audio. Updates use the current Beat speed.'); return;
    }
    if (action === 'mix-starter' || action === 'bypass' || action === 'polarity') {
      this.mixChange(s => {
        const track = s.tracks.find(t => t.id === trackId); if (!track) throw new Error('Choose a track first.');
        if (action === 'mix-starter') applyMixStarter(track, target.dataset.preset); else track[action] = !track[action];
      }); return;
    }
    this.change(s => {
      const track = s.tracks.find(t => t.id === trackId);
      if (!track) throw new Error('Choose a track first.');
      if (action === 'mute' || action === 'solo') track[action] = !track[action];
      if (action === 'duplicate') duplicateClip(track, clipId);
      if (action === 'split') splitClip(track, clipId, this.position);
      if (action === 'remove') track.clips = track.clips.filter(c => c.id !== clipId);
      if (action === 'remove-track') s.tracks = s.tracks.filter(t => t.id !== trackId);
    });
  }
  field(parent, label, value, change, { min, max, step = 0.1, type = 'number' } = {}) {
    const wrap = el('label', undefined, 'music-field'); wrap.append(el('span', label));
    const input = el('input'); input.type = type; input.value = value;
    input.dataset.musicField = label;
    if (min !== undefined) input.min = min; if (max !== undefined) input.max = max; input.step = step;
    input.addEventListener('change', () => this.run(() => {
      if (!input.checkValidity() || (type === 'number' && !Number.isFinite(input.valueAsNumber))) throw new Error(`Check “${label}” and choose a value between ${min} and ${max}.`);
      return change(type === 'number' ? input.valueAsNumber : input.value);
    }));
    wrap.append(input); parent.append(wrap); return input;
  }
  render() {
    const focused = document.activeElement;
    const focus = focused && this.dialog.contains(focused) ? {
      action: focused.dataset.musicAction, field: focused.dataset.musicField,
      track: focused.closest('[data-track]')?.dataset.track,
      clip: focused.closest('[data-clip]')?.dataset.clip,
      drum: focused.dataset.drum, step: focused.dataset.step, preset: focused.dataset.preset,
      voice: focused.dataset.voice, pitch: focused.dataset.pitch, chord: focused.dataset.chord, note: focused.dataset.note, source: focused.dataset.source
    } : null;
    const openDetails = new Set([...this.content.querySelectorAll('details[data-section]')].filter(d => d.open).map(d => d.dataset.section));
    const s = this.session, advanced = s.mode === 'advanced'; this.content.replaceChildren();
    this.previewLabel = el('p', this.playbackPolicy?.watermarked === false ? 'Music plan active · clean playback' : 'Free preview · audio watermark during playback', 'music-notice'); this.content.append(this.previewLabel);
    const modes = el('div', undefined, 'seg'); modes.setAttribute('aria-label', 'Music editing mode'); modes.setAttribute('role', 'group');
    for (const mode of ['guided', 'advanced']) { const b = button(mode === 'guided' ? 'Guided' : 'Advanced', mode); b.classList.toggle('on', mode === s.mode); b.setAttribute('aria-pressed', String(mode === s.mode)); modes.append(b); }
    this.content.append(modes);
    this.guide = el('section', undefined, 'music-guide'); this.guide.hidden = advanced;
    this.guideTitle = el('h3'); this.guideText = el('p'); this.guideNext = button('', 'next', true);
    this.guide.append(this.guideTitle, this.guideText, this.guideNext); this.content.append(this.guide);
    const project = el('div', undefined, 'music-controls');
    this.field(project, 'Song name', s.name, value => this.change(song => song.name = value), { type: 'text' });
    for (const [label, action] of [['Add audio', 'import'], ['Open project', 'open'], ['Recover last save', 'recover'], ['Save project', 'save']]) project.append(button(label, action));
    this.content.append(project);
    const transport = el('div', undefined, 'music-controls');
    const hasAudio = sessionDuration(s) > 0;
    for (const [label, action, unavailable] of [
      [this.transport?.playing ? 'Pause' : 'Play', 'play', !hasAudio], ['Back to start', 'start', false],
      [this.recordStarted !== null ? 'Finish recording' : 'Record microphone', 'record', !!this.pendingTake],
      ['Undo', 'undo', !this.history.undoStack.length], ['Redo', 'redo', !this.history.redoStack.length]
    ]) { const b = button(label, action); b.dataset.unavailable = String(unavailable); transport.append(b); }
    this.clockLabel = el('output', timeText(this.position)); this.clockLabel.setAttribute('aria-label', 'Playback position'); transport.append(this.clockLabel);
    this.content.append(transport);
    this.seek = this.field(this.content, 'Start listening at (seconds)', this.position.toFixed(1), value => { this.transport?.stop(); this.position = value; this.render(); }, { min: 0, max: Math.max(0, sessionDuration(s)) });
    const levels = el('div', undefined, 'music-controls');
    this.volumeField(levels, 'Song volume', s.masterDb, value => this.mixChange(song => song.masterDb = value), advanced, 6);
    this.field(levels, advanced ? 'Tempo (BPM)' : 'Beat speed (beats per minute)', s.tempo, value => this.change(song => song.tempo = value), { min: 40, max: 240, step: 1 });
    this.content.append(levels);
    const mono = button('Listen in mono', 'mono'); mono.setAttribute('aria-pressed', String(!!this.transport?.mono)); this.content.append(mono);
    this.content.append(el('p', 'Mono combines left and right for a listening check. It does not change your saved mix or delivery format.', 'music-note'));
    const recording = el('details'); recording.open = advanced; recording.append(el('summary', 'Recording setup'));
    recording.dataset.section = 'recording';
    recording.append(el('p', 'Use headphones to keep your beat out of the microphone. The microphone is recorded separately, so you can adjust your voice afterwards.'));
    for (const [label, action, on] of [['Hear existing parts while recording', 'backing', this.recordBacking], ['Four-beat count-in', 'count-in', !!this.countBeats]]) {
      const b = button(label, action); b.setAttribute('aria-pressed', String(on)); recording.append(b);
    }
    recording.append(el('p', 'The count-in follows Beat speed. Recording runs forward even when playback repeat is on. Device delay can require moving your recorded part slightly after listening.'));
    this.content.append(recording);
    const looping = el('details'); looping.open = advanced; looping.append(el('summary', 'Repeat a section while listening'));
    looping.dataset.section = 'looping';
    const loopButton = button('Repeat section', 'loop'); loopButton.setAttribute('aria-pressed', String(s.loop.enabled)); looping.append(loopButton);
    this.field(looping, 'Repeat from (seconds)', s.loop.start, value => this.change(song => { if (value >= song.loop.end) throw new Error('The repeat start must be before its end.'); song.loop.start = value; }), { min: 0, max: 7199, step: 0.01 });
    this.field(looping, 'Repeat until (seconds)', s.loop.end, value => this.change(song => { if (value <= song.loop.start) throw new Error('The repeat end must be after its start.'); song.loop.end = value; }), { min: 0.01, max: 7200, step: 0.01 });
    this.content.append(looping);
    this.content.append(this.beatView(advanced));
    this.content.append(this.instrumentView(advanced));
    if (!hasAudio) this.content.append(el('p', 'Add your own audio or record a microphone to start. Imported files become separate parts that play together.'));
    for (const track of s.tracks) this.content.append(this.trackView(track, advanced));
    if (this.pendingTake) this.content.append(button('Save unprocessed recording', 'take'));
    this.content.append(el('p', 'Save project keeps your editable song on this device. Finished-song delivery and streaming-library connections are not enabled in this development workspace.', 'music-note'));
    for (const detail of this.content.querySelectorAll('details[data-section]')) if (openDetails.has(detail.dataset.section)) detail.open = true;
    this.updateGuide(); this.lock();
    if (focus?.action || focus?.field) {
      const same = [...this.dialog.querySelectorAll('button, input, select')].find(node =>
        (focus.action ? node.dataset.musicAction === focus.action : node.dataset.musicField === focus.field) &&
        node.closest('[data-track]')?.dataset.track === focus.track && node.closest('[data-clip]')?.dataset.clip === focus.clip &&
        ['drum', 'step', 'preset', 'voice', 'pitch', 'chord', 'note', 'source'].every(key => node.dataset[key] === focus[key]));
      this.focusAfterRun = same || this.guideNext;
      if (!this.busy && !this.focusAfterRun.disabled) this.focusAfterRun.focus({ preventScroll: true });
    }
  }
  stopBeatPreview() {
    clearTimeout(this.previewEnd);
    const source = this.beatPreview; this.beatPreview = null;
    if (source) { source.onended = null; try { source.stop(); } catch { /* Ended already. */ } source.disconnect(); this.previewLevel?.disconnect(); this.previewLevel = null; this.output?.stop(); }
  }
  async listenBeat() {
    if (this.beatPreview) { this.stopBeatPreview(); this.render(); return; }
    this.transport?.stop(); const context = await this.preparePlayback();
    const rendered = renderBeat({ ...this.session.beat, bars: 1 }, this.session.tempo, context.sampleRate);
    this.previewSamples(rendered.samples, context);
    this.render(); this.say('Listening to one bar. Turn steps on or off, then add the beat to your song.');
  }
  previewSamples(samples, context) {
    this.stopBeatPreview();
    const buffer = context.createBuffer(1, samples.length, context.sampleRate); buffer.getChannelData(0).set(samples);
    const source = context.createBufferSource(); source.buffer = buffer;
    const level = context.createGain(); level.gain.value = 0.5; this.previewLevel = level;
    source.connect(level).connect(this.output?.input || context.destination); this.beatPreview = source;
    const started = context.currentTime; this.output?.start(started);
    source.onended = () => { source.disconnect(); level.disconnect(); if (this.beatPreview === source) {
      this.previewEnd = setTimeout(() => { if (this.beatPreview === source) { this.beatPreview = null; this.previewLevel = null; this.output?.stop(); this.render(); } }, Math.max(0, ((this.output?.minimumSeconds || 0) - (context.currentTime - started)) * 1000));
    } };
    source.start();
  }
  async addBeat() {
    const editing = this.session.tracks.find(t => t.id === this.editBeatTrack);
    if (!editing && this.session.tracks.length >= 32) throw new Error('This workspace currently supports 32 tracks. Save the project before starting another song.');
    const context = await this.audio();
    const at = this.transport.playing ? this.transport.current() : this.position;
    const rendered = renderBeat(this.session.beat, this.session.tempo, context.sampleRate);
    if (!editing && at + rendered.seconds > 7200) throw new Error('Move the listening position earlier so the beat fits within the project.');
    const blob = encodeWav([rendered.samples], context.sampleRate, 16);
    const used = [...this.sources.values()].reduce((sum, source) => sum + source.bytes, 0);
    const source = await this.decode(blob, `Beat — ${this.session.tempo} BPM`, undefined, used);
    this.commitGeneratedSource(source, 'beat', this.session.beat, at, editing?.id);
    this.say(editing ? 'Beat updated, including its repeats. Clip positions and mix settings were kept. Play it to check the changes; Undo restores the previous version.' : 'Beat added as a new part. Go to its start and choose Record microphone to perform over it. Use Edit pattern on the track to change its drums later.');
  }
  beatView(advanced) {
    const section = el('details'); section.dataset.section = 'beat-maker'; section.open = advanced;
    section.append(el('summary', 'Make a beat'));
    section.append(el('p', 'Choose a starter or turn on numbered steps. Each row is a drum; 16 steps make one bar. Beat speed controls the tempo. Your pattern is saved with the project.'));
    const starters = el('div', undefined, 'music-controls');
    for (const [preset, label] of [['rap', 'Rap starter'], ['dance', 'Dance starter'], ['empty', 'Clear pattern']]) { const b = button(label, 'beat-preset'); b.dataset.preset = preset; starters.append(b); }
    section.append(starters);
    const customize = el('details'); customize.dataset.section = 'custom-drums'; customize.open = advanced; customize.append(el('summary', 'Change individual drum hits'));
    for (const row of this.session.beat.rows) {
      const drum = DRUMS.find(d => d.id === row.id), group = el('div', undefined, 'music-drum');
      group.setAttribute('role', 'group'); group.setAttribute('aria-label', drum.name); group.append(el('p', drum.name));
      const steps = el('div', undefined, 'music-steps');
      row.steps.forEach((velocity, index) => {
        const b = button(String(index + 1), 'beat-step'); b.dataset.drum = row.id; b.dataset.step = String(index);
        b.setAttribute('aria-label', `${drum.name}, step ${index + 1}${velocity ? `, ${Math.round(velocity * 100)} percent` : ''}`);
        b.setAttribute('aria-pressed', String(velocity > 0)); steps.append(b);
      });
      group.append(steps);
      this.field(group, `${drum.name} volume (%)`, Math.round(row.level * 100), value => this.change(s => s.beat.rows.find(r => r.id === row.id).level = value / 100), { min: 0, max: 100, step: 1 });
      if (advanced) {
        const dynamics = el('details'); dynamics.dataset.section = `velocity-${row.id}`; dynamics.append(el('summary', `${drum.name} step strength`));
        row.steps.forEach((velocity, index) => this.field(dynamics, `${drum.name} step ${index + 1} strength (%)`, Math.round(velocity * 100), value => this.change(s => s.beat.rows.find(r => r.id === row.id).steps[index] = value / 100), { min: 0, max: 100, step: 1 }));
        group.append(dynamics);
      }
      customize.append(group);
    }
    section.append(customize);
    this.field(section, 'Swing (%; 0 is evenly spaced)', Math.round(this.session.beat.swing * 100), value => this.change(s => s.beat.swing = value / 100), { min: 0, max: 60, step: 1 });
    this.field(section, 'Bars to add', this.session.beat.bars, value => this.change(s => s.beat.bars = value), { min: 1, max: 32, step: 1 });
    const editing = this.session.tracks.find(t => t.id === this.editBeatTrack);
    const actions = el('div', undefined, 'music-controls'); actions.append(button(this.beatPreview ? 'Stop preview' : 'Listen to beat', 'beat-listen'), button(editing ? `Update ${editing.name}` : 'Add beat as a new part', 'beat-add', true));
    if (editing) actions.append(button('Keep original and add a new part instead', 'beat-new')); section.append(actions);
    section.append(el('p', 'The part uses the current Beat speed when added or updated. Updates keep clip positions, so listen for overlaps if you change its length. Undo restores the previous version.'));
    return section;
  }
  async listenInstrument(pitch = null) {
    this.stopBeatPreview(); this.transport?.stop(); const context = await this.preparePlayback();
    let pattern = { ...this.session.instrument, bars: 1 };
    if (pitch !== null) { pattern = { ...pattern, notes: [] }; addInstrumentNotes(pattern, { pitch, length: 4 }); }
    const result = renderInstrument(pattern, this.session.tempo, context.sampleRate, this.sources);
    this.previewSamples(result.samples, context); this.render();
    this.say(pitch === null ? 'Listening to one bar of your instrument part. Add it to the song when you like it.' : `This is ${noteName(pitch)}. Choose Add note or a chord to place it in the pattern.`);
  }
  async addInstrument() {
    const editing = this.session.tracks.find(t => t.id === this.editInstrumentTrack);
    if (!editing && this.session.tracks.length >= 32) throw new Error('This workspace currently supports 32 tracks. Save the project before starting another song.');
    const context = await this.audio(), at = this.transport.playing ? this.transport.current() : this.position;
    const result = renderInstrument(this.session.instrument, this.session.tempo, context.sampleRate, this.sources);
    if (!editing && at + result.seconds > 7200) throw new Error('Move the listening position earlier so the instrument part fits.');
    const name = INSTRUMENTS.find(i => i.id === this.session.instrument.voice).name;
    const used = [...this.sources.values()].reduce((sum, source) => sum + source.bytes, 0);
    const source = await this.decode(encodeWav([result.samples], context.sampleRate, 16), `${name} — ${this.session.tempo} BPM`, undefined, used);
    this.commitGeneratedSource(source, 'instrument', this.session.instrument, at, editing?.id);
    this.say(editing ? 'Instrument updated. Clip positions and mix settings were kept. Play the song to check it; Undo restores the previous audio and notes.' : 'Instrument added as a new part. Play the song to hear it with your beat and recordings. Use Edit pattern on the track to change its notes or sound later.');
  }
  commitGeneratedSource(source, kind, pattern, at, trackId) {
    this.sources.set(source.id, source);
    try {
      this.change(s => {
        if (trackId) { const track = s.tracks.find(t => t.id === trackId); if (!track) throw new Error('The part to update is no longer in the song.'); replaceGeneratedPart(track, source.id, source.buffer.duration, pattern, s.tempo); }
        else {
          const track = createTrack(source.name); track.clips.push(createClip(source.id, source.buffer.duration, at));
          track.generated = { kind, sourceId: source.id, duration: source.buffer.duration, pattern: structuredClone(pattern), tempo: s.tempo }; s.tracks.push(track);
        }
      });
    } catch (error) { this.sources.delete(source.id); throw error; }
  }
  selectField(parent, label, value, options, change) {
    const wrap = el('label', undefined, 'music-field'); wrap.append(el('span', label));
    const select = el('select'); select.dataset.musicField = label; select.setAttribute('aria-label', label);
    for (const [id, name] of options) { const option = el('option', name); option.value = id; select.append(option); }
    select.value = value; select.addEventListener('change', () => this.run(() => change(select.value)));
    wrap.append(select); parent.append(wrap); return select;
  }
  instrumentView(advanced) {
    const section = el('details'); section.dataset.section = 'instruments'; section.open = advanced;
    section.append(el('summary', 'Play keys and instruments'));
    section.append(el('p', 'Choose a sound, try a starter, then listen. Add the part to your song when it sounds right. Built-in instrument sounds are synthesized; Your sample plays audio you import.'));
    this.selectField(section, 'Instrument sound', this.session.instrument.voice, INSTRUMENTS.map(i => [i.id, i.name]), value => this.change(s => s.instrument.voice = value));
    const starters = el('div', undefined, 'music-controls');
    for (const [preset, label] of [['chords', 'Start with chords'], ['bassline', 'Start with a bassline'], ['melody', 'Start with a melody'], ['empty', 'Clear notes']]) { const b = button(label, 'instrument-preset'); b.dataset.preset = preset; starters.append(b); }
    section.append(starters);
    const keys = el('details'); keys.dataset.section = 'instrument-keys'; keys.open = advanced; keys.append(el('summary', 'Try notes and write your own part'));
    const keyboard = el('div', undefined, 'music-keys'); keyboard.setAttribute('role', 'group'); keyboard.setAttribute('aria-label', 'Listen to notes');
    for (let pitch = 60; pitch <= 72; pitch++) { const b = button(noteName(pitch), 'instrument-key'); b.dataset.pitch = String(pitch); b.setAttribute('aria-label', `Listen to ${noteName(pitch)}`); b.setAttribute('aria-pressed', String(pitch === this.notePitch)); keyboard.append(b); }
    keys.append(keyboard);
    this.selectField(keys, 'Note to add', String(this.notePitch), Array.from({ length: 73 }, (_, i) => [String(i + 24), noteName(i + 24)]), value => { this.notePitch = Number(value); this.render(); });
    this.field(keys, 'Starts at step (1–16)', this.noteStep + 1, value => { this.noteStep = value - 1; this.render(); }, { min: 1, max: 16, step: 1 });
    this.field(keys, 'Hold for this many steps', this.noteLength, value => { this.noteLength = value; this.render(); }, { min: 1, max: 16, step: 1 });
    const add = el('div', undefined, 'music-controls');
    for (const [chord, label] of [['single', 'Add note'], ['major', 'Add major chord'], ['minor', 'Add minor chord'], ['seventh', 'Add seventh chord']]) { const b = button(label, 'instrument-note'); b.dataset.chord = chord; add.append(b); }
    keys.append(add, el('p', 'A chord plays several notes together. There are 16 steps in one bar. Notes stop at the end of the bar, and Undo restores your last change.'));
    section.append(keys);
    const notes = el('details'); notes.dataset.section = 'instrument-notes'; notes.open = advanced; notes.append(el('summary', `Edit the ${this.session.instrument.notes.length} notes in this pattern`));
    for (const [index, note] of this.session.instrument.notes.entries()) {
      const row = el('div', undefined, 'music-controls'); row.append(el('span', `${noteName(note.pitch)} · step ${note.step + 1} · ${note.length} steps long`));
      const remove = button(`Remove ${noteName(note.pitch)} at step ${note.step + 1}`, 'instrument-remove'); remove.dataset.note = note.id; row.append(remove);
      const set = (key, value) => this.change(s => { const n = s.instrument.notes.find(n => n.id === note.id); n[key] = value; if (key === 'step') n.length = Math.min(n.length, 16 - n.step); });
      this.selectField(row, `Note ${index + 1}: pitch`, String(note.pitch), Array.from({ length: 73 }, (_, i) => [String(i + 24), noteName(i + 24)]), value => set('pitch', Number(value)));
      this.field(row, `Note ${index + 1}: start step`, note.step + 1, value => set('step', value - 1), { min: 1, max: 16, step: 1 });
      this.field(row, `Note ${index + 1}: length in steps`, note.length, value => set('length', value), { min: 1, max: 16 - note.step, step: 1 });
      this.field(row, `Note ${index + 1}: strength (%)`, Math.round(note.velocity * 100), value => set('velocity', value / 100), { min: 1, max: 100, step: 1 });
      notes.append(row);
    }
    section.append(notes);
    if (this.session.instrument.voice === 'sampler') {
      const sample = this.session.instrument.sample;
      section.append(el('p', 'Add your own instrument recording with Add audio, then choose it here. Set its original note so higher and lower notes play at the right pitch.'));
      for (const source of this.sources.values()) { const b = button(`Use ${source.name}`, 'instrument-sample'); b.dataset.source = source.id; b.setAttribute('aria-pressed', String(sample?.sourceId === source.id)); section.append(b); }
      if (sample) {
        this.selectField(section, 'Original note of your sample', String(sample.rootNote), Array.from({ length: 73 }, (_, i) => [String(i + 24), noteName(i + 24)]), value => this.change(s => s.instrument.sample.rootNote = Number(value)));
        const source = this.sources.get(sample.sourceId);
        this.field(section, 'Sample starts at (seconds)', sample.offset, value => this.change(s => { s.instrument.sample.offset = value; s.instrument.sample.duration = Math.min(s.instrument.sample.duration, source.buffer.duration - value); }), { min: 0, max: source.buffer.duration - 0.001, step: 0.001 });
        this.field(section, 'Sample length (seconds)', sample.duration, value => this.change(s => s.instrument.sample.duration = value), { min: 0.001, max: Math.min(30, source.buffer.duration - sample.offset), step: 0.001 });
      }
    }
    this.field(section, 'Instrument bars to add', this.session.instrument.bars, value => this.change(s => s.instrument.bars = value), { min: 1, max: 32, step: 1 });
    const editing = this.session.tracks.find(t => t.id === this.editInstrumentTrack);
    const actions = el('div', undefined, 'music-controls'); actions.append(button('Listen to instrument part', 'instrument-listen'), button(editing ? `Update ${editing.name}` : 'Add instrument as a new part', 'instrument-add', true));
    if (editing) actions.append(button('Keep original and add a new part instead', 'instrument-new')); section.append(actions);
    return section;
  }
  trackView(track, advanced) {
    const section = el('section', undefined, 'music-track'); section.dataset.track = track.id;
    const header = el('div', undefined, 'music-controls'); header.append(el('h3', track.name));
    if (track.generated) header.append(button('Edit pattern', 'edit-generated'));
    for (const [label, action] of [['Mute', 'mute'], ['Only this part', 'solo'], ['Compare without effects', 'bypass']]) { const b = button(label, action); b.setAttribute('aria-pressed', String(track[action])); header.append(b); }
    if (advanced) { const b = button('Invert polarity', 'polarity'); b.setAttribute('aria-pressed', String(track.polarity)); header.append(b); }
    section.append(header);
    const controls = el('div', undefined, 'music-controls');
    const set = (key, value) => this.mixChange(s => s.tracks.find(t => t.id === track.id)[key] = value);
    this.field(controls, 'Part name', track.name, value => this.change(s => s.tracks.find(t => t.id === track.id).name = value), { type: 'text' });
    this.volumeField(controls, 'Part volume', track.gainDb, value => set('gainDb', value), advanced, 12);
    const more = el('details'); more.open = advanced; more.append(el('summary', 'Adjust the sound'));
    more.dataset.section = `sound-${track.id}`;
    more.append(el('p', 'Choose a starting point, then listen and adjust it for your recording. Compare without effects keeps your volume and stereo balance. Undo restores the previous settings.'));
    const starters = el('div', undefined, 'music-controls');
    for (const [preset, { label }] of Object.entries(MIX_STARTERS)) { const b = button(label, 'mix-starter'); b.dataset.preset = preset; starters.append(b); }
    more.append(starters);
    more.append(el('p', 'Start at zero for the original sound. Warmth changes low sounds; presence changes the middle; brightness changes high sounds.'));
    for (const [key, label, min, max, step] of [
      ['lowDb', advanced ? 'Low shelf (dB)' : 'Warmth (less −18, more 18)', -18, 18, 1],
      ['midDb', advanced ? 'Mid EQ (dB)' : 'Presence (less −18, more 18)', -18, 18, 1],
      ['highDb', advanced ? 'High shelf (dB)' : 'Brightness (less −18, more 18)', -18, 18, 1],
      ['pan', 'Left / right balance (−1 left, 1 right)', -1, 1, 0.1],
      ['compression', 'Even out loud and quiet moments (0–1)', 0, 1, 0.1],
      ['room', 'Room sound (0–1)', 0, 1, 0.1], ['delay', 'Echo (0–1)', 0, 1, 0.1]
    ]) this.field(more, label, track[key], value => set(key, value), { min, max, step });
    section.append(controls, more);
    for (const clip of track.clips) {
      const part = el('div', undefined, 'music-clip'); part.dataset.clip = clip.id;
      part.append(el('p', `${timeText(clip.start)} – ${timeText(clip.start + clip.duration)}`));
      const wave = el('canvas'); wave.width = 600; wave.height = 48;
      wave.setAttribute('role', 'img'); wave.setAttribute('aria-label', `Audio waveform for ${track.name}`); this.waveform(wave, clip); part.append(wave);
      const edit = el('details'); edit.open = advanced; edit.append(el('summary', 'Move or trim this part'));
      edit.dataset.section = `edit-${clip.id}`;
      edit.append(el('p', 'Starts at moves the part in your song. Use from skips the beginning of the original audio. Length keeps only that much audio. Undo restores your previous edit.'));
      const source = this.sources.get(clip.sourceId);
      for (const [key, label, min, max] of [
        ['start', 'Starts at (seconds)', 0, 7199], ['offset', 'Use from (seconds)', 0, source.buffer.duration - 0.001],
        ['duration', 'Length (seconds)', 0.001, source.buffer.duration],
        ['fadeIn', 'Fade in (seconds)', 0, clip.duration / 2], ['fadeOut', 'Fade out (seconds)', 0, clip.duration / 2]
      ]) this.field(edit, label, Number(clip[key].toFixed(3)), value => this.change(s => {
        const t = s.tracks.find(item => item.id === track.id), index = t.clips.findIndex(c => c.id === clip.id);
        t.clips[index] = editClip(t.clips[index], { [key]: value }, source.buffer.duration);
      }), { min, max, step: 0.001 });
      const actions = el('div', undefined, 'music-controls');
      actions.append(button('Split at listening position', 'split'), button('Repeat this part', 'duplicate'), button('Remove part', 'remove'));
      edit.append(actions); part.append(edit); section.append(part);
    }
    section.append(button('Remove track (Undo restores it)', 'remove-track'));
    return section;
  }
  waveform(canvas, clip) {
    const audio = this.sources.get(clip.sourceId)?.buffer;
    const context = canvas.getContext('2d'); if (!audio || !context) return;
    const data = audio.getChannelData(0), first = Math.floor(clip.offset * audio.sampleRate), length = Math.floor(clip.duration * audio.sampleRate);
    context.strokeStyle = getComputedStyle(this.dialog).getPropertyValue('--gold').trim() || '#c9a86a';
    context.beginPath();
    for (let x = 0; x < canvas.width; x++) {
      let peak = 0; const from = first + Math.floor(x * length / canvas.width), to = first + Math.floor((x + 1) * length / canvas.width);
      for (let i = from; i < to; i += Math.max(1, Math.floor((to - from) / 32))) peak = Math.max(peak, Math.abs(data[i] || 0));
      context.moveTo(x, 24 - peak * 23); context.lineTo(x, 24 + peak * 23);
    }
    context.stroke();
  }
  volumeField(parent, label, db, change, advanced, max) {
    if (advanced) return this.field(parent, `${label} (dB)`, db, change, { min: -60, max, step: 1 });
    return this.field(parent, `${label} (%; 100 is original level)`, Math.round(100 * 10 ** (db / 20)), value => change(value <= 0 ? -60 : 20 * Math.log10(value / 100)), { min: 0, max: Math.round(100 * 10 ** (max / 20)), step: 1 });
  }
  updateGuide() {
    this.guideState = musicGuidance(this.session, { recording: this.recorder.state === 'recording', playing: this.transport?.playing, saveError: this.saveError });
    if (!this.guideTitle) return;
    if (this.recordStarted !== null && this.context?.currentTime < this.recordStarted) {
      this.guideState = { title: 'Get ready to record', text: 'Listen to the count-in, then start your song or rap. Choose Finish recording to cancel the take.', action: 'record', label: 'Finish recording' };
    }
    this.guideTitle.textContent = this.guideState.title; this.guideText.textContent = this.guideState.text;
    this.guideNext.textContent = this.guideState.label;
  }
  tick() {
    if (this.recordStarted !== null && this.recorder.state === 'stopping') { this.run(() => this.record()); return; }
    if (this.recorder.error) {
      clearTimeout(this.recordLimit); const error = this.recorder.error; this.recorder.error = null;
      this.render(); this.say(error.message, true); return;
    }
    if (this.recorder.state === 'recording') {
      const elapsed = this.context.currentTime - this.recordStarted;
      this.clockLabel.textContent = elapsed < 0 ? `Get ready: ${Math.ceil(-elapsed / (60 / this.session.tempo))}` : `Recording ${timeText(elapsed)}`;
      this.updateGuide();
    }
    else if (this.transport?.playing) {
      this.position = this.transport.current(); this.clockLabel.textContent = timeText(this.position);
      if (!this.session.loop.enabled && this.position >= sessionDuration(this.session)) { this.transport.stop(); this.render(); }
    }
  }
}

let studio;
export function openMusicStudio() { studio ||= new MusicStudio(); studio.open(); }
