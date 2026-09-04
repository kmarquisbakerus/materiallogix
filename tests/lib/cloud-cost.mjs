// What a cloud job actually costs us, measured rather than argued about.
//
// Three of the four cloud lanes were priced from reasoning, not measurement:
// only video has a real figure behind it, and that one is extrapolated from a
// single ten-second run. A price with no fixture under it is a guess wearing a
// decimal point, so this module makes the gap visible and testable - a lane
// cannot be switched on until a fixture exists for it.
//
// Fixtures carry no prompts, no filenames, no customer data: a GPU model, some
// timings, and what the provider billed.

export const COST_FIXTURE_SCHEMA = 'materiallogix.cloud-cost-fixture.v1';

const positive = (value, label) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${label} must be a number at or above zero.`);
  return n;
};

/**
 * Record one measured run. `outputUnits` is what the customer bought - output
 * minutes for video and voice, images for photo, profiles for conditioning -
 * so the fixture divides cost by the same thing the price multiplies.
 */
export function recordCostFixture({
  lane, unit, outputUnits, gpuModel = '', gpuHourlyCents, gpuSeconds,
  wallSeconds, providerBilledCents = null, samples = 1, note = ''
}) {
  if (!lane || !unit) throw new Error('A fixture needs a lane and a unit.');
  const units = positive(outputUnits, 'Output units');
  if (units <= 0) throw new Error('A fixture needs at least one output unit.');
  const hourly = positive(gpuHourlyCents, 'GPU hourly rate');
  const gpu = positive(gpuSeconds, 'GPU seconds');
  const wall = positive(wallSeconds, 'Wall seconds');
  const runs = Math.max(1, Math.floor(Number(samples) || 1));

  // Bill for the pod's whole life, not just the part that computed. Idle
  // spin-up is most of a short job's cost and it is the easiest thing to
  // forget, which is how a lane ends up looking free.
  const billedSeconds = Math.max(gpu, wall);
  const derivedCents = (billedSeconds / 3600) * hourly;
  const totalCents = providerBilledCents === null ? derivedCents : positive(providerBilledCents, 'Provider billed');

  return Object.freeze({
    schema: COST_FIXTURE_SCHEMA,
    lane, unit,
    outputUnits: units,
    gpuModel: String(gpuModel).slice(0, 120),
    gpuHourlyCents: hourly,
    gpuSeconds: gpu,
    wallSeconds: wall,
    idleSeconds: Math.max(0, wall - gpu),
    centsPerUnit: +(totalCents / units).toFixed(4),
    totalCents: +totalCents.toFixed(4),
    samples: runs,
    // One run of one length proves almost nothing about the next one.
    confidence: runs >= 3 && units >= 2 ? 'measured' : 'indicative',
    note: String(note).slice(0, 200),
    recordedAt: new Date().toISOString()
  });
}

/**
 * The fixtures we hold. `null` means nobody has measured that lane yet, and
 * says so out loud rather than letting a derived number pass for a measured
 * one.
 */
export const COST_FIXTURES = Object.freeze({
  // decisions.md: native 4K on a community RTX 4090 pool at $0.34/hr.
  // One ten-second run, so indicative, not measured.
  video: recordCostFixture({
    lane: 'video', unit: 'output minute', outputUnits: 1,
    gpuModel: 'community RTX 4090', gpuHourlyCents: 34,
    gpuSeconds: 11100, wallSeconds: 13875, providerBilledCents: 131, samples: 1,
    note: 'Extrapolated from a single 10s run; the 60s checkpoint has not been run.'
  }),
  voice_render: null,
  voice_training: null,
  photo: null
});

/** Measured cost per unit, or null when the lane has never been measured. */
export function costCentsPerUnit(lane) {
  const fixture = COST_FIXTURES[lane];
  return fixture ? fixture.centsPerUnit : null;
}

/** Lanes still priced on reasoning alone. Empty is the goal. */
export function unmeasuredLanes() {
  return Object.keys(COST_FIXTURES).filter(lane => !COST_FIXTURES[lane]);
}

/** Lanes measured from too little to trust. */
export function indicativeLanes() {
  return Object.keys(COST_FIXTURES).filter(lane => COST_FIXTURES[lane]?.confidence === 'indicative');
}

/**
 * What a lane would have to charge to clear a target margin. Not a price - a
 * floor to check a proposed price against, so nobody sets one below cost by
 * accident.
 */
export function priceFloorCents(lane, marginTarget = 0.7) {
  const cost = costCentsPerUnit(lane);
  if (cost === null) return null;
  const margin = Math.min(0.99, Math.max(0, Number(marginTarget) || 0));
  return Math.ceil(cost / (1 - margin));
}
