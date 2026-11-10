import { IS_MAC } from "@platform/os";

/**
 * Every keyboard shortcut in the app, in one table, so clashes show up in one
 * place (and in the tests) and a shortcuts help screen can be built from it.
 *
 * Keys are written as Mantine hotkeys (`"ArrowLeft"`, `"shift+K"`, `"mod+K"`,
 * where `mod` is ⌘ on macOS and Ctrl elsewhere), plus one token of our own:
 * `word`, the modifier that moves the cursor by a word, which is Alt (⌥) on
 * macOS and Ctrl elsewhere.
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
} as const satisfies Record<string, { keys: string; description: string }>;

export type ShortcutId = keyof typeof SHORTCUTS;

/** `id`'s keys as a Mantine hotkey for this platform, with `word` resolved. */
export function hotkey(id: ShortcutId, mac = IS_MAC): string {
  return SHORTCUTS[id].keys
    .split("+")
    .map((part) => (part === "word" ? (mac ? "alt" : "ctrl") : part))
    .join("+");
}
