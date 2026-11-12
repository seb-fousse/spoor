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
    /** A log type's entries, latest first, for the Logs page. */
    type: (logTypeId: string) => ["db", "logs", "type", logTypeId] as const,
    /** An entry's child entries, by position. */
    children: (parentEntryId: string) => ["db", "logs", "children", parentEntryId] as const,
    all: ["db", "logs"] as const,
    day: (day: LocalDate) => ["db", "logs", "day", day] as const,
  },

  logTypes: {
    all: ["db", "logTypes"] as const,
    list: ["db", "logTypes", "list"] as const,
    fields: (typeId: string) => ["db", "logTypes", "fields", typeId] as const,
  },

  things: {
    /** Every thing read: thing types, their fields, things and their titles. */
    all: ["db", "things"] as const,
    /** Every thing type, archived ones too. */
    types: ["db", "things", "types"] as const,
    /** A thing type's fields, by position. */
    fields: (typeId: string) => ["db", "things", "fields", typeId] as const,
    /** A thing type's live things, with their values. */
    ofType: (typeId: string) => ["db", "things", "ofType", typeId] as const,
    /** A thing type's live things by title, to pick from. */
    options: (typeId: string) => ["db", "things", "options", typeId] as const,
    /** The titles of a set of things, which follow their values. */
    titles: (ids: readonly string[]) => ["db", "things", "titles", ids] as const,
  },
};
