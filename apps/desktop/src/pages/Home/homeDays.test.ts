import { describe, expect, it } from "vitest";
import {
  formatDay,
  formatWindow,
  type HomeDays,
  type HomeDaysAction,
  homeDaysReducer,
  initialHomeDays,
  isAtToday,
  windowDays,
} from "./homeDays";

const TODAY = "2026-11-09";

function run(state: HomeDays, ...actions: HomeDaysAction[]): HomeDays {
  return actions.reduce(homeDaysReducer, state);
}

describe("initialHomeDays", () => {
  it("shows five days ending today, with today active", () => {
    const state = initialHomeDays(TODAY);
    expect(state.activeDay).toBe(TODAY);
    expect(windowDays(state)).toEqual([
      "2026-11-05",
      "2026-11-06",
      "2026-11-07",
      "2026-11-08",
      "2026-11-09",
    ]);
  });
});

describe("stepActive", () => {
  it("moves the active day within the window without moving the window", () => {
    const state = run(initialHomeDays(TODAY), { type: "stepActive", by: -4 });
    expect(state.activeDay).toBe("2026-11-05");
    expect(state.windowEnd).toBe(TODAY);
  });

  it("shifts the window by one day when stepping past its start", () => {
    const state = run(initialHomeDays(TODAY), { type: "stepActive", by: -5 });
    expect(state.activeDay).toBe("2026-11-04");
    expect(windowDays(state)[0]).toBe("2026-11-04");
    expect(state.windowEnd).toBe("2026-11-08");
  });

  it("shifts the window by one day when stepping past its end", () => {
    const state = run(initialHomeDays(TODAY), { type: "stepActive", by: 1 });
    expect(state.activeDay).toBe("2026-11-10");
    expect(state.windowEnd).toBe("2026-11-10");
  });

  it("crosses month and year boundaries", () => {
    const state = run(initialHomeDays("2026-01-01"), { type: "stepActive", by: -5 });
    expect(state.activeDay).toBe("2025-12-27");
    expect(windowDays(state)).toEqual([
      "2025-12-27",
      "2025-12-28",
      "2025-12-29",
      "2025-12-30",
      "2025-12-31",
    ]);
  });

  it("moves a one-day window with the active day", () => {
    const state = run(
      initialHomeDays(TODAY),
      { type: "setRange", range: "day" },
      { type: "stepActive", by: -1 },
    );
    expect(windowDays(state)).toEqual(["2026-11-08"]);
  });
});

describe("select", () => {
  it("leaves the window alone for a visible day", () => {
    const state = run(initialHomeDays(TODAY), { type: "select", day: "2026-11-06" });
    expect(state.activeDay).toBe("2026-11-06");
    expect(state.windowEnd).toBe(TODAY);
  });

  it("puts a far earlier day at the window's start", () => {
    const state = run(initialHomeDays(TODAY), { type: "select", day: "2026-10-01" });
    expect(windowDays(state)[0]).toBe("2026-10-01");
  });
});

describe("pageWindow", () => {
  it("moves the window by its length and keeps the active day's column", () => {
    const state = run(
      initialHomeDays(TODAY),
      { type: "stepActive", by: -2 },
      { type: "pageWindow", by: -1 },
    );
    expect(state.windowEnd).toBe("2026-11-04");
    expect(state.activeDay).toBe("2026-11-02");
  });

  it("pages a week by seven days", () => {
    const state = run(
      initialHomeDays(TODAY),
      { type: "setRange", range: "week" },
      { type: "pageWindow", by: 1 },
    );
    expect(state.windowEnd).toBe("2026-11-16");
    expect(state.activeDay).toBe("2026-11-16");
  });
});

describe("goToday", () => {
  it("brings the window and active day back to today, keeping the range", () => {
    const state = run(
      initialHomeDays(TODAY),
      { type: "setRange", range: "week" },
      { type: "pageWindow", by: -3 },
      { type: "goToday", today: TODAY },
    );
    expect(state).toEqual({ activeDay: TODAY, windowEnd: TODAY, range: "week" });
  });
});

describe("setRange", () => {
  it("keeps the window's end when the active day stays visible", () => {
    const state = run(initialHomeDays(TODAY), { type: "setRange", range: "week" });
    expect(state.windowEnd).toBe(TODAY);
    expect(windowDays(state)).toHaveLength(7);
  });

  it("re-anchors on the active day when shrinking would hide it", () => {
    const state = run(
      initialHomeDays(TODAY),
      { type: "stepActive", by: -3 },
      { type: "setRange", range: "day" },
    );
    expect(windowDays(state)).toEqual(["2026-11-06"]);
  });
});

describe("formatting", () => {
  it("labels the active day with a short weekday", () => {
    expect(formatDay(TODAY, "en-GB")).toBe("Mon, 9 Nov 2026");
  });

  it("labels a multi-day window as a range", () => {
    expect(formatWindow(initialHomeDays(TODAY), "en-GB")).toMatch(/^5\s*–\s*9 Nov 2026$/);
  });

  it("labels a one-day window as that day", () => {
    const state = run(initialHomeDays(TODAY), { type: "setRange", range: "day" });
    expect(formatWindow(state, "en-GB")).toBe("Mon, 9 Nov 2026");
  });
});

describe("isAtToday", () => {
  it("is true at the start", () => {
    expect(isAtToday(initialHomeDays(TODAY), TODAY)).toBe(true);
  });

  it("is false once the active day moves off today", () => {
    const state = run(initialHomeDays(TODAY), { type: "stepActive", by: -1 });
    expect(isAtToday(state, TODAY)).toBe(false);
  });

  it("is true again after stepping forward past today and back", () => {
    const state = run(
      initialHomeDays(TODAY),
      { type: "stepActive", by: 1 },
      { type: "stepActive", by: -1 },
    );
    // The window still ends tomorrow, but today is active and visible.
    expect(state.windowEnd).toBe("2026-11-10");
    expect(isAtToday(state, TODAY)).toBe(true);
  });

  it("is true again after paging away and back", () => {
    const state = run(
      initialHomeDays(TODAY),
      { type: "pageWindow", by: -2 },
      { type: "pageWindow", by: 2 },
    );
    expect(isAtToday(state, TODAY)).toBe(true);
  });
});

describe("rollover", () => {
  const TOMORROW = "2026-11-10";

  it("follows the new day when the user was on today", () => {
    const state = run(initialHomeDays(TODAY), { type: "rollover", from: TODAY, to: TOMORROW });
    expect(state).toEqual({ activeDay: TOMORROW, windowEnd: TOMORROW, range: "5days" });
  });

  it("leaves a user who was looking at another day where they are", () => {
    const before = run(initialHomeDays(TODAY), { type: "stepActive", by: -2 });
    const after = run(before, { type: "rollover", from: TODAY, to: TOMORROW });
    expect(after).toBe(before);
  });
});
