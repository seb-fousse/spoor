import { describe, expect, it } from "vitest";
import { hotkey, SHORTCUTS, type ShortcutId } from "./shortcuts";

const IDS = Object.keys(SHORTCUTS) as ShortcutId[];
const MODIFIERS = ["alt", "ctrl", "meta", "shift"];

/**
 * The keys a hotkey really presses, in one spelling: lower case, `mod`
 * resolved, modifiers sorted. So "Alt+K", "k+alt" and "alt+k" all compare equal.
 */
function pressed(keys: string, mac: boolean): string {
  return keys
    .toLowerCase()
    .split("+")
    .map((part) => part.trim())
    .map((part) => (part === "mod" ? (mac ? "meta" : "ctrl") : part))
    .sort()
    .join("+");
}

describe("hotkey", () => {
  it("resolves word to Alt on macOS and Ctrl elsewhere", () => {
    expect(hotkey("earlierDays", true)).toBe("alt+ArrowLeft");
    expect(hotkey("earlierDays", false)).toBe("ctrl+ArrowLeft");
  });

  it("resolves mod to ⌘ on macOS and Ctrl elsewhere, never both", () => {
    expect(hotkey("copyBlock", true)).toBe("meta+C");
    expect(hotkey("copyBlock", false)).toBe("ctrl+C");
  });

  it("leaves other keys as they are", () => {
    expect(hotkey("previousDay", true)).toBe("ArrowLeft");
    expect(hotkey("previousDay", false)).toBe("ArrowLeft");
  });
});

describe("SHORTCUTS", () => {
  it.each([true, false])("has no two shortcuts on the same keys (mac: %s)", (mac) => {
    const seen = new Map<string, ShortcutId>();
    for (const id of IDS) {
      const keys = pressed(hotkey(id, mac), mac);
      expect(seen.get(keys), `${id} clashes`).toBeUndefined();
      seen.set(keys, id);
    }
  });

  it.each([true, false])(
    "gives every shortcut exactly one key besides modifiers (mac: %s)",
    (mac) => {
      for (const id of IDS) {
        const keys = pressed(hotkey(id, mac), mac).split("+");
        expect(
          keys.filter((part) => !MODIFIERS.includes(part)),
          id,
        ).toHaveLength(1);
      }
    },
  );
});
