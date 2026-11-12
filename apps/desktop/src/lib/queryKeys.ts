import type { LocalDate } from "@spoor/core";

/**
 * Every query's key, in one place so reads and invalidations agree.
 *
 * Local database queries start with "db"; remote API queries will get their
 * own prefix. Below that, keys are grouped by what a write changes, so one
 * prefix invalidates everything that depends on it: creating a log entry
 * invalidates `logs.all`. The app has one database, so it isn't in the keys.
 */
export const queryKeys = {
  timeZone: ["db", "settings", "timeZone"] as const,

  timelines: {
    /** Everything below: a write to timelines, categories or intervals invalidates it. */
    all: ["db", "timelines"] as const,
    /** Every timeline, archived included, for the Timelines page. */
    list: ["db", "timelines", "list"] as const,
    /** A timeline's categories, archived included. */
    categories: (timelineId: string) => ["db", "timelines", "categories", timelineId] as const,
    /** All of a timeline's intervals, for the Timelines page. */
    timelineIntervals: (timelineId: string) =>
      ["db", "timelines", "timelineIntervals", timelineId] as const,
    /** The unarchived timelines and their categories, for the grid. */
    grid: ["db", "timelines", "grid"] as const,
    intervals: (
      timelineIds: readonly string[],
      first: LocalDate | undefined,
      last: LocalDate | undefined,
      timeZone: string | undefined,
    ) => ["db", "timelines", "intervals", { timelineIds, first, last, timeZone }] as const,
  },

  observations: {
    day: (day: LocalDate) => ["db", "observations", "day", day] as const,
    countsAll: ["db", "observations", "counts"] as const,
    counts: (first: LocalDate | undefined, last: LocalDate | undefined) =>
      ["db", "observations", "counts", { first, last }] as const,
  },

  logs: {
    all: ["db", "logs"] as const,
    day: (day: LocalDate) => ["db", "logs", "day", day] as const,
  },

  logTypes: {
    all: ["db", "logTypes"] as const,
    list: ["db", "logTypes", "list"] as const,
    fields: (typeId: string) => ["db", "logTypes", "fields", typeId] as const,
  },
};
