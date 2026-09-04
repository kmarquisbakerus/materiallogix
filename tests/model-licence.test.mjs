import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ENGINE_LICENCES, EU_MEMBER_STATES, HUNYUAN_EXCLUDED, VIDEO_ENGINE_PREFERENCE,
  engineAllowedIn, videoEngineFor, engineNoticeFor, usableCountry
} from '../studio/js/model-licence.js';

// Tencent Hunyuan Community License §1(l): "'Territory' shall mean the
// worldwide territory, excluding the territory of the European Union, United
// Kingdom and South Korea."
const EXCLUDED = [...EU_MEMBER_STATES, 'GB', 'KR'];

test('the excluded territory is exactly the one the licence names', () => {
  assert.equal(EU_MEMBER_STATES.length, 27, 'the EU has 27 member states');
  assert.equal(new Set(EU_MEMBER_STATES).size, 27, 'a member state is listed twice');
  assert.deepEqual([...HUNYUAN_EXCLUDED].sort(), [...EXCLUDED].sort());
  for (const country of EXCLUDED) {
    assert.equal(engineAllowedIn('hunyuan', country), false, `${country} is excluded by the licence`);
  }
  // The licence says "European Union". The EEA states that are not members,
  // and Switzerland, are outside the exclusion as drafted - refusing them
  // would be over-blocking, which is its own harm.
  for (const country of ['NO', 'IS', 'LI', 'CH']) {
    assert.equal(engineAllowedIn('hunyuan', country), true, `${country} is not in the EU`);
  }
  for (const country of ['US', 'CA', 'MX', 'BR', 'JP', 'AU', 'IN']) {
    assert.equal(engineAllowedIn('hunyuan', country), true, country);
  }
});

test('an excluded customer is served, not refused', () => {
  // Wan 2.2 is Apache-2.0 with no territorial condition, so an EU customer
  // gets a working product rather than an error.
  assert.equal(ENGINE_LICENCES.wan.licence, 'Apache-2.0');
  assert.deepEqual([...ENGINE_LICENCES.wan.excludedTerritories], []);
  for (const country of EXCLUDED) {
    const notice = engineNoticeFor(country);
    assert.equal(notice.engine?.id, 'wan', `${country} has no engine`);
    assert.equal(notice.blocked, false);
    assert.equal(notice.rerouted, true);
    assert.match(notice.message, /Wan 2\.2/);
  }
  assert.equal(videoEngineFor('US').id, 'hunyuan', 'the preferred engine is used where it is licensed');
  assert.equal(engineNoticeFor('US').rerouted, false);
  assert.equal(engineNoticeFor('US').message, '');
  assert.equal(VIDEO_ENGINE_PREFERENCE[0], 'hunyuan');
});

test('an unknown location is refused, never guessed', () => {
  // Failing open here would guess in the one direction that breaks the licence.
  for (const bad of [null, undefined, '', 'U', 'USA', 'united states', 12, {}]) {
    assert.equal(usableCountry(bad), null, JSON.stringify(bad));
    assert.equal(engineAllowedIn('hunyuan', bad), false);
    assert.equal(engineNoticeFor(bad).blocked, true);
  }
  // ISO 3166-1 reserves these for private use: they name no country and must
  // never clear a territory check.
  for (const reserved of ['AA', 'ZZ', 'QM', 'QZ', 'XA', 'XK', 'XZ']) {
    assert.equal(usableCountry(reserved), null, reserved);
    assert.equal(engineAllowedIn('hunyuan', reserved), false, reserved);
  }
  assert.equal(usableCountry('  de  '), 'DE', 'a stray space is not a compliance event');
  assert.equal(usableCountry('us'), 'US');
});

test('an unknown engine is never allowed anywhere', () => {
  for (const country of ['US', 'DE', 'GB']) {
    assert.equal(engineAllowedIn('nope', country), false);
    assert.equal(engineAllowedIn('', country), false);
    assert.equal(engineAllowedIn(undefined, country), false);
  }
});

test('the licence terms that bind us are recorded, not remembered', () => {
  const hunyuan = ENGINE_LICENCES.hunyuan;
  // §5(c) restricts the Output, not only the model: rendering inside the
  // Territory and displaying the result outside it is still unlicensed. This
  // flag is why the gate is on the customer's location and not the server's.
  assert.equal(hunyuan.restrictsOutput, true);
  assert.equal(hunyuan.commercial, true);
  assert.equal(hunyuan.monthlyActiveUserCeiling, 100_000_000);   // §4
  assert.equal(hunyuan.mayImproveOtherModels, false);            // §5(b)
  assert.equal(hunyuan.licence, 'Tencent Hunyuan Community License Agreement');
});
