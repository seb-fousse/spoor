/**
 * Example: a data domain file, with one read factory, one read hook and one write.
 * Illustrates docs/conventions/data.md. Nothing imports it; typecheck, lint and test
 * check it like the app's own src/data/<domain>.ts files, which it stands in for.
 *
 * In src/data/ a domain file imports its siblings by relative path (./queryKeys,
 * ./useDbWrite); from here it reaches them through the @data alias.
 */
import { queryKeys } from "@data/queryKeys";
import { useDbWrite } from "@data/useDbWrite";
import { useDatabase } from "@platform/DatabaseProvider";
import { type Database, listMetrics, updateMetric } from "@spoor/core";
import { queryOptions, useQuery } from "@tanstack/react-query";

/**
 * The domain's reads, as `queryOptions` factories. Each keeps its key, from
 * `queryKeys`, with its query, so `.queryKey` types the cache by its data:
 * `queryClient.getQueryData(metricQueries.list(db).queryKey)` is an
 * `ObservationMetric[] | undefined`, with no generic written by hand.
 */
export const metricQueries = {
  /** Every metric, archived included, by name. */
  list: (db: Database) =>
    queryOptions({ queryKey: queryKeys.observations.metrics, queryFn: () => listMetrics(db) }),
};

/**
 * A read hook runs one factory and returns TanStack's `UseQueryResult`, with its
 * data type inferred from core. It substitutes no fallback for missing data: a
 * caller that needs a stable empty value uses a shared constant.
 */
export function useMetricList() {
  const db = useDatabase();
  return useQuery(metricQueries.list(db));
}

/**
 * A write hook: one per write, a short wrapper around `useDbWrite`, which hands it
 * the database and returns the mutation (`mutateAsync`, `isPending`, `error`,
 * `reset`). It lists what it invalidates, from `queryKeys`: a metric's name also
 * shows in Home's rail, so the whole `observations.all` prefix.
 */
export function useRenameMetric() {
  return useDbWrite(
    (db, { id, name }: { id: string; name: string }) => updateMetric(db, id, { name }),
    { invalidates: [queryKeys.observations.all] },
  );
}
