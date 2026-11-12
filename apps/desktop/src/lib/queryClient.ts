import { QueryClient } from "@tanstack/react-query";

/**
 * The app's query cache. Every query so far reads the local database, so the
 * defaults suit local data rather than a server:
 *
 * - `networkMode: "always"`: the database works offline, so queries never
 *   pause waiting for a network.
 * - No retries: a failed SQLite query fails the same way the second time.
 * - No refetch on focus or reconnect: neither changes local data.
 *
 * `staleTime` stays at 0, so a query refetches whenever a component using it
 * mounts, showing the cached data meanwhile. Pages that don't use queries yet
 * write without invalidating, so this is how their edits reach Home. Once
 * every write invalidates what it changes, `["db"]` queries can use
 * `staleTime: Infinity`. Remote API queries, when they come, should get their
 * own defaults with `setQueryDefaults` on their key prefix.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        networkMode: "always",
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
      mutations: {
        networkMode: "always",
        retry: false,
      },
    },
  });
}
