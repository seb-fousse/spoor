import { formatClockTime, formatShortDay } from "@lib/format";
import { VisuallyHidden } from "@mantine/core";
import {
  type DayObservationCount,
  dayOf,
  type Instant,
  type LocalDate,
  startOfDay,
  type Timeline,
  type TimelineCategory,
} from "@spoor/core";
import {
  type CSSProperties,
  Fragment,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useState,
} from "react";
import { completeness, completenessLabel } from "./completeness";
import { type DrawnRange, rangePieces } from "./dragRange";
import {
  type BlockSegment,
  categoryColor,
  clockRange,
  describeBlock,
  type GridBlock,
  labelFit,
  sharedSpan,
} from "./gridLayout";
import { BLOCK_ATTR, DAY_COLUMN } from "./gridPointer";
import classes from "./TimelineGrid.module.css";
import { type BlockEdit, EDGE_ATTR, type SegmentHandlers } from "./useBlockDrag";
import type { SubColumnHandlers } from "./useDragToCreate";

/**
 * What Home's timeline grid draws: its day columns, the blocks in them, and
 * the ghosts of blocks being drawn, moved or pasted. `TimelineGrid` wires the
 * interactions; everything here only renders what it is given.
 */

/** Height of one hour, in pixels. */
export const HOUR_HEIGHT = 48;

/** The name a block shows when its category is gone. */
const UNKNOWN_CATEGORY = "Unknown category";

/**
 * What a block segment spreads: the drag handlers, a right click for its
 * menu, and the selected block's keys.
 */
export type BlockHandlers = SegmentHandlers & {
  onContextMenu: (event: MouseEvent<HTMLElement>) => void;
  onKeyDown: ((event: KeyboardEvent<HTMLElement>) => void) | undefined;
};

/** What a sub-column spreads: the drawing handlers, and the paste menu's. */
export type ColumnHandlers = SubColumnHandlers & {
  onContextMenu: (event: MouseEvent<HTMLElement>) => void;
};

/** Something drawn in one of a day's sub-columns, over its blocks. */
export interface Extra {
  key: string;
  timelineId: string;
  node: ReactNode;
}

/**
 * A category's colours, as the custom properties blocks and edit ghosts are
 * drawn with. They come from one colour, Mantine's filled shade for the scheme,
 * mixed into the surface for the fills and into the text colour for the line
 * and the label. Mixing into the scheme's own tokens keeps every category's
 * label readable on its fill in light and dark mode (at least 4.5:1).
 */
export function blockColors(categoryId: string) {
  const color = `var(--mantine-color-${categoryColor(categoryId)}-filled)`;
  return {
    "--block-bg": `color-mix(in srgb, ${color} 16%, var(--app-surface))`,
    "--block-bg-strong": `color-mix(in srgb, ${color} 26%, var(--app-surface))`,
    "--block-line": `color-mix(in oklab, ${color} 75%, var(--app-text))`,
    "--block-fg": `color-mix(in oklab, ${color} 45%, var(--app-text))`,
  };
}

/**
 * The line along a segment's top or bottom edge where the block changes lane:
 * the whole edge, except the `shared` part (fractions of the segment's width)
 * that joins the block's next segment. Drawn in the block's outline colour.
 *
 * The line lies in the segment's padding box, 4px narrower than its slot (a
 * 1px inset and a 1px border each side), so a fraction `p` of the slot is at
 * `p * (100% + 4px) - 2px`. The open part runs between the next segment's
 * side borders, so the line meets them at the corners.
 */
function seamLine(shared: [number, number] | null): string {
  const edge = "var(--block-edge)";
  if (!shared) return `linear-gradient(${edge}, ${edge})`;
  const [a, b] = shared;
  const at = (p: number, px: number) => `calc(${(p * 100).toFixed(3)}% + ${px.toFixed(3)}px)`;
  const from = at(a, 4 * a);
  const to = at(b, 4 * b - 4);
  return `linear-gradient(to right, ${edge} ${from}, transparent ${from} ${to}, ${edge} ${to})`;
}

/** The seam lines of a block's `i`th segment, as the custom properties it is drawn with. */
function seamStyle(segments: readonly BlockSegment[], i: number) {
  const segment = segments[i] as BlockSegment;
  const above = segments[i - 1];
  const below = segments[i + 1];
  return {
    ...(above && { "--seam-top": seamLine(sharedSpan(segment, above)) }),
    ...(below && { "--seam-bottom": seamLine(sharedSpan(segment, below)) }),
  };
}

/** How tall a stretch of `height` (a fraction of the day) is, in pixels. */
const toPixels = (height: number) => height * 24 * HOUR_HEIGHT;

/**
 * A block's label: its category, if it has one yet, and its time. It's
 * stacked, on one line, or left out, as fits the segment it's in.
 */
function BlockLabel({ name, time, height }: { name?: string; time: string; height: number }) {
  const fit = labelFit(toPixels(height));
  if (fit === "none") return null;
  return (
    <span className={classes.blockLabel} data-fit={fit}>
      {name !== undefined && <span className={classes.blockName}>{name}</span>}
      <span className={classes.blockTime}>{time}</span>
    </span>
  );
}

/** Where a block segment goes in its sub-column. */
export function segmentStyle(segment: BlockSegment) {
  return {
    "--top": segment.top,
    "--height": segment.height,
    "--lane": segment.lane,
    "--lanes": segment.lanes,
  } as CSSProperties;
}

/**
 * A range's time, such as "9:00–10:30" (see `clockRange`), with the days
 * when it crosses midnight.
 */
function rangeLabel(range: { startAt: Instant; endAt: Instant | null }, timeZone: string) {
  const { startAt, endAt } = range;
  if (endAt !== null) {
    const startDay = dayOf(startAt, timeZone);
    const endDay = dayOf(endAt, timeZone);
    // A range that ends at midnight is still on one day.
    if (startDay !== endDay && endAt !== startOfDay(endDay, timeZone)) {
      const time = (at: Instant) => formatClockTime(at, timeZone);
      return `${formatShortDay(startDay)} ${time(startAt)} – ${formatShortDay(endDay)} ${time(endAt)}`;
    }
  }
  return clockRange(range, timeZone);
}

/** How an edited or pasted block's ghost is drawn: as the block, in its category. */
interface GhostLook {
  colors: Record<string, string>;
  name: string;
  /** Still going, so open at the bottom. */
  ongoing: boolean;
}

/** The look of a ghost in `categoryId`'s colours, named after it. */
export function ghostLook(
  categoryId: string,
  categories: ReadonlyMap<string, TimelineCategory>,
  ongoing: boolean,
): GhostLook {
  return {
    colors: blockColors(categoryId),
    name: categories.get(categoryId)?.name ?? UNKNOWN_CATEGORY,
    ongoing,
  };
}

/**
 * A block being drawn, or where an edited block is going: one piece per day it
 * covers, with its label in the first. A drawn block is a dashed outline with
 * its time; an edited block's ghost has its `look`: the block itself, framed.
 */
export function ghostPieces(
  range: DrawnRange,
  days: readonly LocalDate[],
  timeZone: string,
  look?: GhostLook,
): { day: LocalDate; node: ReactNode }[] {
  const pieces = rangePieces(range, days, timeZone);
  const ongoing = look?.ongoing ?? false;
  const time = rangeLabel(ongoing ? { ...range, endAt: null } : range, timeZone);
  return pieces.map(({ day, top, height }, i) => ({
    day,
    node: (
      <div
        className={classes.ghost}
        style={{ ...look?.colors, "--top": top, "--height": height } as CSSProperties}
        data-edit={look ? true : undefined}
        data-continues-before={i > 0 || undefined}
        data-continues-after={i < pieces.length - 1 || ongoing || undefined}
      >
        {i === 0 && <BlockLabel name={look?.name} time={time} height={height} />}
      </div>
    ),
  }));
}

/**
 * How many of the day's observations are recorded, such as "3/7": filled when
 * all are, outlined when some are, dashed when none are. It sits inside the
 * day's button, so focusing the header reads the count out in words too.
 */
export function DayBadge({ count }: { count: DayObservationCount | undefined }) {
  const state = count && completeness(count);
  if (!count || !state) return null;
  return (
    <>
      <span className={classes.badge} data-state={state} aria-hidden="true">
        {count.recorded}/{count.total}
      </span>
      <VisuallyHidden>, {completenessLabel(count)}</VisuallyHidden>
    </>
  );
}

interface DayColumnProps {
  blocks: Map<string, GridBlock[]> | undefined;
  /** What the day's sub-columns draw over their blocks, such as the block being drawn. */
  extras: readonly Extra[];
  /** The drawing and paste handlers for one of the day's sub-columns. */
  handlers: (timelineId: string) => ColumnHandlers;
  /** The editing handlers for one of a block's segments. */
  blockHandlers: (block: GridBlock, segment: BlockSegment) => BlockHandlers;
  /** The block being dragged, saved or edited, if any. */
  edit: BlockEdit | null;
  timelines: Timeline[];
  categories: Map<string, TimelineCategory>;
  timeZone: string;
  /** Where the now line goes, as a fraction of the day, or `null` when it is not today. */
  nowAt: number | null;
  /** A click in the column, which makes this the active day. */
  onSelect: (event: MouseEvent<HTMLDivElement>) => void;
}

export function DayColumn({
  blocks,
  extras,
  handlers,
  blockHandlers,
  edit,
  timelines,
  categories,
  timeZone,
  nowAt,
  onSelect,
}: DayColumnProps) {
  return (
    // A mouse shortcut only: the day's header button is the keyboard way to select it.
    // biome-ignore lint/a11y/noStaticElementInteractions: see above.
    // biome-ignore lint/a11y/useKeyWithClickEvents: see above.
    <div className={classes.day} {...{ [DAY_COLUMN]: "" }} onClick={onSelect}>
      {timelines.map((t) => (
        <div key={t.id} className={classes.subColumn} {...handlers(t.id)}>
          {blocks?.get(t.id)?.map((block) => (
            <Block
              key={block.interval.id}
              block={block}
              category={categories.get(block.interval.categoryId)}
              timeZone={timeZone}
              handlers={blockHandlers}
              edit={edit?.interval.id === block.interval.id ? edit : null}
            />
          ))}
          {extras
            .filter((e) => e.timelineId === t.id)
            .map((e) => (
              <Fragment key={e.key}>{e.node}</Fragment>
            ))}
        </div>
      ))}
      {nowAt !== null && <div className={classes.nowLine} style={{ top: `${nowAt * 100}%` }} />}
    </div>
  );
}

interface BlockProps {
  block: GridBlock;
  category: TimelineCategory | undefined;
  timeZone: string;
  handlers: (block: GridBlock, segment: BlockSegment) => BlockHandlers;
  /** This block's edit, if it is the one being dragged, saved or edited. */
  edit: BlockEdit | null;
}

/**
 * One interval's piece of the day, drawn as its segments: one rectangle per
 * stretch with the same width, which fit together with overlapping blocks. The
 * label, its category and time, sits in the first segment. Its outline is
 * drawn around the whole shape: the edges where the interval really starts and
 * ends, its sides, and the steps where it changes lane, but not the seams
 * between its segments. The start and end are rounded, and there
 * they have handles to resize it, with grips on hover (an ongoing interval has
 * no end to drag). The whole block lights up on hover, whichever segment is
 * under the pointer. While it is dragged somewhere else, a dashed outline
 * stays where it was; while it is selected or its popover is open, it is
 * framed. Its segments take focus when it is selected, for its keys, but
 * aren't tab stops.
 */
function Block({ block, category, timeZone, handlers, edit }: BlockProps) {
  const [hovered, setHovered] = useState(false);
  const name = category?.name ?? UNKNOWN_CATEGORY;
  const title = describeBlock(block, name, timeZone);
  const colors = blockColors(block.interval.categoryId);
  const last = block.segments.length - 1;
  const startHere = !block.startsBefore;
  const endHere = !block.endsAfter && !block.ongoing;

  return block.segments.map((segment, i) => (
    <div
      // Segments never move between blocks, and a block's segments keep their order.
      // biome-ignore lint/suspicious/noArrayIndexKey: see above.
      key={i}
      className={classes.block}
      style={{ ...colors, ...segmentStyle(segment), ...seamStyle(block.segments, i) }}
      title={title}
      tabIndex={-1}
      // Which block it is, so the split key can tell the pointer is on the selected one.
      {...{ [BLOCK_ATTR]: block.interval.id }}
      data-start={(i === 0 && startHere) || undefined}
      data-end={(i === last && endHere) || undefined}
      data-ongoing={(i === last && block.ongoing) || undefined}
      data-hover={hovered || undefined}
      data-moving={
        (edit?.range && (edit.phase === "dragging" || edit.phase === "saving")) || undefined
      }
      data-selected={edit?.phase === "selected" || edit?.phase === "editing" || undefined}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      {...handlers(block, segment)}
    >
      {i === 0 && startHere && (
        <div className={classes.handle} data-side="top" {...{ [EDGE_ATTR]: "start" }} />
      )}
      {i === 0 && (
        <BlockLabel
          name={name}
          time={clockRange(block.interval, timeZone)}
          height={segment.height}
        />
      )}
      {i === last && endHere && (
        <div className={classes.handle} data-side="bottom" {...{ [EDGE_ATTR]: "end" }} />
      )}
    </div>
  ));
}
