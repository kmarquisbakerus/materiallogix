import { validateSession } from './music-session.js';

const MAGIC = 'MLXMUSIC1\n';
const MAX_BYTES = 512 * 1024 * 1024;

export function projectSnapshot(session, sources) {
  const wanted = new Set(session.tracks.flatMap(t => t.clips.map(c => c.sourceId)));
  if (session.instrument?.sample) wanted.add(session.instrument.sample.sourceId);
  for (const track of session.tracks) if (track.generated?.kind === 'instrument' && track.generated.pattern.sample) wanted.add(track.generated.pattern.sample.sourceId);
  const audio = [...wanted].map(id => {
    const source = sources.get(id);
    if (!source || !(source.blob instanceof Blob)) throw new Error('A source file is missing. The project has not been saved.');
    return { id, name: source.name, blob: source.blob };
  });
  return { session: validateSession(session), audio, savedAt: Date.now() };
}

export function packProject(snapshot) {
  const session = validateSession(snapshot.session);
  const metadata = new TextEncoder().encode(JSON.stringify({ session, audio: snapshot.audio.map(s => ({ id: s.id, name: s.name, type: s.blob.type, bytes: s.blob.size })) }));
  const size = new ArrayBuffer(4); new DataView(size).setUint32(0, metadata.length, true);
  const blob = new Blob([MAGIC, size, metadata, ...snapshot.audio.map(s => s.blob)], { type: 'application/octet-stream' });
  if (blob.size > MAX_BYTES) throw new Error('This project exceeds the current 512 MB portable-project limit.');
  return blob;
}

export async function unpackProject(blob) {
  if (!(blob instanceof Blob) || blob.size > MAX_BYTES || blob.size < MAGIC.length + 4) throw new Error('This file is not a supported music project.');
  if (await blob.slice(0, MAGIC.length).text() !== MAGIC) throw new Error('This file is not a MaterialLogix music project.');
  const length = new DataView(await blob.slice(MAGIC.length, MAGIC.length + 4).arrayBuffer()).getUint32(0, true);
  const headerEnd = MAGIC.length + 4 + length;
  if (length > 4 * 1024 * 1024 || headerEnd > blob.size) throw new Error('The project header is invalid.');
  const value = JSON.parse(await blob.slice(MAGIC.length + 4, headerEnd).text());
  const session = validateSession(value.session);
  if (!Array.isArray(value.audio) || value.audio.length > 4096) throw new Error('The project audio list is invalid.');
  let offset = headerEnd; const ids = new Set();
  const audio = value.audio.map(s => {
    if (!s || typeof s.id !== 'string' || !s.id || ids.has(s.id) || !Number.isSafeInteger(s.bytes) || s.bytes <= 0 || offset + s.bytes > blob.size) throw new Error('The project contains invalid source audio.');
    ids.add(s.id);
    const part = blob.slice(offset, offset + s.bytes, typeof s.type === 'string' ? s.type : ''); offset += s.bytes;
    return { id: s.id, name: String(s.name || 'Audio').slice(0, 120), blob: part };
  });
  if (offset !== blob.size || session.tracks.some(t => t.clips.some(c => !ids.has(c.sourceId))) || (session.instrument.sample && !ids.has(session.instrument.sample.sourceId))) throw new Error('The project audio is incomplete.');
  if (session.tracks.some(t => t.generated?.kind === 'instrument' && t.generated.pattern.sample && !ids.has(t.generated.pattern.sample.sourceId))) throw new Error('The project is missing an instrument sample.');
  return { session, audio };
}

export class MusicProjectStore {
  constructor(factory = globalThis.indexedDB) { this.factory = factory; this.queue = Promise.resolve(); }
  async database() {
    if (this.db) return this.db;
    if (!this.factory) throw new Error('Local project recovery is unavailable. Save a project file before closing.');
    return new Promise((resolve, reject) => {
      const request = this.factory.open('materiallogix-music', 2);
      request.onupgradeneeded = () => {
        const store = request.result.objectStoreNames.contains('projects')
          ? request.transaction.objectStore('projects')
          : request.result.createObjectStore('projects', { keyPath: 'session.id' });
        if (!store.indexNames.contains('savedAt')) store.createIndex('savedAt', 'savedAt');
      };
      request.onerror = () => reject(new Error('Local project storage could not be opened.'));
      request.onblocked = () => reject(new Error('Close other Music windows to finish opening local storage.'));
      request.onsuccess = () => { this.db = request.result; this.db.onversionchange = () => { this.db.close(); this.db = null; }; resolve(this.db); };
    });
  }
  async latest() {
    const db = await this.database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('projects', 'readonly'), request = tx.objectStore('projects').index('savedAt').openCursor(null, 'prev');
      request.onsuccess = () => resolve(request.result?.value || null);
      request.onerror = () => reject(new Error('The saved project could not be read. Your files have not been removed.'));
    });
  }
  save(snapshot) {
    const operation = this.queue.catch(() => {}).then(async () => {
      const db = await this.database();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('projects', 'readwrite'); tx.objectStore('projects').put(snapshot);
        tx.oncomplete = resolve;
        tx.onabort = tx.onerror = () => reject(new Error('Autosave failed. Keep this window open and save a project file.'));
      });
    });
    this.queue = operation; return operation;
  }
}
