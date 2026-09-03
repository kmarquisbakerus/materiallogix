import test from 'node:test';
import assert from 'node:assert/strict';
import { PACE, paceTarget, idealAngle, paceTrace, paceTraceSvg, paceGuideSvg, tickPlan } from '../studio/js/capture-pacer.js';
import { FACE_GUIDANCE, BODY_GUIDANCE, guidanceFor, retryAdvice, voiceGuidance, GUARDIAN_ACK_TEXT, GUARDIAN_ACK_KEY } from '../studio/js/capture-guidance.js';
import { namedLandmarks, landmarkBounds, foregroundMaskSummary, spatialGeometryModel, geometryAssurance, humanGeometryRecord, POSE_LANDMARK_CODES, HUMAN_GEOMETRY_SCHEMA } from '../studio/js/human-geometry.js';

test('both capture kinds declare a full sweep and a pace to walk it', () => {
  for (const kind of ['face', 'body']) {
    const target = paceTarget(kind);
    assert.ok(target.seconds > 0, `${kind} duration`);
    assert.ok(target.sweepDeg > 0, `${kind} sweep`);
    assert.ok(target.maxJumpDeg > 0, `${kind} jump limit`);
    assert.ok(Math.abs(target.degreesPerSecond - target.sweepDeg / target.seconds) < 1e-9, `${kind} pace`);
  }
  assert.equal(paceTarget('face').sweepDeg, 180, 'a face turns profile to profile');
  assert.equal(paceTarget('body').sweepDeg, 360, 'a body turns all the way round');
  // A capture kind is a program decision, not user input: an unknown one is a
  // bug to surface, not a default to silently walk.
  assert.throws(() => paceTarget('nonsense'), /Unknown capture kind/);
});

test('the ideal angle starts at the sweep start, reaches the end, and holds there', () => {
  for (const kind of ['face', 'body']) {
    const { seconds, sweepDeg, start } = paceTarget(kind);
    assert.equal(idealAngle(kind, 0), start);
    const mid = idealAngle(kind, seconds / 2);
    assert.ok(mid > start && mid < start + sweepDeg, `${kind} midpoint ${mid}`);
    assert.ok(Math.abs(idealAngle(kind, seconds) - (start + sweepDeg)) < 1e-6, `${kind} end`);
    assert.ok(idealAngle(kind, seconds * 5) <= start + sweepDeg + 1e-6, `${kind} must not run past the sweep`);
    assert.equal(idealAngle(kind, -10), start, 'before the start is the start');
    for (const bad of [NaN, undefined, null, 'x', Infinity]) {
      assert.equal(idealAngle(kind, bad), start, `an unusable time (${String(bad)}) reads as the start, never NaN`);
    }
  }
});

test('a pace trace reports steps and a verdict, and renders without NaN', () => {
  const empty = paceTrace('face', {}, 0);
  assert.deepEqual(empty.steps, []);
  assert.equal(empty.verdict, 'unknown', 'nothing captured is not a pass');
  assert.equal(paceTraceSvg(empty, 320, 34), '', 'nothing measured draws nothing');

  const measured = paceTrace('face', { frames: [{ at: 0, yawDeg: -90 }, { at: 8, yawDeg: 0 }, { at: 16, yawDeg: 90 }] }, 16);
  const svg = paceTraceSvg(measured, 320, 34);
  if (svg) {
    assert.match(svg, /^<svg/);
    assert.match(svg, /viewBox="0 0 320 34"/);
    assert.ok(!/undefined|NaN/.test(svg), 'a trace never renders undefined or NaN');
  }
});

test('the pace guide renders for every kind and never emits NaN', () => {
  for (const kind of ['face', 'body']) {
    for (const elapsed of [0, 1.5, 999, -1]) {
      const svg = paceGuideSvg(kind, elapsed, 160);
      assert.match(svg, /^<svg/, `${kind} ${elapsed}`);
      assert.ok(!/NaN|undefined/.test(svg), `${kind} at ${elapsed}s emitted NaN`);
    }
  }
});

test('the metronome ticks are ordered, inside the capture, and mark the last one', () => {
  for (const kind of ['face', 'body']) {
    const { seconds } = paceTarget(kind);
    const ticks = tickPlan(kind, 12);
    assert.equal(ticks.length, 12, kind);
    for (let i = 1; i < ticks.length; i++) {
      assert.ok(ticks[i].at > ticks[i - 1].at, `${kind} ticks must move forward`);
    }
    assert.ok(ticks.every(tick => Number.isFinite(tick.at) && tick.at > 0 && tick.at <= seconds + 1e-9), `${kind} tick outside the capture`);
    assert.ok(ticks.every(tick => Number.isFinite(tick.hz) && tick.hz > 0), `${kind} tick has no tone`);
    assert.equal(ticks.filter(tick => tick.last).length, 1, `${kind} must mark exactly one final tick`);
    assert.equal(ticks[ticks.length - 1].last, true);
  }
});

test('guidance names the shot and lists the steps for both kinds', () => {
  for (const kind of ['face', 'body']) {
    const guidance = guidanceFor(kind, null);
    assert.ok(guidance.title, `${kind} title`);
    assert.ok(guidance.target, `${kind} target`);
    assert.ok(Array.isArray(guidance.steps) && guidance.steps.length, `${kind} steps`);
    assert.ok(guidance.steps.every(step => typeof step === 'string' && step.length), `${kind} step text`);
  }
  assert.throws(() => guidanceFor('unknown', null), /Unknown capture kind/);
  assert.equal(guidanceFor('face', null).title, FACE_GUIDANCE.title);
  assert.equal(guidanceFor('body', null).title, BODY_GUIDANCE.title);
});

test('retry advice is a list, specific when short and quiet when complete', () => {
  const short = retryAdvice('face', { yawSpreadDeg: 20, gaps: [{}, {}] });
  assert.ok(Array.isArray(short) && short.length >= 2, 'a short, jumpy capture gets advice');
  assert.ok(short.every(line => typeof line === 'string' && line.length));
  assert.deepEqual(retryAdvice('face', { yawSpreadDeg: 180, gaps: [] }), [], 'a complete face turn needs no advice');
  assert.deepEqual(retryAdvice('body', { coveredBuckets: 8 }), [], 'a complete circle needs no advice');
  assert.deepEqual(retryAdvice('body', { coveredBuckets: 2 }), ['Complete the full circle without stopping.']);
  assert.deepEqual(retryAdvice('face', { yawSpreadDeg: 180, gaps: [], flags: ['Too dark.'] }), ['Too dark.'],
    'measured flags are passed through verbatim');
  // A capture that produced no report at all is exactly when advice is needed.
  for (const coverage of [undefined, null]) {
    assert.ok(Array.isArray(retryAdvice('face', coverage)), JSON.stringify(coverage));
  }
});

test('the guardian acknowledgement names the ages it covers and has a stable key', () => {
  assert.match(GUARDIAN_ACK_TEXT, /18 or older/);
  assert.match(GUARDIAN_ACK_TEXT, /13/);
  assert.match(GUARDIAN_ACK_TEXT, /under 13 are not permitted/);
  assert.match(GUARDIAN_ACK_KEY, /^[a-z]+:[a-z-]+$/);
});

test('voice guidance renders for a plan and for nothing at all', () => {
  assert.doesNotThrow(() => voiceGuidance(null));
  assert.doesNotThrow(() => voiceGuidance({ segments: [], totalWords: 0 }));
});

test('landmarks are named against their code list and bounded', () => {
  const points = POSE_LANDMARK_CODES.map((_, index) => ({ x: 0.1 + index / 200, y: 0.2 + index / 300, z: 0, score: 0.9 }));
  const named = namedLandmarks(points, POSE_LANDMARK_CODES);
  assert.equal(named.length, POSE_LANDMARK_CODES.length);
  assert.ok(named.every(point => typeof point.code === 'string' && point.code.length), 'every landmark is named');
  assert.equal(named[0].code, POSE_LANDMARK_CODES[0]);
  assert.ok(named.every(point => point.method === 'model-inference'), 'the record says how the point was obtained');
  const bounds = landmarkBounds(named);
  assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.w > 0 && bounds.h > 0, JSON.stringify(bounds));
});

test('landmark helpers survive empty and malformed input', () => {
  assert.deepEqual(namedLandmarks([], POSE_LANDMARK_CODES), []);
  assert.deepEqual(namedLandmarks(undefined, undefined), []);
  // No landmarks means no bounds - a zero rectangle would read as a real one.
  assert.equal(landmarkBounds([]), null);
  assert.equal(landmarkBounds(undefined), null);
});

test('a foreground mask summarises to a fraction, never past everything', () => {
  const values = new Float32Array(16 * 16).fill(1);
  const all = foregroundMaskSummary(values, 16, 16, 0.5);
  assert.ok(all.coverage <= 1 + 1e-9 && all.coverage > 0.99, JSON.stringify(all));
  const none = foregroundMaskSummary(new Float32Array(16 * 16), 16, 16, 0.5);
  assert.ok(none.coverage < 1e-9, JSON.stringify(none));
});

test('the geometry record is schema-tagged and safe when nothing was detected', () => {
  const record = humanGeometryRecord({ engine: 'test', engineVersion: '1', faces: [], hands: [], poses: [] });
  assert.equal(record.schema, HUMAN_GEOMETRY_SCHEMA);
  assert.ok(record.at, 'a record is timestamped');
  const model = spatialGeometryModel({});
  assert.ok(model, 'an empty scene still models');
  const assurance = geometryAssurance({});
  assert.ok(assurance, 'an empty scene still reports assurance');
});
