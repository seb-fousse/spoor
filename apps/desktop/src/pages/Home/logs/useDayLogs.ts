import { queryKeys } from "@lib/queryKeys";
import { type Database, type LocalDate, listDayLogEntries } from "@spoor/core";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

/**
 * The rail's logs for `day`: its top-level entries by log type, with child
 * entries nested. While another day loads, the previous day's stay
 * (`isPlaceholderData` is then true). Creating an entry invalidates them.
 */
export function useDayLogs(db: Database, day: LocalDate) {
  return useQuery({
    queryKey: queryKeys.logs.day(day),
    queryFn: () => listDayLogEntries(db, day),
    placeholderData: keepPreviousData,
  });
}
