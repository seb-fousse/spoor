import type { TimelineCategory, TimelineInterval } from "@spoor/core";
import { describe, expect, it } from "vitest";
import { type BlockCopy, copyOf, pasteTarget } from "./blockCopy";
import { daysWindow } from "./dragRange";

const ZONE = "Europe/Paris";
/** Paris is UTC+1 in November. */
const at = (local: string) => Date.parse(`${local}+01:00`);
const t = (time: string) => at(`2026-11-09T${time}:00`);
const HOUR = 60 * 60 * 1000;
/** Monday to Wednesday. */
const WINDOW = daysWindow(["2026-11-09", "2026-11-10", "2026-11-11"], ZONE);

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

const category: TimelineCategory = {
  id: "c1",
  timelineId: "t1",
  name: "Work",
  description: null,
  thingId: null,
  createdAt: 0,
  updatedAt: 0,
  archivedAt: null,
};

/** A copy of an hour of Work. */
const copy: BlockCopy = { timelineId: "t1", categoryId: "c1", length: HOUR };

/** Pasting `copy` at `when` on t1, among `intervals`. */
function paste(
  when: number,
  intervals: TimelineInterval[] = [],
  options: { exclusive?: boolean; category?: TimelineCategory; copied?: BlockCopy | null } = {},
) {
  return pasteTarget(options.copied === undefined ? copy : options.copied, "t1", when, {
    intervals,
    timeline: { exclusive: options.exclusive ?? true },
    category: "category" in options ? options.category : category,
    window: WINDOW,
  });
}

describe("copyOf", () => {
  it("keeps the block's timeline, category and length", () => {
    expect(copyOf(interval("a", t("09:00"), t("10:30")))).toEqual({
      timelineId: "t1",
      categoryId: "c1",
      length: 1.5 * HOUR,
    });
  });

  it("is null for an ongoing block", () => {
    expect(copyOf(interval("a", t("09:00"), null))).toBeNull();
  });
});

describe("pasteTarget", () => {
  it("starts at the mark when it is free", () => {
    expect(paste(t("14:00"))).toEqual({ range: { startAt: t("14:00"), endAt: t("15:00") } });
  });

  it("moves to the nearest spot that fits on an exclusive timeline", () => {
    const busy = interval("busy", t("14:00"), t("16:00"));
    // 15:30 is nearer the end of the block in the way, 14:00 its start.
    expect(paste(t("15:30"), [busy])).toEqual({
      range: { startAt: t("16:00"), endAt: t("17:00") },
    });
    expect(paste(t("14:00"), [busy])).toEqual({
      range: { startAt: t("13:00"), endAt: t("14:00") },
    });
  });

  it("skips gaps too short to hold it", () => {
    const first = interval("first", t("12:00"), t("14:00"));
    const second = interval("second", t("14:30"), t("16:00"));
    // 14:00–14:30 is free but too short.
    expect(paste(t("14:00"), [first, second])).toEqual({
      range: { startAt: t("16:00"), endAt: t("17:00") },
    });
  });

  it("only keeps clear of the same category on a non-exclusive timeline", () => {
    const other = interval("other", t("14:00"), t("16:00"), { categoryId: "c2" });
    const same = interval("same", t("14:00"), t("16:00"));
    expect(paste(t("14:00"), [other], { exclusive: false })).toEqual({
      range: { startAt: t("14:00"), endAt: t("15:00") },
    });
    expect(paste(t("14:00"), [same], { exclusive: false })).toEqual({
      range: { startAt: t("13:00"), endAt: t("14:00") },
    });
  });

  it("crosses midnight, and stays inside the visible days", () => {
    expect(paste(t("23:30"))).toEqual({
      range: { startAt: t("23:30"), endAt: at("2026-11-10T00:30:00") },
    });
    expect(paste(at("2026-11-11T23:30:00"))).toEqual({
      range: { startAt: WINDOW.endAt - HOUR, endAt: WINDOW.endAt },
    });
  });

  it("is refused with nothing copied, or on another timeline", () => {
    expect(paste(t("14:00"), [], { copied: null })).toEqual({ reason: "Nothing copied" });
    expect(paste(t("14:00"), [], { copied: { ...copy, timelineId: "t2" } })).toEqual({
      reason: "Copied from another timeline",
    });
  });

  it("is refused once its category is archived or deleted", () => {
    expect(paste(t("14:00"), [], { category: { ...category, archivedAt: 1 } })).toEqual({
      reason: "Its category is archived",
    });
    expect(paste(t("14:00"), [], { category: undefined })).toEqual({
      reason: "Its category was deleted",
    });
  });

  it("is refused when it fits nowhere", () => {
    const ongoing = interval("ongoing", WINDOW.startAt + 30 * 60 * 1000, null);
    expect(paste(t("14:00"), [ongoing])).toEqual({
      reason: "No room for it on the visible days",
    });
  });
});
