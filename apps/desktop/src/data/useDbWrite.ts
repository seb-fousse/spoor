import { useDatabase } from "@platform/DatabaseProvider";
import type { Database } from "@spoor/core";
import {
  type QueryClient,
  type QueryKey,
  type UseMutationResult,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";

/**
 * A write through core. Once it succeeds, its `update` runs, then its
 * `invalidates` refetch, and only then does the mutation settle.
 *
 * Every write hook is a short wrapper around it, one per write, returning the
 * mutation, so callers get its `isPending`, `error` and `reset` too. Waiting
 * for the refetch costs little, as the database is local, and it means a
 * caller that awaits the write, or watches `isPending`, sees the new data
 * once it settles: the grid's blocks don't flicker back to where they were.
 * A failed write invalidates nothing, since core rolled it back.
 */
export function useDbWrite<Vars, Result>(
  write: (db: Database, vars: Vars) => Promise<Result>,
  options: {
    /** Keys from `queryKeys`, fixed or derived from the write. */
    invalidates: readonly QueryKey[] | ((result: Result, vars: Vars) => readonly QueryKey[]);
    /** Cache writes made before invalidating, for when the write returns the stored record. */
    update?: (queryClient: QueryClient, result: Result, vars: Vars) => void;
  },
): UseMutationResult<Result, Error, Vars> {
  const db = useDatabase();
  const queryClient = useQueryClient();
  const { invalidates, update } = options;
  return useMutation({
    mutationFn: (vars: Vars) => write(db, vars),
    onSuccess: (result, vars) => {
      update?.(queryClient, result, vars);
      const keys = typeof invalidates === "function" ? invalidates(result, vars) : invalidates;
      // Returned, so the mutation settles only once the shown queries have refetched.
      return Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
    },
  });
}
