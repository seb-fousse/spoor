import { useNow } from "@hooks/useNow";
import { shortcutHandler, shortcutLabel, useShortcuts } from "@keyboard";
import { formatClockTime, formatShortDay } from "@lib/format";
import { Alert, Button, Center, Loader, Stack, Text } from "@mantine/core";
import {
  type Database,
  type DayObservationCount,
  dayOf,
  dayRange,
  type LocalDate,
  type Timeline,
  type TimelineCategory,
  type TimelineInterval,
} from "@spoor/core";
import {
  type CSSProperties,
  type Dispatch,
  type MouseEvent,
  type PointerEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { dayShortcuts } from "../dayShortcuts";
import type { HomeDaysAction } from "../homeDays";
import { BlockMenu, PasteMenu } from "./BlockMenu";
import { type BlockCopy, copyOf, landingLabel } from "./blockCopy";
import { conflictingCategories, splitPoint } from "./blockEdit";
import { blockKeyHandler } from "./blockShortcuts";
import { CategoryPicker } from "./CategoryPicker";
import { type HiddenTimelines, visibleTimelines } from "./filter/timelineVisibility";
import {
  type BlockHandlers,
  blockColors,
  type ColumnHandlers,
  DayBadge,
  DayColumn,
  type Extra,
  ghostLook,
  ghostPieces,
  HOUR_HEIGHT,
  segmentStyle,
} from "./GridBlocks";
import { type BlockSegment, type GridBlock, layoutGrid, nowFraction } from "./gridLayout";
import { DRAG_ROOT, isOnBlock, ownsEvent } from "./gridPointer";
import classes from "./TimelineGrid.module.css";
import { useBlockDrag } from "./useBlockDrag";
import { useBlockPaste } from "./useBlockPaste";
import { useDragToCreate } from "./useDragToCreate";
import type { GridData } from "./useGridData";
import { useGridPointer } from "./useGridPointer";
import {
  useCreateInterval,
  useDeleteInterval,
  useSplitInterval,
  useUpdateInterval,
} from "./useIntervalWrites";
import { useNotice } from "./useNotice";
import { useObservationCounts } from "./useObservationCounts";
import { usePasteMenu } from "./usePasteMenu";
import { useSplitAim } from "./useSplitAim";

const HOURS = Array.from({ length: 24 }, (_, h) => h);
/** The earliest hour the grid opens scrolled to. */
const MORNING = 7;
/** How long a notice, such as why a paste was refused, stays up. */
const NOTICE_MS = 4000;
const COPY_KEYS = shortcutLabel("copyBlock");
const PASTE_KEYS = shortcutLabel("pasteBlock");

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
 * conflicts. Clicking a block selects it: ⌫ or Delete then deletes it, ⌘C
 * copies it, C splits it at the mark nearest the pointer, and Enter or a
 * second click opens a popover to change its category. Its right-click menu
 * splits, copies or deletes it. A copy (its
 * category and length) pastes any number of times on its timeline, from the
 * right-click menu of an empty stretch or with ⌘V at the pointer, landing
 * like a move would: never over a block it conflicts with.
 * Clicking a day's header or column makes it the active day. Each day's
 * header has a badge with how many of its observations are recorded.
 *
 * The blocks and ghosts themselves are drawn by `GridBlocks`.
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

  // Failed moves, resizes, deletes, splits and pastes show above the grid;
  // failed picks show in the popover.
  const [error, setError] = useState<string | null>(null);
  const run = (action: () => Promise<unknown>) => {
    setError(null);
    action().catch((e: Error) => setError(e.message));
  };

  const move = useUpdateInterval(db);
  const recategorize = useUpdateInterval(db);
  const remove = useDeleteInterval(db);
  const split = useSplitInterval(db);
  // Whether the split key's last split is still being saved.
  const splitting = useRef(false);
  // The split a right-button press on a block aims, and the menu its release opens.
  const splitAim = useSplitAim(timeZone, now);
  const menu = splitAim.aim;
  const blockDrag = useBlockDrag(timeZone, days, timelines, intervals, now, (interval, range) =>
    run(() =>
      move
        .mutateAsync({ id: interval.id, timelineId: interval.timelineId, ...range })
        .finally(() => blockDrag.settle()),
    ),
  );
  const closeEdit = () => {
    blockDrag.cancel();
    recategorize.reset();
  };

  // At once, without asking: a block takes nothing else with it. Once it is
  // gone, nothing is selected and focus goes to the active day's header, the
  // grid's tab stop, rather than the page. The write settles after the grid
  // has refetched, so the block is gone by then.
  const deleteBlock = (interval: TimelineInterval) =>
    run(async () => {
      await remove.mutateAsync(interval.id);
      blockDrag.cancel();
      focusDay(activeDay);
    });

  // Copy and paste. A copy of an ongoing block can't be made: it has no length yet.
  const copy = (interval: TimelineInterval) => {
    const c = copyOf(interval);
    if (c) onCopy(c);
  };
  const pasteMenu = usePasteMenu(timeZone);
  // Where the pointer is, for the keys that act there: paste and split.
  const gridPointer = useGridPointer(timeZone);
  const pasting = useBlockPaste({
    db,
    copied,
    timelines,
    intervals,
    categories,
    days,
    timeZone,
    now,
    run,
  });

  // A short message over the grid, such as why the paste key did nothing.
  const { notice, say } = useNotice(NOTICE_MS);

  // ⌘V pastes at the pointer. It never fails silently: it says why it can't,
  // and where the paste went when a block in the way moved it.
  useShortcuts([
    [
      "pasteBlock",
      () => {
        if (!copied) return say(`Nothing copied. Select a block and press ${COPY_KEYS} first.`);
        const point = gridPointer.atPointer();
        if (!point) return say(`Point where the block should go, then press ${PASTE_KEYS}.`);
        const target = pasting.targetAt(point);
        if ("reason" in target) return say(`Can't paste here. ${target.reason}.`);
        pasting.paste(target.range);
        if (target.range.startAt !== point.at) {
          const where = landingLabel(target.range.startAt, point.day, timeZone);
          say(`Pasted at ${where}, the nearest free spot.`);
        }
      },
    ],
    // C splits the selected block, like ⌫ deletes it, at the mark nearest
    // the pointer, like the menu's Split. The earlier half keeps the block's
    // id, so it stays selected. One at a time: the next press needs the grid
    // refetched with the halves. Like ⌫, it does nothing, quietly, when it
    // can't: nothing selected, the pointer off it, or no mark inside it there.
    [
      "splitBlock",
      () => {
        const selected = blockDrag.edit;
        if (splitting.current || selected?.phase !== "selected") return;
        const point = gridPointer.atPointer();
        const interval = intervals.find((i) => i.id === selected.interval.id);
        if (!point || !interval || point.blockId !== interval.id) return;
        const at = splitPoint(interval, point.at, now);
        if (at === null) return;
        splitAim.close();
        pasteMenu.close();
        splitting.current = true;
        run(() =>
          split.mutateAsync({ id: interval.id, at }).finally(() => {
            splitting.current = false;
          }),
        );
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
    const look = ghostLook(edit.interval.categoryId, categories, endAt === null);
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
              deleteBlock(interval);
            }}
          />
        ),
      });
    }
  }

  // The paste menu, and a ghost of where the paste would land.
  const pasteAt = pasteMenu.menu;
  if (pasteAt) {
    const target = pasting.targetAt(pasteAt);
    let item: { label: string } | { reason: string } = {
      reason: "reason" in target ? target.reason : "Nothing copied",
    };
    if (copied && "range" in target) {
      item = { label: `Paste at ${landingLabel(target.range.startAt, pasteAt.day, timeZone)}` };
      const look = ghostLook(copied.categoryId, categories, false);
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
            if ("range" in target) pasting.paste(target.range);
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
            onDelete: () => deleteBlock(block.interval),
            onCopy: () => copy(block.interval),
            onOpen: blockDrag.open,
            onDeselect: closeEdit,
          })
        : undefined,
    };
  };
  const subColumnHandlers = (day: LocalDate, timelineId: string): ColumnHandlers => {
    const handlers = drag.handlers(day, timelineId);
    const pasteHandlers = pasteMenu.handlers(day, timelineId);
    return {
      ...handlers,
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        // Not a press in a popover (see `ownsEvent`).
        if (ownsEvent(event)) {
          closeEdit();
          pasteMenu.close();
          if (!isOnBlock(event.target as Element)) splitAim.close();
        }
        handlers.onPointerDown(event);
      },
      // A right click in an empty stretch opens the paste menu, in place of any other.
      onContextMenu: (event: MouseEvent<HTMLElement>) => {
        if (!pasteHandlers.onContextMenu(event)) return;
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
                // Not a click in a popover (see `ownsEvent`).
                if (!ownsEvent(event)) return;
                // A click on a block selects it, and focuses it for its keys:
                // the day becomes active, but its header doesn't take focus.
                if (isOnBlock(event.target as Element)) dispatch({ type: "select", day });
                else select(day);
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
