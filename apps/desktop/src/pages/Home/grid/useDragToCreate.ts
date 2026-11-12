import type { Instant, LocalDate, Timeline, TimelineInterval } from "@spoor/core";
import { type PointerEvent, useState } from "react";
import { type DrawnRange, daysWindow, dragRange, freeSpan, snapFraction } from "./dragRange";

/** A block being drawn, or drawn and waiting for its category. It may span several days. */
export interface Draft {
  timelineId: string;
  range: DrawnRange;
  /** The day the pointer is (or was released) over, where the popover goes. */
  pointerDay: LocalDate;
  /** `drawing` while the pointer is down, `choosing` once released. */
  phase: "drawing" | "choosing";
}

interface DragState extends Omit<Draft, "range"> {
  /** `null` until the pointer has moved off the step it was pressed on. */
  range: DrawnRange | null;
  anchor: Instant;
  /** Where the drag may reach: the visible days, or on an exclusive timeline the gap it started in. */
  span: DrawnRange;
}

/** Marks the element holding every day column, and each day column. */
export const DRAG_ROOT = "data-drag-root";
export const DAY_COLUMN = "data-drag-day-column";
const DAY_ATTR = "data-drag-day";
const TIMELINE_ATTR = "data-drag-timeline";

/** What `handlers` spreads on a sub-column. */
export type SubColumnHandlers = ReturnType<ReturnType<typeof useDragToCreate>["handlers"]>;

/**
 * Drawing a block with the pointer: press in an empty stretch of a
 * sub-column, drag up, down, or across to another day's column of the same
 * timeline, release. Mouse and pen only. One draft at a time; pressing again
 * elsewhere replaces it. A click, or a drag that ends where it started, draws
 * nothing. On an exclusive timeline the drag stops at the neighbouring
 * blocks, and a press with no room (inside an ongoing interval's reach) does
 * nothing.
 *
 * `handlers(day, timelineId)` is spread on each sub-column, inside a day
 * column marked with `DAY_COLUMN`, inside an element marked with `DRAG_ROOT`.
 * A press on an existing block (anything matching `[data-block]`) is left
 * alone. `cancel` drops a released draft.
 */
export function useDragToCreate(
  timeZone: string,
  days: readonly LocalDate[],
  timelines: readonly Timeline[],
  intervals: readonly TimelineInterval[],
) {
  const [state, setState] = useState<DragState | null>(null);

  /** The snapped instant at `clientY` in `column`, a sub-column of `day`. */
  const instantIn = (column: HTMLElement, clientY: number, day: LocalDate) => {
    const rect = column.getBoundingClientRect();
    return snapFraction((clientY - rect.top) / rect.height, day, timeZone);
  };

  /**
   * The day under the pointer, and the snapped instant at its height in that
   * day's sub-column for the timeline. The day is the whole day column the
   * pointer is over, so moving across other timelines' sub-columns stays on it.
   */
  const locate = (event: PointerEvent<HTMLElement>, timelineId: string) => {
    const root = event.currentTarget.closest(`[${DRAG_ROOT}]`) ?? event.currentTarget;
    const columns = [
      ...root.querySelectorAll<HTMLElement>(`[${TIMELINE_ATTR}="${CSS.escape(timelineId)}"]`),
    ];
    // Left of the first day counts as the first, right of the last as the last.
    const column =
      columns.find(
        (c) => event.clientX < (c.closest(`[${DAY_COLUMN}]`) ?? c).getBoundingClientRect().right,
      ) ??
      columns.at(-1) ??
      event.currentTarget;
    const day = column.getAttribute(DAY_ATTR) as LocalDate;
    return { day, at: instantIn(column, event.clientY, day) };
  };

  const handlers = (day: LocalDate, timelineId: string) => ({
    [DAY_ATTR]: day,
    [TIMELINE_ATTR]: timelineId,
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType === "touch" || event.button !== 0) return;
      const target = event.target as HTMLElement;
      // React passes events up from portals too, such as the category popover's.
      if (!event.currentTarget.contains(target) || target.closest("[data-block]")) return;
      const timeline = timelines.find((t) => t.id === timelineId);
      const anchor = instantIn(event.currentTarget, event.clientY, day);
      const span = timeline && freeSpan(anchor, intervals, timeline, daysWindow(days, timeZone));
      if (!span) return;
      // No text selection or focus change while drawing.
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      setState({ timelineId, anchor, span, range: null, pointerDay: day, phase: "drawing" });
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      // Captured, so the pressed sub-column gets every move, wherever the pointer is.
      if (state?.phase !== "drawing" || state.timelineId !== timelineId) return;
      const { day: pointerDay, at } = locate(event, timelineId);
      setState({ ...state, pointerDay, range: dragRange(state.anchor, at, state.span) });
    },
    onPointerUp: () => {
      setState((s) => {
        if (s?.phase !== "drawing") return s;
        return s.range ? { ...s, phase: "choosing" } : null;
      });
    },
    onPointerCancel: () => setState((s) => (s?.phase === "drawing" ? null : s)),
  });

  // Only a released draft: an outside click that closes the popover may have
  // just started the next one, which stays.
  const cancel = () => setState((s) => (s?.phase === "choosing" ? null : s));

  const draft: Draft | null = state?.range ? { ...state, range: state.range } : null;
  return { draft, handlers, cancel };
}
