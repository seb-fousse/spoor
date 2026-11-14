// @vitest-environment jsdom
import { createTestRoot, type TestRoot } from "@test/render";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useShortcuts } from "./useShortcuts";

let root: TestRoot;
let split: ReturnType<typeof vi.fn<() => void>>;

/** A page whose C key splits, with a text field in it. */
function Page() {
  useShortcuts([["splitBlock", () => split()]]);
  return <input aria-label="Filter" />;
}

beforeEach(() => {
  root = createTestRoot();
  split = vi.fn<() => void>();
  root.render(<Page />);
});

afterEach(() => {
  root.unmount();
});

/** Presses `key` on `target`, as a keydown that bubbles to the window. Returns whether it was taken. */
function press(target: EventTarget, key: string, modifiers: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...modifiers,
  });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("useShortcuts", () => {
  it("runs a plain letter key pressed outside a text field", () => {
    expect(press(document.body, "c")).toBe(true);
    expect(split).toHaveBeenCalledOnce();
  });

  it("leaves the letter to a text field, so it types", () => {
    const input = root.container.querySelector("input");
    if (!input) throw new Error("No input");
    input.focus();
    expect(press(input, "c")).toBe(false);
    expect(split).not.toHaveBeenCalled();
  });

  it("doesn't run the letter with a modifier held", () => {
    press(document.body, "c", { metaKey: true });
    press(document.body, "c", { ctrlKey: true });
    press(document.body, "C", { shiftKey: true });
    press(document.body, "c", { altKey: true });
    expect(split).not.toHaveBeenCalled();
  });
});
