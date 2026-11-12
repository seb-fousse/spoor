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
