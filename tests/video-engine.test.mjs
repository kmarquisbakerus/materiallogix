import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  ENABLED_VIDEO_ENGINES, EDITORIAL_PROVENANCE, resolveVideoEngine
} from '../studio/js/video-engine.js';
import { EU_MEMBER_STATES, ENGINE_PREFERENCE_KEY } from '../studio/js/model-licence.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFileSync(resolve(ROOT, file), 'utf8');

// The build under test. Injected, because the gate has to be proven against
// engines that exist, and this build ships none.
const BOTH = ['hunyuan', 'wan'];
const EXCLUDED = [...EU_MEMBER_STATES, 'GB', 'KR'];

test('no generative engine is enabled, and every render says so on the file', () => {
  // KNOWN_LIMITATIONS records that neither engine is shipped. Declaring one
  // here without the runtime behind it would put a false engine name on a
  // customer's file, and the terms promise the name is true.
  assert.deepEqual([...ENABLED_VIDEO_ENGINES], []);
  assert.match(read('KNOWN_LIMITATIONS.md'), /Pro Motion Engine is not shipped/);
  for (const country of ['US', 'IE', 'GB', 'KR', 'ZZ', null]) {
    for (const pro of [true, false]) {
      const decision = resolveVideoEngine({ country, pro });
      assert.equal(decision.generative, false, `${country} pro=${pro}`);
      assert.equal(decision.engineId, null);
      assert.equal(decision.blocked, false, 'an editorial render has no territorial question to fail on');
      assert.equal(decision.offered, false, 'there is no switch between engines that do not exist');
      assert.equal(decision.provenance, EDITORIAL_PROVENANCE);
    }
  }
  assert.match(EDITORIAL_PROVENANCE, /No generative video model was used/);
});

test('the restricted engine cannot be reached from an excluded territory, whatever the client asks for', () => {
  for (const country of EXCLUDED) {
    for (const preference of [null, 'hunyuan', 'wan', 'anything']) {
      const decision = resolveVideoEngine({ country, pro: true, preference, available: BOTH });
      assert.equal(decision.engineId, 'wan', `${country} with preference ${preference}`);
      assert.equal(decision.offered, false, `${country} must not be offered a switch`);
      assert.equal(decision.locked, true);
      assert.equal(decision.lockReason, 'not_licensed_here');
      assert.equal(decision.blocked, false, 'served, not refused');
      assert.match(decision.notice, /not licensed in your region/);
      assert.match(decision.provenance, /Wan 2\.2/);
      assert.doesNotMatch(decision.provenance, /Hunyuan/);
    }
  }
});

test('inside the territory a Pro customer has the switch, and it defaults to the Pro engine', () => {
  for (const country of ['US', 'CA', 'MX', 'BR', 'JP', 'AU', 'NO', 'CH']) {
    const byDefault = resolveVideoEngine({ country, pro: true, available: BOTH });
    assert.equal(byDefault.engineId, 'hunyuan', country);
    assert.equal(byDefault.offered, true, `${country} may choose`);
    assert.equal(byDefault.locked, false);
    assert.match(byDefault.provenance, /HunyuanVideo/);
    assert.match(byDefault.provenance, /European Union, the United Kingdom and South Korea/,
      'the file must say where its own use is restricted');

    const unrestricted = resolveVideoEngine({ country, pro: true, preference: 'wan', available: BOTH });
    assert.equal(unrestricted.engineId, 'wan', `${country} may opt out of the restriction`);
    assert.match(unrestricted.provenance, /no territorial restriction/);
  }
});

test('a standard plan never sees the restricted engine anywhere', () => {
  for (const country of ['US', 'IE', 'JP']) {
    const decision = resolveVideoEngine({ country, pro: false, preference: 'hunyuan', available: BOTH });
    assert.equal(decision.engineId, 'wan', country);
    assert.equal(decision.offered, false);
  }
});

test('an unconfirmed region stops a generative render rather than guessing', () => {
  for (const country of [null, '', 'ZZ', 'XX', 'usa', '1']) {
    const decision = resolveVideoEngine({ country, pro: true, available: BOTH });
    assert.equal(decision.blocked, true, `"${country}" is not a country we can decide on`);
    assert.equal(decision.engineId, null);
    assert.match(decision.notice, /could not confirm your region/);
  }
});

test('a build that ships only the restricted engine refuses the excluded territory instead of running it', () => {
  const only = ['hunyuan'];
  const dublin = resolveVideoEngine({ country: 'IE', pro: true, available: only });
  assert.equal(dublin.blocked, true, 'nothing licensed for Dublin is installed');
  assert.equal(dublin.engineId, null);
  const ohio = resolveVideoEngine({ country: 'US', pro: true, available: only });
  assert.equal(ohio.engineId, 'hunyuan');
  assert.equal(ohio.offered, false, 'one engine is not a choice');
});

test('the render path is the only product code that reads the engine licence', () => {
  // The gate is worthless if a second caller can ask model-licence.js directly
  // and get a different answer. app.js may import the two engine ids for its
  // labels; every decision goes through video-engine.js.
  const offenders = [];
  const files = ['studio/js/app.js', 'studio/js/cloud-video.js', 'studio/js/generate.js', 'studio/js/export.js',
    'studio/js/video-plan.js', 'studio/js/studio-shell.js', 'studio/js/bootstrap.js'];
  for (const file of files) {
    const source = read(file);
    for (const match of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*'\.\/model-licence\.js'/g)) {
      const names = match[1].split(',').map(name => name.trim()).filter(Boolean);
      const decisions = names.filter(name => !/^(PRO_VIDEO_ENGINE|STANDARD_VIDEO_ENGINE)$/.test(name));
      if (decisions.length) offenders.push(`${file} imports ${decisions.join(', ')}`);
    }
  }
  assert.deepEqual(offenders, [], offenders.join('\n'));
  assert.match(read('studio/js/app.js'), /videoEngineForThisCustomer\(/, 'app.js must ask the gate');
});

test('both render paths ask the gate and put its answer on the job', () => {
  const app = read('studio/js/app.js');
  const asks = app.match(/await videoEngineForThisCustomer\(/g) || [];
  assert.ok(asks.length >= 2, `local and cloud renders must both ask; found ${asks.length}`);
  assert.match(app, /if \(engine\.blocked\) return toast\(engine\.notice, true\)/,
    'a blocked decision must stop the render with the reason');
  assert.match(app, /engine: engine\?\.engineId \|\| null/, 'the decision travels in the render options');
  assert.match(app, /engine: \{ id: plan\.opts\.engine, region: engine\.country/, 'the cloud manifest names engine and region');
  assert.match(app, /rendered\.provenance = [^\n]*\$\{plan\.provenance\}/, 'the produced file carries the provenance line');
});

test('the stored preference key is the one model-licence declares', () => {
  const source = read('studio/js/video-engine.js');
  assert.match(source, /ENGINE_PREFERENCE_KEY/);
  assert.equal(ENGINE_PREFERENCE_KEY, 'cros:videoEngine');
});
