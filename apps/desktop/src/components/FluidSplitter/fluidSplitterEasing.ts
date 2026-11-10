/**
 * The pane-size easing behind FluidSplitter, kept free of the DOM so it can be
 * tested on its own.
 *
 * The shown sizes trail the target (the mouse-driven sizes) through two chained
 * exponential easings, target -> mid -> shown. Two stages make the panes start
 * gently, as if they had weight. Both stages stay within `maxDelta` of the
 * target, so past that the panes are dragged along.
 *
 * Unlike a spring, this can never overshoot: each step only moves a size
 * toward the target, never back the other way.
 */
export interface Easing {
  mid: number[];
  shown: number[];
}

/**
 * One frame of easing.
 * @param target the sizes the panes are heading for
 * @param current the easing state from the previous frame
 * @param ease the fraction of the remaining distance to cover this frame, in [0, 1]
 * @param maxDelta the farthest, in size units, any size may trail the target
 */
export function easeSizes(
  target: number[],
  current: Easing,
  ease: number,
  maxDelta: number,
): Easing {
  const follow = (from: number[], to: number[]) =>
    from.map((v, i) => {
      const next = v + (to[i] - v) * ease;
      return Math.max(target[i] - maxDelta, Math.min(target[i] + maxDelta, next));
    });
  const mid = follow(current.mid, target);
  return { mid, shown: follow(current.shown, mid) };
}

/** The fraction of the remaining distance to cover in `seconds` at `rate` (1/s). */
export function easeFraction(rate: number, seconds: number): number {
  return 1 - Math.exp(-rate * seconds);
}
