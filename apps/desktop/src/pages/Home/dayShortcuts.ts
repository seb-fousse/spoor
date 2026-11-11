import type { ShortcutBinding } from "@keyboard";
import type { HomeDaysAction } from "./homeDays";

/**
 * Home's day keys: Left and Right move the active day by one, and with the
 * word-jump modifier (⌥ on macOS, Ctrl elsewhere) they page the window like
 * the timeline header's arrows, by 1, 5 or 7 days, whichever range is showing.
 * Home binds them page-wide; the grid's day headers bind them too, to keep
 * focus on the active day.
 */
export function dayShortcuts(dispatch: (action: HomeDaysAction) => void): ShortcutBinding[] {
  return [
    ["previousDay", () => dispatch({ type: "stepActive", by: -1 })],
    ["nextDay", () => dispatch({ type: "stepActive", by: 1 })],
    ["earlierDays", () => dispatch({ type: "pageWindow", by: -1 })],
    ["laterDays", () => dispatch({ type: "pageWindow", by: 1 })],
  ];
}
