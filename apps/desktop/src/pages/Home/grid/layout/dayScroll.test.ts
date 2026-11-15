import { addDays, type LocalDate } from "@spoor/core";
import { describe, expect, it } from "vitest";
import {
  centreLeft,
  type DayStrip,
  keptLeft,
  maxLeft,
  nearestLeft,
  placement,
  settledStart,
} from "./dayScroll";

/** `count` days from `first`, oldest first. */
function run(first: LocalDate, count: number): LocalDate[] {
  return Array.from({ length: count }, (_, i) => addDays(first, i));
}

// Five days in view, five either side, 100px each: 2026-11-05 to 09 in view at 500px.
const STRIP: DayStrip = { days: run("2026-10-31", 15), visible: 5, width: 100 };

describe("centreLeft and maxLeft", () => {
  it("centres the window, with a window's worth either side", () => {
    expect(centreLeft(STRIP)).toBe(500);
    expect(maxLeft(STRIP)).toBe(1000);
  });

  it("never scrolls past the strip's end", () => {
    const short = { ...STRIP, days: STRIP.days.slice(0, 7) };
    expect(maxLeft(short)).toBe(200);
    expect(centreLeft(short)).toBe(200);
  });
});

describe("nearestLeft", () => {
  it("rounds to the nearest day boundary", () => {
    expect(nearestLeft(649, STRIP)).toBe(600);
    expect(nearestLeft(651, STRIP)).toBe(700);
  });

  it("stays inside the strip", () => {
    expect(nearestLeft(-80, STRIP)).toBe(0);
    expect(nearestLeft(5000, STRIP)).toBe(1000);
  });
});

describe("settledStart", () => {
  it("is the day at the left edge on a day boundary", () => {
    expect(settledStart(500, STRIP)).toBe("2026-11-05");
    expect(settledStart(700, STRIP)).toBe("2026-11-07");
    expect(settledStart(0, STRIP)).toBe("2026-10-31");
    expect(settledStart(1000, STRIP)).toBe("2026-11-10");
  });

  it("allows for a position rounded to the device pixel", () => {
    expect(settledStart(699.5, STRIP)).toBe("2026-11-07");
    expect(settledStart(700.8, STRIP)).toBe("2026-11-07");
  });

  it("is null between two days", () => {
    expect(settledStart(650, STRIP)).toBeNull();
    expect(settledStart(703, STRIP)).toBeNull();
  });

  it("is null before the days have a width", () => {
    expect(settledStart(0, { ...STRIP, width: 0 })).toBeNull();
  });
});

describe("keptLeft", () => {
  it("keeps the same day at the left edge when the strip re-centres", () => {
    // Settled two days later, at 700: 2026-11-07 at the left edge.
    const next = { ...STRIP, days: run("2026-11-02", 15) };
    expect(keptLeft(700, STRIP, next)).toBe(500);
  });

  it("keeps a position between two days", () => {
    const next = { ...STRIP, days: run("2026-11-02", 15) };
    expect(keptLeft(750, STRIP, next)).toBe(550);
  });

  it("puts the old view at the start when the window pages a window later", () => {
    const next = { ...STRIP, days: run("2026-11-05", 15) };
    expect(keptLeft(500, STRIP, next)).toBe(0);
  });

  it("puts the old view at the end when the window pages a window earlier", () => {
    const next = { ...STRIP, days: run("2026-10-26", 15) };
    expect(keptLeft(500, STRIP, next)).toBe(1000);
  });

  it("goes to the end the old view is off, when it is far away", () => {
    expect(keptLeft(500, STRIP, { ...STRIP, days: run("2026-12-01", 15) })).toBe(0);
    expect(keptLeft(500, STRIP, { ...STRIP, days: run("2026-09-01", 15) })).toBe(1000);
  });
});

describe("placement", () => {
  it("goes straight to the centre on the first render", () => {
    expect(placement(0, null, STRIP)).toEqual({ from: 500, to: 500 });
  });

  it("stays put when the user scrolled to the new window", () => {
    const next = { ...STRIP, days: run("2026-11-02", 15) };
    expect(placement(700, STRIP, next)).toEqual({ from: 500, to: 500 });
  });

  it("animates a day when the window moves by one", () => {
    // Stepping past the window's end: the strip starts a day later.
    const next = { ...STRIP, days: run("2026-11-01", 15) };
    expect(placement(500, STRIP, next)).toEqual({ from: 400, to: 500 });
  });

  it("animates a window when it pages", () => {
    const next = { ...STRIP, days: run("2026-11-05", 15) };
    expect(placement(500, STRIP, next)).toEqual({ from: 0, to: 500 });
  });

  it("goes straight to the centre when the range changes", () => {
    const week = { days: run("2026-10-27", 21), visible: 7, width: 500 / 7 };
    expect(placement(500, STRIP, week)).toEqual({ from: 500, to: 500 });
  });

  it("goes straight to the centre after a resize", () => {
    expect(placement(500, STRIP, { ...STRIP, width: 120 })).toEqual({ from: 600, to: 600 });
  });
});
