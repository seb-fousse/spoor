import { useNow } from "@hooks/useNow";
import { Alert, Center, Loader, Text } from "@mantine/core";
import {
  type Database,
  dayOf,
  type LocalDate,
  type Timeline,
  type TimelineCategory,
  type TimelineInterval,
} from "@spoor/core";
import { type CSSProperties, useLayoutEffect, useMemo, useRef } from "react";
import {
  categoryColor,
  describeBlock,
  type GridBlock,
  layoutGrid,
  nowFraction,
} from "./gridLayout";
import { formatShortDay } from "./homeDays";
import classes from "./TimelineGrid.module.css";
import { useGridData } from "./useGridData";

/** Height of one hour, in pixels. */
const HOUR_HEIGHT = 48;
const HOURS = Array.from({ length: 24 }, (_, h) => h);
/** The earliest hour the grid opens scrolled to. */
const MORNING = 7;

interface TimelineGridProps {
  db: Database;
  /** The visible days, oldest first. */
  days: LocalDate[];
  /** The day the rail shows, highlighted in the grid. Always one of `days`. */
  activeDay: LocalDate;
  /** Called when the user picks a day from its header or column. */
  onSelectDay: (day: LocalDate) => void;
}

/**
 * Home's timeline grid. Each day is a column, each timeline a sub-column, and
 * there is one hour axis down the left. The two-tier header (days, then
 * timeline names) stays at the top while the hours scroll. The intervals are
 * read-only; clicking a day's header or column makes it the active day.
 */
export function TimelineGrid({ db, days, activeDay, onSelectDay }: TimelineGridProps) {
  const data = useGridData(db, days);

  if (data.status === "loading") {
    return (
      <Center className={classes.state}>
        <Loader />
      </Center>
    );
  }
  if (data.status === "error") {
    return (
      <Alert m="md" color="red" title="Could not load the timelines">
        {data.error}
      </Alert>
    );
  }
  if (data.timelines.length === 0) {
    return (
      <Center className={classes.state}>
        <Text c="dimmed">No timelines yet. Add one on the Timelines page to see it here.</Text>
      </Center>
    );
  }
  return (
    <Grid
      days={days}
      activeDay={activeDay}
      onSelectDay={onSelectDay}
      timeZone={data.timeZone}
      timelines={data.timelines}
      categories={data.categories}
      intervals={data.intervals}
    />
  );
}

interface GridProps {
  days: LocalDate[];
  activeDay: LocalDate;
  onSelectDay: (day: LocalDate) => void;
  timeZone: string;
  timelines: Timeline[];
  categories: Map<string, TimelineCategory>;
  intervals: TimelineInterval[];
}

function Grid({
  days,
  activeDay,
  onSelectDay,
  timeZone,
  timelines,
  categories,
  intervals,
}: GridProps) {
  const now = useNow();
  const today = dayOf(now, timeZone);
  const layout = useMemo(
    () => layoutGrid(intervals, timelines, days, timeZone, now),
    [intervals, timelines, days, timeZone, now],
  );

  // Open on the morning, or a little before now if that is later. Only on the
  // first render: after that the user's scroll position wins.
  const scrollRef = useRef<HTMLDivElement>(null);
  const initialTop = useRef(
    Math.max(MORNING, (nowFraction(now, today, timeZone) ?? 0) * 24 - 2) * HOUR_HEIGHT,
  );
  useLayoutEffect(() => {
    scrollRef.current?.scrollTo({ top: initialTop.current });
  }, []);

  const style = {
    "--days": days.length,
    "--timelines": timelines.length,
    "--hour-height": `${HOUR_HEIGHT}px`,
  } as CSSProperties;

  return (
    <div className={classes.grid} style={style}>
      {/* Outside the scroller, so only the hours scroll. */}
      <div className={classes.header}>
        <div className={classes.corner} />
        {days.map((day) => (
          <div
            key={day}
            className={classes.dayHead}
            data-today={day === today || undefined}
            data-active={day === activeDay || undefined}
          >
            {/* The keyboard way to pick a day; the column below takes mouse clicks too. */}
            <button
              type="button"
              className={classes.dayLabel}
              aria-current={day === activeDay ? "date" : undefined}
              onClick={() => onSelectDay(day)}
            >
              {formatShortDay(day)}
            </button>
            <div className={classes.timelineNames}>
              {timelines.map((t) => (
                <div key={t.id} className={classes.timelineName} title={t.name}>
                  {t.name}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div ref={scrollRef} className={classes.scroller}>
        <div className={classes.body}>
          <div className={classes.gutter} aria-hidden="true">
            {HOURS.map((h) => (
              <div key={h} className={classes.hour}>
                {h > 0 && <span>{`${String(h).padStart(2, "0")}:00`}</span>}
              </div>
            ))}
          </div>

          {days.map((day) => (
            <DayColumn
              key={day}
              blocks={layout.get(day)}
              timelines={timelines}
              categories={categories}
              timeZone={timeZone}
              nowAt={day === today ? nowFraction(now, day, timeZone) : null}
              active={day === activeDay}
              onSelect={() => onSelectDay(day)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

interface DayColumnProps {
  blocks: Map<string, GridBlock[]> | undefined;
  timelines: Timeline[];
  categories: Map<string, TimelineCategory>;
  timeZone: string;
  /** Where the now line goes, as a fraction of the day, or `null` when it is not today. */
  nowAt: number | null;
  /** Whether this is the active day, which gets the accent outline. */
  active: boolean;
  /** Makes this the active day. */
  onSelect: () => void;
}

function DayColumn({
  blocks,
  timelines,
  categories,
  timeZone,
  nowAt,
  active,
  onSelect,
}: DayColumnProps) {
  return (
    // A mouse shortcut only: the day's header button is the keyboard way to select it.
    // biome-ignore lint/a11y/noStaticElementInteractions: see above.
    // biome-ignore lint/a11y/useKeyWithClickEvents: see above.
    <div
      className={classes.day}
      data-today={nowAt !== null || undefined}
      data-active={active || undefined}
      onClick={onSelect}
    >
      {timelines.map((t) => (
        <div key={t.id} className={classes.subColumn}>
          {blocks?.get(t.id)?.map((block) => (
            <Block
              key={block.interval.id}
              block={block}
              category={categories.get(block.interval.categoryId)}
              timeZone={timeZone}
            />
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
}

/**
 * One interval's piece of the day, drawn as its segments: one rectangle per
 * stretch with the same width, which fit together with overlapping blocks. The
 * label sits in the first segment. The outer corners are rounded where the
 * interval really starts and ends.
 */
function Block({ block, category, timeZone }: BlockProps) {
  const color = categoryColor(block.interval.categoryId);
  const name = category?.name ?? "Unknown category";
  const title = describeBlock(block, name, timeZone);
  const colors = {
    // Mantine's variant colours, which follow the light/dark scheme.
    "--block-bg": `var(--mantine-color-${color}-light)`,
    "--block-fg": `var(--mantine-color-${color}-light-color)`,
    "--block-accent": `var(--mantine-color-${color}-filled)`,
  };
  const last = block.segments.length - 1;

  return block.segments.map((segment, i) => (
    <div
      // Segments never move between blocks, and a block's segments keep their order.
      // biome-ignore lint/suspicious/noArrayIndexKey: see above.
      key={i}
      className={classes.block}
      style={
        {
          ...colors,
          "--top": segment.top,
          "--height": segment.height,
          "--lane": segment.lane,
          "--lanes": segment.lanes,
        } as CSSProperties
      }
      title={title}
      data-round-top={(i === 0 && !block.startsBefore) || undefined}
      data-round-bottom={(i === last && !block.endsAfter && !block.ongoing) || undefined}
      data-ongoing={(i === last && block.ongoing) || undefined}
    >
      {i === 0 && <span className={classes.blockLabel}>{name}</span>}
    </div>
  ));
}
