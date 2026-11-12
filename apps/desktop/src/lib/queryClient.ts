import { QueryClient } from "@tanstack/react-query";

/**
 * The app's query cache. Every query so far reads the local database, so the
 * defaults suit local data rather than a server:
 *
 * - `networkMode: "always"`: the database works offline, so queries never
 *   pause waiting for a network.
 * - No retries: a failed SQLite query fails the same way the second time.
 * - No refetch on focus or reconnect: neither changes local data.
 * - `["db"]` queries never go stale on their own: only the app writes to the
 *   database, and every write invalidates (or sets) the queries whose data it
 *   changes, so a cached result stays right until then. Refetching on each
 *   mount would only redo reads, such as Home's grid on every return to it.
 *
 * A write that skips invalidation now shows stale data until the app
 * restarts, so each write lists what it invalidates beside it. Remote API
 * queries, when they come, should get their own defaults on their own prefix.
 */
export function createQueryClient(): QueryClient {
  const queryClient = new QueryClient({
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
  queryClient.setQueryDefaults(["db"], { staleTime: Infinity });
  return queryClient;
}
