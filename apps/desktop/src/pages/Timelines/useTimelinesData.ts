import { queryKeys } from "@lib/queryKeys";
import { type Database, listCategories, listIntervals, listTimelines } from "@spoor/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

/** Every timeline by name, archived included. */
export function useTimelineList(db: Database) {
  return useQuery({ queryKey: queryKeys.timelines.list, queryFn: () => listTimelines(db) });
}

/** A timeline's categories and intervals, archived categories included. */
export function useTimelineDetail(db: Database, timelineId: string) {
  const categories = useQuery({
    queryKey: queryKeys.timelines.categories(timelineId),
    queryFn: () => listCategories(db, timelineId),
  });
  const intervals = useQuery({
    queryKey: queryKeys.timelines.timelineIntervals(timelineId),
    queryFn: () => listIntervals(db, timelineId),
  });
  return { categories, intervals };
}

/**
 * Runs one of the page's writes, then invalidates `timelines.all`. Any of them
 * can change what the grid shows (archiving hides a timeline; deleting a
 * timeline or category deletes its intervals), and none touches another
 * group, so that one prefix refreshes this page and Home alike. The delete
 * dialog's preview read runs through it too, so its errors show the same way;
 * invalidating after it only refetches what is on screen.
 */
export function useTimelinesWrite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (write: () => Promise<unknown>) => write(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.timelines.all }),
  });
}
