// Pure editorial maths for a video render: what the delivery frame is, what
// the trim actually selects, and how long the output runs. Kept out of the
// view so the suite can check it without a browser or an engine.

export const VIDEO_DELIVERY_FRAMES = Object.freeze({
  vertical: Object.freeze({ w: 1080, h: 1920 }),
  portrait: Object.freeze({ w: 1080, h: 1350 }),
  square: Object.freeze({ w: 1080, h: 1080 }),
  wide: Object.freeze({ w: 1920, h: 1080 })
});

export const DEFAULT_VIDEO_SPEC = 'vertical';

export function deliveryFrame(spec) {
  return VIDEO_DELIVERY_FRAMES[spec] || VIDEO_DELIVERY_FRAMES[DEFAULT_VIDEO_SPEC];
}

/**
 * Read seconds or timecode ("12", "0:03.5", "1:02:03").
 *
 * Every component has to be a real, non-negative number. A negative in point
 * is not a place on a timeline: it would stretch the render past the end of
 * the source and bill for footage that does not exist.
 */
export function parseVideoTime(value) {
  if (value === '' || value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  const parts = String(value).trim().split(':');
  // A leading minus is rejected on the text, not the number: Number('-0') is
  // -0, and -0 < 0 is false, so "-0:30" would otherwise quietly become 30.
  if (parts.length > 3 || parts.some(part => part.trim() === '' || part.trim().startsWith('-'))) return null;
  const numbers = parts.map(Number);
  if (numbers.some(part => !Number.isFinite(part) || part < 0)) return null;
  return numbers.reduce((total, part) => total * 60 + part, 0);
}

/**
 * Resolve the trim against the source. Throws with the wording the editor
 * shows, so the caller does not have to restate any of these rules.
 */
export function resolveVideoTrim({ trimStart, trimEnd, duration, speed = 1 } = {}) {
  const start = parseVideoTime(trimStart);
  const end = parseVideoTime(trimEnd);
  if (trimStart !== '' && trimStart != null && start == null) {
    throw new Error('Enter the in point as seconds or timecode, for example 0:03.5.');
  }
  if (trimEnd !== '' && trimEnd != null && end == null) {
    throw new Error('Enter the out point as seconds or timecode, for example 0:12.');
  }
  if (end != null && end <= (start || 0)) throw new Error('The out point must be later than the in point.');

  const rate = Number(speed) > 0 ? Number(speed) : 1;
  const sourceEnd = end ?? duration;
  const outputSeconds = Math.max(0, (sourceEnd - (start || 0)) / rate);
  if (!Number.isFinite(outputSeconds) || outputSeconds <= 0) {
    throw new Error('The selected video range has no renderable duration.');
  }
  return { start: start || 0, end, outputSeconds, speed: rate };
}
