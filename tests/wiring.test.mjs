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
 * The end tag has to be matched the way a parser ends one. After `</script`,
 * whitespace or a solidus moves the tokenizer into attribute parsing, and
 * everything up to the `>` is read and discarded - so `</script >`,
 * `</script/>` and even `</script\t\n bar>` all close the element, while
 * `</scriptfoo>` does not. Matching only `</script>` reads the rest as script
 * body and silently swallows the page, leaving every control the following
 * scripts wire up unchecked.
 */
const inlineScripts = source => [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script(?:[\s/][^>]*)?>/gi)].map(match => match[1]).join('\n');
const allScriptSource = [...jsFiles.map(read), ...htmlFiles.map(file => inlineScripts(read(file)))].join('\n');

test('inline scripts are found however their end tag is written', () => {
  // A parser ends a script tag on whitespace or a solidus too. A scanner that
  // only knows `</script>` swallows the rest of the page from the first
  // `</script >` on, and every check built on it quietly stops looking.
  const page = ['<script>ONE</script>', '<script>TWO</script >', '<script>THREE</script\n>',
    '<script type="module">FOUR</script/>', '<script>FIVE</SCRIPT>', '<script>SIX</script\t\n bar>'].join('\n');
  const found = inlineScripts(page).split('\n').filter(Boolean);
  assert.deepEqual(found, ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX']);
  // A name that only starts with "script" is not an end tag, so the element
  // stays open and the scanner must not treat it as one.
  assert.deepEqual(inlineScripts('<script>KEPT</scriptfoo>').split('\n').filter(Boolean), []);
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

test('every page a paid customer can be returned to redeems the claim', () => {
  // checkout-result.js shipped for weeks loaded by nothing at all: a customer
  // paid, Stripe redirected them back, and no code ever exchanged the claim for
  // a licence. The billing service picks the success URL, so every plausible
  // landing page has to be able to finish the purchase.
  const missing = ['studio/index.html', 'studio/voice.html', 'studio/usage.html', 'studio/admin.html']
    .filter(page => !/checkout-result\.js/.test(read(page)));
  assert.deepEqual(missing, [], `a paid return to these pages leaves the customer unlicensed: ${missing.join(', ')}`);
  assert.match(read('checkout-site.js'), /checkout-result\.js/,
    'the marketing homepage is a valid success URL too and must redeem a claim');
});

test('the claim redemption runs after the page it lands on has booted', () => {
  // The module has a top-level await on a network call. Placed before the
  // Studio's own scripts it holds the whole page on that request, and it
  // executes before anything else has read the query string.
  for (const page of ['studio/index.html', 'studio/voice.html', 'studio/usage.html', 'studio/admin.html']) {
    const source = read(page);
    const tags = [...source.matchAll(/<script[^>]*\btype="module"[^>]*>/gi)];
    const last = tags[tags.length - 1];
    assert.ok(/checkout-result\.js/.test(last[0]),
      `${page} must load checkout-result.js last; it currently loads ${last[0]}`);
  }
});

test('redeeming a claim strips only the claim from the address bar', () => {
  // Clearing the whole query took the project id, the demo flag and the entry
  // hint with it, so a customer returning to a specific project lost it.
  const source = read('studio/js/checkout-result.js');
  assert.ok(!/\.search\s*=\s*''/.test(source),
    'the return handler must not blank the whole query string');
  assert.match(source, /searchParams\.delete/);
  for (const param of ['checkout', 'session_id', 'claim']) {
    assert.ok(source.includes(`'${param}'`), `${param} must be removed from the address bar`);
  }
  assert.match(source, /AbortSignal\.timeout/,
    'an unanswered fulfilment lookup must not hold the page open forever');
});

test('the journey ignores only the console lines that are provably not errors', async () => {
  // A native library banner on the error channel - the face-detection engine's
  // TensorFlow Lite backend announcing itself on a CPU that picks the XNNPACK
  // delegate, which is every CI runner - failed the whole browser suite while
  // all 62 of its checks passed. The remedy has to stay narrow: a broad filter
  // here would hide the console errors that suite exists to catch.
  const { isBenignConsoleLine } = await import('./browser/harness.mjs');
  for (const benign of [
    'INFO: Created TensorFlow Lite XNNPACK delegate for CPU.',
    'Failed to load resource: net::ERR_CONNECTION_REFUSED',
    'net::ERR_TUNNEL_CONNECTION_FAILED'
  ]) assert.equal(isBenignConsoleLine(benign), true, benign);

  for (const real of [
    'Uncaught TypeError: x is not a function',
    'TypeError: Cannot read properties of null',
    'Refused to connect to https://evil.example',
    'INFO: Created TensorFlow Lite XNNPACK delegate for CPU. Uncaught TypeError',
    'Uncaught (in promise) Error: license_required'
  ]) assert.equal(isBenignConsoleLine(real), false, real);
});

test('a Studio left open notices it has gone stale, wherever it is running', () => {
  // "The hosted app is always current, so it skips" was true of a fresh load
  // and false of what customers do, which is leave the tab open. After a
  // deploy the page keeps its old modules while the refreshed service worker
  // serves new ones to any later dynamic import - two versions in one page,
  // with nothing on screen to say so.
  const nav = read('studio/js/studio-nav.js');
  assert.ok(!/if \(location\.hostname === 'materiallogix\.com'\) return;/.test(nav),
    'the hosted app must not skip the update check');
  assert.match(nav, /checkForUpdates\(\)/, 'the check must still run');
  // Hosted, the remedy is a reload; installed, it is a download. Offering a
  // download to somebody already on the site sends them hunting an installer.
  assert.match(nav, /location\.reload\(\)/);
  assert.match(nav, /HOSTED \? 'Reload' : 'Get the update'/);
  // The stamp is still never trusted into markup.
  assert.match(nav, /const semver = \/\^\\d\+\\\.\\d\+\\\.\\d\+\$\//);
  assert.ok(!/\.innerHTML\s*=|insertAdjacentHTML/.test(nav),
    'a fetched version string must never reach innerHTML');

  const stamp = JSON.parse(read('studio/version.json'));
  assert.match(stamp.version, /^\d+\.\d+\.\d+$/, 'the live stamp must be strict semver or the bar never shows');
  assert.match(stamp.minimum, /^\d+\.\d+\.\d+$/);
  assert.match(read('studio/js/app-version.js'), new RegExp(`APP_VERSION = '${stamp.version}'`),
    'the shipped version and the published stamp must agree, or every fresh load claims to be stale');
});
