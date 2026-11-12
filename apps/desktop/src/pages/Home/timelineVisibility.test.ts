import type { Timeline } from "@spoor/core";
import { describe, expect, it } from "vitest";
import { allShown, setAll, toggleTimeline, visibleTimelines } from "./timelineVisibility";

const timeline = (id: string) => ({ id, name: id }) as Timeline;
const TIMELINES = [timeline("a"), timeline("b"), timeline("c")];

describe("visibleTimelines", () => {
  it("keeps every timeline when none is hidden", () => {
    expect(visibleTimelines(TIMELINES, new Set())).toEqual(TIMELINES);
  });

  it("drops the hidden ones and keeps the order", () => {
    expect(visibleTimelines(TIMELINES, new Set(["b"])).map((t) => t.id)).toEqual(["a", "c"]);
  });

  it("ignores ids of timelines that no longer exist", () => {
    expect(visibleTimelines(TIMELINES, new Set(["gone"]))).toEqual(TIMELINES);
  });

  it("can hide everything", () => {
    expect(visibleTimelines(TIMELINES, new Set(["a", "b", "c"]))).toEqual([]);
  });
});

describe("toggleTimeline", () => {
  it("hides a shown timeline", () => {
    expect(toggleTimeline(new Set(), "a")).toEqual(new Set(["a"]));
  });

  it("shows a hidden timeline", () => {
    expect(toggleTimeline(new Set(["a", "b"]), "a")).toEqual(new Set(["b"]));
  });

  it("leaves the original set alone", () => {
    const hidden = new Set(["a"]);
    toggleTimeline(hidden, "b");
    expect(hidden).toEqual(new Set(["a"]));
  });
});

describe("allShown", () => {
  it("is true when nothing is hidden", () => {
    expect(allShown(TIMELINES, new Set())).toBe(true);
  });

  it("is false when any timeline is hidden", () => {
    expect(allShown(TIMELINES, new Set(["c"]))).toBe(false);
  });

  it("ignores ids of timelines that no longer exist", () => {
    expect(allShown(TIMELINES, new Set(["gone"]))).toBe(true);
  });
});

describe("setAll", () => {
  it("shows everything with an empty set", () => {
    expect(setAll(TIMELINES, true)).toEqual(new Set());
  });

  it("hides everything by listing every id", () => {
    expect(setAll(TIMELINES, false)).toEqual(new Set(["a", "b", "c"]));
  });
});
