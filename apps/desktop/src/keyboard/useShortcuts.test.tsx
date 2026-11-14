// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useShortcuts } from "./useShortcuts";

// Tell React this is a test environment, so `act` flushes renders and effects.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLElement;
let split: ReturnType<typeof vi.fn<() => void>>;

/** A page whose C key splits, with a text field in it. */
function Page() {
  useShortcuts([["splitBlock", () => split()]]);
  return <input aria-label="Filter" />;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  split = vi.fn<() => void>();
  act(() => root.render(<Page />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
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
    const input = container.querySelector("input");
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
