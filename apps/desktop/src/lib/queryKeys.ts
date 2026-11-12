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
    /** Every metric and observation read: each metric or observation write invalidates it. */
    all: ["db", "observations"] as const,
    /** Every metric, archived included, for the Observations page. */
    metrics: ["db", "observations", "metrics"] as const,
    /** One metric's observations, latest day first. */
    metric: (metricId: string) => ["db", "observations", "metric", metricId] as const,
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
