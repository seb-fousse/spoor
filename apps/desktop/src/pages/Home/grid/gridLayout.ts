import { formatClockTime } from "@lib/format";
import type { MantineColor } from "@mantine/core";
import {
  dayRange,
  daysSpanned,
  type Instant,
  type LocalDate,
  type Timeline,
  type TimelineInterval,
} from "@spoor/core";
import { daysWindow } from "./dragRange";

/**
 * Layout for Home's timeline grid: where each interval's blocks go.
 *
 * The grid has one column per day and, inside it, one sub-column per timeline.
 * An interval becomes one block per day it touches, clipped to that day.
 * Ongoing intervals run until `now`. On a non-exclusive timeline, overlapping
 * blocks share their sub-column like tetris pieces: at every moment the
 * blocks active then split the full width between them. No React here, so it
 * can be tested directly.
 */

/**
 * A stretch of a block with one width. A block that overlaps nothing has one
 * segment. A block that overlaps others is cut wherever the set of blocks
 * sharing the column changes.
 */
export interface BlockSegment {
  /** Offset and length as fractions of the day, from 0 to 1. */
  top: number;
  height: number;
  /** The block's slot, out of `lanes` equal side-by-side slots. */
  lane: number;
  lanes: number;
}

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
  /** The block's stretches, top to bottom, which together cover `top` to `top + height`. */
  segments: BlockSegment[];
}

/**
 * The part of `segment`'s width that `other` also spans, as fractions of
 * `segment`'s width from 0 to 1, or `null` if they don't line up at all.
 * `other` is the same block's segment just above or below it: where the block
 * changes lane, the rest of the edge between them is the block's outline.
 */
export function sharedSpan(segment: BlockSegment, other: BlockSegment): [number, number] | null {
  const left = segment.lane / segment.lanes;
  const from = Math.max(left, other.lane / other.lanes);
  const to = Math.min((segment.lane + 1) / segment.lanes, (other.lane + 1) / other.lanes);
  if (to <= from) return null;
  return [(from - left) * segment.lanes, (to - left) * segment.lanes];
}

/** Blocks by day, then by timeline id. */
export type GridLayout = Map<LocalDate, Map<string, GridBlock[]>>;

/**
 * Splits `intervals` into one block per day of `days`, a run of consecutive
 * dates, oldest first. Days are counted in `timeZone`. Every block starts as
 * one full-width segment.
 */
export function splitByDay(
  intervals: readonly TimelineInterval[],
  days: readonly LocalDate[],
  timeZone: string,
  now: Instant,
): GridBlock[] {
  if (days.length === 0) return [];
  const { startAt: windowFrom, endAt: windowTo } = daysWindow(days, timeZone);
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
      const top = (pieceStart - dayStart) / length;
      const height = (pieceEnd - pieceStart) / length;
      blocks.push({
        interval,
        day,
        start: pieceStart,
        end: pieceEnd,
        ongoing: interval.endAt === null && end <= dayEnd,
        startsBefore: start < dayStart,
        endsAfter: end > dayEnd,
        top,
        height,
        segments: [{ top, height, lane: 0, lanes: 1 }],
      });
    }
  }
  return blocks;
}

/** A segment while it is being built, in instants rather than fractions. */
interface Stretch {
  from: Instant;
  to: Instant;
  lane: number;
  lanes: number;
}

/**
 * Fits overlapping blocks together like tetris pieces, so the column is always
 * full. Time is cut at every start and end. In each stretch, the blocks active
 * then split the width equally, in start order. If A overlaps the start of B,
 * A is full width, then A and B are half each, then B is full width. Returns
 * new blocks ordered by start.
 */
export function fitSegments(blocks: readonly GridBlock[]): GridBlock[] {
  const sorted = [...blocks].sort(
    (a, b) => a.start - b.start || a.end - b.end || (a.interval.id < b.interval.id ? -1 : 1),
  );
  const cuts = [...new Set(sorted.flatMap((b) => [b.start, b.end]))].sort((a, b) => a - b);
  const pieces = new Map<GridBlock, Stretch[]>(sorted.map((b) => [b, []]));

  for (let i = 0; i < cuts.length - 1; i++) {
    const from = cuts[i] as Instant;
    const to = cuts[i + 1] as Instant;
    const active = sorted.filter((b) => b.start <= from && b.end >= to);
    active.forEach((b, lane) => {
      const own = pieces.get(b) as Stretch[];
      const previous = own.at(-1);
      // Stretches with the same slot join into one segment.
      if (previous && previous.lane === lane && previous.lanes === active.length) {
        previous.to = to;
      } else {
        own.push({ from, to, lane, lanes: active.length });
      }
    });
  }
  // A zero-length block covers no stretch. It takes a slot among the blocks
  // running at its instant.
  for (const b of sorted) {
    if (b.start !== b.end) continue;
    const active = sorted.filter((o) => o === b || (o.start <= b.start && b.start < o.end));
    pieces
      .get(b)
      ?.push({ from: b.start, to: b.end, lane: active.indexOf(b), lanes: active.length });
  }

  return sorted.map((b) => {
    // Map instants to fractions of the day along the block itself.
    const span = b.end - b.start;
    const at = (t: Instant) => (span === 0 ? b.top : b.top + ((t - b.start) / span) * b.height);
    const segments = (pieces.get(b) ?? []).map(({ from, to, lane, lanes }) => ({
      top: at(from),
      height: at(to) - at(from),
      lane,
      lanes,
    }));
    return { ...b, segments };
  });
}

/**
 * The whole grid: blocks by day and timeline. Blocks are only fitted together
 * on non-exclusive timelines, because intervals on an exclusive one never overlap.
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
      if (exclusive.get(timelineId) === false) byTimeline.set(timelineId, fitSegments(blocks));
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

/**
 * A range's clock times, such as "09:00–10:30", or "since 09:00" while it is
 * still going. Days are left out, so a range that crosses midnight reads
 * "22:00–01:30" on both of its days.
 */
export function clockRange(
  range: { startAt: Instant; endAt: Instant | null },
  timeZone: string,
  locale?: string,
): string {
  const start = formatClockTime(range.startAt, timeZone, locale);
  if (range.endAt === null) return `since ${start}`;
  return `${start}–${formatClockTime(range.endAt, timeZone, locale)}`;
}

/** A block's tooltip, such as "Work · 09:00–10:30" or "Work · since 09:00". */
export function describeBlock(
  block: GridBlock,
  categoryName: string,
  timeZone: string,
  locale?: string,
): string {
  return `${categoryName} · ${clockRange(block.interval, timeZone, locale)}`;
}

/**
 * How a block's label fits a segment `px` tall: not at all, on one line (the
 * name, then the time if there's room), or stacked (the name over the time).
 * A 15-minute block at 48px an hour gets one line.
 */
export type LabelFit = "none" | "line" | "stack";

/** The shortest segment with a label, and the shortest with a two-line one, in pixels. */
const LABEL_MIN = 9;
const STACK_MIN = 28;

export function labelFit(px: number): LabelFit {
  if (px < LABEL_MIN) return "none";
  return px < STACK_MIN ? "line" : "stack";
}
