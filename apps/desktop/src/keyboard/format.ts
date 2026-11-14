import { IS_MAC } from "@platform/os";
import { hotkey, type ShortcutId } from "./shortcuts";

/** A shortcut written for people, and for `aria-keyshortcuts`. */
export interface ShortcutDisplay {
  /** One entry per key, modifiers first, such as ["⌥", "←"] or ["Ctrl", "←"]. */
  keys: string[];
  /** In `aria-keyshortcuts` form, such as "Alt+ArrowLeft". */
  ariaKeys: string;
}

/**
 * By Mantine's name, in the order each platform writes them: ⌃⌥⇧⌘ on macOS,
 * Ctrl+Alt+Shift elsewhere. (`mod` is resolved to `meta` or `ctrl` first.)
 */
const MODIFIERS = [
  { name: "ctrl", mac: "⌃", other: "Ctrl", aria: "Control" },
  { name: "alt", mac: "⌥", other: "Alt", aria: "Alt" },
  { name: "shift", mac: "⇧", other: "Shift", aria: "Shift" },
  { name: "meta", mac: "⌘", other: "Meta", aria: "Meta" },
];
const MODIFIER_NAMES = new Set(["mod", ...MODIFIERS.map((m) => m.name)]);

/** Keys with a conventional symbol or name, by Mantine's lower-case name. */
const KEY_LABELS: Record<string, { label: string; aria: string }> = {
  arrowleft: { label: "←", aria: "ArrowLeft" },
  arrowright: { label: "→", aria: "ArrowRight" },
  arrowup: { label: "↑", aria: "ArrowUp" },
  arrowdown: { label: "↓", aria: "ArrowDown" },
  escape: { label: "Esc", aria: "Escape" },
  enter: { label: "Enter", aria: "Enter" },
  space: { label: "Space", aria: "Space" },
  tab: { label: "Tab", aria: "Tab" },
  backspace: { label: "⌫", aria: "Backspace" },
  delete: { label: "⌦", aria: "Delete" },
  home: { label: "Home", aria: "Home" },
  end: { label: "End", aria: "End" },
  pageup: { label: "Page Up", aria: "PageUp" },
  pagedown: { label: "Page Down", aria: "PageDown" },
};

/** A Mantine hotkey, such as "alt+ArrowLeft", written the platform's way. */
export function describeHotkey(keys: string, mac = IS_MAC): ShortcutDisplay {
  const parts = keys
    .split("+")
    .map((part) => part.trim().toLowerCase())
    .map((part) => (part === "mod" ? (mac ? "meta" : "ctrl") : part));
  const modifiers = MODIFIERS.filter((m) => parts.includes(m.name));
  const key = parts.find((part) => !MODIFIER_NAMES.has(part));

  const labels = modifiers.map((m) => (mac ? m.mac : m.other));
  const aria = modifiers.map((m) => m.aria);
  if (key !== undefined) {
    const known = KEY_LABELS[key];
    labels.push(known?.label ?? key.toUpperCase());
    aria.push(known?.aria ?? key.toUpperCase());
  }
  return { keys: labels, ariaKeys: aria.join("+") };
}

/** Shortcut `id` written the platform's way. */
export function describeShortcut(id: ShortcutId, mac = IS_MAC): ShortcutDisplay {
  return describeHotkey(hotkey(id, mac), mac);
}

/** Shortcut `id` as one string for running text or a menu, such as "⌘+C" or "Ctrl+C". */
export function shortcutLabel(id: ShortcutId, mac = IS_MAC): string {
  return describeShortcut(id, mac).keys.join("+");
}
