import test from 'node:test';
import assert from 'node:assert/strict';
import {
  recordCostFixture, COST_FIXTURES, costCentsPerUnit, unmeasuredLanes, indicativeLanes, priceFloorCents
} from '../studio/js/cloud-cost.js';
import { CLOUD_PRICING } from '../studio/js/pricing.js';

const LANE_RATES = {
  video: 'videoUpscale',
  voice_render: 'voiceRender',
  voice_training: 'voiceTraining',
  photo: 'imageUpscale'
};

test('a cloud lane cannot be switched on without a measured cost', () => {
  // Three of the four lanes are priced from reasoning. A price with no fixture
  // under it is a guess wearing a decimal point, and it must not reach a
  // customer.
  for (const [lane, rateKey] of Object.entries(LANE_RATES)) {
    const rate = CLOUD_PRICING[rateKey];
    if (!rate?.available) continue;
    const cost = costCentsPerUnit(lane);
    assert.notEqual(cost, null, `${lane} is switched on with no cost fixture`);
    assert.ok(rate.price * 100 > cost, `${lane} is sold at ${rate.price} against a measured ${cost / 100}`);
  }
});

test('the lanes still waiting on a measurement say so', () => {
  assert.deepEqual(unmeasuredLanes().sort(), ['photo', 'voice_render', 'voice_training']);
  assert.deepEqual(indicativeLanes(), ['video'], 'one ten-second run is indicative, not measured');
  assert.equal(costCentsPerUnit('voice_render'), null);
  assert.equal(priceFloorCents('voice_render'), null, 'no fixture means no floor to check against');
});

test('a fixture bills the pod for its whole life, not just the busy part', () => {
  // Idle spin-up is most of a short job's cost and the easiest thing to forget,
  // which is how a lane ends up looking free.
  const idle = recordCostFixture({
    lane: 'voice_render', unit: 'output minute', outputUnits: 1,
    gpuHourlyCents: 34, gpuSeconds: 6, wallSeconds: 2400, samples: 1
  });
  assert.equal(idle.idleSeconds, 2394);
  assert.equal(idle.centsPerUnit, +((2400 / 3600) * 34).toFixed(4));
  assert.ok(idle.centsPerUnit > 22, 'a job that idles for forty minutes is not free');

  const busy = recordCostFixture({
    lane: 'video', unit: 'output minute', outputUnits: 1,
    gpuHourlyCents: 34, gpuSeconds: 3600, wallSeconds: 100, samples: 1
  });
  assert.equal(busy.centsPerUnit, 34, 'when compute outlasts the wall clock, compute wins');
});

test('a fixture is honest about how little it proves', () => {
  const one = recordCostFixture({
    lane: 'photo', unit: 'image', outputUnits: 1,
    gpuHourlyCents: 34, gpuSeconds: 20, wallSeconds: 60, samples: 1
  });
  assert.equal(one.confidence, 'indicative', 'one run of one unit proves almost nothing');
  const many = recordCostFixture({
    lane: 'photo', unit: 'image', outputUnits: 10,
    gpuHourlyCents: 34, gpuSeconds: 200, wallSeconds: 400, samples: 5
  });
  assert.equal(many.confidence, 'measured');
  assert.ok(many.centsPerUnit < one.centsPerUnit, 'a batch amortises the spin-up');
});

test('a fixture refuses nonsense rather than recording it', () => {
  const base = { lane: 'photo', unit: 'image', outputUnits: 1, gpuHourlyCents: 34, gpuSeconds: 1, wallSeconds: 1 };
  assert.throws(() => recordCostFixture({ ...base, lane: '' }), /lane and a unit/);
  assert.throws(() => recordCostFixture({ ...base, outputUnits: 0 }), /at least one output unit/);
  assert.throws(() => recordCostFixture({ ...base, gpuSeconds: -1 }), /at or above zero/);
  assert.throws(() => recordCostFixture({ ...base, gpuHourlyCents: NaN }), /at or above zero/);
});

test('a fixture carries no customer data', () => {
  const fixture = COST_FIXTURES.video;
  const allowed = new Set(['schema', 'lane', 'unit', 'outputUnits', 'gpuModel', 'gpuHourlyCents',
    'gpuSeconds', 'wallSeconds', 'idleSeconds', 'centsPerUnit', 'totalCents', 'samples',
    'confidence', 'note', 'recordedAt']);
  for (const key of Object.keys(fixture)) assert.ok(allowed.has(key), `fixture leaks "${key}"`);
});
