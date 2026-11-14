import type { Timeline, TimelineInterval } from "@spoor/core";
import { describe, expect, it } from "vitest";
import {
  CATEGORY_COLORS,
  categoryColor,
  clockRange,
  describeBlock,
  fitSegments,
  labelFit,
  layoutGrid,
  nowFraction,
  sharedSpan,
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

describe("fitSegments", () => {
  const blocksOf = (...spans: [string, string][]) =>
    splitByDay(
      spans.map(([s, e]) => interval(`2026-11-08T${s}:00.000`, `2026-11-08T${e}:00.000`)),
      DAYS,
      ZONE,
      NOW,
    );
  /** Each block's segments as [from hour, to hour, slot, slots]. */
  const segmentsOf = (...spans: [string, string][]) =>
    fitSegments(blocksOf(...spans)).map((b) =>
      b.segments.map((s) => [hours(s.top), hours(s.top + s.height), s.lane, s.lanes]),
    );
  const hours = (fraction: number) => Math.round(fraction * 24 * 100) / 100;

  it("goes full width, then halves, then full width again when A overlaps the start of B", () => {
    expect(segmentsOf(["09:00", "11:00"], ["10:00", "12:00"])).toEqual([
      [
        [9, 10, 0, 1],
        [10, 11, 0, 2],
      ],
      [
        [10, 11, 1, 2],
        [11, 12, 0, 1],
      ],
    ]);
  });

  it("splits three ways while three blocks overlap", () => {
    expect(segmentsOf(["09:00", "12:00"], ["10:00", "12:00"], ["11:00", "12:00"])).toEqual([
      [
        [9, 10, 0, 1],
        [10, 11, 0, 2],
        [11, 12, 0, 3],
      ],
      [
        [10, 11, 1, 2],
        [11, 12, 1, 3],
      ],
      [[11, 12, 2, 3]],
    ]);
  });

  it("moves a block over when one before it ends", () => {
    expect(segmentsOf(["09:00", "11:00"], ["09:30", "12:00"], ["10:00", "12:00"])).toEqual([
      [
        [9, 9.5, 0, 1],
        [9.5, 10, 0, 2],
        [10, 11, 0, 3],
      ],
      [
        [9.5, 10, 1, 2],
        [10, 11, 1, 3],
        [11, 12, 0, 2],
      ],
      [
        [10, 11, 2, 3],
        [11, 12, 1, 2],
      ],
    ]);
  });

  it("keeps a block that overlaps nothing as one full-width segment", () => {
    expect(segmentsOf(["09:00", "10:00"], ["14:00", "15:00"])).toEqual([
      [[9, 10, 0, 1]],
      [[14, 15, 0, 1]],
    ]);
  });

  it("treats touching blocks as not overlapping", () => {
    expect(segmentsOf(["09:00", "10:00"], ["10:00", "11:00"])).toEqual([
      [[9, 10, 0, 1]],
      [[10, 11, 0, 1]],
    ]);
  });

  it("gives a zero-length block a slot beside what is running at its instant", () => {
    expect(segmentsOf(["09:00", "11:00"], ["10:00", "10:00"])).toEqual([
      [[9, 11, 0, 1]],
      [[10, 10, 1, 2]],
    ]);
  });
});

describe("layoutGrid", () => {
  it("groups blocks by day and timeline, fitting blocks together only on non-exclusive timelines", () => {
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
    expect(day?.get("free")?.map((b) => b.segments.length)).toEqual([2, 2]);
    expect(day?.get("only")?.map((b) => b.segments.length)).toEqual([1]);
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

describe("sharedSpan", () => {
  const seg = (lane: number, lanes: number) => ({ top: 0, height: 0.1, lane, lanes });

  it("shares all of a segment that stays in its lane", () => {
    expect(sharedSpan(seg(0, 1), seg(0, 1))).toEqual([0, 1]);
    expect(sharedSpan(seg(1, 2), seg(0, 1))).toEqual([0, 1]);
  });

  it("shares part of a wider segment above or below a narrower one", () => {
    expect(sharedSpan(seg(0, 1), seg(0, 2))).toEqual([0, 0.5]);
    expect(sharedSpan(seg(0, 1), seg(1, 2))).toEqual([0.5, 1]);
    const [from, to] = sharedSpan(seg(1, 2), seg(1, 3)) ?? [];
    expect(from).toBeCloseTo(0);
    expect(to).toBeCloseTo(1 / 3);
  });

  it("shares nothing when the lanes don't line up", () => {
    expect(sharedSpan(seg(1, 2), seg(0, 3))).toBeNull();
  });
});

describe("clockRange", () => {
  it("shows the start and end, or since when for an ongoing range", () => {
    const range = { startAt: at("2026-11-08T09:00:00.000"), endAt: at("2026-11-08T10:30:00.000") };
    expect(clockRange(range, ZONE, "en-GB")).toBe("09:00–10:30");
    expect(clockRange({ ...range, endAt: null }, ZONE, "en-GB")).toBe("since 09:00");
  });

  it("leaves the days out of a range that crosses midnight", () => {
    const range = { startAt: at("2026-11-08T22:00:00.000"), endAt: at("2026-11-09T01:30:00.000") };
    expect(clockRange(range, ZONE, "en-GB")).toBe("22:00–01:30");
  });
});

describe("labelFit", () => {
  /** A duration in minutes, as pixels at 48px an hour. */
  const px = (minutes: number) => (minutes / 60) * 48;

  it("has no label on a sliver", () => {
    expect(labelFit(px(5))).toBe("none");
    expect(labelFit(0)).toBe("none");
  });

  it("fits a 15-minute block on one line", () => {
    expect(labelFit(px(15))).toBe("line");
    expect(labelFit(px(30))).toBe("line");
  });

  it("stacks the time under the name from 35 minutes", () => {
    expect(labelFit(px(35))).toBe("stack");
    expect(labelFit(px(90))).toBe("stack");
  });
});
