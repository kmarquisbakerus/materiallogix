import test from 'node:test';
import assert from 'node:assert/strict';
import {
  performancePlan, planDuration, readTimeLabel, fitTargetSeconds,
  FIT_SECONDS, INTENSITY_RANGE, VARIATION_RANGE
} from '../studio/js/voice.js';

/**
 * The Voice Studio controls, checked against what the page puts on screen
 * beside them.
 *
 * "Performance intensity" and "Pacing variation" sit next to a panel titled
 * "Performance direction" that lists rate, energy and pause for every line.
 * Both sliders reached the engine at render time and nothing else, so the
 * panel was byte-identical at 0.25 and at 1.40 — and on the web Studio, where
 * no local engine can be installed, that panel is the only feedback there is.
 * The read estimate and the custom fit length are printed by the same panel.
 */

const SCRIPT = `A strong idea deserves a finished presentation. MaterialLogix brings photo, video, and voice into one focused production workflow.

Create with freedom. Finish with *confidence*.`;

/** Exactly what the direction panel prints for each line. */
const direction = plan =>
  plan.segments.map(s => `${s.intent} · rate ${s.rate} · energy ${s.energy} · pause ${s.pauseAfterMs}ms`).join(' | ');

test('performance intensity moves the direction panel, and its shipped position leaves it alone', () => {
  const quiet = performancePlan(SCRIPT, { intensity: INTENSITY_RANGE.min });
  const loud = performancePlan(SCRIPT, { intensity: INTENSITY_RANGE.max });
  assert.notEqual(direction(quiet), direction(loud),
    'the panel beside the slider reads the same at both ends of its range');
  for (let i = 0; i < quiet.segments.length; i++) {
    assert.notEqual(quiet.segments[i].energy, loud.segments[i].energy, `line ${i + 1} energy`);
    assert.notEqual(quiet.segments[i].pauseAfterMs, loud.segments[i].pauseAfterMs, `line ${i + 1} pause`);
  }
  // The emphasised line is where intensity should show most: it is the one the
  // renderer already exaggerates hardest.
  const emphasised = plan => plan.segments.findIndex(s => s.emphasis.length);
  assert.ok(emphasised(quiet) >= 0, 'the fixture carries an emphasised line');
  assert.ok(loud.segments[emphasised(loud)].energy > quiet.segments[emphasised(quiet)].energy);
  // A bigger performance holds its beats, so the read is honestly longer — the
  // fit-to-video readout has to move with the slider too.
  assert.ok(planDuration(loud) > planDuration(quiet), `${planDuration(loud)} vs ${planDuration(quiet)}`);
  // The slider ships at its neutral value, and there the plan is the plan the
  // page has always drawn.
  assert.deepEqual(performancePlan(SCRIPT, { intensity: INTENSITY_RANGE.neutral, variation: VARIATION_RANGE.neutral }),
    performancePlan(SCRIPT), 'the shipped slider positions changed the default plan');
});

test('pacing variation widens the line-to-line drift the panel shows', () => {
  const even = performancePlan(SCRIPT, { variation: VARIATION_RANGE.min });
  const varied = performancePlan(SCRIPT, { variation: VARIATION_RANGE.max });
  assert.notEqual(direction(even), direction(varied));
  for (let i = 0; i < even.segments.length; i++) {
    assert.notEqual(even.segments[i].rate, varied.segments[i].rate, `line ${i + 1} rate`);
  }
  // Variation is drift, so what it has to move is the spread of the read, not
  // any one line.
  const spread = plan => Math.max(...plan.segments.map(s => s.rate)) - Math.min(...plan.segments.map(s => s.rate));
  assert.ok(spread(varied) > spread(even), `${spread(varied)} should exceed ${spread(even)}`);
});

test('a direction value from outside the slider is clamped, and a control nobody touched is neutral', () => {
  const both = { intensity: INTENSITY_RANGE, variation: VARIATION_RANGE };
  for (const [name, range] of Object.entries(both)) {
    const top = performancePlan(SCRIPT, { [name]: range.max });
    const bottom = performancePlan(SCRIPT, { [name]: range.min });
    assert.notEqual(direction(top), direction(bottom), `${name} does not reach the panel at all`);
    assert.deepEqual(performancePlan(SCRIPT, { [name]: 99 }), top, `${name} above its range`);
    assert.deepEqual(performancePlan(SCRIPT, { [name]: -4 }), bottom, `${name} below its range`);
  }
  // An unread control arrives as '' and Number('') is 0, which would clamp to
  // the floor and flatten every plan on the page's first paint.
  for (const nothing of ['', null, undefined, NaN, 'abc']) {
    assert.deepEqual(performancePlan(SCRIPT, { intensity: nothing, variation: nothing }), performancePlan(SCRIPT),
      `${String(nothing)} was taken for a slider position`);
  }
});

test('a read estimate is a length a person can act on, never raw seconds', () => {
  // "1 segment, 10,000 words, ~4000.9s read." reached the screen.
  assert.equal(readTimeLabel(4000.9), '1h 6m');
  assert.equal(readTimeLabel(400.9), '6m 41s');
  assert.equal(readTimeLabel(120), '2m');
  assert.equal(readTimeLabel(3600), '1h');
  assert.equal(readTimeLabel(42.4), '42s', 'a read under a minute is still seconds');
  for (const bad of [0, NaN, null, undefined, -12, 'x']) assert.equal(readTimeLabel(bad), '0s', String(bad));
  // The script that produced the defect: long enough that seconds are useless.
  const long = planDuration(performancePlan('A strong idea deserves a finished presentation. '.repeat(1400)));
  assert.ok(long > 3600, `${long} seconds is not the long-script case`);
  assert.doesNotMatch(readTimeLabel(long), /^[\d.]+s$/, 'an hour-long read is still printed in seconds');
});

test('a custom fit length that is zero, negative, or not a number is refused out loud', () => {
  for (const typed of ['0', '-5', 'abc', '0.0']) {
    const fit = fitTargetSeconds('custom', typed);
    assert.equal(fit.seconds, 0, typed);
    assert.ok(fit.message, `"${typed}" blanked the readout and said nothing`);
    assert.match(fit.message, new RegExp(String(FIT_SECONDS.max)), `"${typed}" never says what the range is`);
  }
  // A box nobody has typed in yet is not a mistake to report.
  for (const empty of ['', '   ', null, undefined]) {
    assert.deepEqual(fitTargetSeconds('custom', empty), { seconds: 0, message: '' }, String(empty));
  }
  // Typing "abc" into a number field leaves `value` empty in a real browser, so
  // the field's own badInput is the only thing that separates the two.
  const text = fitTargetSeconds('custom', '', { unparsed: true });
  assert.equal(text.seconds, 0);
  assert.match(text.message, /seconds/, 'text typed into the length box is ignored in silence');
});

test('a custom fit length obeys the maximum its own field advertises', () => {
  const over = fitTargetSeconds('custom', '99999');
  assert.equal(over.seconds, FIT_SECONDS.max);
  assert.ok(over.message, '99999 was accepted in silence');
  // 99999 was answered in full: "room for ~190450 more words", from a field
  // whose markup says max="600". That is the sum the page does with it.
  const plan = performancePlan(SCRIPT);
  const room = target => Math.floor(plan.totalWords / (planDuration(plan) / target) - plan.totalWords);
  assert.ok(room(over.seconds) < 5000, `${room(over.seconds)} more words is not an answer to anything`);
  assert.deepEqual(fitTargetSeconds('custom', String(FIT_SECONDS.max)), { seconds: FIT_SECONDS.max, message: '' });
  assert.deepEqual(fitTargetSeconds('custom', '90'), { seconds: 90, message: '' });
  // The range belongs to the typed box. A fifteen-minute project video is a
  // legitimate target and must not be cut back to ten.
  assert.deepEqual(fitTargetSeconds('900', ''), { seconds: 900, message: '' });
  assert.deepEqual(fitTargetSeconds('12.5', ''), { seconds: 12.5, message: '' });
  assert.deepEqual(fitTargetSeconds('', ''), { seconds: 0, message: '' }, 'no fit — natural length');
});
