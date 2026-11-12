import type { TimelineInterval } from "@spoor/core";
import { describe, expect, it } from "vitest";
import { daysWindow, dragRange, freeSpan, rangePieces, snapFraction } from "./dragRange";

const ZONE = "Europe/Paris";
const DAY = "2026-11-09";
/** Paris is UTC+1 in November. */
const at = (local: string) => Date.parse(`${local}+01:00`);
const MINUTE = 60 * 1000;
/** Just the one day, as when one day is shown. */
const WINDOW = { startAt: at("2026-11-09T00:00:00"), endAt: at("2026-11-10T00:00:00") };

function interval(
  start: string,
  end: string | null,
  extra: Partial<TimelineInterval> = {},
): TimelineInterval {
  const startAt = at(start);
  return {
    id: "i1",
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

describe("snapFraction", () => {
  it("snaps to the nearest 15 minutes", () => {
    // 9:07 → 9:00, 9:08 → 9:15.
    expect(snapFraction((9 * 60 + 7) / 1440, DAY, ZONE)).toBe(at("2026-11-09T09:00:00"));
    expect(snapFraction((9 * 60 + 8) / 1440, DAY, ZONE)).toBe(at("2026-11-09T09:15:00"));
  });

  it("stays inside the day", () => {
    expect(snapFraction(-0.2, DAY, ZONE)).toBe(at("2026-11-09T00:00:00"));
    expect(snapFraction(1.3, DAY, ZONE)).toBe(at("2026-11-10T00:00:00"));
  });

  it("counts elapsed time on a day with a clock change", () => {
    // 2026-10-25 has 25 hours in Paris: halfway is 12:30 elapsed, 11:30 on the clock.
    const start = Date.parse("2026-10-25T00:00:00+02:00");
    expect(snapFraction(0.5, "2026-10-25", ZONE)).toBe(start + 12.5 * 60 * MINUTE);
  });
});

describe("freeSpan", () => {
  const exclusive = { id: "t1", exclusive: true };
  const midnight = at("2026-11-09T00:00:00");
  const nextMidnight = at("2026-11-10T00:00:00");
  const blocks = [
    interval("2026-11-09T08:00:00", "2026-11-09T09:00:00"),
    interval("2026-11-09T13:00:00", "2026-11-09T14:00:00"),
  ];

  it("is the whole day on a non-exclusive timeline", () => {
    const span = freeSpan(
      at("2026-11-09T12:00:00"),
      blocks,
      { id: "t1", exclusive: false },
      WINDOW,
    );
    expect(span).toEqual({ startAt: midnight, endAt: nextMidnight });
  });

  it("is the gap between the blocks around the anchor", () => {
    expect(freeSpan(at("2026-11-09T12:00:00"), blocks, exclusive, WINDOW)).toEqual({
      startAt: at("2026-11-09T09:00:00"),
      endAt: at("2026-11-09T13:00:00"),
    });
  });

  it("runs to the day's ends past the first and last blocks", () => {
    expect(freeSpan(at("2026-11-09T06:00:00"), blocks, exclusive, WINDOW)?.startAt).toBe(midnight);
    expect(freeSpan(at("2026-11-09T20:00:00"), blocks, exclusive, WINDOW)?.endAt).toBe(
      nextMidnight,
    );
  });

  it("leaves room on either side of an anchor on a block's edge", () => {
    expect(freeSpan(at("2026-11-09T13:00:00"), blocks, exclusive, WINDOW)).toEqual({
      startAt: at("2026-11-09T09:00:00"),
      endAt: at("2026-11-09T13:00:00"),
    });
  });

  it("has no room inside a block or after an ongoing one starts", () => {
    expect(freeSpan(at("2026-11-09T13:30:00"), blocks, exclusive, WINDOW)).toBeNull();
    const ongoing = [interval("2026-11-09T15:00:00", null)];
    expect(freeSpan(at("2026-11-09T18:00:00"), ongoing, exclusive, WINDOW)).toBeNull();
  });

  it("ignores other timelines", () => {
    const other = [interval("2026-11-09T13:00:00", "2026-11-09T14:00:00", { timelineId: "t2" })];
    expect(freeSpan(at("2026-11-09T13:30:00"), other, exclusive, WINDOW)).not.toBeNull();
  });

  it("reaches across days to the next block", () => {
    const window = daysWindow(["2026-11-09", "2026-11-10", "2026-11-11"], ZONE);
    const tomorrow = [interval("2026-11-10T08:00:00", "2026-11-10T09:00:00")];
    expect(freeSpan(at("2026-11-09T12:00:00"), tomorrow, exclusive, window)).toEqual({
      startAt: window.startAt,
      endAt: at("2026-11-10T08:00:00"),
    });
  });
});

describe("daysWindow", () => {
  it("runs from the first day's start to the last day's end", () => {
    expect(daysWindow(["2026-11-09", "2026-11-10"], ZONE)).toEqual({
      startAt: at("2026-11-09T00:00:00"),
      endAt: at("2026-11-11T00:00:00"),
    });
  });
});

describe("dragRange", () => {
  const nine = at("2026-11-09T09:00:00");
  const ten = at("2026-11-09T10:00:00");
  const day = { startAt: at("2026-11-09T00:00:00"), endAt: at("2026-11-10T00:00:00") };

  it("orders the ends, so dragging upward works", () => {
    expect(dragRange(nine, ten, day)).toEqual({ startAt: nine, endAt: ten });
    expect(dragRange(ten, nine, day)).toEqual({ startAt: nine, endAt: ten });
  });

  it("stops at the end of the span", () => {
    const gap = { startAt: at("2026-11-09T08:00:00"), endAt: at("2026-11-09T13:00:00") };
    expect(dragRange(at("2026-11-09T12:00:00"), at("2026-11-09T15:00:00"), gap)).toEqual({
      startAt: at("2026-11-09T12:00:00"),
      endAt: at("2026-11-09T13:00:00"),
    });
    expect(dragRange(nine, at("2026-11-09T06:00:00"), gap)).toEqual({
      startAt: at("2026-11-09T08:00:00"),
      endAt: nine,
    });
  });

  it("is nothing while the pointer is on the anchor", () => {
    expect(dragRange(nine, nine, day)).toBeNull();
  });

  it("is nothing when the span leaves no room past the anchor", () => {
    const gap = { startAt: at("2026-11-09T08:00:00"), endAt: nine };
    expect(dragRange(nine, ten, gap)).toBeNull();
  });
});

describe("rangePieces", () => {
  const days = ["2026-11-09", "2026-11-10", "2026-11-11"];

  it("places a range within one day", () => {
    const range = { startAt: at("2026-11-09T06:00:00"), endAt: at("2026-11-09T12:00:00") };
    expect(rangePieces(range, days, ZONE)).toEqual([{ day: DAY, top: 0.25, height: 0.25 }]);
  });

  it("cuts a range at midnight", () => {
    const range = { startAt: at("2026-11-09T12:00:00"), endAt: at("2026-11-11T06:00:00") };
    expect(rangePieces(range, days, ZONE)).toEqual([
      { day: "2026-11-09", top: 0.5, height: 0.5 },
      { day: "2026-11-10", top: 0, height: 1 },
      { day: "2026-11-11", top: 0, height: 0.25 },
    ]);
  });

  it("skips a day the range only touches", () => {
    const range = { startAt: at("2026-11-09T12:00:00"), endAt: at("2026-11-10T00:00:00") };
    expect(rangePieces(range, days, ZONE)).toHaveLength(1);
  });
});
