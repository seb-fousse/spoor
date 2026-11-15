/**
 * How fast a drag scrolls Home's grid when the pointer nears an edge of the
 * days, so a block can be drawn or moved onto days and hours out of view. No
 * React here, so it can be tested directly.
 */

/** How near an edge, in pixels, the pointer starts scrolling the grid. */
export const EDGE_ZONE = 40;
/** The fastest the grid scrolls, in pixels a frame: at the edge, or past it. */
export const EDGE_SPEED = 16;

/** The part of the scroller the days show in: right of the hour gutter, below the header. */
export interface ScrollArea {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * The speed along one axis for a pointer at `at`, between `start` and `end`:
 * negative near the start, positive near the end, faster the nearer the edge,
 * and zero in between. A pointer past an edge goes at full speed.
 */
export function edgeSpeed(at: number, start: number, end: number): number {
  const ramp = (depth: number) => Math.round(EDGE_SPEED * Math.min(1, depth / EDGE_ZONE));
  if (at < start + EDGE_ZONE) return -ramp(start + EDGE_ZONE - at);
  if (at > end - EDGE_ZONE) return ramp(at - (end - EDGE_ZONE));
  return 0;
}

/** How far to scroll the grid this frame, for the pointer at `x`, `y`. */
export function edgeScroll(
  pointer: { x: number; y: number },
  area: ScrollArea,
): { dx: number; dy: number } {
  // `|| 0` turns -0 into 0.
  return {
    dx: edgeSpeed(pointer.x, area.left, area.right) || 0,
    dy: edgeSpeed(pointer.y, area.top, area.bottom) || 0,
  };
}
