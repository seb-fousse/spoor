import { useConfirmDelete } from "@components/ConfirmDelete";
import { useNow } from "@hooks/useNow";
import { describeShortcut, shortcutHandler, useShortcuts } from "@keyboard";
import { formatClockTime, formatShortDay } from "@lib/format";
import { Alert, Button, Center, Loader, Stack, Text, VisuallyHidden } from "@mantine/core";
import {
  type Database,
  type DayObservationCount,
  dayOf,
  dayRange,
  type Instant,
  type LocalDate,
  startOfDay,
  type Timeline,
  type TimelineCategory,
  type TimelineInterval,
} from "@spoor/core";
import {
  type CSSProperties,
  type Dispatch,
  Fragment,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { dayShortcuts } from "../dayShortcuts";
import type { HomeDaysAction } from "../homeDays";
import { BlockMenu, PasteMenu } from "./BlockMenu";
import { type BlockCopy, copyOf, pasteTarget } from "./blockCopy";
import { conflictingCategories } from "./blockEdit";
import { blockKeyHandler } from "./blockShortcuts";
import { CategoryPicker } from "./CategoryPicker";
import { completeness, completenessLabel } from "./completeness";
import { type DrawnRange, daysWindow, rangePieces } from "./dragRange";
import { type HiddenTimelines, visibleTimelines } from "./filter/timelineVisibility";
import {
  type BlockSegment,
  categoryColor,
  clockRange,
  describeBlock,
  type GridBlock,
  labelFit,
  layoutGrid,
  nowFraction,
  sharedSpan,
} from "./gridLayout";
import { DAY_COLUMN, DRAG_ROOT } from "./gridPointer";
import classes from "./TimelineGrid.module.css";
import { type BlockEdit, EDGE_ATTR, type SegmentHandlers, useBlockDrag } from "./useBlockDrag";
import { type SubColumnHandlers, useDragToCreate } from "./useDragToCreate";
import type { GridData } from "./useGridData";
import {
  useCreateInterval,
  useDeleteInterval,
  useSplitInterval,
  useUpdateInterval,
} from "./useIntervalWrites";
import { useObservationCounts } from "./useObservationCounts";
import { type PastePoint, usePasteMenu } from "./usePasteMenu";
import { useSplitAim } from "./useSplitAim";

/** Height of one hour, in pixels. */
const HOUR_HEIGHT = 48;
const HOURS = Array.from({ length: 24 }, (_, h) => h);
/** The earliest hour the grid opens scrolled to. */
const MORNING = 7;
/** How long a notice, such as why a paste was refused, stays up. */
const NOTICE_MS = 4000;
const COPY_KEYS = describeShortcut("copyBlock").keys.join("+");
const PASTE_KEYS = describeShortcut("pasteBlock").keys.join("+");

interface TimelineGridProps {
  db: Database;
  /** What to draw for `days`. Loaded by Home, which also feeds the header's timeline filter. */
  data: GridData;
  /** The timelines the header's filter has switched off. */
  hiddenTimelines: HiddenTimelines;
  /** Switches every timeline back on, from the empty state shown when all are off. */
  onShowAllTimelines: () => void;
  /** The visible days, oldest first. */
  days: LocalDate[];
  /** The day the rail shows, highlighted in its header. Always one of `days`. */
  activeDay: LocalDate;
  /** Changes the active day: picked from a header or column, or moved with the day keys. */
  dispatch: Dispatch<HomeDaysAction>;
}

/**
 * Home's timeline grid. Each day is a column, each timeline a sub-column, and
 * there is one hour axis down the left. The two-tier header (days, then
 * timeline names) stays at the top while the hours scroll. Dragging in an
 * empty stretch of a sub-column draws a new block, possibly across days, which
 * asks for its category on release. Dragging a block moves it, possibly to
 * another day, skipping over blocks in the way, and dragging its top or
 * bottom edge resizes it. Neither drag ever overlaps another block that
 * conflicts. Clicking a block selects it: ⌫ or Delete then asks to delete it,
 * ⌘C copies it, and Enter or a second click opens a popover to change its
 * category. Its right-click menu splits, copies or deletes it. A copy (its
 * category and length) pastes any number of times on its timeline, from the
 * right-click menu of an empty stretch or with ⌘V at the pointer, landing
 * like a move would: never over a block it conflicts with.
 * Clicking a day's header or column makes it the active day. Each day's
 * header has a badge with how many of its observations are recorded.
 */
export function TimelineGrid({
  db,
  data,
  hiddenTimelines,
  onShowAllTimelines,
  days,
  activeDay,
  dispatch,
}: TimelineGridProps) {
  const counts = useObservationCounts(db, days);
  // Held here, so it survives paging the days and the timeline filter.
  const [copied, setCopied] = useState<BlockCopy | null>(null);

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
  const shown = visibleTimelines(data.timelines, hiddenTimelines);
  if (shown.length === 0) {
    return (
      <Center className={classes.state}>
        <Stack align="center" gap="xs">
          <Text c="dimmed">No timelines selected.</Text>
          <Button size="xs" variant="light" onClick={onShowAllTimelines}>
            Show all
          </Button>
        </Stack>
      </Center>
    );
  }
  return (
    <Grid
      db={db}
      days={days}
      activeDay={activeDay}
      dispatch={dispatch}
      counts={counts}
      timeZone={data.timeZone}
      timelines={shown}
      categories={data.categories}
      intervals={data.intervals}
      copied={copied}
      onCopy={setCopied}
    />
  );
}

interface GridProps {
  db: Database;
  days: LocalDate[];
  activeDay: LocalDate;
  dispatch: Dispatch<HomeDaysAction>;
  /** Each day's observation counts, for its badge. A day without one has no badge. */
  counts: ReadonlyMap<LocalDate, DayObservationCount>;
  timeZone: string;
  timelines: Timeline[];
  categories: Map<string, TimelineCategory>;
  intervals: TimelineInterval[];
  /** The copied block, to paste; `null` until one is copied. */
  copied: BlockCopy | null;
  onCopy: (copy: BlockCopy) => void;
}

function Grid({
  db,
  days,
  activeDay,
  dispatch,
  counts,
  timeZone,
  timelines,
  categories,
  intervals,
  copied,
  onCopy,
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

  // The day headers are one tab stop: only the active day's button is
  // tabbable, and focus moves with the active day. A day key can push the
  // window along, which replaces the focused button, so the new active day's
  // button takes focus once it has rendered. Elsewhere on Home the same keys
  // go to Home's `useShortcuts`, which leaves alone the ones handled here.
  const headerRef = useRef<HTMLDivElement>(null);
  const focusDay = (day: LocalDate) =>
    headerRef.current
      ?.querySelector<HTMLButtonElement>(`button[data-day="${day}"]`)
      ?.focus({ preventScroll: true });
  const focusAfterStep = useRef(false);
  useEffect(() => {
    if (!focusAfterStep.current) return;
    focusAfterStep.current = false;
    focusDay(activeDay);
  });

  const onHeaderKeyDown = shortcutHandler(
    dayShortcuts((action) => {
      focusAfterStep.current = true;
      dispatch(action);
    }),
  );

  // Clicking focuses the day's button, so the header keeps focus for the keys.
  // WebKit (the macOS webview) doesn't focus a button on click by itself.
  const select = (day: LocalDate) => {
    dispatch({ type: "select", day });
    focusDay(day);
  };

  const drag = useDragToCreate(timeZone, days, timelines, intervals);
  const create = useCreateInterval(db);
  const cancel = () => {
    drag.cancel();
    create.reset();
  };

  // Failed moves, resizes and deletes show above the grid; failed picks show in the popover.
  const [error, setError] = useState<string | null>(null);
  const run = (action: () => Promise<unknown>) => {
    setError(null);
    action().catch((e: Error) => setError(e.message));
  };
  const [confirmDelete, deleteDialog] = useConfirmDelete(run);

  const move = useUpdateInterval(db);
  const recategorize = useUpdateInterval(db);
  const remove = useDeleteInterval(db);
  const split = useSplitInterval(db);
  // The split a right-button press on a block aims, and the menu its release opens.
  const splitAim = useSplitAim(timeZone, now);
  const menu = splitAim.aim;
  const blockDrag = useBlockDrag(timeZone, days, timelines, intervals, now, (interval, range) => {
    setError(null);
    move.mutate(
      { id: interval.id, timelineId: interval.timelineId, ...range },
      { onError: (e) => setError(e.message), onSettled: () => blockDrag.settle() },
    );
  });
  const closeEdit = () => {
    blockDrag.cancel();
    recategorize.reset();
  };

  // Asks first. Once the block is gone, nothing is selected and focus goes
  // to the active day's header, the grid's tab stop, rather than the page.
  // The write settles after the grid has refetched, so the block is gone by then.
  const askDelete = (interval: TimelineInterval) => {
    const name = categories.get(interval.categoryId)?.name ?? "Unknown category";
    confirmDelete(`the ${name} block, ${rangeLabel(interval, timeZone)}`, async () => {
      await remove.mutateAsync(interval.id);
      blockDrag.cancel();
      focusDay(activeDay);
    });
  };

  // Copy and paste. A copy of an ongoing block can't be made: it has no length yet.
  const copy = (interval: TimelineInterval) => {
    const c = copyOf(interval);
    if (c) onCopy(c);
  };
  const pasteMenu = usePasteMenu(timeZone);
  const pasteWrite = useCreateInterval(db);
  const visible = daysWindow(days, timeZone);
  // Pastes still being saved. Each one counts as a block until the grid has
  // refetched with it, so pasting again right away lands clear of it.
  const inFlight = useRef<TimelineInterval[]>([]);
  const pasteCount = useRef(0);
  /** Where pasting the copy at `point` lands, or why it can't. */
  const pasteTargetAt = (point: PastePoint) => {
    const timeline = timelines.find((t) => t.id === point.timelineId);
    if (!timeline) return { reason: "This timeline is hidden" };
    return pasteTarget(copied, point.timelineId, point.at, {
      intervals: [...intervals, ...inFlight.current],
      timeline,
      category: copied ? categories.get(copied.categoryId) : undefined,
      window: visible,
    });
  };
  // Failures show above the grid.
  const paste = (range: DrawnRange) => {
    if (!copied) return;
    const { timelineId, categoryId } = copied;
    pasteCount.current += 1;
    const pending: TimelineInterval = {
      id: `paste-${pasteCount.current}`,
      timelineId,
      categoryId,
      ...range,
      timeZone,
      createdAt: now,
      updatedAt: now,
    };
    inFlight.current = [...inFlight.current, pending];
    run(() =>
      pasteWrite.mutateAsync({ ...range, timelineId, categoryId }).finally(() => {
        inFlight.current = inFlight.current.filter((i) => i !== pending);
      }),
    );
  };

  // A short message over the grid, such as why the paste key did nothing.
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const say = (text: string) => {
    clearTimeout(noticeTimer.current);
    setNotice(text);
    noticeTimer.current = setTimeout(() => setNotice(null), NOTICE_MS);
  };
  useEffect(() => () => clearTimeout(noticeTimer.current), []);

  // ⌘V pastes at the pointer. It never fails silently: it says why it can't,
  // and where the paste went when a block in the way moved it.
  useShortcuts([
    [
      "pasteBlock",
      () => {
        if (!copied) return say(`Nothing copied. Select a block and press ${COPY_KEYS} first.`);
        const point = pasteMenu.atPointer();
        if (!point) return say(`Point where the block should go, then press ${PASTE_KEYS}.`);
        const target = pasteTargetAt(point);
        if ("reason" in target) return say(`Can't paste here. ${target.reason}.`);
        paste(target.range);
        if (target.range.startAt !== point.at) {
          const { startAt } = target.range;
          const when = formatClockTime(startAt, timeZone);
          const day = dayOf(startAt, timeZone);
          say(
            `Pasted at ${day === point.day ? when : `${formatShortDay(day)} ${when}`}, the nearest free spot.`,
          );
        }
      },
    ],
  ]);

  /** The timeline's unarchived categories, by name, to pick from. */
  const choicesFor = (timelineId: string) =>
    [...categories.values()]
      .filter((c) => c.timelineId === timelineId && c.archivedAt === null)
      .sort((a, b) => a.name.localeCompare(b.name));

  // What each day's sub-columns draw over their blocks: the block being drawn
  // or edited, one piece per day it covers, and the popover's anchor.
  const extras = new Map<LocalDate, Extra[]>();
  const addExtra = (day: LocalDate, extra: Extra) =>
    extras.set(day, [...(extras.get(day) ?? []), extra]);

  // The block being drawn. The piece under the pointer carries the category
  // popover once released.
  const draft = drag.draft;
  if (draft && timelines.some((t) => t.id === draft.timelineId)) {
    const pieces = ghostPieces(draft.range, days, timeZone);
    const popoverDay = pieces.some((p) => p.day === draft.pointerDay)
      ? draft.pointerDay
      : pieces.at(-1)?.day;
    for (const { day, node } of pieces) {
      addExtra(day, {
        key: "draft",
        timelineId: draft.timelineId,
        node:
          day !== popoverDay ? (
            node
          ) : (
            <CategoryPicker
              opened={draft.phase === "choosing"}
              categories={choicesFor(draft.timelineId)}
              error={create.error?.message ?? null}
              saving={create.isPending}
              onCancel={cancel}
              onPick={(choice) =>
                create.mutate(
                  { ...draft.range, ...choice, timelineId: draft.timelineId },
                  { onSuccess: cancel },
                )
              }
            >
              {node}
            </CategoryPicker>
          ),
      });
    }
  }

  // The block being edited: where it is going, in its category's colours,
  // while it is dragged and saved; its popover once clicked.
  const edit = blockDrag.edit;
  if (edit?.range) {
    const { startAt, endAt } = edit.range;
    const shown = { startAt, endAt: endAt ?? Math.max(now, startAt) };
    const look = {
      colors: blockColors(edit.interval.categoryId),
      name: categories.get(edit.interval.categoryId)?.name ?? "Unknown category",
      ongoing: endAt === null,
    };
    for (const { day, node } of ghostPieces(shown, days, timeZone, look)) {
      addExtra(day, { key: "edit", timelineId: edit.interval.timelineId, node });
    }
  }
  if (menu) {
    const { interval, day, segment, at } = menu;
    const [dayStart, dayEnd] = dayRange(day, timeZone);
    if (at !== null) {
      // Where the cut goes, across the block.
      const style = { ...blockColors(interval.categoryId), ...segmentStyle(segment) };
      addExtra(day, {
        key: "cut",
        timelineId: interval.timelineId,
        node: (
          <div
            className={classes.cutLine}
            style={{ ...style, "--top": (at - dayStart) / (dayEnd - dayStart) } as CSSProperties}
          />
        ),
      });
    }
    if (menu.phase === "open") {
      addExtra(day, {
        key: "menu",
        timelineId: interval.timelineId,
        node: (
          <BlockMenu
            top={menu.top}
            left={menu.left}
            splitLabel={at === null ? null : `Split at ${formatClockTime(at, timeZone)}`}
            onClose={() => splitAim.close()}
            onSplit={() => {
              if (at === null) return;
              splitAim.close();
              run(() => split.mutateAsync({ id: interval.id, at }));
            }}
            onCopy={
              interval.endAt === null
                ? null
                : () => {
                    splitAim.close();
                    copy(interval);
                  }
            }
            onDelete={() => {
              splitAim.close();
              askDelete(interval);
            }}
          />
        ),
      });
    }
  }

  // The paste menu, and a ghost of where the paste would land.
  const pasteAt = pasteMenu.menu;
  if (pasteAt) {
    const target = pasteTargetAt(pasteAt);
    let item: { label: string } | { reason: string } = {
      reason: "reason" in target ? target.reason : "Nothing copied",
    };
    if (copied && "range" in target) {
      // The day too, when a block in the way pushed it onto another one.
      const { startAt } = target.range;
      const startDay = dayOf(startAt, timeZone);
      const when = formatClockTime(startAt, timeZone);
      item = {
        label: `Paste at ${startDay === pasteAt.day ? when : `${formatShortDay(startDay)} ${when}`}`,
      };
      const look = {
        colors: blockColors(copied.categoryId),
        name: categories.get(copied.categoryId)?.name ?? "Unknown category",
        ongoing: false,
      };
      for (const { day, node } of ghostPieces(target.range, days, timeZone, look)) {
        addExtra(day, { key: "paste", timelineId: pasteAt.timelineId, node });
      }
    }
    addExtra(pasteAt.day, {
      key: "paste-menu",
      timelineId: pasteAt.timelineId,
      node: (
        <PasteMenu
          top={pasteAt.top}
          left={pasteAt.left}
          paste={item}
          onClose={pasteMenu.close}
          onPaste={() => {
            pasteMenu.close();
            if ("range" in target) paste(target.range);
          }}
        />
      ),
    });
  }

  if (edit?.phase === "editing") {
    const { interval, segment } = edit;
    const timeline = timelines.find((t) => t.id === interval.timelineId);
    const choices = choicesFor(interval.timelineId);
    addExtra(edit.day, {
      key: "popover",
      timelineId: interval.timelineId,
      node: (
        <CategoryPicker
          opened
          categories={choices}
          currentId={interval.categoryId}
          disabledIds={
            timeline &&
            conflictingCategories(
              interval,
              intervals,
              timeline,
              choices.map((c) => c.id),
            )
          }
          error={recategorize.error?.message ?? null}
          saving={recategorize.isPending}
          onCancel={closeEdit}
          onPick={(choice) =>
            recategorize.mutate(
              { id: interval.id, timelineId: interval.timelineId, ...choice },
              { onSuccess: closeEdit },
            )
          }
        >
          <div className={classes.anchor} style={segmentStyle(segment)} />
        </CategoryPicker>
      ),
    });
  }

  // A press on a block, and a press in an empty stretch, each closes the
  // other's popover, and the block menu. Mantine can't see these presses: the
  // drags cancel them.
  const blockHandlers = (block: GridBlock, segment: BlockSegment): BlockHandlers => {
    const handlers = blockDrag.handlers(block, segment);
    const aim = splitAim.handlers(block, segment);
    const selected = edit?.phase === "selected" && edit.interval.id === block.interval.id;
    return {
      // A right-button press aims a split (see `useSplitAim`); the left
      // button drags the block.
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        cancel();
        pasteMenu.close();
        if (blockDrag.edit?.phase !== "saving" && aim.onPointerDown(event)) {
          closeEdit();
          return;
        }
        splitAim.close();
        handlers.onPointerDown(event);
      },
      onPointerMove: (event: PointerEvent<HTMLElement>) => {
        if (!aim.onPointerMove(event)) handlers.onPointerMove(event);
      },
      onPointerUp: (event: PointerEvent<HTMLElement>) => {
        if (!aim.onPointerUp()) handlers.onPointerUp(event);
      },
      onPointerCancel: () => {
        if (!aim.onPointerCancel()) handlers.onPointerCancel();
      },
      // The webview's own menu would hide the block's.
      onContextMenu: (event: MouseEvent<HTMLElement>) => {
        event.preventDefault();
        event.stopPropagation();
      },
      // The selected block's keys, on whichever of its segments has focus.
      onKeyDown: selected
        ? blockKeyHandler({
            onDelete: () => askDelete(block.interval),
            onCopy: () => copy(block.interval),
            onOpen: blockDrag.open,
            onDeselect: closeEdit,
          })
        : undefined,
    };
  };
  const subColumnHandlers = (day: LocalDate, timelineId: string): ColumnHandlers => {
    const handlers = drag.handlers(day, timelineId);
    const pasting = pasteMenu.handlers(day, timelineId);
    return {
      ...handlers,
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        // React passes events up from portals too, such as the popover's.
        const target = event.target as HTMLElement;
        if (event.currentTarget.contains(target)) {
          closeEdit();
          pasteMenu.close();
          if (!target.closest("[data-block]")) splitAim.close();
        }
        handlers.onPointerDown(event);
      },
      // A right click in an empty stretch opens the paste menu, in place of any other.
      onContextMenu: (event: MouseEvent<HTMLElement>) => {
        if (!pasting.onContextMenu(event)) return;
        cancel();
        closeEdit();
        splitAim.close();
      },
    };
  };

  const style = {
    "--days": days.length,
    "--timelines": timelines.length,
    "--hour-height": `${HOUR_HEIGHT}px`,
  } as CSSProperties;

  return (
    <div className={classes.grid} style={style}>
      {deleteDialog}
      {/* Over the grid, so it doesn't push the hours down. */}
      <div className={classes.notice} role="status">
        {notice && <span className={classes.noticeText}>{notice}</span>}
      </div>
      {error && (
        <Alert
          color="red"
          m="xs"
          py={6}
          withCloseButton
          closeButtonLabel="Dismiss"
          onClose={() => setError(null)}
        >
          {error}
        </Alert>
      )}

      {/* Outside the scroller, so only the hours scroll. */}
      <div ref={headerRef} className={classes.header}>
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
              data-day={day}
              tabIndex={day === activeDay ? 0 : -1}
              aria-current={day === activeDay ? "date" : undefined}
              onClick={() => select(day)}
              onKeyDown={onHeaderKeyDown}
            >
              {formatShortDay(day)}
              <DayBadge count={counts.get(day)} />
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
        <div className={classes.body} {...{ [DRAG_ROOT]: "" }}>
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
              extras={extras.get(day) ?? []}
              handlers={(timelineId) => subColumnHandlers(day, timelineId)}
              blockHandlers={blockHandlers}
              edit={edit}
              timelines={timelines}
              categories={categories}
              timeZone={timeZone}
              nowAt={day === today ? nowFraction(now, day, timeZone) : null}
              onSelect={(event) => {
                // React passes clicks up from portals too, such as the popover's.
                const target = event.target as Element;
                if (!event.currentTarget.contains(target)) return;
                // A click on a block selects it, and focuses it for its keys:
                // the day becomes active, but its header doesn't take focus.
                if (target.closest("[data-block]")) dispatch({ type: "select", day });
                else select(day);
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * What a block segment spreads: the drag handlers, a right click for its
 * menu, and the selected block's keys.
 */
type BlockHandlers = SegmentHandlers & {
  onContextMenu: (event: MouseEvent<HTMLElement>) => void;
  onKeyDown: ((event: KeyboardEvent<HTMLElement>) => void) | undefined;
};

/** What a sub-column spreads: the drawing handlers, and the paste menu's. */
type ColumnHandlers = SubColumnHandlers & {
  onContextMenu: (event: MouseEvent<HTMLElement>) => void;
};

/** Something drawn in one of a day's sub-columns, over its blocks. */
interface Extra {
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
function blockColors(categoryId: string) {
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
function segmentStyle(segment: BlockSegment) {
  return {
    "--top": segment.top,
    "--height": segment.height,
    "--lane": segment.lane,
    "--lanes": segment.lanes,
  } as CSSProperties;
}

/** A range's time, such as "9:00–10:30", with the days when it crosses midnight. */
function rangeLabel(range: { startAt: Instant; endAt: Instant | null }, timeZone: string) {
  const { startAt, endAt } = range;
  const time = (at: Instant) => formatClockTime(at, timeZone);
  if (endAt === null) return `since ${time(startAt)}`;
  const startDay = dayOf(startAt, timeZone);
  const endDay = dayOf(endAt, timeZone);
  // A range that ends at midnight is still on one day.
  if (startDay === endDay || endAt === startOfDay(endDay, timeZone)) {
    return `${time(startAt)}–${time(endAt)}`;
  }
  return `${formatShortDay(startDay)} ${time(startAt)} – ${formatShortDay(endDay)} ${time(endAt)}`;
}

/** How an edited block's ghost is drawn: as the block, in its category. */
interface GhostLook {
  colors: Record<string, string>;
  name: string;
  /** Still going, so open at the bottom. */
  ongoing: boolean;
}

/**
 * A block being drawn, or where an edited block is going: one piece per day it
 * covers, with its label in the first. A drawn block is a dashed outline with
 * its time; an edited block's ghost has its `look`: the block itself, framed.
 */
function ghostPieces(
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
function DayBadge({ count }: { count: DayObservationCount | undefined }) {
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

function DayColumn({
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
  const name = category?.name ?? "Unknown category";
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
      data-block
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
