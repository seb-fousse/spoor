import type { Instant, LocalDate } from "@spoor/core";
import { type MouseEvent, useState } from "react";
import { instantIn } from "./gridPointer";

/** Where on the grid a paste goes: a sub-column, and the 15-minute mark there. */
export interface PastePoint {
  day: LocalDate;
  timelineId: string;
  at: Instant;
}

/** The paste menu, open where an empty stretch was right-clicked. */
export interface PasteMenuState extends PastePoint {
  /** The pointer, as a fraction down the day and pixels from the sub-column's left. */
  top: number;
  left: number;
}

/**
 * The paste menu. A right click in an empty stretch of a sub-column
 * (Control-click on macOS) opens it there, at the 15-minute mark nearest the
 * pointer; `close` drops it. The paste key finds the pointer with
 * `useGridPointer` instead.
 *
 * `handlers(day, timelineId)` is spread on each sub-column, next to the
 * drawing handlers; its `onContextMenu` returns whether it opened the menu.
 * A right click on a block (anything matching `[data-block]`) is left to the
 * block's own menu.
 */
export function usePasteMenu(timeZone: string) {
  const [menu, setMenu] = useState<PasteMenuState | null>(null);

  const handlers = (day: LocalDate, timelineId: string) => ({
    onContextMenu: (event: MouseEvent<HTMLElement>): boolean => {
      const target = event.target as HTMLElement;
      // React passes events up from portals too, such as the menu's own.
      if (!event.currentTarget.contains(target) || target.closest("[data-block]")) return false;
      // The webview's own menu would hide this one.
      event.preventDefault();
      const column = event.currentTarget;
      const rect = column.getBoundingClientRect();
      setMenu({
        day,
        timelineId,
        at: instantIn(column, event.clientY, day, timeZone),
        top: (event.clientY - rect.top) / rect.height,
        left: Math.min(rect.width, Math.max(0, event.clientX - rect.left)),
      });
      return true;
    },
  });

  const close = () => setMenu(null);

  return { menu, handlers, close };
}
