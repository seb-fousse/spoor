import { formatDay, formatMonthRange } from "@lib/format";
import { addDays, compareLocalDates, type LocalDate } from "@spoor/core";

/**
 * Which days Home shows, and which one is active.
 *
 * The timeline shows a window of consecutive days ending on `windowEnd`; the
 * rail shows `activeDay`. Every action keeps the active day inside the window,
 * so the rail never describes a day the timeline has scrolled away from.
 *
 * The timeline scrolls sideways through more days than the window (see
 * `bufferDays`). The window is the days in view once it settles: the actions
 * move it, and the timeline scrolls to it, or the user scrolls and the timeline
 * reports where it settled with `scroll`.
 */

/** How many days the timeline shows at once. */
export type DayRange = "day" | "5days" | "week";

export const RANGES: readonly { value: DayRange; label: string; length: number }[] = [
  { value: "day", label: "Day", length: 1 },
  { value: "5days", label: "5 days", length: 5 },
  { value: "week", label: "Week", length: 7 },
];

export interface HomeDays {
  activeDay: LocalDate;
  /** The last (rightmost) day of the window. */
  windowEnd: LocalDate;
  range: DayRange;
}

export type HomeDaysAction =
  /** Move the active day by `by` days, dragging the window along if it leaves it. */
  | { type: "stepActive"; by: number }
  /** Move the window by `by` whole windows; the active day keeps its column. */
  | { type: "pageWindow"; by: number }
  /** Make `today` the active day and the window's last day. */
  | { type: "goToday"; today: LocalDate }
  /** Make `day` the active day, moving the window only if it is not visible. */
  | { type: "select"; day: LocalDate }
  /** Show `range` days, keeping the window's end unless the active day would drop out. */
  | { type: "setRange"; range: DayRange }
  /** The date changed (midnight passed): follow it if the user was on the old today. */
  | { type: "rollover"; from: LocalDate; to: LocalDate }
  /**
   * The timeline was scrolled, and settled with `start` at its left edge. The
   * active day stays unless it left the window; then it keeps its column, as
   * when paging.
   */
  | { type: "scroll"; start: LocalDate };

export function rangeLength(range: DayRange): number {
  const found = RANGES.find((r) => r.value === range);
  if (!found) throw new Error(`Unknown range: ${String(range)}`);
  return found.length;
}

/** Where the window is: its last day, and how many days it has. */
type Window = Pick<HomeDays, "windowEnd" | "range">;

/** The first (leftmost) day of the window. */
export function windowStart({ windowEnd, range }: Window): LocalDate {
  return addDays(windowEnd, -(rangeLength(range) - 1));
}

/** The window's days, oldest first. */
export function windowDays(state: HomeDays): LocalDate[] {
  const start = windowStart(state);
  return Array.from({ length: rangeLength(state.range) }, (_, i) => addDays(start, i));
}

/**
 * The days the timeline renders, oldest first: the window, with a window's
 * worth either side of it, so the user can scroll a whole window either way
 * before the timeline re-centres on where they stopped.
 */
export function bufferDays(state: Window): LocalDate[] {
  const length = rangeLength(state.range);
  const first = addDays(windowStart(state), -length);
  return Array.from({ length: 3 * length }, (_, i) => addDays(first, i));
}

/** The default: five days ending today, with today active. */
export function initialHomeDays(today: LocalDate): HomeDays {
  return { activeDay: today, windowEnd: today, range: "5days" };
}

export function homeDaysReducer(state: HomeDays, action: HomeDaysAction): HomeDays {
  switch (action.type) {
    case "stepActive":
      return show(state, addDays(state.activeDay, action.by));
    case "select":
      return show(state, action.day);
    case "pageWindow": {
      const shift = action.by * rangeLength(state.range);
      return {
        ...state,
        activeDay: addDays(state.activeDay, shift),
        windowEnd: addDays(state.windowEnd, shift),
      };
    }
    case "goToday":
      return { ...state, activeDay: action.today, windowEnd: action.today };
    case "setRange": {
      const next = { ...state, range: action.range };
      // Shrinking can leave the active day behind; re-anchor on it.
      return isVisible(next, state.activeDay) ? next : { ...next, windowEnd: state.activeDay };
    }
    case "rollover":
      // Someone looking at another day keeps it; only "today" moves on.
      return isAtToday(state, action.from)
        ? { ...state, activeDay: action.to, windowEnd: action.to }
        : state;
    case "scroll": {
      const windowEnd = addDays(action.start, rangeLength(state.range) - 1);
      // The same object, so settling where it already is renders nothing.
      if (windowEnd === state.windowEnd) return state;
      const next = { ...state, windowEnd };
      if (isVisible(next, state.activeDay)) return next;
      const column = Math.max(0, windowDays(state).indexOf(state.activeDay));
      return { ...next, activeDay: addDays(action.start, column) };
    }
  }
}

/** Make `day` active, shifting the window as little as possible to keep it visible. */
function show(state: HomeDays, day: LocalDate): HomeDays {
  const length = rangeLength(state.range);
  if (compareLocalDates(day, state.windowEnd) > 0) {
    return { ...state, activeDay: day, windowEnd: day };
  }
  if (compareLocalDates(day, windowStart(state)) < 0) {
    return { ...state, activeDay: day, windowEnd: addDays(day, length - 1) };
  }
  return { ...state, activeDay: day };
}

/**
 * True when today is the active day and on screen, which is everything Today
 * would do; however the user got there, the button has nothing left to do.
 */
export function isAtToday(state: HomeDays, today: LocalDate): boolean {
  return state.activeDay === today && isVisible(state, today);
}

function isVisible(state: HomeDays, day: LocalDate): boolean {
  return (
    compareLocalDates(day, windowStart(state)) >= 0 && compareLocalDates(day, state.windowEnd) <= 0
  );
}

/**
 * The window as a compact label: its months for a range, such as "Oct – Nov 2026" or "November 2026" (the
 * grid's headers say which days), or the day itself for one, such as "Mon, 9 Nov 2026".
 */
export function formatWindow(state: HomeDays, locale?: string): string {
  if (state.range === "day") return formatDay(state.windowEnd, locale);
  return formatMonthRange(windowStart(state), state.windowEnd, locale);
}
