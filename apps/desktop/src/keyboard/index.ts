/**
 * Keyboard shortcuts: the table of every shortcut (`SHORTCUTS`), how to bind
 * them (`useShortcuts` for a page, `shortcutHandler` for one element), and how
 * to show them (`ShortcutTooltip`, `describeShortcut`).
 */
export { describeHotkey, describeShortcut, type ShortcutDisplay, shortcutLabel } from "./format";
export { ownsKey } from "./ownsKey";
export { ShortcutTooltip } from "./ShortcutTooltip";
export { hotkey, SHORTCUTS, type ShortcutId } from "./shortcuts";
export { type ShortcutBinding, shortcutHandler, useShortcuts } from "./useShortcuts";
