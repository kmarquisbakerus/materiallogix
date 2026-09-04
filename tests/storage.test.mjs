import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stub = estimate => {
  Object.defineProperty(globalThis, 'navigator', {
    value: { storage: { estimate: async () => estimate, persist: async () => true, persisted: async () => false } },
    configurable: true
  });
  Object.defineProperty(globalThis, 'indexedDB', { value: {}, configurable: true });
};

test('an import that will not fit is refused before it is attempted', async () => {
  // addAsset did a raw put with no check and no catch, so filling the disk
  // surfaced as an unhandled QuotaExceededError.
  stub({ usage: 9.6e9, quota: 10e9 });                       // 400 MB free
  const { roomFor, STORAGE_HEADROOM_BYTES } = await import('../studio/js/store.js?fit');
  assert.equal((await roomFor(50e6)).fits, true, 'a small import still fits');
  assert.equal((await roomFor(300e6)).fits, false, 'a 300 MB video does not fit in 400 MB');
  assert.equal((await roomFor(2e9)).fits, false);
  // Headroom is kept back deliberately: a database that is exactly full cannot
  // be compacted, and on some engines cannot even delete cleanly.
  assert.ok(STORAGE_HEADROOM_BYTES > 0);
  assert.equal((await roomFor(0)).needBytes, STORAGE_HEADROOM_BYTES);
});

test('a browser that will not report is not second-guessed', async () => {
  stub(null);
  const { roomFor } = await import('../studio/js/store.js?unknown');
  const room = await roomFor(5e9);
  assert.equal(room.known, false);
  assert.equal(room.fits, true, 'let the write decide rather than refusing on no evidence');
  assert.equal(room.freeBytes, null);
});

test('running out of room reads as a sentence, not an error name', async () => {
  stub({ usage: 1, quota: 2 });
  const { StorageFullError } = await import('../studio/js/store.js?msg');
  const known = new StorageFullError(4e8, 2.5e9);
  assert.equal(known.code, 'storage_full');
  assert.match(known.message, /needs about 2\.3 GB/);
  assert.match(known.message, /has 0\.37 GB left/);
  assert.ok(!/Quota|Exceeded|IDB|DOMException/i.test(known.message), 'no internals in customer copy');
  assert.match(new StorageFullError(null, 0).message, /out of room/);
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
