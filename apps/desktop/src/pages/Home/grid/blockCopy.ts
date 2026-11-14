import { formatClockTime, formatShortDay } from "@lib/format";
import {
  dayOf,
  type Instant,
  type LocalDate,
  type TimelineCategory,
  type TimelineInterval,
} from "@spoor/core";
import { freeGaps, movedRange } from "./blockEdit";
import type { DrawnRange } from "./dragRange";

/**
 * Copying a block on Home's grid and pasting it elsewhere. A copy is the
 * block's category and length; a paste places it like a move would (see
 * `blockEdit`): at the mark asked for, or the nearest spot where it fits
 * without overlapping a block it conflicts with. No React here, so it can be
 * tested directly.
 */

/** A copied block: what a paste needs to draw it again. */
export interface BlockCopy {
  timelineId: string;
  categoryId: string;
  /** In milliseconds. */
  length: number;
}

/** A copy of `interval`, or `null` for an ongoing one: it has no length yet. */
export function copyOf(interval: TimelineInterval): BlockCopy | null {
  if (interval.endAt === null) return null;
  return {
    timelineId: interval.timelineId,
    categoryId: interval.categoryId,
    length: interval.endAt - interval.startAt,
  };
}

/** Where a paste lands, or why it can't. */
export type PasteTarget = { range: DrawnRange } | { reason: string };

/**
 * Where pasting `copy` at `at`, on timeline `timelineId`, lands: starting at
 * `at`, or moved to the nearest spot inside `window` (the visible days, see
 * `daysWindow`) where it overlaps no block it conflicts with. Refused when
 * nothing is copied, on another timeline, when the copy's category is no
 * longer offered (archived or gone), or when it fits nowhere.
 */
export function pasteTarget(
  copy: BlockCopy | null,
  timelineId: string,
  at: Instant,
  {
    intervals,
    timeline,
    category,
    window,
  }: {
    intervals: readonly TimelineInterval[];
    timeline: { exclusive: boolean };
    /** The copy's category, if it still exists. */
    category: TimelineCategory | undefined;
    window: DrawnRange;
  },
): PasteTarget {
  if (!copy) return { reason: "Nothing copied" };
  if (copy.timelineId !== timelineId) return { reason: "Copied from another timeline" };
  if (!category) return { reason: "Its category was deleted" };
  if (category.archivedAt !== null) return { reason: "Its category is archived" };
  const gaps = freeGaps(copy, intervals, timeline, window);
  // `movedRange` stays put when nothing fits, which here would overlap.
  if (!gaps.some((g) => g.endAt - g.startAt >= copy.length)) {
    return { reason: "No room for it on the visible days" };
  }
  return { range: movedRange({ startAt: at, endAt: at + copy.length }, 0, gaps) };
}

/**
 * Where a paste starting at `startAt` lands, for its menu item and notice:
 * the time, such as "14:00", with the day too, such as "Tue 10 14:00", when
 * a block in the way pushed it off `pointDay`, the day it was asked for.
 */
export function landingLabel(
  startAt: Instant,
  pointDay: LocalDate,
  timeZone: string,
  locale?: string,
): string {
  const when = formatClockTime(startAt, timeZone, locale);
  const day = dayOf(startAt, timeZone);
  return day === pointDay ? when : `${formatShortDay(day, locale)} ${when}`;
}
