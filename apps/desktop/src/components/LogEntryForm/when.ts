import type { Precision } from "@spoor/core";
import dayjs from "dayjs";

/** A log entry is on a day, with no time of day (the timeline is for times). */
export interface EntryDay {
  occurredAt: number;
  endedAt: null;
  precision: Precision;
}

/**
 * The time to store for an entry on `day` ("YYYY-MM-DD"): noon of that day, with
 * day precision. Core keeps the start of the day in its own time zone, and noon
 * is the instant least likely to fall on another date in any zone near the device's.
 */
export function dayToTime(day: string): EntryDay {
  return { occurredAt: dayjs(`${day} 12:00:00`).valueOf(), endedAt: null, precision: "day" };
}
