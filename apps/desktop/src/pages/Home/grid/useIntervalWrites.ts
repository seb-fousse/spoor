import { queryKeys } from "@lib/queryKeys";
import {
  createCategory,
  createInterval,
  type Database,
  deleteInterval,
  type Instant,
  splitInterval,
  updateInterval,
} from "@spoor/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { DrawnRange } from "./dragRange";

/**
 * The grid's writes to intervals. Core rejects an overlap conflict, and
 * nothing is written then. Each success refetches the grid before the
 * mutation settles, so `isPending` lasts until the new blocks are drawn and
 * nothing flickers back to where it was.
 */

/** An existing category, or a new one in the timeline named `newCategory`. */
export type CategoryChoice = { categoryId: string } | { newCategory: string };

/** A drawn block to record. */
export type NewBlock = DrawnRange & { timelineId: string } & CategoryChoice;

/** A block's changes: its range, its category, or both. */
export type BlockChange = { id: string; timelineId: string } & (
  | { startAt: Instant; endAt: Instant | null }
  | CategoryChoice
);

async function categoryOf(db: Database, timelineId: string, choice: CategoryChoice) {
  if ("categoryId" in choice) return choice.categoryId;
  return (await createCategory(db, timelineId, { name: choice.newCategory })).id;
}

/**
 * A write to the grid's intervals, which refetches the grid once it succeeds.
 * Each call is its own mutation, with its own pending and error state.
 */
function useGridWrite<Variables, Result>(write: (variables: Variables) => Promise<Result>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: write,
    // Returned, so the mutation settles only once the grid has refetched.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.timelines.all }),
  });
}

/** Records a drawn block, creating its category first when it is new. */
export function useCreateInterval(db: Database) {
  return useGridWrite(async (block: NewBlock) => {
    const categoryId = await categoryOf(db, block.timelineId, block);
    return createInterval(db, { categoryId, startAt: block.startAt, endAt: block.endAt });
  });
}

/** Moves, resizes or recategorizes a block, creating its new category first when it is new. */
export function useUpdateInterval(db: Database) {
  return useGridWrite(async (change: BlockChange) => {
    if ("startAt" in change) {
      return updateInterval(db, change.id, { startAt: change.startAt, endAt: change.endAt });
    }
    const categoryId = await categoryOf(db, change.timelineId, change);
    return updateInterval(db, change.id, { categoryId });
  });
}

/** Deletes a block, for good. */
export function useDeleteInterval(db: Database) {
  return useGridWrite((id: string) => deleteInterval(db, id));
}

/** Cuts a block in two at `at`, both in its category. */
export function useSplitInterval(db: Database) {
  return useGridWrite(({ id, at }: { id: string; at: Instant }) => splitInterval(db, id, at));
}
