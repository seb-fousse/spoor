import { queryKeys } from "@lib/queryKeys";
import { createCategory, createInterval, type Database } from "@spoor/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { DrawnRange } from "./dragRange";

/** A drawn block to record: in an existing category, or a new one named `newCategory`. */
export type NewBlock = DrawnRange & { timelineId: string } & (
    | { categoryId: string }
    | { newCategory: string }
  );

/**
 * Records a drawn block, creating its category first when it is new. Core
 * rejects an overlap conflict, and nothing is written then. Success refetches
 * the grid, so the block and any new category show up.
 */
export function useCreateInterval(db: Database) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (block: NewBlock) => {
      const categoryId =
        "categoryId" in block
          ? block.categoryId
          : (await createCategory(db, block.timelineId, { name: block.newCategory })).id;
      return createInterval(db, { categoryId, startAt: block.startAt, endAt: block.endAt });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.timelines.all }),
  });
}
