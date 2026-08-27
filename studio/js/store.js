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

export async function addAsset(asset, file) {
  await tx('blobs', 'readwrite', s => s.put(file, asset.id));
  return saveAsset(asset);
}

export async function deleteAsset(id) {
  await tx('blobs', 'readwrite', s => s.delete(id));
  return tx('assets', 'readwrite', s => s.delete(id));
}

export const getBlob = id => tx('blobs', 'readonly', s => s.get(id));

// --- object URL cache ------------------------------------------------------
// Revoking eagerly breaks <img> reuse across re-renders, so URLs are cached
// per asset id and released only when the asset is deleted.

const urlCache = new Map();

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
  const { usage: used, quota } = await navigator.storage.estimate();
  return { used, quota };
}
