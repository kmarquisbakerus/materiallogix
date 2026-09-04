// IndexedDB persistence. Three stores: projects, assets (metadata), blobs (files).
// Blobs are kept separate so the metadata store stays cheap to scan.

const DB_NAME = 'creative-review-os';
const DB_VERSION = 1;

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) {
        db.createObjectStore('projects', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('assets')) {
        const s = db.createObjectStore('assets', { keyPath: 'id' });
        s.createIndex('projectId', 'projectId', { unique: false });
      }
      if (!db.objectStoreNames.contains('blobs')) {
        db.createObjectStore('blobs');
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another tab upgrading or deleting the database blocks forever while we
      // hold this connection. Step aside and reopen lazily on the next call.
      db.onversionchange = () => { db.close(); dbPromise = null; };
      db.onclose = () => { dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Another tab is holding this database open. Close the other Creative Review tabs and reload.'));
  });
  return dbPromise;
}

// Cached per asset id; see the object URL section below.
const urlCache = new Map();

function tx(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.onabort = t.onerror = () => reject(t.error);
    if (req) {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } else {
      t.oncomplete = () => resolve();
    }
  }));
}

// --- projects --------------------------------------------------------------

export const listProjects = () =>
  tx('projects', 'readonly', s => s.getAll())
    .then(rows => rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));

export const getProject = id => tx('projects', 'readonly', s => s.get(id));

export function saveProject(project) {
  project.updatedAt = new Date().toISOString();
  return tx('projects', 'readwrite', s => s.put(project)).then(() => project);
}

export async function deleteProject(id) {
  const assets = await listAssets(id);
  for (const a of assets) await deleteAsset(a.id);
  return tx('projects', 'readwrite', s => s.delete(id));
}

// --- assets ----------------------------------------------------------------

export const listAssets = projectId =>
  tx('assets', 'readonly', s => s.index('projectId').getAll(projectId))
    .then(rows => rows.sort((a, b) => a.addedAt.localeCompare(b.addedAt)));

export const getAsset = id => tx('assets', 'readonly', s => s.get(id));

export const saveAsset = asset =>
  tx('assets', 'readwrite', s => s.put(asset)).then(() => asset);

/**
 * Ask the browser to stop treating this project as disposable.
 *
 * Without this the origin's storage is "best-effort": the browser may evict the
 * whole database under disk pressure, with no warning and no recovery. For a
 * product whose promise is that the work stays on the customer's own computer,
 * that is the worst failure it can have. Persisted storage is also granted a
 * far larger quota on every engine, which is most of the answer to "why can't I
 * import more video".
 *
 * Safari grants this on user engagement rather than on request, so a refusal is
 * normal and not an error. Chrome and Firefox grant it to installed apps.
 */
let persistenceAsked = null;
export function requestPersistentStorage() {
  if (persistenceAsked) return persistenceAsked;
  persistenceAsked = (async () => {
    try {
      if (!navigator.storage?.persist) return { supported: false, persisted: false };
      if (await navigator.storage.persisted?.()) return { supported: true, persisted: true };
      return { supported: true, persisted: await navigator.storage.persist() };
    } catch { return { supported: false, persisted: false }; }
  })();
  return persistenceAsked;
}

/**
 * Whether this file will fit, before we try to write it and lose the import.
 * Keeps a working margin back: a database that is exactly full cannot be
 * compacted, and cannot even delete cleanly on some engines.
 */
export const STORAGE_HEADROOM_BYTES = 256 * 1024 * 1024;

export async function roomFor(bytes) {
  const size = Math.max(0, Number(bytes) || 0);
  const estimate = await usage();
  // A browser that will not report cannot be second-guessed; let the write
  // decide, and let addAsset turn the failure into a sentence.
  if (!estimate || !estimate.quota) return { known: false, fits: true, freeBytes: null, needBytes: size };
  const free = Math.max(0, estimate.quota - estimate.used);
  return {
    known: true,
    fits: free >= size + STORAGE_HEADROOM_BYTES,
    freeBytes: free,
    needBytes: size + STORAGE_HEADROOM_BYTES
  };
}

const gb = bytes => `${(bytes / 1073741824).toFixed(bytes < 1073741824 ? 2 : 1)} GB`;

export class StorageFullError extends Error {
  constructor(freeBytes, needBytes) {
    super(freeBytes === null
      ? 'This browser is out of room for the project. Remove an asset you no longer need, or open the Studio on a computer with more free space.'
      : `This file needs about ${gb(needBytes)} and the browser has ${gb(freeBytes)} left for the project. Remove an asset you no longer need, or free space on the drive.`);
    this.name = 'StorageFullError';
    this.code = 'storage_full';
    this.freeBytes = freeBytes;
    this.needBytes = needBytes;
  }
}

export async function addAsset(asset, file) {
  // Ask once, on the first thing worth keeping.
  requestPersistentStorage();
  const room = await roomFor(file?.size || 0);
  if (room.known && !room.fits) throw new StorageFullError(room.freeBytes, room.needBytes);
  try {
    await tx('blobs', 'readwrite', s => s.put(file, asset.id));
  } catch (error) {
    // A raw QuotaExceededError reaches the customer as "QuotaExceededError".
    if (error?.name === 'QuotaExceededError' || error?.code === 22) {
      throw new StorageFullError(room.freeBytes, room.needBytes);
    }
    throw error;
  }
  return saveAsset(asset);
}

export async function deleteAsset(id) {
  releaseUrl(id);
  await tx('blobs', 'readwrite', s => s.delete(id));
  return tx('assets', 'readwrite', s => s.delete(id));
}

export const getBlob = id => tx('blobs', 'readonly', s => s.get(id));

// --- object URL cache ------------------------------------------------------
// Revoking eagerly breaks <img> reuse across re-renders, so URLs are cached
// per asset id and released when the asset is deleted.

export async function objectUrl(assetId) {
  if (urlCache.has(assetId)) return urlCache.get(assetId);
  const blob = await getBlob(assetId);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urlCache.set(assetId, url);
  return url;
}

export function releaseUrl(assetId) {
  const url = urlCache.get(assetId);
  if (url) {
    URL.revokeObjectURL(url);
    urlCache.delete(assetId);
  }
}

// --- estimated usage -------------------------------------------------------

export async function usage() {
  if (!navigator.storage || !navigator.storage.estimate) return null;
  // Some engines reject or answer with nothing. Destructuring that threw, and
  // took the caller with it - which for the import path meant a failed estimate
  // became a failed import.
  try {
    const estimate = await navigator.storage.estimate();
    if (!estimate) return null;
    const { usage: used, quota } = estimate;
    return Number.isFinite(quota) ? { used: Number(used) || 0, quota } : null;
  } catch { return null; }
}
