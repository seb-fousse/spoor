import { describe, expect, it } from "vitest";
import { describeHotkey, describeShortcut, shortcutLabel } from "./format";

describe("describeHotkey", () => {
  it("writes a single key as one key", () => {
    expect(describeHotkey("ArrowLeft", true)).toEqual({ keys: ["←"], ariaKeys: "ArrowLeft" });
    expect(describeHotkey("ArrowRight", false)).toEqual({ keys: ["→"], ariaKeys: "ArrowRight" });
  });

  it("uses macOS symbols, in ⌃⌥⇧⌘ order", () => {
    expect(describeHotkey("alt+ArrowLeft", true)).toEqual({
      keys: ["⌥", "←"],
      ariaKeys: "Alt+ArrowLeft",
    });
    expect(describeHotkey("shift+mod+alt+ctrl+k", true)).toEqual({
      keys: ["⌃", "⌥", "⇧", "⌘", "K"],
      ariaKeys: "Control+Alt+Shift+Meta+K",
    });
  });

  it("uses names elsewhere, with mod as Ctrl", () => {
    expect(describeHotkey("ctrl+ArrowRight", false)).toEqual({
      keys: ["Ctrl", "→"],
      ariaKeys: "Control+ArrowRight",
    });
    expect(describeHotkey("mod+shift+K", false)).toEqual({
      keys: ["Ctrl", "Shift", "K"],
      ariaKeys: "Control+Shift+K",
    });
  });

  it("ignores spelling and spacing", () => {
    expect(describeHotkey("Alt + arrowleft", true)).toEqual(describeHotkey("alt+ArrowLeft", true));
  });

  it("names special keys", () => {
    expect(describeHotkey("Escape", false).keys).toEqual(["Esc"]);
    expect(describeHotkey("mod+Enter", true).keys).toEqual(["⌘", "Enter"]);
  });

  it("writes the delete keys as symbols, and names them for assistive tech", () => {
    expect(describeHotkey("Backspace", true)).toEqual({ keys: ["⌫"], ariaKeys: "Backspace" });
    expect(describeHotkey("Delete", false)).toEqual({ keys: ["⌦"], ariaKeys: "Delete" });
  });
});

describe("describeShortcut", () => {
  it("resolves the platform's word-jump modifier", () => {
    expect(describeShortcut("laterDays", true).keys).toEqual(["⌥", "→"]);
    expect(describeShortcut("laterDays", false).keys).toEqual(["Ctrl", "→"]);
    expect(describeShortcut("nextDay", true).keys).toEqual(["→"]);
  });
});

describe("shortcutLabel", () => {
  it("joins the keys with +, the platform's way", () => {
    expect(shortcutLabel("copyBlock", true)).toBe("⌘+C");
    expect(shortcutLabel("copyBlock", false)).toBe("Ctrl+C");
    expect(shortcutLabel("splitBlock", true)).toBe("C");
  });
});
