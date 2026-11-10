import type { HomeDaysAction } from "./homeDays";

/**
 * Home's day keys. Left and Right move the active day by one. With the
 * platform's word-jump modifier (Alt on macOS, Ctrl elsewhere, as for moving
 * the cursor by a word), they page the whole window instead, like the
 * timeline header's arrows: 1, 5 or 7 days, whichever range is showing.
 */

/** The parts of a keyboard event that pick the action. */
export type DayKey = Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey">;

const DIRECTIONS: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1 };

/** The action for `event`, or `null` when it isn't one of the day keys. */
export function dayKeyAction(event: DayKey, mac: boolean): HomeDaysAction | null {
  const by = DIRECTIONS[event.key];
  if (by === undefined || event.shiftKey || event.metaKey) return null;
  const wordJump = mac ? event.altKey && !event.ctrlKey : event.ctrlKey && !event.altKey;
  if (wordJump) return { type: "pageWindow", by };
  if (event.altKey || event.ctrlKey) return null;
  return { type: "stepActive", by };
}

/** Whether this is macOS, where Alt rather than Ctrl jumps by a word. */
export function isMac(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);
}

/** Roles whose widgets use the arrow keys themselves (or sit in a dialog). */
const ARROW_ROLES = [
  "combobox",
  "dialog",
  "grid",
  "listbox",
  "menu",
  "menubar",
  "radiogroup",
  "separator",
  "slider",
  "spinbutton",
  "tablist",
  "tree",
];
const ARROW_OWNERS = [
  "input",
  "textarea",
  "select",
  "[contenteditable]:not([contenteditable='false'])",
  ...ARROW_ROLES.map((role) => `[role="${role}"]`),
].join(",");

/**
 * Whether `target` (where a key went) needs the arrow keys for itself, such
 * as a text field moving its cursor or a splitter resizing. Home leaves those
 * keys alone.
 */
export function ownsArrowKeys(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(ARROW_OWNERS) !== null;
}
