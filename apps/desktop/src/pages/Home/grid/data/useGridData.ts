import { useTimeZone } from "@hooks/useTimeZone";
import { queryKeys } from "@lib/queryKeys";
import { useDatabase } from "@platform/DatabaseProvider";
import {
  type Database,
  type LocalDate,
  listCategories,
  listIntervalsInRange,
  listTimelines,
  type Timeline,
  type TimelineCategory,
  type TimelineInterval,
} from "@spoor/core";
import { keepPreviousData, skipToken, useQuery } from "@tanstack/react-query";
import { daysWindow } from "../layout/dragRange";

interface GridMeta {
  /** The timelines shown, one sub-column each: the unarchived ones, by name. */
  timelines: Timeline[];
  /** The shown timelines' categories by id, archived included (old intervals use them). */
  categories: Map<string, TimelineCategory>;
}

export type GridData =
  | { status: "loading" }
  | { status: "error"; error: string }
  | ({
      status: "ready";
      /** The zone the grid's days are counted in (the `time_zone` setting). */
      timeZone: string;
      intervals: TimelineInterval[];
    } & GridMeta);

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
 * What the timeline grid draws for `days`, a run of consecutive dates.
 *
 * The zone, timelines and categories stay cached across visits to Home:
 * nothing sets the zone yet, and every write that changes timelines,
 * categories or intervals (the Timelines and Things pages', and blocks drawn
 * on the grid) invalidates `timelines.all`, which reloads them. The intervals reload whenever the window moves. Until the new ones
 * arrive, the previous ones stay on screen, so paging doesn't flash empty.
 */
export function useGridData(days: readonly LocalDate[]): GridData {
  const db = useDatabase();
  const timeZone = useTimeZone();
  const meta = useQuery({ queryKey: queryKeys.timelines.grid, queryFn: () => loadGridMeta(db) });

  const zone = timeZone.data;
  const timelineIds = meta.data?.timelines.map((t) => t.id);
  const first = days[0];
  const last = days.at(-1);
  const intervals = useQuery({
    queryKey: queryKeys.timelines.intervals(timelineIds ?? [], first, last, zone),
    queryFn:
      zone !== undefined && timelineIds && days.length > 0
        ? () => {
            const { startAt: from, endAt: to } = daysWindow(days, zone);
            return listIntervalsInRange(db, timelineIds, { from, to });
          }
        : skipToken,
    placeholderData: keepPreviousData,
  });

  const error = timeZone.error ?? meta.error ?? intervals.error;
  if (error) return { status: "error", error: error.message };
  if (zone === undefined || !meta.data || !intervals.data) return { status: "loading" };
  return { status: "ready", timeZone: zone, intervals: intervals.data, ...meta.data };
}
