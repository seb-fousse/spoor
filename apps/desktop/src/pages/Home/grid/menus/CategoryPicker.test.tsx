// @vitest-environment jsdom
import type { TimelineCategory } from "@spoor/core";
import { createTestRoot, type TestRoot } from "@test/render";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CategoryPicker } from "./CategoryPicker";

const category = (id: string, name: string) =>
  ({ id, timelineId: "t1", name, archivedAt: null }) as TimelineCategory;
const deep = category("deep", "Deep work");
const meetings = category("meetings", "Meetings");
const sport = category("sport", "Sport");
const categories = [deep, meetings, sport];

let root: TestRoot;
let onPick: ReturnType<
  typeof vi.fn<(choice: { categoryId: string } | { newCategory: string }) => void>
>;
let onCancel: ReturnType<typeof vi.fn<() => void>>;

beforeEach(() => {
  root = createTestRoot({ mantine: true });
  onPick = vi.fn<(choice: { categoryId: string } | { newCategory: string }) => void>();
  onCancel = vi.fn<() => void>();
});

afterEach(() => {
  root.unmount();
});

/** Opens the picker for an existing Deep work block that can't become a Meetings one. */
function showForBlock() {
  root.render(
    <CategoryPicker
      opened
      categories={categories}
      currentId={deep.id}
      disabledIds={new Set([meetings.id])}
      error={null}
      saving={false}
      onPick={onPick}
      onCancel={onCancel}
    >
      <div />
    </CategoryPicker>,
  );
}

/** The popover renders in a portal, so look through the whole page. */
function option(text: string): HTMLButtonElement {
  const found = [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(text),
  );
  if (!found) throw new Error(`No "${text}" option`);
  return found;
}

function press(key: string) {
  const input = document.body.querySelector("input");
  if (!input) throw new Error("No filter input");
  act(() => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

describe("CategoryPicker for an existing block", () => {
  it("marks the current category, and picking it again only closes", () => {
    showForBlock();
    expect(option("Deep work").getAttribute("aria-current")).toBe("true");
    act(() => option("Deep work").click());
    expect(onPick).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("can't pick a category the block would overlap", () => {
    showForBlock();
    expect(option("Meetings").disabled).toBe(true);
    // Numbers skip it: 2 is Sport.
    press("2");
    expect(onPick).toHaveBeenCalledWith({ categoryId: sport.id });
  });

  it("picks another category", () => {
    showForBlock();
    act(() => option("Sport").click());
    expect(onPick).toHaveBeenCalledWith({ categoryId: sport.id });
  });

  it("leaves Backspace in the filter field to the field", () => {
    showForBlock();
    const input = document.body.querySelector("input");
    if (!input) throw new Error("No filter input");
    const event = new KeyboardEvent("keydown", {
      key: "Backspace",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      input.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
    expect(onPick).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });
});
