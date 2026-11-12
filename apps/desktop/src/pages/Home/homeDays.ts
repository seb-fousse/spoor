import { formatDay, formatDayRange } from "@lib/format";
import { addDays, compareLocalDates, type LocalDate } from "@spoor/core";

/**
 * Which days Home shows, and which one is active.
 *
 * The timeline shows a window of consecutive days ending on `windowEnd`; the
 * rail shows `activeDay`. Every action keeps the active day inside the window,
 * so the rail never describes a day the timeline has scrolled away from.
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
  | { type: "rollover"; from: LocalDate; to: LocalDate };

export function rangeLength(range: DayRange): number {
  const found = RANGES.find((r) => r.value === range);
  if (!found) throw new Error(`Unknown range: ${String(range)}`);
  return found.length;
}

/** The first (leftmost) day of the window. */
export function windowStart({ windowEnd, range }: HomeDays): LocalDate {
  return addDays(windowEnd, -(rangeLength(range) - 1));
}

/** The window's days, oldest first. */
export function windowDays(state: HomeDays): LocalDate[] {
  const start = windowStart(state);
  return Array.from({ length: rangeLength(state.range) }, (_, i) => addDays(start, i));
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

/** The window as a compact label, such as "5 – 9 Nov 2026" or "Mon, 9 Nov 2026". */
export function formatWindow(state: HomeDays, locale?: string): string {
  if (state.range === "day") return formatDay(state.windowEnd, locale);
  return formatDayRange(windowStart(state), state.windowEnd, locale);
}
