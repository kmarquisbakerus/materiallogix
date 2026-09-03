import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const find = args => execFileSync('find', ['.', ...args], { cwd: ROOT, encoding: 'utf8' })
  .split('\n').map(line => line.trim()).filter(Boolean);

const SKIP = ['-not', '-path', './.git/*', '-not', '-path', '*/assets/human/*',
  '-not', '-path', './tests/*', '-not', '-path', '*/node_modules/*'];
const jsFiles = find(['-name', '*.js', ...SKIP]);
const htmlFiles = find(['-name', '*.html', ...SKIP]);
const cssFiles = find(['-name', '*.css', ...SKIP]);
const read = file => readFileSync(resolve(ROOT, file), 'utf8');

/**
 * Pages carry inline modules too, and those wire up real controls.
 *
 * The end tag has to be matched the way a parser ends one - on whitespace or a
 * solidus as well as on `>`. Matching only `</script>` reads `</script >` as
 * script body and silently swallows the rest of the page, so every control the
 * next script wires up would go unchecked.
 */
const inlineScripts = source => [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script[\s/]*>/gi)].map(match => match[1]).join('\n');
const allScriptSource = [...jsFiles.map(read), ...htmlFiles.map(file => inlineScripts(read(file)))].join('\n');

test('inline scripts are found however their end tag is written', () => {
  // A parser ends a script tag on whitespace or a solidus too. A scanner that
  // only knows `</script>` swallows the rest of the page from the first
  // `</script >` on, and every check built on it quietly stops looking.
  const page = ['<script>ONE</script>', '<script>TWO</script >', '<script>THREE</script\n>',
    '<script type="module">FOUR</script/>', '<script>FIVE</SCRIPT>'].join('\n');
  const found = inlineScripts(page).split('\n').filter(Boolean);
  assert.deepEqual(found, ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE']);
});

test('every shipped script parses', () => {
  for (const file of jsFiles) {
    assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', file], { cwd: ROOT, stdio: 'pipe' }), `${file} does not parse`);
  }
});

test('every element id a script looks up actually exists', () => {
  // Ids come from markup or from a script that creates them. A lookup for an
  // id that exists nowhere is a control wired to something that never renders.
  const declared = new Set();
  for (const file of [...htmlFiles, ...jsFiles]) {
    const source = read(file);
    for (const match of source.matchAll(/\sid="([A-Za-z0-9_-]+)"/g)) declared.add(match[1]);
    for (const match of source.matchAll(/\bid:\s*['"]([A-Za-z0-9_-]+)['"]/g)) declared.add(match[1]);
    for (const match of source.matchAll(/\.id\s*=\s*['"]([A-Za-z0-9_-]+)['"]/g)) declared.add(match[1]);
  }
  const orphans = [];
  for (const file of jsFiles) {
    read(file).split('\n').forEach((line, index) => {
      for (const match of line.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)) {
        if (!declared.has(match[1])) orphans.push(`${file}:${index + 1} #${match[1]}`);
      }
      for (const match of line.matchAll(/querySelector(?:All)?\(\s*['"]#([A-Za-z0-9_-]+)['"]\s*\)/g)) {
        if (!declared.has(match[1])) orphans.push(`${file}:${index + 1} #${match[1]}`);
      }
    });
  }
  assert.deepEqual(orphans, [], `scripts look up ids that never exist:\n  ${orphans.join('\n  ')}`);
});

test('every id declared in markup is used by a script, a stylesheet, or another element', () => {
  const scripts = allScriptSource;
  const styles = cssFiles.map(read).join('\n');
  const markup = htmlFiles.map(read).join('\n');
  const unused = [];
  for (const file of htmlFiles) {
    for (const match of read(file).matchAll(/\sid="([A-Za-z0-9_-]+)"/g)) {
      const id = match[1];
      const inScripts = new RegExp(`['"\`#]${id}\\b`).test(scripts);
      const inStyles = styles.includes(`#${id}`);
      const referenced = new RegExp(
        `(?:for|form|list|href|aria-controls|aria-labelledby|aria-describedby|aria-owns|aria-activedescendant|popovertarget)="[^"]*\\b${id}\\b`
      ).test(markup);
      if (!inScripts && !inStyles && !referenced) unused.push(`${file} #${id}`);
    }
  }
  assert.deepEqual(unused, [], `markup declares ids nothing uses:\n  ${unused.join('\n  ')}`);
});

test('the service worker precache lists only files that exist', () => {
  const worker = read('studio/sw.js');
  const listed = [...worker.matchAll(/'([^']+\.(?:js|css|html|svg|json|webmanifest|wav|png))'/g)].map(m => m[1]);
  assert.ok(listed.length > 10, 'expected a populated precache list');
  const missing = listed
    .map(entry => entry.replace(/^\.\//, ''))
    .filter(entry => !/^https?:/.test(entry))
    .filter(entry => {
      try { readFileSync(resolve(ROOT, 'studio', entry)); return false; } catch { return true; }
    });
  assert.deepEqual(missing, [], `the service worker precaches files that are not shipped: ${missing.join(', ')}`);
});
