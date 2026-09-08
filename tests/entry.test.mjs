// The entrance, and the one thing it has to get right: the card you press
// decides which Studio you land in.
//
// The Video card's three starters created a video project with the video QA
// preset and then dropped the customer on the Photo start page, because only
// `enterWorkspace` stamped `mlx:start-product` and the starter path did not.
// So this enumerates every starter on every card rather than sampling one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const session = new Map();
const local = new Map();
let navigation = [];

const storage = map => ({
  getItem: key => (map.has(key) ? map.get(key) : null),
  setItem: (key, value) => map.set(key, String(value)),
  removeItem: key => map.delete(key)
});

/**
 * A memory-backed IndexedDB, only as deep as store.js reaches into one:
 * `saveProject` has to actually complete or the starter never opens.
 */
function fakeIndexedDB() {
  const rows = new Map();
  const request = result => {
    const req = { result, onsuccess: null, onerror: null };
    queueMicrotask(() => req.onsuccess?.());
    return req;
  };
  const objectStore = name => ({
    createIndex() {},
    put(value, key) { rows.set(`${name}:${key ?? value.id}`, value); return request(undefined); },
    get(key) { return request(rows.get(`${name}:${key}`)); },
    getAll() { return request([...rows].filter(([k]) => k.startsWith(`${name}:`)).map(([, v]) => v)); },
    index: () => ({ getAll: () => request([]) }),
    delete(key) { rows.delete(`${name}:${key}`); return request(undefined); }
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
  return {
    open() {
      const req = { result: db, onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null };
      queueMicrotask(() => { req.onupgradeneeded?.(); req.onsuccess?.(); });
      return req;
    },
    rows
  };
}

const define = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });

define('sessionStorage', storage(session));
define('localStorage', storage(local));
define('indexedDB', fakeIndexedDB());
define('navigator', { storage: { persist: async () => true, persisted: async () => true, estimate: async () => null } });
define('location', {
  href: 'http://studio.test/studio/', pathname: '/studio/', search: '', hash: '',
  assign(url) { navigation.push(`assign ${url}`); },
  reload() { navigation.push(`reload ${this.href}`); }
});
define('history', {
  replaceState(state, title, url) {
    location.href = new URL(url, location.href).href;
    location.hash = new URL(location.href).hash;
    navigation.push(`replace ${location.href}`);
  }
});

const { STUDIO_STARTERS, startStarter } = await import('../studio/js/studio-entry.js');

function freshArrival() {
  session.clear();
  local.clear();
  navigation = [];
  location.href = 'http://studio.test/studio/';
  location.pathname = '/studio/';
  location.search = '';
  location.hash = '';
}

// Photo is the start page's default and Voice has a page of its own, so `video`
// is the one id the workspace has to recognise by name.
const app = readFileSync(resolve(ROOT, 'studio/js/app.js'), 'utf8');

test('every starter opens the Studio whose card it sits under', async () => {
  const landed = [];
  for (const [product, starters] of Object.entries(STUDIO_STARTERS)) {
    for (const starter of starters) {
      freshArrival();
      const project = await startStarter(product, starter.id);
      const stamp = sessionStorage.getItem('mlx:start-product');
      landed.push(`${starter.id} -> ${stamp}`);
      assert.equal(stamp, product,
        `"${starter.label}" sits on the ${product} card and must open the ${product} Studio`);
      assert.equal(local.get('cros:project'), project.id, `${starter.id} did not become the open project`);
      assert.equal(project.starter.product, product);
      assert.equal(project.qaPreset, starter.qaPreset);
      if (product === 'voice') {
        // Voice is a separate page, and it reads the project off the query.
        assert.deepEqual(navigation, [`assign http://studio.test/studio/voice.html?project=${project.id}`],
          `${starter.id} must open the Voice page`);
      } else {
        assert.deepEqual(navigation, ['replace http://studio.test/studio/#workspace', 'reload http://studio.test/studio/#workspace'],
          `${starter.id} must land in the workspace`);
      }
    }
  }
  assert.equal(landed.length, 9, 'nine starters ship on the entrance');
});

test('the workspace recognises the value the entrance stamps', () => {
  // Writer and reader are in different files, which is how the Video starters
  // came to write nothing at all. Pin the string they have to agree on.
  assert.ok(Object.keys(STUDIO_STARTERS).includes('video'), 'video is a product id the entrance can stamp');
  assert.match(app, /sessionStorage\.getItem\('mlx:start-product'\) === 'video'/,
    'the start page no longer reads the stamp the entrance writes');
});
