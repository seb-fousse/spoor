import { IS_MAC } from "@platform/os";
import type { Instant, LocalDate, Timeline, TimelineInterval } from "@spoor/core";
import { type PointerEvent, useState } from "react";
import { type DrawnRange, daysWindow, dragRange, freeSpan } from "./dragRange";
import { DAY_ATTR, instantIn, pointerAt, TIMELINE_ATTR } from "./gridPointer";

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

/** What `handlers` spreads on a sub-column. */
export type SubColumnHandlers = ReturnType<ReturnType<typeof useDragToCreate>["handlers"]>;

/**
 * Drawing a block with the pointer: press in an empty stretch of a
 * sub-column, drag up, down, or across to another day's column of the same
 * timeline, release. Mouse and pen only, and not Control-click on macOS,
 * which is a right click there. One draft at a time; pressing again
 * elsewhere replaces it. A click, or a drag that ends where it started, draws
 * nothing. On an exclusive timeline the drag stops at the neighbouring
 * blocks, and a press with no room (inside an ongoing interval's reach) does
 * nothing.
 *
 * `handlers(day, timelineId)` is spread on each sub-column, inside a day
 * column marked with `DAY_COLUMN`, inside an element marked with `DRAG_ROOT`
 * (see `gridPointer`).
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

  const handlers = (day: LocalDate, timelineId: string) => ({
    [DAY_ATTR]: day,
    [TIMELINE_ATTR]: timelineId,
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType === "touch" || event.button !== 0 || (IS_MAC && event.ctrlKey)) return;
      const target = event.target as HTMLElement;
      // React passes events up from portals too, such as the category popover's.
      if (!event.currentTarget.contains(target) || target.closest("[data-block]")) return;
      const timeline = timelines.find((t) => t.id === timelineId);
      const anchor = instantIn(event.currentTarget, event.clientY, day, timeZone);
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
      const { day: pointerDay, at } = pointerAt(event, timelineId, timeZone);
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
