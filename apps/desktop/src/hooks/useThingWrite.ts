import { queryKeys } from "@lib/queryKeys";
import { type QueryKey, useMutation, useQueryClient } from "@tanstack/react-query";

/**
 * What a write to thing data changes beyond it, so the screens showing that
 * refresh too:
 *
 * - `"things"`: only thing data: types, fields, things and their titles.
 * - `"titles"`: also timeline categories, which core renames to follow their
 *   thing's title (`updateThingValues`).
 * - `"references"`: also every log entry and timeline category referring to
 *   the things. Deleting a thing removes refs to it from log entries and
 *   unlinks its categories; merging repoints both and moves intervals.
 */
export type ThingWriteReach = "things" | "titles" | "references";

// The timelines keys have no prefix of their own yet; every timeline read starts with this.
const TIMELINES: QueryKey = ["db", "timelines"];

const INVALIDATES: Record<ThingWriteReach, QueryKey[]> = {
  things: [queryKeys.things.all],
  titles: [queryKeys.things.all, TIMELINES],
  references: [queryKeys.things.all, queryKeys.logs.all, TIMELINES],
};

/**
 * Runs a write to thing data, then invalidates what it changed, per `reach`.
 * Resolves or rejects with the write. One mutation serves every write: they
 * differ only in what they invalidate.
 */
export function useThingWrite() {
  const queryClient = useQueryClient();
  const { mutateAsync } = useMutation({
    mutationFn: ({ action }: { action: () => Promise<unknown>; reach: ThingWriteReach }) =>
      action(),
    onSuccess: (_, { reach }) =>
      Promise.all(
        INVALIDATES[reach].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      ),
  });
  return (action: () => Promise<unknown>, reach: ThingWriteReach = "things") =>
    mutateAsync({ action, reach });
}
