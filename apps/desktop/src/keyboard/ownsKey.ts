/**
 * Whether a key should be left to the element it went to rather than run a
 * shortcut, such as a text field moving its cursor or a splitter resizing.
 */

/** Fields you type into: they need every key. */
const TEXT_ENTRY = [
  "textarea",
  "[contenteditable]:not([contenteditable='false'])",
  // Every input but the ones that are really buttons, toggles or pickers.
  "input:not([type='button'],[type='checkbox'],[type='color'],[type='file'],[type='radio'],[type='range'],[type='reset'],[type='submit'])",
].join(",");

/** Keys that move around inside a widget. */
const NAVIGATION_KEYS = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

/** Roles whose widgets move with the navigation keys (or sit in a dialog, which owns them). */
const NAVIGATION_ROLES = [
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
const NAVIGATION_OWNERS = [
  "input",
  "select",
  ...NAVIGATION_ROLES.map((role) => `[role="${role}"]`),
].join(",");

/** Whether `target` (where `key` went) needs that key itself, so no shortcut should run. */
export function ownsKey(target: EventTarget | null, key: string): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest(TEXT_ENTRY)) return true;
  return NAVIGATION_KEYS.has(key) && target.closest(NAVIGATION_OWNERS) !== null;
}
