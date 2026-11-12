import { describe, expect, it } from "vitest";
import { dateFormat, formatClockTime, formatDay, formatDayRange, formatShortDay } from "./format";

describe("dateFormat", () => {
  it("reuses one formatter for the same locale and options", () => {
    expect(dateFormat({ year: "numeric" }, "en-GB")).toBe(dateFormat({ year: "numeric" }, "en-GB"));
  });

  it("builds another for different options or locales", () => {
    const base = dateFormat({ year: "numeric" }, "en-GB");
    expect(dateFormat({ month: "short" }, "en-GB")).not.toBe(base);
    expect(dateFormat({ year: "numeric" }, "fr-FR")).not.toBe(base);
  });
});

describe("date labels", () => {
  it("labels a day with a short weekday", () => {
    expect(formatDay("2026-11-09", "en-GB")).toBe("Mon, 9 Nov 2026");
  });

  it("labels a column header with the weekday and day", () => {
    expect(formatShortDay("2026-11-09", "en-GB")).toBe("Mon 9");
  });

  it("labels a run of days as a range", () => {
    expect(formatDayRange("2026-11-05", "2026-11-09", "en-GB")).toMatch(/^5\s*–\s*9 Nov 2026$/);
  });
});

describe("formatClockTime", () => {
  it("shows the wall-clock time in the given zone", () => {
    const instant = Date.parse("2026-11-09T08:30:00Z");
    expect(formatClockTime(instant, "Europe/Paris", "en-GB")).toBe("09:30");
    expect(formatClockTime(instant, "UTC", "en-GB")).toBe("08:30");
  });
});
