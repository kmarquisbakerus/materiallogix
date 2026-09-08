import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const app = readFileSync(resolve(ROOT, 'studio/js/app.js'), 'utf8');

/** Slice one top-level function body out of app.js by matching braces. */
function functionBody(name) {
  const start = app.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.notEqual(start, -1, `${name} not found in app.js`);
  let depth = 0;
  for (let i = app.indexOf('{', start); i < app.length; i++) {
    if (app[i] === '{') depth++;
    else if (app[i] === '}' && --depth === 0) return app.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces in ${name}`);
}

// Local production jobs cost nothing to run but are licensed capability, and
// the Usage ledger promises every production operation is visible. Each one
// therefore has to reserve before the work, settle the delivered artifact, and
// return the reservation when the job does not deliver. A flow that loses any
// of the three either bills for nothing or works for free and unrecorded.
// `startVideoRender` is the body of the video render; `renderEditedVideo` is
// the synchronous re-entry guard wrapped around it, so the metering lives in
// the former.
const LOCAL_PRODUCTION_FLOWS = ['generativeFillDialog', 'upscaleAsset', 'startVideoRender'];

for (const name of LOCAL_PRODUCTION_FLOWS) {
  test(`${name} reserves, settles, and releases its usage`, () => {
    const body = functionBody(name);
    assert.match(body, /authorizeOutbound\(/, `${name} must reserve usage before starting work`);
    assert.match(body, /settleOutbound(?:BeforeDelivery)?\(/, `${name} must settle the delivered artifact`);
    assert.match(body, /releaseUsage\(/, `${name} must return the reservation when it fails`);
  });
}

test('Generative Fill reserves photo usage as a local processing job', () => {
  const body = functionBody('generativeFillDialog');
  assert.match(body, /authorizeOutbound\(\{\s*product:\s*'photo',\s*artifactKind:\s*'upload',\s*quantity:\s*1\s*\}\)/,
    'Generative Fill must be recorded against Photo as a local processing job, matching Photo enhancement');
});

test('Generative Fill refuses before touching the engine when it is not authorized', () => {
  const body = functionBody('generativeFillDialog');
  const authorizeAt = body.indexOf('authorizeOutbound(');
  const engineAt = body.indexOf('inpaintOne(');
  assert.ok(authorizeAt > -1 && engineAt > -1);
  assert.ok(authorizeAt < engineAt, 'authorization has to happen before the engine is asked to do work');
  assert.match(body.slice(authorizeAt, engineAt), /if \(!authorization\.ok\)/,
    'an unauthorized fill must return instead of falling through to the engine');
});

test('no customer-facing failure text names the third-party engine', () => {
  const generate = readFileSync(resolve(ROOT, 'studio/js/generate.js'), 'utf8');
  const thrown = [...generate.matchAll(/throw new Error\(([`'][^`']*[`'])/g)].map(match => match[1]);
  const leaking = thrown.filter(text => /comfy/i.test(text));
  assert.deepEqual(leaking, [], `errors shown to customers must not name the engine: ${leaking.join(', ')}`);
});
