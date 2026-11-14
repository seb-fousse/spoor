import type { TimelineInterval } from "@spoor/core";
import { describe, expect, it } from "vitest";
import { daysWindow } from "../layout/dragRange";
import {
  canMove,
  conflictingCategories,
  editSpan,
  freeGaps,
  movedRange,
  resizedRange,
  sameRange,
  splitPoint,
} from "./blockEdit";

const ZONE = "Europe/Paris";
/** Paris is UTC+1 in November. */
const at = (local: string) => Date.parse(`${local}+01:00`);
const t = (time: string) => at(`2026-11-09T${time}:00`);
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
/** Monday to Wednesday. */
const WINDOW = daysWindow(["2026-11-09", "2026-11-10", "2026-11-11"], ZONE);
const exclusive = { exclusive: true };
const shared = { exclusive: false };

function interval(
  id: string,
  start: number,
  end: number | null,
  extra: Partial<TimelineInterval> = {},
): TimelineInterval {
  return {
    id,
    timelineId: "t1",
    categoryId: "c1",
    startAt: start,
    endAt: end,
    timeZone: ZONE,
    createdAt: start,
    updatedAt: start,
    ...extra,
  };
}

// 8–9, then the one edited at 10–11, then 13–14.
const before = interval("before", t("08:00"), t("09:00"));
const block = interval("block", t("10:00"), t("11:00"));
const after = interval("after", t("13:00"), t("14:00"));
const day = [before, block, after];

describe("editSpan", () => {
  it("is the gap between the neighbours on an exclusive timeline", () => {
    expect(editSpan(block, day, exclusive, WINDOW)).toEqual({
      startAt: t("09:00"),
      endAt: t("13:00"),
    });
  });

  it("runs to the window's ends without neighbours", () => {
    expect(editSpan(block, [block], exclusive, WINDOW)).toEqual(WINDOW);
  });

  it("only stops at the same category on a non-exclusive timeline", () => {
    const other = interval("other", t("12:00"), t("15:00"), { categoryId: "c2" });
    expect(editSpan(block, [before, block, other], shared, WINDOW)).toEqual({
      startAt: t("09:00"),
      endAt: WINDOW.endAt,
    });
  });

  it("ignores other timelines", () => {
    const elsewhere = interval("elsewhere", t("12:00"), t("15:00"), { timelineId: "t2" });
    expect(editSpan(block, [block, elsewhere], exclusive, WINDOW).endAt).toBe(WINDOW.endAt);
  });

  it("holds a block that runs past the window", () => {
    const early = interval("early", at("2026-11-08T22:00:00"), t("02:00"));
    expect(editSpan(early, [early, before], exclusive, WINDOW)).toEqual({
      startAt: early.startAt,
      endAt: t("08:00"),
    });
  });

  it("reaches as late as the window for an ongoing block", () => {
    const ongoing = interval("ongoing", t("15:00"), null);
    expect(editSpan(ongoing, [after, ongoing], exclusive, WINDOW)).toEqual({
      startAt: t("14:00"),
      endAt: WINDOW.endAt,
    });
  });
});

describe("canMove", () => {
  it("moves an ended block inside the window", () => {
    expect(canMove(block, WINDOW)).toBe(true);
  });

  it("doesn't move an ongoing block, or one that runs past the window", () => {
    expect(canMove(interval("ongoing", t("15:00"), null), WINDOW)).toBe(false);
    expect(canMove(interval("early", at("2026-11-08T22:00:00"), t("02:00")), WINDOW)).toBe(false);
  });
});

describe("freeGaps", () => {
  it("is every gap between the other blocks, inside the window", () => {
    expect(freeGaps(block, day, exclusive, WINDOW)).toEqual([
      { startAt: WINDOW.startAt, endAt: t("08:00") },
      { startAt: t("09:00"), endAt: t("13:00") },
      { startAt: t("14:00"), endAt: WINDOW.endAt },
    ]);
  });

  it("is the whole window without other blocks", () => {
    expect(freeGaps(block, [block], exclusive, WINDOW)).toEqual([WINDOW]);
  });

  it("only counts the same category on a non-exclusive timeline", () => {
    const other = interval("other", t("12:00"), t("15:00"), { categoryId: "c2" });
    expect(freeGaps(block, [block, other], shared, WINDOW)).toEqual([WINDOW]);
  });

  it("has nothing free after an ongoing block starts", () => {
    const ongoing = interval("ongoing", t("15:00"), null);
    expect(freeGaps(block, [block, ongoing], exclusive, WINDOW)).toEqual([
      { startAt: WINDOW.startAt, endAt: t("15:00") },
    ]);
  });

  it("leaves out blocks touching each other, and ones outside the window", () => {
    const early = interval("early", at("2026-11-08T20:00:00"), t("01:00"));
    const a = interval("a", t("13:00"), t("14:00"));
    const b = interval("b", t("14:00"), t("15:00"));
    expect(freeGaps(block, [early, block, a, b], exclusive, WINDOW)).toEqual([
      { startAt: t("01:00"), endAt: t("13:00") },
      { startAt: t("15:00"), endAt: WINDOW.endAt },
    ]);
  });
});

describe("movedRange", () => {
  const ten = { startAt: t("10:00"), endAt: t("11:00") };
  const gaps = freeGaps(block, day, exclusive, WINDOW);

  it("shifts the range and keeps its length", () => {
    expect(movedRange(ten, HOUR, gaps)).toEqual({ startAt: t("11:00"), endAt: t("12:00") });
    expect(movedRange(ten, -45 * MINUTE, gaps)).toEqual({
      startAt: t("09:15"),
      endAt: t("10:15"),
    });
  });

  it("stays clear of a block in the way, on the nearer side", () => {
    // 12:30–13:30 overlaps 13–14: just above it is nearer.
    expect(movedRange(ten, 2.5 * HOUR, gaps)).toEqual({ startAt: t("12:00"), endAt: t("13:00") });
    // 13:45–14:45: just below it is nearer.
    expect(movedRange(ten, 3.75 * HOUR, gaps)).toEqual({
      startAt: t("14:00"),
      endAt: t("15:00"),
    });
  });

  it("skips over a block to the far side", () => {
    expect(movedRange(ten, 5 * HOUR, gaps)).toEqual({ startAt: t("15:00"), endAt: t("16:00") });
    expect(movedRange(ten, -4 * HOUR, gaps)).toEqual({ startAt: t("06:00"), endAt: t("07:00") });
  });

  it("prefers the earlier spot on a tie", () => {
    // A half-hour block wanted at 12:45, with a block from 12:30 to 13:30:
    // 12:00 and 13:30 are each 45 minutes off.
    const half = { startAt: t("10:00"), endAt: t("10:30") };
    const around = [
      { startAt: t("09:00"), endAt: t("12:30") },
      { startAt: t("13:30"), endAt: t("16:00") },
    ];
    expect(movedRange(half, 2.75 * HOUR, around).startAt).toBe(t("12:00"));
  });

  it("skips a gap too short to hold it", () => {
    // A 30-minute gap between 13–14 and 14:30–15: the hour-long block can't land there.
    const narrow = [
      { startAt: t("09:00"), endAt: t("13:00") },
      { startAt: t("14:00"), endAt: t("14:30") },
      { startAt: t("15:00"), endAt: WINDOW.endAt },
    ];
    expect(movedRange(ten, 4 * HOUR, narrow)).toEqual({ startAt: t("15:00"), endAt: t("16:00") });
  });

  it("crosses midnight", () => {
    expect(movedRange(ten, 24 * HOUR, [WINDOW])).toEqual({
      startAt: at("2026-11-10T10:00:00"),
      endAt: at("2026-11-10T11:00:00"),
    });
  });

  it("stops at the window's ends", () => {
    expect(movedRange(ten, 5 * 24 * HOUR, [WINDOW]).endAt).toBe(WINDOW.endAt);
  });

  it("keeps the length across a clock change", () => {
    // 2026-10-25 has 25 hours in Paris.
    const paris = (local: string) => Date.parse(`${local}+02:00`);
    const late = { startAt: paris("2026-10-25T01:00:00"), endAt: paris("2026-10-25T02:30:00") };
    const moved = movedRange(late, 2 * HOUR, [daysWindow(["2026-10-25"], ZONE)]);
    expect(moved.endAt - moved.startAt).toBe(90 * MINUTE);
  });
});

describe("resizedRange", () => {
  const gap = { startAt: t("09:00"), endAt: t("13:00") };
  const now = t("16:00");

  it("moves one edge", () => {
    expect(resizedRange(block, "start", t("09:30"), gap, now)).toEqual({
      startAt: t("09:30"),
      endAt: t("11:00"),
    });
    expect(resizedRange(block, "end", t("12:15"), gap, now)).toEqual({
      startAt: t("10:00"),
      endAt: t("12:15"),
    });
  });

  it("stops at the neighbours", () => {
    expect(resizedRange(block, "start", t("07:00"), gap, now).startAt).toBe(t("09:00"));
    expect(resizedRange(block, "end", t("15:00"), gap, now).endAt).toBe(t("13:00"));
  });

  it("keeps the block a step long", () => {
    expect(resizedRange(block, "start", t("12:00"), gap, now).startAt).toBe(t("10:45"));
    expect(resizedRange(block, "end", t("08:00"), gap, now).endAt).toBe(t("10:15"));
  });

  it("lets a block shorter than a step grow, not shrink", () => {
    const short = interval("short", t("10:00"), t("10:05"));
    expect(resizedRange(short, "start", t("10:30"), gap, now).startAt).toBe(t("10:00"));
    expect(resizedRange(short, "start", t("09:45"), gap, now).startAt).toBe(t("09:45"));
    expect(resizedRange(short, "end", t("09:00"), gap, now).endAt).toBe(t("10:05"));
    expect(resizedRange(short, "end", t("10:30"), gap, now).endAt).toBe(t("10:30"));
  });

  it("keeps an ongoing block ongoing, started by now", () => {
    const ongoing = interval("ongoing", t("15:00"), null);
    const span = { startAt: t("14:00"), endAt: WINDOW.endAt };
    expect(resizedRange(ongoing, "start", t("14:30"), span, now)).toEqual({
      startAt: t("14:30"),
      endAt: null,
    });
    expect(resizedRange(ongoing, "start", t("18:00"), span, now).startAt).toBe(now);
    expect(resizedRange(ongoing, "end", t("18:00"), span, now)).toBe(ongoing);
  });
});

describe("splitPoint", () => {
  const now = t("16:00");

  it("cuts strictly inside the block", () => {
    expect(splitPoint(block, t("10:15"), now)).toBe(t("10:15"));
    expect(splitPoint(block, t("10:45"), now)).toBe(t("10:45"));
  });

  it("doesn't cut on an edge or outside", () => {
    expect(splitPoint(block, t("10:00"), now)).toBeNull();
    expect(splitPoint(block, t("11:00"), now)).toBeNull();
    expect(splitPoint(block, t("12:00"), now)).toBeNull();
  });

  it("has nowhere to cut a block shorter than two steps on the grid", () => {
    const quarter = interval("quarter", t("10:00"), t("10:15"));
    for (const mark of [t("10:00"), t("10:15")]) expect(splitPoint(quarter, mark, now)).toBeNull();
  });

  it("cuts an ongoing block only before now", () => {
    const ongoing = interval("ongoing", t("14:00"), null);
    expect(splitPoint(ongoing, t("15:45"), now)).toBe(t("15:45"));
    expect(splitPoint(ongoing, t("16:00"), now)).toBeNull();
  });
});

describe("sameRange", () => {
  it("compares both ends", () => {
    expect(sameRange(block, { startAt: t("10:00"), endAt: t("11:00") })).toBe(true);
    expect(sameRange(block, { startAt: t("10:00"), endAt: null })).toBe(false);
  });
});

describe("conflictingCategories", () => {
  const ids = ["c1", "c2", "c3"];

  it("is empty on an exclusive timeline", () => {
    expect(conflictingCategories(block, day, exclusive, ids).size).toBe(0);
  });

  it("is the other categories with a block overlapping it", () => {
    const c2 = interval("c2", t("10:30"), t("12:00"), { categoryId: "c2" });
    // Only touching is no overlap.
    const c3 = interval("c3", t("11:00"), t("12:00"), { categoryId: "c3" });
    expect(conflictingCategories(block, [block, c2, c3], shared, ids)).toEqual(new Set(["c2"]));
  });

  it("counts an ongoing block as never ending", () => {
    const ongoing = interval("ongoing", t("09:00"), null, { categoryId: "c2" });
    expect(conflictingCategories(block, [block, ongoing], shared, ids)).toEqual(new Set(["c2"]));
  });
});
