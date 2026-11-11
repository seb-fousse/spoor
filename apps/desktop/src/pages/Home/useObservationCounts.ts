import {
  countDayObservations,
  type Database,
  type DayObservationCount,
  type LocalDate,
} from "@spoor/core";
import { useEffect, useState } from "react";

/**
 * Each of `days`' observation counts by date, for the grid's day badges.
 *
 * They reload when the window moves and whenever `version` changes, which
 * Home bumps after each value recorded in the rail. Until the new counts
 * arrive the previous ones stay, so badges don't flash. If loading fails the
 * badges are hidden rather than left showing old counts.
 */
export function useObservationCounts(
  db: Database,
  days: readonly LocalDate[],
  version: number,
): ReadonlyMap<LocalDate, DayObservationCount> {
  const [counts, setCounts] = useState<ReadonlyMap<LocalDate, DayObservationCount>>(new Map());

  const first = days[0];
  const last = days.at(-1);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` is the signal to reload.
  useEffect(() => {
    if (first === undefined || last === undefined) return;
    let cancelled = false;
    countDayObservations(db, first, last)
      .then((loaded) => !cancelled && setCounts(new Map(loaded.map((c) => [c.date, c]))))
      .catch(() => !cancelled && setCounts(new Map()));
    return () => {
      cancelled = true;
    };
  }, [db, first, last, version]);

  return counts;
}
