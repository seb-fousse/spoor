/**
 * The grid's day badges: how much of a day's observations are recorded, as
 * counted by core's `countDayObservations`.
 */

interface Count {
  recorded: number;
  total: number;
}

/** A day with every active metric recorded, some of them, or none. */
export type Completeness = "complete" | "partial" | "empty";

/** How complete the day is, or `null` when there are no metrics to record. */
export function completeness({ recorded, total }: Count): Completeness | null {
  if (total === 0) return null;
  if (recorded >= total) return "complete";
  return recorded === 0 ? "empty" : "partial";
}

/** The badge in words, for screen readers, such as "3 of 7 observations recorded". */
export function completenessLabel({ recorded, total }: Count): string {
  return `${recorded} of ${total} ${total === 1 ? "observation" : "observations"} recorded`;
}
