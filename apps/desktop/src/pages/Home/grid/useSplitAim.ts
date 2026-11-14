import type { Instant, LocalDate, TimelineInterval } from "@spoor/core";
import { type PointerEvent, useRef, useState } from "react";
import { splitPoint } from "./blockEdit";
import type { BlockSegment, GridBlock } from "./gridLayout";
import { DAY_ATTR, instantIn, menuAnchor } from "./gridPointer";

/** A block's split menu: aimed while the right button is held, open once it is released. */
export interface SplitAim {
  interval: TimelineInterval;
  /** The pressed piece's day and segment. */
  day: LocalDate;
  segment: BlockSegment;
  /** The pointer, as a fraction down the day and pixels from the sub-column's left. */
  top: number;
  left: number;
  /** Where a split would cut, or `null` when there is no 15-minute mark inside the block there. */
  at: Instant | null;
  phase: "aiming" | "open";
}

interface AimState extends SplitAim {
  block: GridBlock;
  /** The pressed piece's sub-column, which the pointer is measured against. */
  column: HTMLElement;
}

/**
 * Aiming a split with the right button: press on a block, and while the
 * button is held a dashed line follows the 15-minute mark nearest the
 * pointer, kept on the pressed piece. Releasing opens the block's menu there,
 * set to split at that mark. A right click without moving does the same where
 * it was pressed. Control-click counts as a right click, as on macOS.
 *
 * Each `handlers` call returns whether it took the event, so the grid can
 * pass the rest on to the block's drag. `close` drops the menu.
 */
export function useSplitAim(timeZone: string, now: Instant) {
  const [state, setState] = useState<AimState | null>(null);
  // Read by the handlers, which can run before the render for the last move.
  const latest = useRef(state);
  const update = (next: AimState | null) => {
    latest.current = next;
    setState(next);
  };

  /** Where the pointer is on the pressed piece, and the cut there. */
  const place = (event: PointerEvent<HTMLElement>, block: GridBlock, column: HTMLElement) => {
    const { top, left } = menuAnchor(column, event);
    const snapped = instantIn(column, event.clientY, block.day, timeZone);
    const at = Math.min(block.end, Math.max(block.start, snapped));
    return {
      top: Math.min(block.top + block.height, Math.max(block.top, top)),
      left,
      at: splitPoint(block.interval, at, now),
    };
  };

  const handlers = (block: GridBlock, segment: BlockSegment) => ({
    onPointerDown: (event: PointerEvent<HTMLElement>): boolean => {
      const right = event.button === 2 || (event.button === 0 && event.ctrlKey);
      if (event.pointerType !== "mouse" || !right) return false;
      const column = event.currentTarget.closest<HTMLElement>(`[${DAY_ATTR}]`);
      if (!column) return false;
      // No text selection or focus change while aiming.
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      update({
        interval: block.interval,
        day: block.day,
        segment,
        block,
        column,
        phase: "aiming",
        ...place(event, block, column),
      });
      return true;
    },
    onPointerMove: (event: PointerEvent<HTMLElement>): boolean => {
      const s = latest.current;
      if (s?.phase !== "aiming" || s.interval.id !== block.interval.id) return false;
      const next = place(event, s.block, s.column);
      if (next.at !== s.at || next.top !== s.top || next.left !== s.left) update({ ...s, ...next });
      return true;
    },
    onPointerUp: (): boolean => {
      const s = latest.current;
      if (s?.phase !== "aiming" || s.interval.id !== block.interval.id) return false;
      update({ ...s, phase: "open" });
      return true;
    },
    onPointerCancel: (): boolean => {
      if (latest.current?.phase !== "aiming") return false;
      update(null);
      return true;
    },
  });

  const close = () => update(null);

  const aim: SplitAim | null = state;
  return { aim, handlers, close };
}
