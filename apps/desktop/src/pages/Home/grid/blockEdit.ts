import type { Instant, TimelineInterval } from "@spoor/core";
import { type DrawnRange, freeSpan, SNAP_MS } from "./dragRange";

/**
 * The maths behind moving and resizing a block on Home's grid. Like drawing
 * one (see `dragRange`), an edit never overlaps: a resized block stops at its
 * neighbours, and a moved one skips over them to the nearest spot where it
 * fits. No React here, so it can be tested directly.
 */

/** What a drag on a block changes: its whole range, one edge, or nothing (it can't move). */
export type BlockMode = "move" | "start" | "end" | "none";

/** A block's new range. `endAt` is `null` for an ongoing block, which stays ongoing. */
export interface EditedRange {
  startAt: Instant;
  endAt: Instant | null;
}

/**
 * The intervals `interval` must not overlap, as core checks: the timeline's
 * others, or on a non-exclusive timeline only those in `categoryId` (default:
 * its own).
 */
function rivals(
  interval: TimelineInterval,
  intervals: readonly TimelineInterval[],
  exclusive: boolean,
  categoryId = interval.categoryId,
): TimelineInterval[] {
  return intervals.filter(
    (i) =>
      i.id !== interval.id &&
      i.timelineId === interval.timelineId &&
      (exclusive || i.categoryId === categoryId),
  );
}

/**
 * Where `interval` may reach while it is resized: the gap between the
 * intervals around it that it must not overlap, inside `window` (the visible
 * days, see `daysWindow`). The gap always holds the interval itself, even
 * where it runs past the window, so its visible edge can still be resized.
 */
export function editSpan(
  interval: TimelineInterval,
  intervals: readonly TimelineInterval[],
  timeline: { exclusive: boolean },
  window: DrawnRange,
): DrawnRange {
  const own = { startAt: interval.startAt, endAt: interval.endAt ?? interval.startAt };
  const wide = {
    startAt: Math.min(window.startAt, own.startAt),
    endAt: Math.max(window.endAt, own.endAt),
  };
  const others = rivals(interval, intervals, timeline.exclusive);
  const gap = freeSpan(
    interval.startAt,
    others,
    { id: interval.timelineId, exclusive: true },
    wide,
  );
  // Only `null` when the data already overlaps: then it stays where it is.
  return gap ?? own;
}

/** Whether a press on the block's body can move it: it has ended, and lies inside `window`. */
export function canMove(interval: TimelineInterval, window: DrawnRange): boolean {
  return (
    interval.endAt !== null && interval.startAt >= window.startAt && interval.endAt <= window.endAt
  );
}

/**
 * Where `interval` may land when it is moved: every gap inside `window`
 * between the intervals it must not overlap, oldest first. One of them is
 * the gap it is in now. An ongoing interval never ends, so nothing is free
 * after its start.
 */
export function freeGaps(
  interval: TimelineInterval,
  intervals: readonly TimelineInterval[],
  timeline: { exclusive: boolean },
  window: DrawnRange,
): DrawnRange[] {
  const others = rivals(interval, intervals, timeline.exclusive).sort(
    (a, b) => a.startAt - b.startAt,
  );
  const gaps: DrawnRange[] = [];
  let from = window.startAt;
  for (const other of others) {
    const to = Math.min(other.startAt, window.endAt);
    if (to > from) gaps.push({ startAt: from, endAt: to });
    from = Math.max(from, other.endAt ?? Number.POSITIVE_INFINITY);
    if (from >= window.endAt) return gaps;
  }
  gaps.push({ startAt: from, endAt: window.endAt });
  return gaps;
}

/**
 * `range` shifted by `delta`, or where it fits nearest to that among `gaps`
 * (see `freeGaps`): pushed back inside the gap it would land in, or over a
 * block in the way to whichever side is closer, skipping gaps too short to
 * hold it. Its length stays the same. On a tie the earlier spot wins.
 */
export function movedRange(
  range: DrawnRange,
  delta: number,
  gaps: readonly DrawnRange[],
): DrawnRange {
  const length = range.endAt - range.startAt;
  const wanted = range.startAt + delta;
  let best = range.startAt;
  let distance = Number.POSITIVE_INFINITY;
  for (const gap of gaps) {
    if (gap.endAt - gap.startAt < length) continue;
    const startAt = Math.max(gap.startAt, Math.min(gap.endAt - length, wanted));
    if (Math.abs(startAt - wanted) < distance) {
      best = startAt;
      distance = Math.abs(startAt - wanted);
    }
  }
  return { startAt: best, endAt: best + length };
}

/**
 * `interval` with its `edge` dragged to `at`, kept inside `span` and at
 * least one snap step long. An ongoing interval has no end to drag, and its
 * start stays at or before `now`. A block already shorter than a step can
 * grow but not shrink.
 */
export function resizedRange(
  interval: EditedRange,
  edge: "start" | "end",
  at: Instant,
  span: DrawnRange,
  now: Instant,
): EditedRange {
  const { startAt, endAt } = interval;
  if (edge === "start") {
    const latest = endAt === null ? now : endAt - SNAP_MS;
    const limit = Math.max(Math.min(startAt, span.endAt), latest);
    return { startAt: Math.max(span.startAt, Math.min(limit, at)), endAt };
  }
  if (endAt === null) return interval;
  const earliest = Math.min(endAt, startAt + SNAP_MS);
  return { startAt, endAt: Math.min(span.endAt, Math.max(earliest, at)) };
}

/**
 * Where a split at `at`, already snapped to the 15-minute grid, cuts the
 * interval: `at` when it falls strictly inside, or `null` when it doesn't,
 * such as on an edge or in a block too short to hold a mark. An ongoing
 * interval runs until `now`, so it can only be cut before then.
 */
export function splitPoint(interval: EditedRange, at: Instant, now: Instant): Instant | null {
  const end = interval.endAt ?? now;
  return interval.startAt < at && at < end ? at : null;
}

/** Whether `a` and `b` are the same range. */
export function sameRange(a: EditedRange, b: EditedRange): boolean {
  return a.startAt === b.startAt && a.endAt === b.endAt;
}

/**
 * The categories in `categoryIds` that `interval` can't move to, because it
 * would overlap one of that category's intervals. Only a non-exclusive
 * timeline has any: on an exclusive one, the interval already overlaps nothing.
 */
export function conflictingCategories(
  interval: TimelineInterval,
  intervals: readonly TimelineInterval[],
  timeline: { exclusive: boolean },
  categoryIds: readonly string[],
): Set<string> {
  const conflicts = new Set<string>();
  if (timeline.exclusive) return conflicts;
  const end = interval.endAt ?? Number.POSITIVE_INFINITY;
  for (const categoryId of categoryIds) {
    if (categoryId === interval.categoryId) continue;
    const overlaps = rivals(interval, intervals, false, categoryId).some(
      (i) => i.startAt < end && interval.startAt < (i.endAt ?? Number.POSITIVE_INFINITY),
    );
    if (overlaps) conflicts.add(categoryId);
  }
  return conflicts;
}
