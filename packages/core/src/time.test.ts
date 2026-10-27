import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addDays,
  compareLocalDates,
  instantToIso,
  isInstant,
  isLocalDate,
  isoToInstant,
  now,
} from "./time";

afterEach(() => {
  vi.useRealTimers();
});

describe("now", () => {
  it("returns the current epoch milliseconds", () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 9, 24, 18));
    expect(now()).toBe(Date.UTC(2026, 9, 24, 18));
    expect(isInstant(now())).toBe(true);
  });
});

describe("isInstant", () => {
  it("accepts safe integers, including before the epoch", () => {
    expect(isInstant(0)).toBe(true);
    expect(isInstant(1_793_037_600_000)).toBe(true);
    expect(isInstant(-1)).toBe(true);
  });

  it("rejects fractions, non-finite and non-numbers", () => {
    expect(isInstant(1.5)).toBe(false);
    expect(isInstant(Number.NaN)).toBe(false);
    expect(isInstant(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isInstant(2 ** 53)).toBe(false);
    expect(isInstant("0")).toBe(false);
    expect(isInstant(null)).toBe(false);
  });
});

describe("instantToIso / isoToInstant", () => {
  it("formats the exact export form", () => {
    expect(instantToIso(Date.UTC(2026, 9, 24, 18))).toBe("2026-10-24T18:00:00.000Z");
    expect(instantToIso(0)).toBe("1970-01-01T00:00:00.000Z");
  });

  it("round-trips", () => {
    for (const iso of [
      "2026-10-24T18:00:00.000Z",
      "1969-12-31T23:59:59.999Z",
      "2024-02-29T12:34:56.789Z",
      "0000-01-01T00:00:00.000Z",
      "9999-12-31T23:59:59.999Z",
    ]) {
      expect(instantToIso(isoToInstant(iso))).toBe(iso);
    }
  });

  it("refuses instants it cannot write in the export form", () => {
    expect(() => instantToIso(1.5)).toThrow();
    expect(() => instantToIso(Number.NaN)).toThrow();
    expect(() => instantToIso(253_402_300_800_000)).toThrow(); // year 10000
  });

  it("rejects anything but YYYY-MM-DDTHH:mm:ss.sssZ, naming the value", () => {
    for (const bad of [
      "2026-10-24T18:00:00Z",
      "2026-10-24T18:00:00.000+00:00",
      "2026-10-24T20:00:00.000+02:00",
      "2026-10-24T18:00:00.000",
      "2026-10-24 18:00:00.000Z",
      "2026-10-24t18:00:00.000z",
      "2026-10-24",
      "2026-02-30T00:00:00.000Z",
      "2026-13-01T00:00:00.000Z",
      "2026-10-24T24:00:00.000Z",
      "2026-10-24T18:60:00.000Z",
      "+002026-10-24T18:00:00.000Z",
      "",
    ]) {
      expect(() => isoToInstant(bad)).toThrow(JSON.stringify(bad));
    }
  });
});

describe("isLocalDate", () => {
  it("accepts real calendar dates", () => {
    expect(isLocalDate("2026-10-24")).toBe(true);
    expect(isLocalDate("2024-02-29")).toBe(true);
    expect(isLocalDate("2000-02-29")).toBe(true);
    expect(isLocalDate("2026-12-31")).toBe(true);
  });

  it("rejects impossible dates, including non-leap Feb 29", () => {
    expect(isLocalDate("2025-02-29")).toBe(false);
    expect(isLocalDate("1900-02-29")).toBe(false);
    expect(isLocalDate("2026-02-30")).toBe(false);
    expect(isLocalDate("2026-04-31")).toBe(false);
    expect(isLocalDate("2026-13-01")).toBe(false);
    expect(isLocalDate("2026-00-10")).toBe(false);
    expect(isLocalDate("2026-10-00")).toBe(false);
  });

  it("rejects other shapes and non-strings", () => {
    expect(isLocalDate("2026-1-24")).toBe(false);
    expect(isLocalDate("2026-10-24T00:00:00.000Z")).toBe(false);
    expect(isLocalDate("20261024")).toBe(false);
    expect(isLocalDate(" 2026-10-24")).toBe(false);
    expect(isLocalDate(20261024)).toBe(false);
    expect(isLocalDate(null)).toBe(false);
  });
});

describe("addDays", () => {
  it("crosses month, year and leap-day boundaries", () => {
    expect(addDays("2026-10-24", 0)).toBe("2026-10-24");
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2025-02-28", 1)).toBe("2025-03-01");
    expect(addDays("2024-01-01", 366)).toBe("2025-01-01");
  });

  it("goes backwards for negative counts", () => {
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
    expect(addDays("2024-03-01", -1)).toBe("2024-02-29");
    expect(addDays("2026-03-29", -365)).toBe("2025-03-29");
  });

  it("is unaffected by DST transitions", () => {
    expect(addDays("2026-03-28", 1)).toBe("2026-03-29");
    expect(addDays("2026-10-25", 1)).toBe("2026-10-26");
  });

  it("throws on an invalid date or a fractional count", () => {
    expect(() => addDays("2026-02-30", 1)).toThrow('"2026-02-30"');
    expect(() => addDays("2026-10-24", 1.5)).toThrow();
  });
});

describe("compareLocalDates", () => {
  it("returns -1, 0 or 1 in calendar order", () => {
    expect(compareLocalDates("2026-10-24", "2026-10-25")).toBe(-1);
    expect(compareLocalDates("2026-10-24", "2026-10-24")).toBe(0);
    expect(compareLocalDates("2027-01-01", "2026-12-31")).toBe(1);
  });

  it("works as a sort comparator", () => {
    expect(["2026-10-24", "2025-12-31", "2026-02-01"].sort(compareLocalDates)).toEqual([
      "2025-12-31",
      "2026-02-01",
      "2026-10-24",
    ]);
  });
});
