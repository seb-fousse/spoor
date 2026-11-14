import type { Instant, LocalDate } from "@spoor/core";
import { useEffect, useRef } from "react";
import { DAY_ATTR, DRAG_ROOT, instantIn, TIMELINE_ATTR } from "./gridPointer";

/** Where the pointer is on the grid: a sub-column, the 15-minute mark there, and the block under it. */
export interface GridPoint {
  day: LocalDate;
  timelineId: string;
  at: Instant;
  /** The block under the pointer (its `data-block`), or `null` over an empty stretch. */
  blockId: string | null;
}

/**
 * Where the pointer is on Home's grid, for keys that act there: ⌘V pastes
 * and C splits at the pointer. `atPointer` looks it up when asked, so it is
 * right after a scroll or a drag too; it is `null` when the pointer is off
 * the grid's body, or something such as a popover covers it.
 */
export function useGridPointer(timeZone: string) {
  // The pointer's last position in the window, `null` once it has left it.
  // Watched on the whole window, before anything else can stop the events,
  // rather than on each sub-column: a drag captures the pointer, and a
  // popover or dialog can cover the grid, and either would leave a
  // sub-column's own record stale.
  const pointer = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      pointer.current = { x: event.clientX, y: event.clientY };
    };
    // Only a leave at the window's edge is the pointer really leaving: WebKit
    // also sends one from inside the page, which would lose the pointer until
    // it next moved.
    const onLeave = (event: PointerEvent) => {
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

  /**
   * The sub-column under the pointer now, the mark there, and the block under
   * it. On a line between two sub-columns, it is the one at the pointer's x.
   */
  const atPointer = (): GridPoint | null => {
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
    const blockId = hit.closest("[data-block]")?.getAttribute("data-block") || null;
    return { day, timelineId, at: instantIn(column, p.y, day, timeZone), blockId };
  };

  return { atPointer };
}
