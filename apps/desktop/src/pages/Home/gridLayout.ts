import type { MantineColor } from "@mantine/core";
import {
  addDays,
  dayRange,
  daysSpanned,
  type Instant,
  type LocalDate,
  startOfDay,
  type Timeline,
  type TimelineInterval,
} from "@spoor/core";

/**
 * Layout for Home's timeline grid: where each interval's blocks go.
 *
 * The grid has one column per day and, inside it, one sub-column per timeline.
 * An interval becomes one block per day it touches, clipped to that day.
 * Ongoing intervals run until `now`. On a non-exclusive timeline, overlapping
 * blocks share their sub-column in lanes. No React here, so it can be tested
 * directly.
 */

/** One interval's piece on one day. */
export interface GridBlock {
  interval: TimelineInterval;
  /** The day this piece is drawn on. */
  day: LocalDate;
  /** Where the piece starts and ends, clipped to the day. */
  start: Instant;
  end: Instant;
  /** True on the piece that reaches `now` (ongoing intervals only). */
  ongoing: boolean;
  /** The interval goes on before this day, or after it. */
  startsBefore: boolean;
  endsAfter: boolean;
  /** Offset and length as fractions of the day, from 0 to 1. */
  top: number;
  height: number;
  /** Which lane the block uses, out of `laneCount` side-by-side lanes. */
  lane: number;
  laneCount: number;
}

/** Blocks by day, then by timeline id. */
export type GridLayout = Map<LocalDate, Map<string, GridBlock[]>>;

/**
 * Splits `intervals` into one block per day of `days`, a run of consecutive
 * dates, oldest first. Days are counted in `timeZone`. Every block starts in
 * lane 0 of 1.
 */
export function splitByDay(
  intervals: readonly TimelineInterval[],
  days: readonly LocalDate[],
  timeZone: string,
  now: Instant,
): GridBlock[] {
  const first = days[0];
  const last = days.at(-1);
  if (first === undefined || last === undefined) return [];
  const windowFrom = startOfDay(first, timeZone);
  const windowTo = startOfDay(addDays(last, 1), timeZone);
  const visible = new Set(days);
  const ranges = new Map<LocalDate, [Instant, Instant]>();
  const rangeOf = (day: LocalDate) => {
    let range = ranges.get(day);
    if (!range) {
      range = dayRange(day, timeZone);
      ranges.set(day, range);
    }
    return range;
  };

  const blocks: GridBlock[] = [];
  for (const interval of intervals) {
    const start = interval.startAt;
    const end = interval.endAt ?? Math.max(now, start);
    // Clip to the window first, so an interval that has been going on for a
    // year doesn't walk through every day it spans.
    const from = Math.max(start, windowFrom);
    const to = Math.min(end, windowTo);
    if (end > start ? to <= from : start < windowFrom || start >= windowTo) continue;

    for (const day of daysSpanned(from, to, timeZone)) {
      if (!visible.has(day)) continue;
      const [dayStart, dayEnd] = rangeOf(day);
      const pieceStart = Math.max(start, dayStart);
      const pieceEnd = Math.min(end, dayEnd);
      const length = dayEnd - dayStart;
      blocks.push({
        interval,
        day,
        start: pieceStart,
        end: pieceEnd,
        ongoing: interval.endAt === null && end <= dayEnd,
        startsBefore: start < dayStart,
        endsAfter: end > dayEnd,
        top: (pieceStart - dayStart) / length,
        height: (pieceEnd - pieceStart) / length,
        lane: 0,
        laneCount: 1,
      });
    }
  }
  return blocks;
}

/**
 * Gives overlapping blocks side-by-side lanes. Each block takes the first lane
 * that is free when it starts. A block's `laneCount` is the number of lanes in
 * its overlap cluster, so a block that overlaps nothing keeps the full width.
 * Returns new blocks ordered by start.
 */
export function assignLanes(blocks: readonly GridBlock[]): GridBlock[] {
  const sorted = [...blocks].sort((a, b) => a.start - b.start || a.end - b.end);
  const result: GridBlock[] = [];
  let cluster: GridBlock[] = [];
  let laneEnds: Instant[] = [];
  let clusterEnd = -Infinity;

  const closeCluster = () => {
    for (const block of cluster) result.push({ ...block, laneCount: laneEnds.length });
    cluster = [];
    laneEnds = [];
  };

  for (const block of sorted) {
    if (block.start >= clusterEnd) closeCluster();
    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= block.start);
    if (lane === -1) lane = laneEnds.push(block.end) - 1;
    else laneEnds[lane] = block.end;
    cluster.push({ ...block, lane });
    clusterEnd = Math.max(clusterEnd, block.end);
  }
  closeCluster();
  return result;
}

/**
 * The whole grid: blocks by day and timeline. Lanes are only used on
 * non-exclusive timelines, because intervals on an exclusive one never overlap.
 */
export function layoutGrid(
  intervals: readonly TimelineInterval[],
  timelines: readonly Timeline[],
  days: readonly LocalDate[],
  timeZone: string,
  now: Instant,
): GridLayout {
  const layout: GridLayout = new Map(
    days.map((day) => [day, new Map(timelines.map((t) => [t.id, [] as GridBlock[]]))]),
  );
  for (const block of splitByDay(intervals, days, timeZone, now)) {
    layout.get(block.day)?.get(block.interval.timelineId)?.push(block);
  }
  const exclusive = new Map(timelines.map((t) => [t.id, t.exclusive]));
  for (const byTimeline of layout.values()) {
    for (const [timelineId, blocks] of byTimeline) {
      if (exclusive.get(timelineId) === false) byTimeline.set(timelineId, assignLanes(blocks));
    }
  }
  return layout;
}

/** Where `now` falls in `day`, as a fraction from 0 to 1, or `null` if it is another day. */
export function nowFraction(now: Instant, day: LocalDate, timeZone: string): number | null {
  const [start, end] = dayRange(day, timeZone);
  if (now < start || now >= end) return null;
  return (now - start) / (end - start);
}

/** The colours blocks are drawn in: Mantine's built-in palettes, minus the greys. */
export const CATEGORY_COLORS: readonly MantineColor[] = [
  "blue",
  "teal",
  "grape",
  "orange",
  "green",
  "pink",
  "cyan",
  "violet",
  "lime",
  "red",
  "indigo",
  "yellow",
];

/**
 * A category's colour. It comes from a hash of the id (FNV-1a), so renaming a
 * category or adding others never changes it. Categories don't store a colour.
 */
export function categoryColor(categoryId: string): MantineColor {
  let hash = 0x811c9dc5;
  for (let i = 0; i < categoryId.length; i++) {
    hash ^= categoryId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return CATEGORY_COLORS[(hash >>> 0) % CATEGORY_COLORS.length] as MantineColor;
}

// Building a formatter is far slower than using one, and the grid formats every block.
const timeFormatters = new Map<string, Intl.DateTimeFormat>();

/** `instant` as a 24-hour wall-clock time in `timeZone`, such as "09:30". */
export function formatTime(instant: Instant, timeZone: string, locale?: string): string {
  const key = `${timeZone}|${locale ?? ""}`;
  let found = timeFormatters.get(key);
  if (!found) {
    found = new Intl.DateTimeFormat(locale, {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    timeFormatters.set(key, found);
  }
  return found.format(instant);
}

/** A block's tooltip, such as "Work · 09:00–10:30" or "Work · since 09:00". */
export function describeBlock(
  block: GridBlock,
  categoryName: string,
  timeZone: string,
  locale?: string,
): string {
  const { startAt, endAt } = block.interval;
  const start = formatTime(startAt, timeZone, locale);
  if (endAt === null) return `${categoryName} · since ${start}`;
  return `${categoryName} · ${start}–${formatTime(endAt, timeZone, locale)}`;
}
