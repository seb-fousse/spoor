import { describe, expect, it } from "vitest";
import {
  dayOf,
  dayOfEntry,
  dayRange,
  daysSpanned,
  isTimeZone,
  startOfDay,
  systemTimeZone,
  truncateToPrecision,
} from "./days";

// Expected instants are written with Date.UTC (month is 0-based).
const HOUR = 3_600_000;

describe("isTimeZone", () => {
  it("accepts IANA IDs, including aliases", () => {
    for (const id of ["Europe/Paris", "UTC", "Etc/UTC", "Asia/Kolkata", "Asia/Calcutta"]) {
      expect(isTimeZone(id)).toBe(true);
    }
  });

  it("rejects unknown, miscased, offset, and non-string values", () => {
    for (const id of ["Mars/Olympus", "", "utc", "europe/paris", "+05:00", "-03:00", 42, null]) {
      expect(isTimeZone(id)).toBe(false);
    }
  });

  it("accepts the system time zone", () => {
    expect(isTimeZone(systemTimeZone())).toBe(true);
  });
});

describe("dayOf", () => {
  it("handles half-hour and extreme offsets near UTC midnight", () => {
    // Asia/Kolkata is +05:30.
    expect(dayOf(Date.UTC(2024, 0, 1, 18, 29, 59, 999), "Asia/Kolkata")).toBe("2024-01-01");
    expect(dayOf(Date.UTC(2024, 0, 1, 18, 30), "Asia/Kolkata")).toBe("2024-01-02");
    // Pacific/Kiritimati is +14: most of a UTC day is already tomorrow there.
    expect(dayOf(Date.UTC(2024, 0, 1, 9, 59, 59, 999), "Pacific/Kiritimati")).toBe("2024-01-01");
    expect(dayOf(Date.UTC(2024, 0, 1, 10), "Pacific/Kiritimati")).toBe("2024-01-02");
    // Pacific/Pago_Pago is -11: most of a UTC day is still yesterday there.
    expect(dayOf(Date.UTC(2024, 0, 2, 10, 59, 59, 999), "Pacific/Pago_Pago")).toBe("2024-01-01");
    expect(dayOf(Date.UTC(2024, 0, 2, 11), "Pacific/Pago_Pago")).toBe("2024-01-02");
  });

  it("rejects an invalid zone or instant, naming it", () => {
    expect(() => dayOf(0, "Mars/Olympus")).toThrow(/Mars\/Olympus/);
    expect(() => dayOf(Number.NaN, "UTC")).toThrow(/Invalid instant/);
  });
});

describe("startOfDay / dayRange", () => {
  it("starts a day at local midnight", () => {
    expect(startOfDay("2024-01-02", "Asia/Kolkata")).toBe(Date.UTC(2024, 0, 1, 18, 30));
    expect(startOfDay("2024-01-02", "Pacific/Kiritimati")).toBe(Date.UTC(2024, 0, 1, 10));
    expect(startOfDay("2024-01-02", "Pacific/Pago_Pago")).toBe(Date.UTC(2024, 0, 2, 11));
    expect(dayRange("2024-02-29", "UTC")).toEqual([Date.UTC(2024, 1, 29), Date.UTC(2024, 2, 1)]);
  });

  it("makes Europe/Paris spring-forward days 23 h and fall-back days 25 h", () => {
    const [springStart, springEnd] = dayRange("2025-03-30", "Europe/Paris");
    expect(springStart).toBe(Date.UTC(2025, 2, 29, 23));
    expect(springEnd).toBe(Date.UTC(2025, 2, 30, 22));
    expect(springEnd - springStart).toBe(23 * HOUR);

    const [fallStart, fallEnd] = dayRange("2025-10-26", "Europe/Paris");
    expect(fallStart).toBe(Date.UTC(2025, 9, 25, 22));
    expect(fallEnd).toBe(Date.UTC(2025, 9, 26, 23));
    expect(fallEnd - fallStart).toBe(25 * HOUR);
  });

  // Chile has moved clocks at midnight since 2019 (first Sunday of September
  // forward, first Sunday of April back), so this relies on current tz data.
  it("starts a day at 01:00 when DST skips midnight (America/Santiago)", () => {
    // 2025-09-07 00:00 -04 does not exist; clocks jump to 01:00 -03.
    expect(startOfDay("2025-09-07", "America/Santiago")).toBe(Date.UTC(2025, 8, 7, 4));
    const [start, end] = dayRange("2025-09-07", "America/Santiago");
    expect(end - start).toBe(23 * HOUR);
  });

  it("puts a repeated hour before midnight in the earlier day (America/Santiago)", () => {
    // 2025-04-06 00:00 -03 becomes 2025-04-05 23:00 -04, so 23:00 happens twice.
    expect(dayRange("2025-04-05", "America/Santiago")).toEqual([
      Date.UTC(2025, 3, 5, 3),
      Date.UTC(2025, 3, 6, 4),
    ]);
  });

  // Samoa skipped 2011-12-30 entirely when it moved from -10 to +14.
  it("makes a skipped date an empty day (Pacific/Apia)", () => {
    const [start, end] = dayRange("2011-12-30", "Pacific/Apia");
    expect(start).toBe(Date.UTC(2011, 11, 30, 10));
    expect(end).toBe(start);
  });

  it("rejects invalid dates, naming them", () => {
    for (const date of ["2024-02-30", "2024-1-01", "0000-01-01", "2024-01-01T00:00", ""]) {
      expect(() => startOfDay(date, "UTC")).toThrow(JSON.stringify(date));
    }
  });
});

describe("daysSpanned", () => {
  const paris = "Europe/Paris";

  it("counts an interval crossing midnight toward both days", () => {
    // 23:00 to 01:00 Paris summer time (+02).
    expect(daysSpanned(Date.UTC(2024, 5, 1, 21), Date.UTC(2024, 5, 1, 23), paris)).toEqual([
      "2024-06-01",
      "2024-06-02",
    ]);
  });

  it("excludes the next day when ending exactly at midnight", () => {
    expect(daysSpanned(Date.UTC(2024, 5, 1, 20), Date.UTC(2024, 5, 1, 22), paris)).toEqual([
      "2024-06-01",
    ]);
  });

  it("returns its own day for a zero-length interval", () => {
    const midnight = Date.UTC(2024, 5, 1, 22);
    expect(daysSpanned(midnight, midnight, paris)).toEqual(["2024-06-02"]);
  });

  it("spans a DST change", () => {
    // 2025-03-29 22:00 +01 to 2025-03-31 01:00 +02.
    expect(daysSpanned(Date.UTC(2025, 2, 29, 21), Date.UTC(2025, 2, 30, 23), paris)).toEqual([
      "2025-03-29",
      "2025-03-30",
      "2025-03-31",
    ]);
  });

  it("leaves out a date the zone skipped", () => {
    // 2011-12-29 23:00 -10 to 2011-12-31 01:00 +14 in Samoa: two hours.
    expect(
      daysSpanned(Date.UTC(2011, 11, 30, 9), Date.UTC(2011, 11, 30, 11), "Pacific/Apia"),
    ).toEqual(["2011-12-29", "2011-12-31"]);
  });

  it("rejects an interval ending before it starts", () => {
    expect(() => daysSpanned(2, 1, paris)).toThrow(/ends before it starts/);
  });
});

describe("truncateToPrecision / dayOfEntry", () => {
  // 2019-03-14 15:30 in Paris (+01).
  const instant = Date.UTC(2019, 2, 14, 14, 30);
  const paris = "Europe/Paris";

  it("truncates to the start of the day, month, or year in the zone", () => {
    expect(truncateToPrecision(instant, "instant", paris)).toBe(instant);
    expect(truncateToPrecision(instant, "day", paris)).toBe(Date.UTC(2019, 2, 13, 23));
    expect(truncateToPrecision(instant, "month", paris)).toBe(Date.UTC(2019, 1, 28, 23));
    expect(truncateToPrecision(instant, "year", paris)).toBe(Date.UTC(2018, 11, 31, 23));
  });

  it("truncates in the zone's date, not the UTC date", () => {
    // 2019-12-31 20:00Z is already 2020-01-01 01:30 in Kolkata.
    expect(truncateToPrecision(Date.UTC(2019, 11, 31, 20), "year", "Asia/Kolkata")).toBe(
      Date.UTC(2019, 11, 31, 18, 30),
    );
  });

  it("assigns instant and day entries to a day, and month and year entries to none", () => {
    expect(dayOfEntry(instant, "instant", paris)).toBe("2019-03-14");
    expect(dayOfEntry(Date.UTC(2019, 2, 13, 23), "day", paris)).toBe("2019-03-14");
    expect(dayOfEntry(Date.UTC(2019, 1, 28, 23), "month", paris)).toBeNull();
    expect(dayOfEntry(Date.UTC(2018, 11, 31, 23), "year", paris)).toBeNull();
  });
});
