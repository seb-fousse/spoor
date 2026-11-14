import type { Instant, LocalDate } from "@spoor/core";
import type { MouseEvent } from "react";
import { snapFraction } from "./dragRange";

/**
 * Where the pointer is on Home's grid, for drawing and editing blocks: which
 * day, and the snapped instant at its height. The grid marks its elements
 * with these attributes so the pointer can be found without measuring
 * anything up front.
 */

/** Marks the element holding every day column, and each day column. */
export const DRAG_ROOT = "data-drag-root";
export const DAY_COLUMN = "data-drag-day-column";
/** Mark each sub-column with its day and timeline. */
export const DAY_ATTR = "data-drag-day";
export const TIMELINE_ATTR = "data-drag-timeline";

/** The snapped instant at `clientY` in `column`, a sub-column of `day`. */
export function instantIn(
  column: HTMLElement,
  clientY: number,
  day: LocalDate,
  timeZone: string,
): Instant {
  const rect = column.getBoundingClientRect();
  return snapFraction((clientY - rect.top) / rect.height, day, timeZone);
}

/**
 * The day under the pointer, and the snapped instant at its height in that
 * day's sub-column for the timeline. The day is the whole day column the
 * pointer is over, so moving across other timelines' sub-columns stays on it.
 * Left of the first day counts as the first, right of the last as the last.
 */
export function pointerAt(
  event: MouseEvent<HTMLElement>,
  timelineId: string,
  timeZone: string,
): { day: LocalDate; at: Instant } {
  const root = event.currentTarget.closest(`[${DRAG_ROOT}]`) ?? event.currentTarget;
  const columns = [
    ...root.querySelectorAll<HTMLElement>(`[${TIMELINE_ATTR}="${CSS.escape(timelineId)}"]`),
  ];
  const column =
    columns.find(
      (c) => event.clientX < (c.closest(`[${DAY_COLUMN}]`) ?? c).getBoundingClientRect().right,
    ) ??
    columns.at(-1) ??
    event.currentTarget.closest<HTMLElement>(`[${DAY_ATTR}]`);
  if (!column) throw new Error(`No sub-column for timeline ${timelineId}`);
  const day = column.getAttribute(DAY_ATTR) as LocalDate;
  return { day, at: instantIn(column, event.clientY, day, timeZone) };
}
