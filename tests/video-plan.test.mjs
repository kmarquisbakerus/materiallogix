import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVideoTime, resolveVideoTrim, deliveryFrame, VIDEO_DELIVERY_FRAMES, DEFAULT_VIDEO_SPEC } from '../studio/js/video-plan.js';

test('seconds and timecode both read as seconds', () => {
  assert.equal(parseVideoTime('12'), 12);
  assert.equal(parseVideoTime('0:03.5'), 3.5);
  assert.equal(parseVideoTime('1:30'), 90);
  assert.equal(parseVideoTime('1:02:03'), 3723);
  assert.equal(parseVideoTime(7), 7);
  assert.equal(parseVideoTime(0), 0);
});

test('an empty point means "no point", not zero', () => {
  assert.equal(parseVideoTime(''), null);
  assert.equal(parseVideoTime(null), null);
  assert.equal(parseVideoTime(undefined), null);
});

test('a negative time is refused rather than stretching the render', () => {
  // A negative in point made the output longer than the source, on a path that
  // reserves billable usage before it runs.
  assert.equal(parseVideoTime('-5'), null);
  assert.equal(parseVideoTime(-5), null);
  assert.equal(parseVideoTime('1:-2'), null);
  assert.equal(parseVideoTime('-0:30'), null);
});

test('malformed timecode is refused', () => {
  for (const value of ['abc', '::', '1::2', ':30', '1:2:3:4', 'NaN', '1e', {}, []]) {
    assert.equal(parseVideoTime(value), null, `${JSON.stringify(value)} is not a time`);
  }
  assert.equal(parseVideoTime(Infinity), null);
  assert.equal(parseVideoTime(NaN), null);
});

test('a trim with no points runs the whole source', () => {
  const trim = resolveVideoTrim({ trimStart: '', trimEnd: '', duration: 30 });
  assert.equal(trim.start, 0);
  assert.equal(trim.end, null);
  assert.equal(trim.outputSeconds, 30);
});

test('speed changes the output length, not the selection', () => {
  assert.equal(resolveVideoTrim({ trimStart: '0', trimEnd: '10', duration: 30, speed: 2 }).outputSeconds, 5);
  assert.equal(resolveVideoTrim({ trimStart: '0', trimEnd: '10', duration: 30, speed: 0.5 }).outputSeconds, 20);
  assert.equal(resolveVideoTrim({ trimStart: '0', trimEnd: '10', duration: 30, speed: 0 }).outputSeconds, 10,
    'an unusable speed falls back to source speed rather than dividing by zero');
});

test('an out point at or before the in point is refused', () => {
  assert.throws(() => resolveVideoTrim({ trimStart: '10', trimEnd: '10', duration: 30 }), /later than the in point/);
  assert.throws(() => resolveVideoTrim({ trimStart: '10', trimEnd: '5', duration: 30 }), /later than the in point/);
});

test('an unreadable point explains itself in the editor', () => {
  assert.throws(() => resolveVideoTrim({ trimStart: 'abc', duration: 30 }), /in point as seconds or timecode/);
  assert.throws(() => resolveVideoTrim({ trimStart: '0', trimEnd: 'xyz', duration: 30 }), /out point as seconds or timecode/);
});

test('a selection with nothing left in it is refused', () => {
  assert.throws(() => resolveVideoTrim({ trimStart: '40', duration: 30 }), /no renderable duration/);
  assert.throws(() => resolveVideoTrim({ trimStart: '30', duration: 30 }), /no renderable duration/);
  assert.throws(() => resolveVideoTrim({ duration: undefined }), /no renderable duration/);
});

test('every delivery frame is a real size and an unknown spec falls back', () => {
  for (const [spec, frame] of Object.entries(VIDEO_DELIVERY_FRAMES)) {
    assert.ok(Number.isInteger(frame.w) && frame.w > 0, `${spec} width`);
    assert.ok(Number.isInteger(frame.h) && frame.h > 0, `${spec} height`);
  }
  assert.deepEqual(deliveryFrame('vertical'), { w: 1080, h: 1920 });
  assert.deepEqual(deliveryFrame('wide'), { w: 1920, h: 1080 });
  assert.deepEqual(deliveryFrame('nonsense'), VIDEO_DELIVERY_FRAMES[DEFAULT_VIDEO_SPEC]);
  assert.deepEqual(deliveryFrame(undefined), VIDEO_DELIVERY_FRAMES[DEFAULT_VIDEO_SPEC]);
});
