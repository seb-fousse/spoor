/**
 * What a read shows: the part of TanStack Query's `UseQueryResult` that
 * components use, as the same discriminated union. A hook that runs one query
 * returns the `UseQueryResult` itself, which is assignable to this; a hook
 * that combines several, like Home's `useGridData`, returns this. Either way,
 * a component such as the rail's `RailPanel` takes the one shape.
 *
 * - `pending`: nothing has loaded yet, and nothing has failed.
 * - `error`: the read failed. `data` is what loaded before, if anything did.
 * - `success`: `data` has loaded. `isPlaceholderData` is true while it is
 *   another read's, kept on screen (`keepPreviousData`) until this one's loads.
 */
export type ReadResult<T> =
  | { status: "pending"; data: undefined; error: null; isPlaceholderData: false }
  | { status: "error"; data: T | undefined; error: Error; isPlaceholderData: false }
  | { status: "success"; data: T; error: null; isPlaceholderData: boolean };

/**
 * The options of a read hook that has to wait, such as `useLogTypes`. Reads
 * run by default; with `enabled: false` the read holds off, `pending`, until
 * it is true.
 */
export interface ReadOptions {
  enabled?: boolean;
}
