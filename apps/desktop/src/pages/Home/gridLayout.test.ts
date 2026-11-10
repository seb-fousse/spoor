import type { Timeline, TimelineInterval } from "@spoor/core";
import { describe, expect, it } from "vitest";
import {
  assignLanes,
  CATEGORY_COLORS,
  categoryColor,
  describeBlock,
  layoutGrid,
  nowFraction,
  splitByDay,
} from "./gridLayout";

const ZONE = "Europe/Paris";
const DAYS = ["2026-11-07", "2026-11-08", "2026-11-09"];
/** Paris is UTC+1 in November. */
const at = (local: string) => Date.parse(`${local}+01:00`);
const NOW = at("2026-11-09T15:00:00.000");

let nextId = 0;
function interval(
  start: string,
  end: string | null,
  extra: Partial<TimelineInterval> = {},
): TimelineInterval {
  const startAt = at(start);
  return {
    id: `i${nextId++}`,
    timelineId: "t1",
    categoryId: "c1",
    startAt,
    endAt: end === null ? null : at(end),
    timeZone: ZONE,
    createdAt: startAt,
    updatedAt: startAt,
    ...extra,
  };
}

function timeline(id: string, exclusive: boolean): Timeline {
  return {
    id,
    name: id,
    description: null,
    exclusive,
    defaultThingTypeId: null,
    createdAt: 0,
    updatedAt: 0,
    archivedAt: null,
  };
}

describe("splitByDay", () => {
  it("places an interval within one day as a fraction of the day", () => {
    const [block, ...rest] = splitByDay(
      [interval("2026-11-08T06:00:00.000", "2026-11-08T12:00:00.000")],
      DAYS,
      ZONE,
      NOW,
    );
    expect(rest).toEqual([]);
    expect(block).toMatchObject({
      day: "2026-11-08",
      top: 0.25,
      height: 0.25,
      startsBefore: false,
      endsAfter: false,
      ongoing: false,
    });
  });

  it("splits an interval crossing midnight across both days", () => {
    const blocks = splitByDay(
      [interval("2026-11-07T22:00:00.000", "2026-11-08T02:00:00.000")],
      DAYS,
      ZONE,
      NOW,
    );
    expect(blocks.map((b) => [b.day, b.top, b.height, b.startsBefore, b.endsAfter])).toEqual([
      ["2026-11-07", 22 / 24, 2 / 24, false, true],
      ["2026-11-08", 0, 2 / 24, true, false],
    ]);
  });

  it("keeps an interval ending exactly at midnight on its own day", () => {
    const blocks = splitByDay(
      [interval("2026-11-07T20:00:00.000", "2026-11-08T00:00:00.000")],
      DAYS,
      ZONE,
      NOW,
    );
    expect(blocks.map((b) => [b.day, b.endsAfter])).toEqual([["2026-11-07", false]]);
  });

  it("runs an ongoing interval until now, across days", () => {
    const blocks = splitByDay([interval("2026-11-08T20:00:00.000", null)], DAYS, ZONE, NOW);
    expect(blocks.map((b) => [b.day, b.ongoing, b.endsAfter])).toEqual([
      ["2026-11-08", false, true],
      ["2026-11-09", true, false],
    ]);
    expect(blocks[1]?.end).toBe(NOW);
    expect(blocks[1]?.height).toBeCloseTo(15 / 24);
  });

  it("clips intervals to the visible days", () => {
    const blocks = splitByDay(
      [
        interval("2026-11-01T08:00:00.000", "2026-11-07T08:00:00.000"),
        interval("2026-11-09T23:00:00.000", "2026-11-10T09:00:00.000"),
      ],
      DAYS,
      ZONE,
      NOW,
    );
    expect(blocks.map((b) => [b.day, b.top, b.height])).toEqual([
      ["2026-11-07", 0, 8 / 24],
      ["2026-11-09", 23 / 24, 1 / 24],
    ]);
  });

  it("skips intervals entirely outside the visible days", () => {
    const blocks = splitByDay(
      [interval("2026-11-05T08:00:00.000", "2026-11-07T00:00:00.000")],
      DAYS,
      ZONE,
      NOW,
    );
    expect(blocks).toEqual([]);
  });

  it("keeps a zero-length interval on its day", () => {
    const blocks = splitByDay(
      [interval("2026-11-08T12:00:00.000", null)],
      DAYS,
      ZONE,
      at("2026-11-08T12:00:00.000"),
    );
    expect(blocks.map((b) => [b.day, b.top, b.height])).toEqual([["2026-11-08", 0.5, 0]]);
  });

  it("returns nothing for an empty window", () => {
    expect(splitByDay([interval("2026-11-08T06:00:00.000", null)], [], ZONE, NOW)).toEqual([]);
  });
});

describe("assignLanes", () => {
  const blocksOf = (...spans: [string, string][]) =>
    splitByDay(
      spans.map(([s, e]) => interval(`2026-11-08T${s}:00.000`, `2026-11-08T${e}:00.000`)),
      DAYS,
      ZONE,
      NOW,
    );
  const lanes = (...spans: [string, string][]) =>
    assignLanes(blocksOf(...spans)).map((b) => [b.lane, b.laneCount]);

  it("puts two overlapping blocks side by side", () => {
    expect(lanes(["09:00", "11:00"], ["10:00", "12:00"])).toEqual([
      [0, 2],
      [1, 2],
    ]);
  });

  it("uses three lanes when three blocks overlap at once", () => {
    expect(lanes(["09:00", "12:00"], ["10:00", "12:00"], ["11:00", "12:00"])).toEqual([
      [0, 3],
      [1, 3],
      [2, 3],
    ]);
  });

  it("reuses a lane once it is free", () => {
    expect(lanes(["09:00", "10:00"], ["09:30", "11:00"], ["10:00", "10:30"])).toEqual([
      [0, 2],
      [1, 2],
      [0, 2],
    ]);
  });

  it("gives a block that overlaps nothing the full width", () => {
    expect(lanes(["09:00", "11:00"], ["10:00", "12:00"], ["14:00", "15:00"])).toEqual([
      [0, 2],
      [1, 2],
      [0, 1],
    ]);
  });

  it("treats touching blocks as not overlapping", () => {
    expect(lanes(["09:00", "10:00"], ["10:00", "11:00"])).toEqual([
      [0, 1],
      [0, 1],
    ]);
  });
});

describe("layoutGrid", () => {
  it("groups blocks by day and timeline, with lanes only on non-exclusive timelines", () => {
    const layout = layoutGrid(
      [
        interval("2026-11-08T09:00:00.000", "2026-11-08T11:00:00.000", { timelineId: "free" }),
        interval("2026-11-08T10:00:00.000", "2026-11-08T12:00:00.000", { timelineId: "free" }),
        interval("2026-11-08T09:00:00.000", "2026-11-08T10:00:00.000", { timelineId: "only" }),
      ],
      [timeline("only", true), timeline("free", false)],
      DAYS,
      ZONE,
      NOW,
    );
    expect([...layout.keys()]).toEqual(DAYS);
    expect(layout.get("2026-11-07")?.get("free")).toEqual([]);
    const day = layout.get("2026-11-08");
    expect(day?.get("free")?.map((b) => b.laneCount)).toEqual([2, 2]);
    expect(day?.get("only")?.map((b) => b.laneCount)).toEqual([1]);
  });

  it("drops intervals of timelines that are not shown", () => {
    const layout = layoutGrid(
      [interval("2026-11-08T09:00:00.000", "2026-11-08T10:00:00.000", { timelineId: "gone" })],
      [timeline("t1", true)],
      DAYS,
      ZONE,
      NOW,
    );
    expect(layout.get("2026-11-08")?.get("t1")).toEqual([]);
    expect(layout.get("2026-11-08")?.has("gone")).toBe(false);
  });
});

describe("nowFraction", () => {
  it("is where now falls in its day", () => {
    expect(nowFraction(NOW, "2026-11-09", ZONE)).toBeCloseTo(15 / 24);
  });

  it("is null on other days", () => {
    expect(nowFraction(NOW, "2026-11-08", ZONE)).toBeNull();
    expect(nowFraction(NOW, "2026-11-10", ZONE)).toBeNull();
  });
});

describe("categoryColor", () => {
  it("always gives the same palette colour for an id", () => {
    const ids = Array.from({ length: 50 }, (_, i) => `category-${i}`);
    for (const id of ids) {
      expect(CATEGORY_COLORS).toContain(categoryColor(id));
      expect(categoryColor(id)).toBe(categoryColor(id));
    }
    // Spread across the palette rather than collapsing onto a few colours.
    expect(new Set(ids.map(categoryColor)).size).toBeGreaterThan(6);
  });
});

describe("describeBlock", () => {
  it("shows the start and end, or since when for an ongoing interval", () => {
    const [done] = splitByDay(
      [interval("2026-11-08T09:00:00.000", "2026-11-08T10:30:00.000")],
      DAYS,
      ZONE,
      NOW,
    );
    const [ongoing] = splitByDay([interval("2026-11-09T09:00:00.000", null)], DAYS, ZONE, NOW);
    if (!done || !ongoing) throw new Error("expected blocks");
    expect(describeBlock(done, "Work", ZONE, "en-GB")).toBe("Work · 09:00–10:30");
    expect(describeBlock(ongoing, "Work", ZONE, "en-GB")).toBe("Work · since 09:00");
  });
});
