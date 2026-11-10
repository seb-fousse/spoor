// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { type DayKey, dayKeyAction, dayShortcut, ownsArrowKeys } from "./dayKeys";

function key(name: string, mods: Partial<Omit<DayKey, "key">> = {}): DayKey {
  return { key: name, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...mods };
}

describe("dayKeyAction", () => {
  it.each([true, false])("steps one day with a bare arrow (mac: %s)", (mac) => {
    expect(dayKeyAction(key("ArrowLeft"), mac)).toEqual({ type: "stepActive", by: -1 });
    expect(dayKeyAction(key("ArrowRight"), mac)).toEqual({ type: "stepActive", by: 1 });
  });

  it("pages the window with Alt on macOS", () => {
    expect(dayKeyAction(key("ArrowLeft", { altKey: true }), true)).toEqual({
      type: "pageWindow",
      by: -1,
    });
    expect(dayKeyAction(key("ArrowRight", { altKey: true }), true)).toEqual({
      type: "pageWindow",
      by: 1,
    });
    // Ctrl+arrow switches Spaces on macOS; leave it to the system.
    expect(dayKeyAction(key("ArrowRight", { ctrlKey: true }), true)).toBeNull();
  });

  it("pages the window with Ctrl elsewhere", () => {
    expect(dayKeyAction(key("ArrowLeft", { ctrlKey: true }), false)).toEqual({
      type: "pageWindow",
      by: -1,
    });
    expect(dayKeyAction(key("ArrowRight", { ctrlKey: true }), false)).toEqual({
      type: "pageWindow",
      by: 1,
    });
    expect(dayKeyAction(key("ArrowRight", { altKey: true }), false)).toBeNull();
  });

  it.each([true, false])("ignores other keys and combinations (mac: %s)", (mac) => {
    expect(dayKeyAction(key("ArrowUp"), mac)).toBeNull();
    expect(dayKeyAction(key("a"), mac)).toBeNull();
    expect(dayKeyAction(key("ArrowLeft", { shiftKey: true }), mac)).toBeNull();
    expect(dayKeyAction(key("ArrowLeft", { metaKey: true }), mac)).toBeNull();
    expect(dayKeyAction(key("ArrowLeft", { altKey: true, ctrlKey: true }), mac)).toBeNull();
  });
});

describe("dayShortcut", () => {
  it.each([true, false])("is a bare arrow for stepping a day (mac: %s)", (mac) => {
    expect(dayShortcut(-1, false, mac)).toEqual({ keys: ["←"], ariaKeys: "ArrowLeft" });
    expect(dayShortcut(1, false, mac)).toEqual({ keys: ["→"], ariaKeys: "ArrowRight" });
  });

  it("uses Option for paging on macOS", () => {
    expect(dayShortcut(-1, true, true)).toEqual({ keys: ["⌥", "←"], ariaKeys: "Alt+ArrowLeft" });
    expect(dayShortcut(1, true, true)).toEqual({ keys: ["⌥", "→"], ariaKeys: "Alt+ArrowRight" });
  });

  it("uses Ctrl for paging elsewhere", () => {
    expect(dayShortcut(-1, true, false)).toEqual({
      keys: ["Ctrl", "←"],
      ariaKeys: "Control+ArrowLeft",
    });
    expect(dayShortcut(1, true, false)).toEqual({
      keys: ["Ctrl", "→"],
      ariaKeys: "Control+ArrowRight",
    });
  });

  // The label must describe what dayKeyAction does with the same keys.
  it.each([true, false])("matches dayKeyAction (mac: %s)", (mac) => {
    for (const page of [false, true]) {
      for (const by of [-1, 1] as const) {
        const parts = dayShortcut(by, page, mac).ariaKeys.split("+");
        const arrow = parts.at(-1) ?? "";
        const event = key(arrow, {
          altKey: parts.includes("Alt"),
          ctrlKey: parts.includes("Control"),
        });
        expect(dayKeyAction(event, mac)).toEqual({ type: page ? "pageWindow" : "stepActive", by });
      }
    }
  });
});

describe("ownsArrowKeys", () => {
  function render(html: string): HTMLElement {
    document.body.innerHTML = html;
    const target = document.querySelector<HTMLElement>("#target");
    if (!target) throw new Error("no #target");
    return target;
  }

  it("is false for plain elements, buttons and no target", () => {
    expect(ownsArrowKeys(render(`<div><button id="target">Mon 9</button></div>`))).toBe(false);
    expect(ownsArrowKeys(document.body)).toBe(false);
    expect(ownsArrowKeys(null)).toBe(false);
  });

  it.each([
    `<input id="target">`,
    `<textarea id="target"></textarea>`,
    `<select id="target"></select>`,
    `<div contenteditable id="target"></div>`,
    `<div role="separator" tabindex="0" id="target"></div>`,
    `<div role="tablist"><button role="tab" id="target"></button></div>`,
    `<div role="dialog"><button id="target"></button></div>`,
  ])("is true inside an arrow-key widget: %s", (html) => {
    expect(ownsArrowKeys(render(html))).toBe(true);
  });

  it("is false for contenteditable=false", () => {
    expect(ownsArrowKeys(render(`<div contenteditable="false" id="target"></div>`))).toBe(false);
  });
});
