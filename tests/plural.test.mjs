import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { count, nounFor } from '../studio/js/plural.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('a counted phrase agrees with its number', () => {
  assert.equal(count(0, 'asset'), '0 assets');
  assert.equal(count(1, 'asset'), '1 asset');
  assert.equal(count(2, 'asset'), '2 assets');
  assert.equal(count(1, 'fix', 'fixes'), '1 fix');
  assert.equal(count(3, 'fix', 'fixes'), '3 fixes');
});

test('large counts are grouped for reading', () => {
  assert.equal(count(1200, 'placement'), '1,200 placements');
});

test('unusable values still read as a sentence fragment', () => {
  for (const value of [null, undefined, NaN, 'x', {}]) assert.equal(count(value, 'asset'), '0 assets');
  assert.equal(nounFor(-1, 'asset'), 'asset', 'one of anything is singular in either direction');
});

test('no shipped copy falls back to a "(s)" placeholder', () => {
  const files = execFileSync('find', ['.', '-name', '*.js', '-o', '-name', '*.html'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').map(line => line.trim())
    .filter(file => file && !file.startsWith('./.git') && !file.includes('/assets/human/') && !file.startsWith('./tests/'));
  const offenders = [];
  for (const file of files) {
    if (file.endsWith('plural.js')) continue;
    readFileSync(resolve(ROOT, file), 'utf8').split('\n').forEach((line, index) => {
      // Only look inside string literals, so a call like `toGray(s)` is not copy.
      if (line.trim().startsWith('//')) return;
      // Counted copy is an interpolated number followed by a "(s)" noun, or a
      // plain sentence containing one. A call such as `toGray(s)` is neither.
      const counted = /`[^`]*\$\{[^`]*\w\(e?s\)/.test(line);
      const sentence = (line.match(/'[A-Za-z][^']*'|"[A-Za-z][^"]*"/g) || []).some(text => /\w\(e?s\)/.test(text));
      if (counted || sentence) {
        offenders.push(`${file}:${index + 1} ${line.trim().slice(0, 90)}`);
      }
    });
  }
  assert.deepEqual(offenders, [], `copy must count properly:\n  ${offenders.join('\n  ')}`);
});
