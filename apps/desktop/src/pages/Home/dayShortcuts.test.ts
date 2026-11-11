// @vitest-environment jsdom
import { shortcutHandler } from "@keyboard";
import { describe, expect, it } from "vitest";
import { dayShortcuts } from "./dayShortcuts";
import type { HomeDaysAction } from "./homeDays";

/** What pressing `key` with `mods` does on Home, on macOS or not. */
function press(key: string, mods: KeyboardEventInit, mac: boolean): HomeDaysAction[] {
  const actions: HomeDaysAction[] = [];
  const event = new KeyboardEvent("keydown", { key, cancelable: true, ...mods });
  shortcutHandler(
    dayShortcuts((action) => actions.push(action)),
    mac,
  )(event);
  // A handled key is taken, so the page-wide listener and the browser leave it alone.
  expect(event.defaultPrevented).toBe(actions.length > 0);
  return actions;
}

describe("dayShortcuts", () => {
  it.each([true, false])("steps one day with a bare arrow (mac: %s)", (mac) => {
    expect(press("ArrowLeft", {}, mac)).toEqual([{ type: "stepActive", by: -1 }]);
    expect(press("ArrowRight", {}, mac)).toEqual([{ type: "stepActive", by: 1 }]);
  });

  it("pages the window with ⌥ on macOS", () => {
    expect(press("ArrowLeft", { altKey: true }, true)).toEqual([{ type: "pageWindow", by: -1 }]);
    expect(press("ArrowRight", { altKey: true }, true)).toEqual([{ type: "pageWindow", by: 1 }]);
    // Ctrl+arrow switches Spaces on macOS; leave it to the system.
    expect(press("ArrowRight", { ctrlKey: true }, true)).toEqual([]);
  });

  it("pages the window with Ctrl elsewhere", () => {
    expect(press("ArrowLeft", { ctrlKey: true }, false)).toEqual([{ type: "pageWindow", by: -1 }]);
    expect(press("ArrowRight", { ctrlKey: true }, false)).toEqual([{ type: "pageWindow", by: 1 }]);
    expect(press("ArrowRight", { altKey: true }, false)).toEqual([]);
  });

  it.each([true, false])("ignores other keys and combinations (mac: %s)", (mac) => {
    expect(press("ArrowUp", {}, mac)).toEqual([]);
    expect(press("a", {}, mac)).toEqual([]);
    expect(press("ArrowLeft", { shiftKey: true }, mac)).toEqual([]);
    expect(press("ArrowLeft", { metaKey: true }, mac)).toEqual([]);
    expect(press("ArrowLeft", { altKey: true, ctrlKey: true }, mac)).toEqual([]);
  });
});
