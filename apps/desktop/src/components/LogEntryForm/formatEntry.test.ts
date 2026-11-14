import type { LogEntry, LogField } from "@spoor/core";
import { describe, expect, it } from "vitest";
import { describeValues } from "./formatEntry";

const NOON = Date.UTC(2026, 10, 14, 12);

const startedAt: LogField = {
  id: "started",
  typeId: "nap",
  name: "Started",
  position: 0,
  optionLabels: {},
  shape: { valueType: "datetime", constraints: {} },
  required: false,
  createdAt: NOON,
  updatedAt: NOON,
};

// 20:00 UTC is the next morning in Tokyo and the same afternoon in New York.
const entry = {
  id: "entry",
  logTypeId: "nap",
  values: { started: Date.UTC(2026, 10, 14, 20) },
} as Partial<LogEntry> as LogEntry;

describe("describeValues", () => {
  it("shows a datetime value in the given zone, not the device's", () => {
    const show = (timeZone: string) =>
      describeValues([startedAt], entry, new Map(), timeZone, "en-GB");
    expect(show("Asia/Tokyo")).toBe("Started: 15 Nov 2026, 05:00");
    expect(show("America/New_York")).toBe("Started: 14 Nov 2026, 15:00");
  });
});
