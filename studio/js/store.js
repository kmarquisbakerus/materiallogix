// IndexedDB persistence. Four stores: projects, assets (metadata), blobs
// (files), and consents. Blobs are kept separate so the metadata store stays
// cheap to scan.

const DB_NAME = 'creative-review-os';
// 2: the consents store. A face or a voice is biometric data, and the burden
// of demonstrating consent for it sits on us - a localStorage flag is not a
// record and cannot be produced.
const DB_VERSION = 2;

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
      if (!db.objectStoreNames.contains('consents')) {
        const s = db.createObjectStore('consents', { keyPath: 'id' });
        s.createIndex('subject', 'subject', { unique: false });
        s.createIndex('recordedAt', 'recordedAt', { unique: false });
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
 * The working margin held back from the quota.
 *
 * A database that is exactly full cannot be compacted, and cannot even delete
 * cleanly on some engines, so some of the quota has to stay unspent. A flat
 * 256 MB was that margin, which is fine on a desktop and ruinous on a phone:
 * against the 300 MB origin quota a phone browser hands out it reserved 86% of
 * the space, so no file of any size could be imported. A share of the quota
 * scales with the device; the floor keeps the margin real on a tiny quota and
 * the ceiling stops it growing without limit on a large one.
 */
export const STORAGE_HEADROOM_FRACTION = 0.1;
export const STORAGE_HEADROOM_MIN_BYTES = 8 * 1024 * 1024;
export const STORAGE_HEADROOM_MAX_BYTES = 256 * 1024 * 1024;

export function storageHeadroom(quota) {
  const total = Math.max(0, Number(quota) || 0);
  return Math.min(STORAGE_HEADROOM_MAX_BYTES,
    Math.max(STORAGE_HEADROOM_MIN_BYTES, Math.round(total * STORAGE_HEADROOM_FRACTION)));
}

/** Whether this file will fit, before we try to write it and lose the import. */
export async function roomFor(bytes) {
  const size = Math.max(0, Number(bytes) || 0);
  const estimate = await usage();
  // A browser that will not report cannot be second-guessed; let the write
  // decide, and let addAsset turn the failure into a sentence.
  if (!estimate || !estimate.quota) {
    return { known: false, fits: true, freeBytes: null, needBytes: size, headroomBytes: 0 };
  }
  const free = Math.max(0, estimate.quota - estimate.used);
  const headroom = storageHeadroom(estimate.quota);
  return {
    known: true,
    fits: free >= size + headroom,
    freeBytes: free,
    // What the customer is asked to make room for is their file. The margin is
    // ours and belongs in the comparison, not in the sentence - quoting the sum
    // described a 20 KB thumbnail as needing a quarter of a gigabyte.
    needBytes: size,
    headroomBytes: headroom
  };
}

// Sizes a customer can act on. Everything in gigabytes turned a 20 KB file into
// "0.00 GB" and 50 MB of free space into "0.05 GB".
const humanSize = bytes => {
  const n = Math.max(0, Math.round(Number(bytes) || 0));
  if (n >= 1073741824) return `${(n / 1073741824).toFixed(1)} GB`;
  if (n >= 1048576) return `${Math.round(n / 1048576)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} bytes`;
};

/**
 * What a refused import says.
 *
 * It names the file the customer chose, not that file plus our own reserve: a
 * 20 KB thumbnail used to be reported as needing 0.25 GB. `room` is the
 * pre-check that refused it; when the write itself is what failed there is no
 * trustworthy figure to quote - the estimate said there was space and the
 * engine disagreed - so the sentence stays general rather than telling the
 * customer they have gigabytes free while refusing them. `Delete a project` is
 * named because that is the delete the product actually offers.
 */
function storageFullSentence(file, room) {
  if (!room?.known) {
    return 'This browser is out of room for the project. Delete a project you no longer need, or open the Studio on a computer with more free space.';
  }
  // "0 bytes left, and 10 MB of that reserved" is not a sentence, so what is
  // left and what is held back are said together.
  const left = room.freeBytes <= 0
    ? 'the browser has no room left for the project'
    : room.freeBytes > room.headroomBytes
      ? `the browser has ${humanSize(room.freeBytes)} left for the project, and ${humanSize(room.headroomBytes)} of that stays reserved so the project can still be tidied up`
      : `the browser has ${humanSize(room.freeBytes)} left for the project, and all of it has to stay free so the project can still be tidied up`;
  return `This ${humanSize(file)} file does not fit: ${left}. Delete a project you no longer need, or free space on the drive.`;
}

export class StorageFullError extends Error {
  constructor(fileBytes, room = null) {
    const file = Math.max(0, Number(fileBytes) || 0);
    super(storageFullSentence(file, room));
    this.name = 'StorageFullError';
    this.code = 'storage_full';
    this.fileBytes = file;
    this.freeBytes = room?.known ? room.freeBytes : null;
    this.needBytes = file;
  }
}

export async function addAsset(asset, file) {
  // Ask once, on the first thing worth keeping.
  requestPersistentStorage();
  const size = file?.size || 0;
  const room = await roomFor(size);
  if (room.known && !room.fits) throw new StorageFullError(size, room);
  try {
    await tx('blobs', 'readwrite', s => s.put(file, asset.id));
  } catch (error) {
    // A raw QuotaExceededError reaches the customer as "QuotaExceededError".
    if (error?.name === 'QuotaExceededError' || error?.code === 22) {
      throw new StorageFullError(size);
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

// --- consent records -------------------------------------------------------
//
// A voice pack and a 360° facial capture are biometric data, and the privacy
// policy says so. Where the lawful basis is explicit consent, the burden of
// demonstrating it sits on us: a localStorage flag is not a record, is not
// per-subject, and cannot be produced when somebody asks what was agreed.
//
// These records are written on the device that took the consent, alongside the
// media they cover, so they survive as long as the work does. That is the
// honest limit and it is worth stating: this is the customer's own copy, not a
// server-side register. `POST /api/consent` in the contract table is what would
// make it producible centrally, and it is not built.

export const CONSENT_SCHEMA = 'materiallogix.consent.v1';

/**
 * Record one consent, for one subject, for one purpose, at one moment.
 * Returns the stored record so a caller can show or export it.
 */
export async function recordConsent({ subject, purpose, statement, granted = true, evidence = {} } = {}) {
  const named = String(subject || '').trim();
  if (!named) throw new Error('A consent record needs the subject it covers.');
  if (!purpose) throw new Error('A consent record needs the purpose it covers.');
  const record = {
    schema: CONSENT_SCHEMA,
    id: `consent_${crypto.randomUUID()}`,
    subject: named,
    purpose: String(purpose),
    statement: String(statement || ''),
    granted: granted === true,
    recordedAt: new Date().toISOString(),
    evidence: { ...evidence }
  };
  const db = await open();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('consents', 'readwrite');
    tx.objectStore('consents').put(record);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  return record;
}

/** Every consent held for a subject, newest first. */
export async function consentsFor(subject) {
  const named = String(subject || '').trim();
  if (!named) return [];
  const db = await open();
  const found = await new Promise((resolve, reject) => {
    const tx = db.transaction('consents', 'readonly');
    const req = tx.objectStore('consents').index('subject').getAll(named);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
  return found.sort((a, b) => String(b.recordedAt).localeCompare(String(a.recordedAt)));
}

/** Has this subject granted consent for this purpose? */
export async function consentGranted(subject, purpose) {
  return (await consentsFor(subject)).some(record => record.purpose === purpose && record.granted === true);
}

/** Everything on file, for a subject-access request or an export. */
export async function allConsents() {
  const db = await open();
  const found = await new Promise((resolve, reject) => {
    const tx = db.transaction('consents', 'readonly');
    const req = tx.objectStore('consents').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
  return found.sort((a, b) => String(b.recordedAt).localeCompare(String(a.recordedAt)));
}

/** Erase every consent record for a subject, for a deletion request. */
export async function forgetConsents(subject) {
  const records = await consentsFor(subject);
  if (!records.length) return 0;
  const db = await open();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('consents', 'readwrite');
    const store = tx.objectStore('consents');
    for (const record of records) store.delete(record.id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  return records.length;
}
