import type { Instant, LocalDate, Timeline, TimelineInterval } from "@spoor/core";
import { type PointerEvent, useRef, useState } from "react";
import { type DrawnRange, daysWindow } from "../layout/dragRange";
import type { BlockSegment, GridBlock } from "../layout/gridLayout";
import { pointerAt } from "../layout/gridPointer";
import {
  type BlockMode,
  canMove,
  type EditedRange,
  editSpan,
  freeGaps,
  movedRange,
  resizedRange,
  sameRange,
} from "./blockEdit";

/** A block being dragged, saved, selected, or edited in its popover. */
export interface BlockEdit {
  interval: TimelineInterval;
  /** The pressed piece's day and segment, where the popover goes. */
  day: LocalDate;
  segment: BlockSegment;
  mode: BlockMode;
  /** The new range, `null` until the pointer has moved off the step it was pressed on. */
  range: EditedRange | null;
  /**
   * `dragging` while the pointer is down, `saving` once a changed range is
   * released, `selected` once a press without a drag selects it, and
   * `editing` once its popover opens: a second such press, or `open`.
   */
  phase: "dragging" | "saving" | "selected" | "editing";
}

interface DragState extends BlockEdit {
  anchor: Instant;
  /** Where a resized edge may reach: the gap between its neighbours, see `editSpan`. */
  span: DrawnRange;
  /** Where a moved block may land: every gap it fits in, see `freeGaps`. Empty unless moving. */
  gaps: DrawnRange[];
  /** Whether the pointer has left the pressed step, which makes this a drag, not a click. */
  moved: boolean;
  /** Whether the block was already selected, so a click opens its popover. */
  reopen: boolean;
}

/** Marks the handle for a block's start or end edge with `start` or `end`. */
export const EDGE_ATTR = "data-edge";

/** What `handlers` spreads on a block segment. */
export type SegmentHandlers = ReturnType<ReturnType<typeof useBlockDrag>["handlers"]>;

/**
 * Editing a block with the pointer. Pressing its body and dragging moves it,
 * possibly to another day, skipping over blocks in the way to the nearest
 * spot where it fits; pressing an edge's handle (marked with `EDGE_ATTR`) and
 * dragging moves that edge, which stops at the neighbouring block. Both snap
 * to 15 minutes, and an edit never overlaps (see `blockEdit`).
 * Releasing a changed range calls `onSave`; once that write is done, `settle`
 * drops the edit. A press that doesn't drag selects the block instead, and
 * focuses the pressed segment for the block's keys; pressing it again, or
 * `open`, opens its popover. `cancel` drops the selection and the popover.
 * Mouse and pen only.
 *
 * `handlers(block, segment)` is spread on each of a block's segments, inside
 * the grid's sub-columns (see `gridPointer`).
 */
export function useBlockDrag(
  timeZone: string,
  days: readonly LocalDate[],
  timelines: readonly Timeline[],
  intervals: readonly TimelineInterval[],
  now: Instant,
  onSave: (interval: TimelineInterval, range: EditedRange) => void,
) {
  const [state, setState] = useState<DragState | null>(null);
  // The handlers read the latest state from here: a release can come before
  // the render for the last move, and must save where the pointer ended.
  const latest = useRef(state);
  const update = (next: DragState | null) => {
    latest.current = next;
    setState(next);
  };

  const handlers = (block: GridBlock, segment: BlockSegment) => ({
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType === "touch" || event.button !== 0) return;
      // One write at a time.
      if (latest.current?.phase === "saving") return;
      const { interval } = block;
      const before = latest.current;
      const timeline = timelines.find((t) => t.id === interval.timelineId);
      if (!timeline) return;
      const visible = daysWindow(days, timeZone);
      const edge = (event.target as HTMLElement).closest(`[${EDGE_ATTR}]`)?.getAttribute(EDGE_ATTR);
      const mode: BlockMode =
        edge === "start" || edge === "end" ? edge : canMove(interval, visible) ? "move" : "none";
      // No text selection or focus change while dragging.
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      update({
        interval,
        day: block.day,
        segment,
        mode,
        range: null,
        phase: "dragging",
        anchor: pointerAt(event, interval.timelineId, timeZone).at,
        span: editSpan(interval, intervals, timeline, visible),
        gaps: mode === "move" ? freeGaps(interval, intervals, timeline, visible) : [],
        moved: false,
        reopen: before?.phase === "selected" && before.interval.id === interval.id,
      });
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      // Captured, so the pressed segment gets every move, wherever the pointer is.
      const s = latest.current;
      if (s?.phase !== "dragging" || s.interval.id !== block.interval.id) return;
      const { at } = pointerAt(event, s.interval.timelineId, timeZone);
      if (!s.moved && at === s.anchor) return;
      const { interval, span, gaps } = s;
      let range: EditedRange | null = null;
      if (s.mode === "move" && interval.endAt !== null) {
        range = movedRange(
          { startAt: interval.startAt, endAt: interval.endAt },
          at - s.anchor,
          gaps,
        );
      } else if (s.mode === "start" || s.mode === "end") {
        range = resizedRange(interval, s.mode, at, span, now);
      }
      if (s.moved && (range === s.range || (range && s.range && sameRange(range, s.range)))) return;
      update({ ...s, moved: true, range });
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => {
      const s = latest.current;
      if (s?.phase !== "dragging" || s.interval.id !== block.interval.id) return;
      if (!s.moved) {
        update({ ...s, phase: s.reopen ? "editing" : "selected" });
        // Captured, so this is the pressed segment. The press's `preventDefault`
        // kept it from taking focus by itself.
        if (!s.reopen) event.currentTarget.focus({ preventScroll: true });
      } else if (s.range && !sameRange(s.range, s.interval)) {
        update({ ...s, phase: "saving" });
        onSave(s.interval, s.range);
      } else {
        update(null);
      }
    },
    onPointerCancel: () => {
      if (latest.current?.phase === "dragging") update(null);
    },
  });

  /** Drops the selection, and closes the popover. A drag that has just started stays. */
  const cancel = () => {
    const phase = latest.current?.phase;
    if (phase === "selected" || phase === "editing") update(null);
  };

  /** Opens the selected block's popover. */
  const open = () => {
    const s = latest.current;
    if (s?.phase === "selected") update({ ...s, phase: "editing" });
  };

  /** Drops a saved edit, once its write has succeeded or failed. */
  const settle = () => {
    if (latest.current?.phase === "saving") update(null);
  };

  const edit: BlockEdit | null = state;
  return { edit, handlers, cancel, open, settle };
}
