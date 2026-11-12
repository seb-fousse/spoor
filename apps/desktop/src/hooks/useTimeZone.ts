import { queryKeys } from "@lib/queryKeys";
import { type Database, getTimeZone } from "@spoor/core";
import { useQuery } from "@tanstack/react-query";

/** The `time_zone` setting, the zone the app counts its days in. */
export function useTimeZone(db: Database) {
  return useQuery({ queryKey: queryKeys.timeZone, queryFn: () => getTimeZone(db) });
}
