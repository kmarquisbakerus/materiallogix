import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STUDIO = resolve(ROOT, 'studio');
const PAGES = ['index.html', 'voice.html', 'usage.html', 'admin.html'];
const read = file => readFileSync(resolve(STUDIO, file), 'utf8');

/** Every module the four Studio pages reach, following imports transitively. */
function importGraph() {
  const queue = [];
  const styles = new Set();
  for (const page of PAGES) {
    const src = read(page);
    for (const match of src.matchAll(/<script[^>]*src="([^"]+)"/g)) queue.push(match[1].split('?')[0]);
    for (const match of src.matchAll(/from\s+['"](\.\/[^'"]+)['"]/g)) queue.push(match[1].replace(/^\.\//, ''));
    for (const match of src.matchAll(/import\(\s*['"](\.\/[^'"]+)['"]/g)) queue.push(match[1].replace(/^\.\//, ''));
    for (const match of src.matchAll(/<link[^>]*href="([^"]+\.css)"/g)) styles.add(match[1]);
  }
  const modules = new Set();
  while (queue.length) {
    const rel = queue.shift();
    if (!rel.endsWith('.js') || modules.has(rel)) continue;
    const file = resolve(STUDIO, rel);
    assert.ok(existsSync(file), `${rel} is referenced but not shipped`);
    modules.add(rel);
    const src = readFileSync(file, 'utf8');
    for (const match of [...src.matchAll(/from\s+['"](\.[^'"]+)['"]/g), ...src.matchAll(/import\(\s*['"](\.[^'"]+)['"]/g)]) {
      queue.push(relative(STUDIO, resolve(dirname(file), match[1])));
    }
  }
  return { modules, styles };
}

function shellList() {
  const sw = read('sw.js');
  const start = sw.indexOf('const SHELL = [');
  assert.notEqual(start, -1, 'sw.js must declare a SHELL list');
  const block = sw.slice(start, sw.indexOf('];', start));
  return new Set([...block.matchAll(/'([^']+)'/g)].map(match => match[1]));
}

test('the installed app precaches every module it imports', () => {
  // Network-first hides this while online. Offline - the whole reason the
  // worker exists - a module missing here is not slower, it is a failure to
  // start.
  const { modules } = importGraph();
  const shell = shellList();
  const missing = [...modules].sort().filter(file => !shell.has(file));
  assert.deepEqual(missing, [], `the service worker would leave these unavailable offline:\n  ${missing.join('\n  ')}`);
});

test('the installed app precaches every stylesheet its pages link', () => {
  const { styles } = importGraph();
  const shell = shellList();
  const missing = [...styles].sort().filter(file => !shell.has(file));
  assert.deepEqual(missing, [], `unstyled offline: ${missing.join(', ')}`);
});

test('the precache carries nothing the app never asks for', () => {
  const { modules } = importGraph();
  const shell = shellList();
  const stale = [...shell].filter(file => file.endsWith('.js') && !file.startsWith('assets/') && !modules.has(file));
  assert.deepEqual(stale, [], `dead weight in every install: ${stale.join(', ')}`);
});

test('every precached path exists in the repository', () => {
  const missing = [...shellList()]
    .filter(entry => entry !== './' && !/^https?:/.test(entry))
    .filter(entry => !existsSync(resolve(STUDIO, entry)));
  assert.deepEqual(missing, [], `the worker would fail to install: ${missing.join(', ')}`);
});

test('the shell cache name changes when the shell does', () => {
  // A stale cache name serves the previous shell to everyone who installed.
  const sw = read('sw.js');
  const match = sw.match(/const CACHE = '([^']+)'/);
  assert.ok(match, 'sw.js must name its cache');
  assert.match(match[1], /-v\d+$/, 'the cache name must carry a version suffix that can be stepped');
});
