import { useDatabase } from "@platform/DatabaseProvider";
import {
  addDays,
  createCategory,
  createInterval,
  type Database,
  deleteInterval,
  type Instant,
  type LocalDate,
  listCategories,
  listIntervals,
  listIntervalsInRange,
  listTimelines,
  splitInterval,
  startOfDay,
  type Timeline,
  type TimelineCategory,
  updateInterval,
} from "@spoor/core";
import { keepPreviousData, queryOptions, skipToken, useQuery } from "@tanstack/react-query";
import { queryKeys } from "./queryKeys";
import { useDbWrite } from "./useDbWrite";

/** What the grid shows of the timelines, before any intervals. */
export interface GridMeta {
  /** The timelines shown, one sub-column each: the unarchived ones, by name. */
  timelines: Timeline[];
  /** The shown timelines' categories by id, archived included (old intervals use them). */
  categories: Map<string, TimelineCategory>;
}

async function loadGridMeta(db: Database): Promise<GridMeta> {
  const timelines = (await listTimelines(db)).filter((t) => t.archivedAt === null);
  const categories = new Map<string, TimelineCategory>();
  // One at a time: every query shares one connection.
  for (const timeline of timelines) {
    for (const category of await listCategories(db, timeline.id)) {
      categories.set(category.id, category);
    }
  }
  return { timelines, categories };
}

/**
 * The timeline reads. Each keeps its key with its query, so `.queryKey` types
 * the cache by its data.
 */
export const timelineQueries = {
  /** Every timeline by name, archived included. */
  list: (db: Database) =>
    queryOptions({ queryKey: queryKeys.timelines.list, queryFn: () => listTimelines(db) }),
  /** A timeline's categories, archived included. */
  categories: (db: Database, timelineId: string) =>
    queryOptions({
      queryKey: queryKeys.timelines.categories(timelineId),
      queryFn: () => listCategories(db, timelineId),
    }),
  /** All of a timeline's intervals. */
  timelineIntervals: (db: Database, timelineId: string) =>
    queryOptions({
      queryKey: queryKeys.timelines.timelineIntervals(timelineId),
      queryFn: () => listIntervals(db, timelineId),
    }),
  /** The unarchived timelines and their categories, for the grid. */
  grid: (db: Database) =>
    queryOptions({ queryKey: queryKeys.timelines.grid, queryFn: () => loadGridMeta(db) }),
  /**
   * The intervals of `timelineIds` across `days`, counted in `timeZone`. Waits
   * until the timelines, the zone and at least one day are known.
   */
  intervals: (
    db: Database,
    timelineIds: readonly string[] | undefined,
    days: readonly LocalDate[],
    timeZone: string | undefined,
  ) => {
    const first = days[0];
    const last = days.at(-1);
    return queryOptions({
      queryKey: queryKeys.timelines.intervals(timelineIds ?? [], first, last, timeZone),
      queryFn:
        timeZone !== undefined && timelineIds && first !== undefined && last !== undefined
          ? () =>
              listIntervalsInRange(db, timelineIds, {
                from: startOfDay(first, timeZone),
                to: startOfDay(addDays(last, 1), timeZone),
              })
          : skipToken,
    });
  },
};

/** Every timeline by name, archived included. */
export function useTimelineList() {
  const db = useDatabase();
  return useQuery(timelineQueries.list(db));
}

/** A timeline's categories, archived included. */
export function useTimelineCategories(timelineId: string) {
  const db = useDatabase();
  return useQuery(timelineQueries.categories(db, timelineId));
}

/** All of a timeline's intervals. */
export function useTimelineIntervals(timelineId: string) {
  const db = useDatabase();
  return useQuery(timelineQueries.timelineIntervals(db, timelineId));
}

/**
 * The grid's timelines and their categories. They stay cached until a write
 * to timelines, categories or intervals invalidates `timelines.all`.
 */
export function useGridMeta() {
  const db = useDatabase();
  return useQuery(timelineQueries.grid(db));
}

/**
 * The intervals of `timelineIds` across `days`, a run of consecutive dates
 * counted in `timeZone`: from the first day's start to the last day's end.
 * Waits until the timelines, the zone and at least one day are known. Until a
 * new window's intervals arrive, the previous ones stay.
 */
export function useGridIntervals(
  timelineIds: readonly string[] | undefined,
  days: readonly LocalDate[],
  timeZone: string | undefined,
) {
  const db = useDatabase();
  return useQuery({
    ...timelineQueries.intervals(db, timelineIds, days, timeZone),
    placeholderData: keepPreviousData,
  });
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
  // The page's writes already hold the database.
  return useDbWrite((_db, write: () => Promise<unknown>) => write(), {
    invalidates: [queryKeys.timelines.all],
  });
}

/**
 * The grid's writes to intervals. Core rejects an overlap conflict, and
 * nothing is written then. Each success refetches the grid, under
 * `timelines.all`, before the mutation settles, so `isPending` lasts until the
 * new blocks are drawn and nothing flickers back to where it was. Each call of
 * a hook is its own mutation, with its own pending and error state.
 */

/** An existing category, or a new one in the timeline named `newCategory`. */
export type CategoryChoice = { categoryId: string } | { newCategory: string };

/** A drawn block to record, over the half-open range `[startAt, endAt)`. */
export type NewBlock = { startAt: Instant; endAt: Instant; timelineId: string } & CategoryChoice;

/** A block's changes: its range, its category, or both. */
export type BlockChange = { id: string; timelineId: string } & (
  | { startAt: Instant; endAt: Instant | null }
  | CategoryChoice
);

async function categoryOf(db: Database, timelineId: string, choice: CategoryChoice) {
  if ("categoryId" in choice) return choice.categoryId;
  return (await createCategory(db, timelineId, { name: choice.newCategory })).id;
}

/** Records a drawn block, creating its category first when it is new. */
export function useCreateInterval() {
  return useDbWrite(
    async (db, block: NewBlock) => {
      const categoryId = await categoryOf(db, block.timelineId, block);
      return createInterval(db, { categoryId, startAt: block.startAt, endAt: block.endAt });
    },
    { invalidates: [queryKeys.timelines.all] },
  );
}

/** Moves, resizes or recategorizes a block, creating its new category first when it is new. */
export function useUpdateInterval() {
  return useDbWrite(
    async (db, change: BlockChange) => {
      if ("startAt" in change) {
        return updateInterval(db, change.id, { startAt: change.startAt, endAt: change.endAt });
      }
      const categoryId = await categoryOf(db, change.timelineId, change);
      return updateInterval(db, change.id, { categoryId });
    },
    { invalidates: [queryKeys.timelines.all] },
  );
}

/** Deletes a block, for good. */
export function useDeleteInterval() {
  return useDbWrite((db, id: string) => deleteInterval(db, id), {
    invalidates: [queryKeys.timelines.all],
  });
}

/** Cuts a block in two at `at`, both in its category. */
export function useSplitInterval() {
  return useDbWrite((db, { id, at }: { id: string; at: Instant }) => splitInterval(db, id, at), {
    invalidates: [queryKeys.timelines.all],
  });
}
