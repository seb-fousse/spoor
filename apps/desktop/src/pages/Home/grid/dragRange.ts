import {
  addDays,
  dayRange,
  type Instant,
  type LocalDate,
  startOfDay,
  type TimelineInterval,
} from "@spoor/core";

/**
 * The maths behind drawing a block on Home's grid: turning pointer positions
 * into a snapped time range that stays clear of the intervals already there.
 * No React here, so it can be tested directly.
 */

/** Drawn blocks snap to this step. */
export const SNAP_MS = 15 * 60 * 1000;

/** A drawn time range, half-open: `[startAt, endAt)`. */
export interface DrawnRange {
  startAt: Instant;
  endAt: Instant;
}

/**
 * The instant at `fraction` (0 to 1) down `day`, snapped to the nearest step
 * after the day's start and kept inside the day. Steps are counted in elapsed
 * time, so a day with a clock change still snaps evenly.
 */
export function snapFraction(fraction: number, day: LocalDate, timeZone: string): Instant {
  const [start, end] = dayRange(day, timeZone);
  const clamped = Math.min(1, Math.max(0, fraction));
  const snapped = start + Math.round((clamped * (end - start)) / SNAP_MS) * SNAP_MS;
  return Math.min(end, snapped);
}

/** The stretch `days`, a run of consecutive dates, covers: the first's start to the last's end. */
export function daysWindow(days: readonly LocalDate[], timeZone: string): DrawnRange {
  const first = days[0];
  const last = days.at(-1);
  if (first === undefined || last === undefined) throw new Error("No days");
  return { startAt: startOfDay(first, timeZone), endAt: startOfDay(addDays(last, 1), timeZone) };
}

/**
 * The stretch a block drawn from `anchor` may cover: the whole `window` (the
 * visible days, see `daysWindow`), or on an exclusive timeline the gap between
 * the blocks around the anchor, so a drag stops at the next block instead of
 * overlapping it, on whichever day that is. `null` when the anchor has no
 * room, such as below an ongoing interval's start (it never ends).
 */
export function freeSpan(
  anchor: Instant,
  intervals: readonly TimelineInterval[],
  timeline: { id: string; exclusive: boolean },
  window: DrawnRange,
): DrawnRange | null {
  let from = window.startAt;
  let to = window.endAt;
  if (!timeline.exclusive) return { startAt: from, endAt: to };
  for (const i of intervals) {
    if (i.timelineId !== timeline.id) continue;
    const end = i.endAt ?? Number.POSITIVE_INFINITY;
    if (i.startAt < anchor && anchor < end) return null;
    if (end <= anchor) from = Math.max(from, end);
    if (i.startAt >= anchor) to = Math.min(to, i.startAt);
  }
  return from < to ? { startAt: from, endAt: to } : null;
}

/**
 * The range between where the drag started and where the pointer is now, in
 * either order, so dragging upward works, kept inside `span` (see
 * `freeSpan`). `null` while the pointer is still on the anchor's step, so a
 * click draws nothing.
 */
export function dragRange(anchor: Instant, current: Instant, span: DrawnRange): DrawnRange | null {
  const clamped = Math.min(span.endAt, Math.max(span.startAt, current));
  if (clamped === anchor) return null;
  return { startAt: Math.min(anchor, clamped), endAt: Math.max(anchor, clamped) };
}

/** A drawn range's piece on one day, as fractions of the day from 0 to 1. */
export interface RangePiece {
  day: LocalDate;
  top: number;
  height: number;
}

/** `range` cut at midnight: one piece per day of `days` it covers, oldest first. */
export function rangePieces(
  range: DrawnRange,
  days: readonly LocalDate[],
  timeZone: string,
): RangePiece[] {
  const pieces: RangePiece[] = [];
  for (const day of days) {
    const [start, end] = dayRange(day, timeZone);
    const from = Math.max(range.startAt, start);
    const to = Math.min(range.endAt, end);
    if (to <= from) continue;
    pieces.push({ day, top: (from - start) / (end - start), height: (to - from) / (end - start) });
  }
  return pieces;
}
