import { IS_MAC } from "@platform/os";

/**
 * Every keyboard shortcut in the app, in one table, so clashes show up in one
 * place (and in the tests) and a shortcuts help screen can be built from it.
 *
 * Keys are written as Mantine hotkeys (`"ArrowLeft"`, `"shift+K"`, `"mod+K"`,
 * where `mod` is ⌘ on macOS and Ctrl elsewhere, and only that one), plus one
 * token of our own: `word`, the modifier that moves the cursor by a word,
 * which is Alt (⌥) on macOS and Ctrl elsewhere.
 *
 * A shortcut does nothing until something binds a handler to its id: a page
 * with `useShortcuts`, an element with `shortcutHandler`, or an app-wide
 * Mantine `useHotkeys` call given `hotkey(id)`.
 */
export const SHORTCUTS = {
  previousDay: { keys: "ArrowLeft", description: "Previous day" },
  nextDay: { keys: "ArrowRight", description: "Next day" },
  earlierDays: { keys: "word+ArrowLeft", description: "Earlier days (one page)" },
  laterDays: { keys: "word+ArrowRight", description: "Later days (one page)" },
  // Both delete keys do it: ⌫, and Delete (fn+⌫ on macOS).
  deleteBlock: { keys: "Backspace", description: "Delete the selected block" },
  deleteBlockForward: { keys: "Delete", description: "Delete the selected block" },
  copyBlock: { keys: "mod+C", description: "Copy the selected block" },
  pasteBlock: { keys: "mod+V", description: "Paste the copied block at the pointer" },
  splitBlock: { keys: "C", description: "Split the selected block at the pointer" },
} as const satisfies Record<string, { keys: string; description: string }>;

export type ShortcutId = keyof typeof SHORTCUTS;

/** What `word` and `mod` stand for on each platform. */
const PLATFORM_KEYS: Record<string, { mac: string; other: string }> = {
  word: { mac: "alt", other: "ctrl" },
  // Mantine would take either ⌘ or Ctrl for `mod`, on every platform.
  mod: { mac: "meta", other: "ctrl" },
};

/** `id`'s keys as a Mantine hotkey for this platform, with `word` and `mod` resolved. */
export function hotkey(id: ShortcutId, mac = IS_MAC): string {
  return SHORTCUTS[id].keys
    .split("+")
    .map((part) => {
      const resolved = PLATFORM_KEYS[part];
      return resolved ? (mac ? resolved.mac : resolved.other) : part;
    })
    .join("+");
}
