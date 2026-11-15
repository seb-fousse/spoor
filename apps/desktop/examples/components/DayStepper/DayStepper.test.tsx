// @vitest-environment jsdom
/**
 * Example: testing a shortcut binding. Illustrates docs/conventions/keyboard.md and
 * docs/conventions/testing.md. Keys are pressed as keydowns that bubble to the window,
 * as a real key press would.
 */
import { createTestRoot, type TestRoot } from "@test/render";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DayStepper } from "./DayStepper";

let root: TestRoot;
let onChange: ReturnType<typeof vi.fn<(day: string) => void>>;

beforeEach(() => {
  root = createTestRoot({ mantine: true });
  onChange = vi.fn<(day: string) => void>();
  root.render(
    <>
      <DayStepper day="2026-11-09" onChange={onChange} />
      <input aria-label="Note" />
    </>,
  );
});

afterEach(() => {
  root.unmount();
});

function press(target: EventTarget, key: string) {
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

describe("DayStepper", () => {
  it("steps the day with the arrow keys, from anywhere on the page", () => {
    press(document.body, "ArrowRight");
    press(document.body, "ArrowLeft");
    expect(onChange.mock.calls).toEqual([["2026-11-10"], ["2026-11-08"]]);
  });

  it("leaves the keys to a text field, which moves its cursor with them", () => {
    const input = root.container.querySelector("input");
    if (!input) throw new Error("No input");
    press(input, "ArrowRight");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("tells assistive tech about each button's shortcut", () => {
    const next = root.container.querySelector('button[aria-label="Next day"]');
    expect(next?.getAttribute("aria-keyshortcuts")).toBe("ArrowRight");
  });
});
