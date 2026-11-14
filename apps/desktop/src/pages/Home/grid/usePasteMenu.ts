import type { Instant, LocalDate } from "@spoor/core";
import { type MouseEvent, useEffect, useRef, useState } from "react";
import { DAY_ATTR, DRAG_ROOT, instantIn, TIMELINE_ATTR } from "./gridPointer";

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
 * Where a copied block can be pasted with the pointer. A right click in an
 * empty stretch of a sub-column (Control-click on macOS) opens the paste menu
 * there, at the 15-minute mark nearest the pointer; `close` drops it.
 * `atPointer` is where the pointer is now, for the paste key, or `null` when
 * it isn't over a sub-column.
 *
 * `handlers(day, timelineId)` is spread on each sub-column, next to the
 * drawing handlers; its `onContextMenu` returns whether it opened the menu.
 * A right click on a block (anything matching `[data-block]`) is left to the
 * block's own menu.
 */
export function usePasteMenu(timeZone: string) {
  const [menu, setMenu] = useState<PasteMenuState | null>(null);

  // The pointer's last position in the window, `null` once it has left it.
  // Watched on the whole window, before anything else can stop the events,
  // rather than on each sub-column: a drag captures the pointer, and a
  // popover or dialog can cover the grid, and either would leave a
  // sub-column's own record stale.
  const pointer = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const onPointer = (event: globalThis.PointerEvent) => {
      pointer.current = { x: event.clientX, y: event.clientY };
    };
    // Only a leave at the window's edge is the pointer really leaving: WebKit
    // also sends one from inside the page, which would lose the pointer until
    // it next moved.
    const onLeave = (event: globalThis.PointerEvent) => {
      const { clientX: x, clientY: y } = event;
      if (x <= 0 || y <= 0 || x >= window.innerWidth - 1 || y >= window.innerHeight - 1) {
        pointer.current = null;
      }
    };
    const types = ["pointermove", "pointerover", "pointerdown", "pointerup"] as const;
    for (const type of types) {
      window.addEventListener(type, onPointer, { capture: true, passive: true });
    }
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      for (const type of types) window.removeEventListener(type, onPointer, { capture: true });
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, []);

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

  /**
   * The sub-column under the pointer now, and the mark there. Looked up
   * when asked, so it is right after a scroll or a drag too. On a line
   * between two sub-columns, it is the one at the pointer's x. `null` when
   * the pointer is off the grid's body, or something such as a popover
   * covers it.
   */
  const atPointer = (): PastePoint | null => {
    const p = pointer.current;
    if (!p) return null;
    const hit = document.elementFromPoint(p.x, p.y);
    const root = hit?.closest(`[${DRAG_ROOT}]`);
    if (!hit || !root) return null;
    const column =
      hit.closest<HTMLElement>(`[${TIMELINE_ATTR}]`) ??
      [...root.querySelectorAll<HTMLElement>(`[${TIMELINE_ATTR}]`)].find((c) => {
        const rect = c.getBoundingClientRect();
        return rect.left <= p.x && p.x < rect.right;
      });
    const day = column?.getAttribute(DAY_ATTR) as LocalDate | null | undefined;
    const timelineId = column?.getAttribute(TIMELINE_ATTR);
    if (!column || !day || !timelineId) return null;
    return { day, timelineId, at: instantIn(column, p.y, day, timeZone) };
  };

  const close = () => setMenu(null);

  return { menu, handlers, atPointer, close };
}
