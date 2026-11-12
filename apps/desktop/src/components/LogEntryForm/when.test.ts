import dayjs from "dayjs";
import { describe, expect, it } from "vitest";
import { dayToTime } from "./when";

describe("dayToTime", () => {
  it("stores a day at noon, with day precision and no end", () => {
    expect(dayToTime("2026-11-03")).toEqual({
      occurredAt: dayjs("2026-11-03 12:00:00").valueOf(),
      endedAt: null,
      precision: "day",
    });
  });
});
