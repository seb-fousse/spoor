import { queryKeys } from "@lib/queryKeys";
import { useDatabase } from "@platform/DatabaseProvider";
import { getTimeZone } from "@spoor/core";
import { useQuery } from "@tanstack/react-query";

/** The `time_zone` setting, the zone the app counts its days in. */
export function useTimeZone() {
  const db = useDatabase();
  return useQuery({ queryKey: queryKeys.timeZone, queryFn: () => getTimeZone(db) });
}
