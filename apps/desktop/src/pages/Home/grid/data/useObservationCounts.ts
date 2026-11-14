import { queryKeys } from "@lib/queryKeys";
import { useDatabase } from "@platform/DatabaseProvider";
import { countDayObservations, type DayObservationCount, type LocalDate } from "@spoor/core";
import { keepPreviousData, skipToken, useQuery } from "@tanstack/react-query";

const NO_COUNTS: ReadonlyMap<LocalDate, DayObservationCount> = new Map();

/**
 * Each of `days`' observation counts by date, for the grid's day badges.
 *
 * They reload when the window moves, and whenever a value recorded in the
 * rail invalidates them. Until the new counts arrive the previous ones stay,
 * so badges don't flash. If loading fails the badges are hidden rather than
 * left showing old counts.
 */
export function useObservationCounts(
  days: readonly LocalDate[],
): ReadonlyMap<LocalDate, DayObservationCount> {
  const db = useDatabase();
  const first = days[0];
  const last = days.at(-1);
  const { data, error } = useQuery({
    queryKey: queryKeys.observations.counts(first, last),
    queryFn:
      first !== undefined && last !== undefined
        ? async (): Promise<ReadonlyMap<LocalDate, DayObservationCount>> => {
            const loaded = await countDayObservations(db, first, last);
            return new Map(loaded.map((c) => [c.date, c]));
          }
        : skipToken,
    placeholderData: keepPreviousData,
  });
  return error ? NO_COUNTS : (data ?? NO_COUNTS);
}
