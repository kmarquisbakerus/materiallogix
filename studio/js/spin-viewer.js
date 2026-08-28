const finiteCount = count => Math.max(0, Math.floor(Number(count) || 0));

/** Keep a spin frame index inside the sequence while allowing continuous turns. */
export function normalizeSpinIndex(index, count) {
  const length = finiteCount(count);
  if (!length) return 0;
  return ((Math.round(Number(index) || 0) % length) + length) % length;
}

export function stepSpinIndex(index, delta, count) {
  return normalizeSpinIndex((Number(index) || 0) + (Number(delta) || 0), count);
}

/**
 * Convert a horizontal grab into a frame. Dragging left advances the turn;
 * dragging right reverses it, matching common product-spin viewers.
 */
export function spinIndexFromDrag(startIndex, deltaX, count, pixelsPerFrame = 24) {
  const sensitivity = Math.max(8, Number(pixelsPerFrame) || 24);
  return normalizeSpinIndex((Number(startIndex) || 0) - Math.round((Number(deltaX) || 0) / sensitivity), count);
}

/** Trackpads may report vertical or horizontal motion, so honor the stronger axis. */
export function spinStepFromWheel(deltaX, deltaY, threshold = 18) {
  const movement = Math.abs(Number(deltaX) || 0) >= Math.abs(Number(deltaY) || 0)
    ? Number(deltaX) || 0
    : Number(deltaY) || 0;
  if (Math.abs(movement) < Math.max(1, Number(threshold) || 18)) return 0;
  return movement > 0 ? 1 : -1;
}

export function spinAngleLabel(index, count, mode = 'body') {
  const length = finiteCount(count);
  if (!length) return 'No frames';
  const frame = normalizeSpinIndex(index, length);
  if (mode === 'face') return `head-turn frame ${frame + 1}`;
  return `${Math.round(frame * (360 / length))}° through turn`;
}
