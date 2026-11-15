import type { LogEntry, LogField } from "@spoor/core";
import { describe, expect, it } from "vitest";
import { describeValues } from "./formatEntry";
import { parseInput } from "./parseInput";

const ZONE = "Europe/Paris";

describe("parseInput", () => {
  it("reads booleans from their select values", () => {
    expect(parseInput("boolean", "true", ZONE)).toBe(true);
    expect(parseInput("boolean", "false", ZONE)).toBe(false);
  });

  it("reads numbers from text", () => {
    expect(parseInput("number", "12.5", ZONE)).toBe(12.5);
  });

  // The device has one zone, so at least one of these differs from it, whichever it is.
  it("reads a datetime picker value in the zone given, not the device's", () => {
    // NZDT is +13 in March, PST -08 and Kolkata +05:30.
    expect(parseInput("datetime", "2026-03-04 09:00:00", "Pacific/Auckland")).toBe(
      Date.UTC(2026, 2, 3, 20),
    );
    expect(parseInput("datetime", "2026-03-04 09:00:00", "America/Los_Angeles")).toBe(
      Date.UTC(2026, 2, 4, 17),
    );
    expect(parseInput("datetime", "2026-03-04 05:06:07", "Asia/Kolkata")).toBe(
      Date.UTC(2026, 2, 3, 23, 36, 7),
    );
  });

  it("shows a typed datetime back at the time it was typed, in the same zone", () => {
    const field = {
      id: "started",
      name: "Started",
      optionLabels: {},
      shape: { valueType: "datetime", constraints: {} },
    } as Partial<LogField> as LogField;
    for (const timeZone of ["Pacific/Auckland", "America/Los_Angeles", "UTC"]) {
      const value = parseInput("datetime", "2026-03-04 09:00:00", timeZone);
      const entry = { values: { started: value } } as Partial<LogEntry> as LogEntry;
      expect(describeValues([field], entry, new Map(), timeZone, "en-GB")).toBe(
        "Started: 4 Mar 2026, 09:00",
      );
    }
  });

  it("passes other inputs through, including multi-ref lists", () => {
    expect(parseInput("text", "hello", ZONE)).toBe("hello");
    expect(parseInput("enum", "a", ZONE)).toBe("a");
    expect(parseInput("multi_ref", ["x", "y"], ZONE)).toEqual(["x", "y"]);
  });
});
