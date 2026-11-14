import { useDatabase } from "@platform/DatabaseProvider";
import { type Database, getTimeZone } from "@spoor/core";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { queryKeys } from "./queryKeys";

export const settingsQueries = {
  timeZone: (db: Database) =>
    queryOptions({ queryKey: queryKeys.timeZone, queryFn: () => getTimeZone(db) }),
};

/** The `time_zone` setting, the zone the app counts its days in. */
export function useTimeZone() {
  const db = useDatabase();
  return useQuery(settingsQueries.timeZone(db));
}
