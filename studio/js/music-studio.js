import { createSession, createTrack, createClip, editClip, splitClip, duplicateClip, SessionHistory, sessionDuration, validateSession } from './music-session.js';
import { MusicTransport, MusicRecorder, verifyAudioSources } from './music-audio.js';
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
    this.store = new MusicProjectStore(); this.recorder = new MusicRecorder();
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
      if (target?.dataset.musicAction === 'cancel-request') {
        this.recorder.stop(); this.say('Microphone request cancelled. You can dismiss the browser’s permission prompt.'); return;
      }
      if (target && !target.disabled) this.run(() => this.action(target.dataset.musicAction, target));
    });
    this.dialog.addEventListener('cancel', e => { e.preventDefault(); this.run(() => this.action('close')); });
    this.dialog.addEventListener('close', () => { this.transport?.stop(); clearInterval(this.clock); });
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
    this.render(); this.autosave(); this.say('Project opened. Your audio and edits are ready.');
  }
  saveProject() {
    downloadBlob(packProject(projectSnapshot(this.session, this.sources)), `${safeName(this.session.name)}.mlxmusic`);
    this.say('Project download started. Keep that file to reopen your song and its original audio.');
  }
  async record() {
    if (this.recorder.state === 'recording') {
      clearTimeout(this.recordLimit);
      this.say('Finishing your recording…');
      const blob = await this.recorder.stop();
      if (blob?.size) {
        // Preserve the take if decoding or storage fails.
        this.pendingTake = blob;
        const used = [...this.sources.values()].reduce((sum, s) => sum + s.bytes, 0);
        const source = await this.decode(blob, `Recording ${this.session.tracks.length + 1}`, undefined, used);
        this.sources.set(source.id, source);
        this.change(s => { const track = createTrack(source.name); track.clips.push(createClip(source.id, source.buffer.duration, this.recordAt)); s.tracks.push(track); });
        this.pendingTake = null;
        this.say('Recording added. Play it back, then use Move or trim if it needs adjusting.');
      }
      this.render(); return;
    }
    if (this.session.tracks.length >= 32) throw new Error('This song has reached the current 32-track limit.');
    await this.audio(); if (this.transport.playing) this.position = this.transport.current(); this.transport.stop(); this.recordAt = this.position;
    this.say('Allow microphone access when your browser asks.');
    const cancel = button('Cancel microphone request', 'cancel-request'); this.content.append(cancel);
    try { await this.recorder.start(); }
    catch (error) { throw new Error(microphoneHelp(error)); }
    finally { cancel.remove(); }
    if (this.recorder.state !== 'recording') return;
    this.recordStarted = performance.now();
    // A bounded take prevents uncontrolled memory growth in MediaRecorder.
    this.recordLimit = setTimeout(() => this.run(() => this.record()), 10 * 60 * 1000);
    this.render(); this.say('Recording. Use headphones. Choose Finish recording when you are done. Maximum take: 10 minutes.');
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
    if (action === 'take') { if (this.pendingTake) downloadBlob(this.pendingTake, `recording.${this.pendingTake.type.includes('mp4') ? 'm4a' : 'webm'}`); return; }
    if (action === 'record') return this.record();
    if (action === 'play') {
      await this.audio();
      if (this.transport.playing) { this.position = this.transport.current(); this.transport.stop(); }
      else { if (this.position >= sessionDuration(this.session)) this.position = 0; await this.transport.play(this.session, this.position); }
      this.render(); return;
    }
    if (action === 'start') { this.transport?.stop(); this.position = 0; this.render(); return; }
    if (action === 'undo' || action === 'redo') {
      this.transport?.stop(); if (this.history[action]()) { this.revision++; this.render(); this.autosave(); } return;
    }
    if (action === 'guided' || action === 'advanced') { this.change(s => s.mode = action); return; }
    const trackId = target?.closest('[data-track]')?.dataset.track;
    const clipId = target?.closest('[data-clip]')?.dataset.clip;
    this.change(s => {
      const track = s.tracks.find(t => t.id === trackId);
      if (!track) throw new Error('Choose a track first.');
      if (action === 'mute' || action === 'solo') track[action] = !track[action];
      if (action === 'duplicate') duplicateClip(track, clipId);
      if (action === 'split') splitClip(track, clipId, this.position);
      if (action === 'remove') track.clips = track.clips.filter(c => c.id !== clipId);
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
      clip: focused.closest('[data-clip]')?.dataset.clip
    } : null;
    const s = this.session, advanced = s.mode === 'advanced'; this.content.replaceChildren();
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
      [this.recorder.state === 'recording' ? 'Finish recording' : 'Record microphone', 'record', false],
      ['Undo', 'undo', !this.history.undoStack.length], ['Redo', 'redo', !this.history.redoStack.length]
    ]) { const b = button(label, action); b.dataset.unavailable = String(unavailable); transport.append(b); }
    this.clockLabel = el('output', timeText(this.position)); this.clockLabel.setAttribute('aria-label', 'Playback position'); transport.append(this.clockLabel);
    this.content.append(transport);
    this.seek = this.field(this.content, 'Start listening at (seconds)', this.position.toFixed(1), value => { this.transport?.stop(); this.position = value; this.render(); }, { min: 0, max: Math.max(0, sessionDuration(s)) });
    const levels = el('div', undefined, 'music-controls');
    this.volumeField(levels, 'Song volume', s.masterDb, value => this.mixChange(song => song.masterDb = value), advanced, 6);
    if (advanced) this.field(levels, 'Tempo (BPM; echo timing)', s.tempo, value => this.change(song => song.tempo = value), { min: 40, max: 240, step: 1 });
    this.content.append(levels);
    if (!hasAudio) this.content.append(el('p', 'Add your own audio or record a microphone to start. Imported files become separate parts that play together.'));
    for (const track of s.tracks) this.content.append(this.trackView(track, advanced));
    if (this.pendingTake) this.content.append(button('Save unprocessed recording', 'take'));
    this.content.append(el('p', 'Save project keeps your editable song on this device. Finished-song delivery and streaming-library connections are not enabled in this development workspace.', 'music-note'));
    this.updateGuide(); this.lock();
    if (focus?.action || focus?.field) {
      const same = [...this.dialog.querySelectorAll('button, input')].find(node =>
        (focus.action ? node.dataset.musicAction === focus.action : node.dataset.musicField === focus.field) &&
        node.closest('[data-track]')?.dataset.track === focus.track && node.closest('[data-clip]')?.dataset.clip === focus.clip);
      this.focusAfterRun = same || this.guideNext;
      if (!this.busy && !this.focusAfterRun.disabled) this.focusAfterRun.focus({ preventScroll: true });
    }
  }
  trackView(track, advanced) {
    const section = el('section', undefined, 'music-track'); section.dataset.track = track.id;
    const header = el('div', undefined, 'music-controls'); header.append(el('h3', track.name));
    for (const [label, action] of [['Mute', 'mute'], ['Only this part', 'solo']]) { const b = button(label, action); b.setAttribute('aria-pressed', String(track[action])); header.append(b); }
    section.append(header);
    const controls = el('div', undefined, 'music-controls');
    const set = (key, value) => this.mixChange(s => s.tracks.find(t => t.id === track.id)[key] = value);
    this.volumeField(controls, 'Part volume', track.gainDb, value => set('gainDb', value), advanced, 12);
    const more = el('details'); more.open = advanced; more.append(el('summary', 'Adjust the sound'));
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
    this.guideTitle.textContent = this.guideState.title; this.guideText.textContent = this.guideState.text;
    this.guideNext.textContent = this.guideState.label;
  }
  tick() {
    if (this.recorder.error) {
      clearTimeout(this.recordLimit); const error = this.recorder.error; this.recorder.error = null;
      this.render(); this.say(error.message, true); return;
    }
    if (this.recorder.state === 'recording') this.clockLabel.textContent = `Recording ${timeText((performance.now() - this.recordStarted) / 1000)}`;
    else if (this.transport?.playing) {
      this.position = this.transport.current(); this.clockLabel.textContent = timeText(this.position);
      if (!this.session.loop.enabled && this.position >= sessionDuration(this.session)) { this.transport.stop(); this.render(); }
    }
  }
}

let studio;
export function openMusicStudio() { studio ||= new MusicStudio(); studio.open(); }
