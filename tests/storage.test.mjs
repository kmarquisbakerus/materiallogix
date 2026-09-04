// Local storage: how much of the quota a customer can actually use, and what
// they are told when a file will not fit.
//
// The refusal used to be checked by handing `StorageFullError` two numbers
// chosen here, so nothing tested the numbers `addAsset` really passes it - and
// what it really passed was the file's size plus the tool's own 256 MB reserve,
// which reported a 20 KB thumbnail as needing 0.25 GB. Everything below drives
// `addAsset`, the way the import path does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MB = 1024 * 1024;

/**
 * A browser reporting `estimate`, and object stores that either accept a write
 * or refuse it the way an engine out of room does. `put` is called with the
 * store's name, because a blob and its metadata row are two separate writes.
 */
const stub = (estimate, { put = () => {} } = {}) => {
  Object.defineProperty(globalThis, 'navigator', {
    value: { storage: { estimate: async () => estimate, persist: async () => true, persisted: async () => false } },
    configurable: true
  });
  const request = result => {
    const req = { result, onsuccess: null, onerror: null };
    queueMicrotask(() => req.onsuccess?.());
    return req;
  };
  const objectStore = name => ({
    createIndex() {},
    put(value, key) { put(name, value, key); return request(undefined); },
    get: () => request(undefined),
    getAll: () => request([]),
    index: () => ({ getAll: () => request([]) }),
    delete: () => request(undefined)
  });
  const created = new Set();
  const db = {
    objectStoreNames: { contains: name => created.has(name) },
    createObjectStore(name) { created.add(name); return objectStore(name); },
    transaction(name) {
      const t = { oncomplete: null, onerror: null, onabort: null, error: null, objectStore: () => objectStore(name) };
      queueMicrotask(() => t.oncomplete?.());
      return t;
    }
  };
  Object.defineProperty(globalThis, 'indexedDB', {
    value: {
      open() {
        const req = { result: db, onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null };
        queueMicrotask(() => { req.onupgradeneeded?.(); req.onsuccess?.(); });
        return req;
      }
    },
    configurable: true
  });
};

const photo = size => ({ size, type: 'image/jpeg', name: 'photo.jpg' });
const asset = () => ({ id: `a${Math.random().toString(36).slice(2)}`, projectId: 'p1', addedAt: new Date().toISOString() });

const refusal = async (store, size) => {
  const error = await store.addAsset(asset(), photo(size)).then(() => null, e => e);
  assert.ok(error, `a ${size} byte file was expected to be refused`);
  return error;
};

test('an import that will not fit is refused before it is attempted', async () => {
  // addAsset did a raw put with no check and no catch, so filling the disk
  // surfaced as an unhandled QuotaExceededError.
  let written = 0;
  stub({ usage: 9.6e9, quota: 10e9 }, { put: name => { if (name === 'blobs') written += 1; } });   // 400 MB free
  const store = await import('../studio/js/store.js?fit');
  await store.addAsset(asset(), photo(50e6));
  assert.equal(written, 1, 'a small import still fits');
  const error = await refusal(store, 300e6);
  assert.equal(error.code, 'storage_full');
  assert.equal(written, 1, 'the refused write was never attempted');
});

test('the reserve scales with the quota instead of swallowing a phone', async () => {
  // A flat 256 MB reserve against the 300 MB origin quota a phone hands out
  // left 14% of it usable: four 10 MB photos and then nothing, of any size.
  const estimate = { usage: 0, quota: 300 * MB };
  let stored = 0;
  stub(estimate, { put: name => { if (name !== 'blobs') return; stored += 10 * MB; estimate.usage += 10 * MB; } });
  const store = await import('../studio/js/store.js?phone');
  // Ten-megabyte photos, one after another, until the Studio refuses one.
  for (let i = 0; i < 40; i++) {
    const refused = await store.addAsset(asset(), photo(10 * MB)).then(() => null, error => error);
    if (refused) break;
  }
  assert.ok(stored >= 260 * MB, `at least 260 MB of the 300 MB quota must be usable, got ${stored / MB} MB`);
  assert.equal(store.storageHeadroom(300 * MB), 30 * MB, 'a tenth of the quota');
  // The ceiling still holds on a desktop-sized quota, and the floor on a tiny one.
  assert.equal(store.storageHeadroom(40e9), store.STORAGE_HEADROOM_MAX_BYTES);
  assert.equal(store.storageHeadroom(20 * MB), store.STORAGE_HEADROOM_MIN_BYTES);
});

test('the refusal describes the file the customer chose', async () => {
  // 20 MB free of a 300 MB quota. The message a 20 KB thumbnail used to get
  // here was "This file needs about 0.25 GB" - the tool's own reserve, quoted
  // back as the photo's requirement.
  stub({ usage: 280 * MB, quota: 300 * MB });
  const store = await import('../studio/js/store.js?msg');
  const thumbnail = await refusal(store, 20 * 1024);
  assert.match(thumbnail.message, /This 20 KB file/);
  assert.ok(!/GB/.test(thumbnail.message), `no gigabytes for a 20 KB file: ${thumbnail.message}`);
  assert.equal(thumbnail.needBytes, 20 * 1024, 'the number in the sentence is the file, not the reserve');
  assert.equal(thumbnail.freeBytes, 20 * MB);
  assert.match(thumbnail.message, /has 20 MB left/);
  // The remedy has to be one the product offers: there is no per-asset delete.
  assert.match(thumbnail.message, /Delete a project/);
  assert.ok(!/Quota|Exceeded|IDB|DOMException/i.test(thumbnail.message), 'no internals in customer copy');

  const video = await refusal(store, 2e9);
  assert.match(video.message, /This 1\.9 GB file/);
});

test('a write that fails does not quote the estimate that said there was room', async () => {
  // The engine refusing a write while `estimate()` still reports gigabytes free
  // produced "This file needs about 0.25 GB and the browser has 8.0 GB left" -
  // a refusal and a contradiction in one sentence.
  stub({ usage: 0, quota: 8e9 }, { put: name => {
    if (name !== 'blobs') return;
    const error = new Error('quota'); error.name = 'QuotaExceededError'; throw error;
  } });
  const store = await import('../studio/js/store.js?quota');
  const error = await refusal(store, 5 * MB);
  assert.equal(error.code, 'storage_full');
  assert.equal(error.freeBytes, null, 'the pre-check figures are known to be wrong by now');
  assert.match(error.message, /out of room for the project/);
  assert.ok(!/8(\.0)? GB/.test(error.message), `no space quoted while refusing: ${error.message}`);
  assert.ok(!/QuotaExceededError/.test(error.message), 'no internals in customer copy');
});

test('a browser that will not report is not second-guessed', async () => {
  stub(null);
  const { roomFor } = await import('../studio/js/store.js?unknown');
  const room = await roomFor(5e9);
  assert.equal(room.known, false);
  assert.equal(room.fits, true, 'let the write decide rather than refusing on no evidence');
  assert.equal(room.freeBytes, null);
});

test('an existing database is upgraded, not rebuilt', async () => {
  // Version 2 added the consents store. A database written by version 1 still
  // holds every project, asset and blob a customer has, and the upgrade must
  // leave all three alone.
  const existing = new Set(['projects', 'assets', 'blobs']);
  const created = [], dropped = [];
  const db = {
    objectStoreNames: { contains: name => existing.has(name) },
    createObjectStore(name) { created.push(name); existing.add(name); return { createIndex() {} }; },
    deleteObjectStore(name) { dropped.push(name); }
  };
  Object.defineProperty(globalThis, 'indexedDB', {
    value: {
      open(name, version) {
        const req = { result: db, onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null };
        req.version = version;
        queueMicrotask(() => { req.onupgradeneeded?.(); req.onsuccess?.(); });
        return req;
      }
    },
    configurable: true
  });
  const store = await import('../studio/js/store.js?upgrade');
  await store.listProjects().catch(() => []);
  assert.deepEqual(created, ['consents'], 'only the new store is created on a version-1 database');
  assert.deepEqual(dropped, [], 'nothing a customer owns is dropped by the upgrade');
});

test('the project is kept, not treated as disposable', () => {
  // Without persist() the browser may evict the whole database under disk
  // pressure, with no warning. On a product whose promise is that the work
  // stays on the customer's computer, that is the worst failure available.
  const source = readFileSync(resolve(ROOT, 'studio/js/store.js'), 'utf8');
  assert.match(source, /navigator\.storage\?\.persist/, 'persistence is never requested');
  assert.match(source, /requestPersistentStorage\(\);/, 'and never called when something worth keeping arrives');
  assert.match(source, /QuotaExceededError/, 'a quota failure must be translated');
});
