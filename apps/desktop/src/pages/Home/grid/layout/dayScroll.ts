import { compareLocalDates, type LocalDate } from "@spoor/core";

/**
 * The maths behind scrolling Home's grid sideways, a day at a time. The grid
 * renders a strip of days, each `width` pixels wide: the window in view, and
 * a window's worth either side (see `bufferDays`). How far the strip is
 * scrolled, `scrollLeft`, puts the day at index `scrollLeft / width` at the
 * left edge of the days, just right of the hour gutter. No React here, so it
 * can be tested directly.
 */

export interface DayStrip {
  /** The rendered days, oldest first. */
  days: readonly LocalDate[];
  /** How many days fit the viewport: the window's length. */
  visible: number;
  /** One day's width, in pixels. */
  width: number;
}

/**
 * How far a scroll position may be off a day boundary, in pixels, and still
 * be on it: the webview rounds scroll positions to device pixels.
 */
const TOLERANCE = 1;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** The farthest the strip scrolls: its last `visible` days in view. */
export function maxLeft({ days, visible, width }: DayStrip): number {
  return Math.max(0, days.length - visible) * width;
}

/** Where the strip is centred: the window in view, with `visible` days either side. */
export function centreLeft(strip: DayStrip): number {
  return Math.min(strip.visible * strip.width, maxLeft(strip));
}

/** The nearest scroll position with a day boundary at the left edge. */
export function nearestLeft(scrollLeft: number, strip: DayStrip): number {
  if (strip.width <= 0) return 0;
  return clamp(Math.round(scrollLeft / strip.width) * strip.width, 0, maxLeft(strip));
}

/**
 * The day at the left edge, once the strip has settled with a day boundary
 * there; `null` while it is between two days, such as while it is still
 * snapping or the user's fingers rest mid-swipe.
 */
export function settledStart(scrollLeft: number, strip: DayStrip): LocalDate | null {
  if (strip.width <= 0) return null;
  const left = nearestLeft(scrollLeft, strip);
  if (!sameLeft(left, scrollLeft)) return null;
  return strip.days[Math.round(left / strip.width)] ?? null;
}

/**
 * The scroll position in `next` that shows what `scrollLeft` shows in `prev`:
 * the same day at the left edge, as far across. When `next` doesn't have that
 * day, the strip goes to the end the day is off, so the move to the centre
 * comes from the side the user was on.
 */
export function keptLeft(scrollLeft: number, prev: DayStrip, next: DayStrip): number {
  const at = prev.width > 0 ? scrollLeft / prev.width : 0;
  const index = clamp(Math.floor(at), 0, prev.days.length - 1);
  const day = prev.days[index];
  const first = next.days[0];
  if (day === undefined || first === undefined) return centreLeft(next);
  const found = next.days.indexOf(day);
  if (found === -1) return compareLocalDates(day, first) < 0 ? 0 : maxLeft(next);
  return clamp((found + at - index) * next.width, 0, maxLeft(next));
}

/**
 * How the strip moves once it renders as `next`, having been `prev` and
 * scrolled to `scrollLeft`: at once to `from`, so nothing on screen moves,
 * then smoothly to `to`, the centre. When the window moved, that animates the
 * days to it; when the user scrolled there, `from` is already the centre. The
 * first render, and a new day width (another range, or a resize), go straight
 * to the centre.
 */
export function placement(
  scrollLeft: number,
  prev: DayStrip | null,
  next: DayStrip,
): { from: number; to: number } {
  const to = centreLeft(next);
  if (!prev || prev.width !== next.width || prev.visible !== next.visible) return { from: to, to };
  return { from: keptLeft(scrollLeft, prev, next), to };
}

/** Whether two scroll positions are the same, to the pixel. */
export function sameLeft(a: number, b: number): boolean {
  return Math.abs(a - b) <= TOLERANCE;
}
