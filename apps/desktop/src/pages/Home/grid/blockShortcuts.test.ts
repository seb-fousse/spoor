// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { blockKeyHandler } from "./blockShortcuts";

type Call = "delete" | "copy" | "open" | "deselect";

afterEach(() => {
  document.body.replaceChildren();
});

/** What pressing `key` on `target` does to a selected block, on macOS or not. */
function press(
  key: string,
  {
    mods = {},
    mac = true,
    target,
  }: { mods?: KeyboardEventInit; mac?: boolean; target?: Element } = {},
): Call[] {
  const calls: Call[] = [];
  const handler = blockKeyHandler(
    {
      onDelete: () => calls.push("delete"),
      onCopy: () => calls.push("copy"),
      onOpen: () => calls.push("open"),
      onDeselect: () => calls.push("deselect"),
    },
    mac,
  );
  const element = target ?? document.body.appendChild(document.createElement("div"));
  const event = new KeyboardEvent("keydown", { key, cancelable: true, bubbles: true, ...mods });
  element.addEventListener("keydown", (e) => handler(e as KeyboardEvent), { once: true });
  element.dispatchEvent(event);
  // A handled key is taken, so the page-wide listener and the browser leave it alone.
  expect(event.defaultPrevented).toBe(calls.length > 0);
  return calls;
}

describe("blockKeyHandler", () => {
  it.each([true, false])("asks to delete with Backspace or Delete (mac: %s)", (mac) => {
    expect(press("Backspace", { mac })).toEqual(["delete"]);
    expect(press("Delete", { mac })).toEqual(["delete"]);
  });

  it("copies with ⌘C on macOS, and Ctrl+C elsewhere", () => {
    expect(press("c", { mods: { metaKey: true } })).toEqual(["copy"]);
    expect(press("c", { mods: { ctrlKey: true }, mac: false })).toEqual(["copy"]);
    expect(press("c", { mods: { ctrlKey: true } })).toEqual([]);
    expect(press("c")).toEqual([]);
  });

  it("opens the popover with Enter, and deselects with Esc", () => {
    expect(press("Enter")).toEqual(["open"]);
    expect(press("Escape")).toEqual(["deselect"]);
  });

  it("leaves other keys and modified keys alone", () => {
    expect(press("a")).toEqual([]);
    expect(press("ArrowLeft")).toEqual([]);
    expect(press("Backspace", { mods: { metaKey: true } })).toEqual([]);
    expect(press("Enter", { mods: { shiftKey: true } })).toEqual([]);
  });

  it.each(["input", "textarea"])("never deletes while focus is in a %s", (tag) => {
    const field = document.body.appendChild(document.createElement(tag));
    expect(press("Backspace", { target: field })).toEqual([]);
    expect(press("Delete", { target: field })).toEqual([]);
  });

  it("leaves a key some other handler already took", () => {
    const element = document.body.appendChild(document.createElement("div"));
    element.addEventListener("keydown", (e) => e.preventDefault());
    const calls: Call[] = [];
    const handler = blockKeyHandler({
      onDelete: () => calls.push("delete"),
      onCopy: () => calls.push("copy"),
      onOpen: () => calls.push("open"),
      onDeselect: () => calls.push("deselect"),
    });
    element.addEventListener("keydown", (e) => handler(e as KeyboardEvent));
    element.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", cancelable: true }));
    expect(calls).toEqual([]);
  });
});
