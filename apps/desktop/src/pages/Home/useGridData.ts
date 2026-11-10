import {
  addDays,
  type Database,
  getTimeZone,
  type LocalDate,
  listCategories,
  listIntervalsInRange,
  listTimelines,
  startOfDay,
  type Timeline,
  type TimelineCategory,
  type TimelineInterval,
} from "@spoor/core";
import { useEffect, useState } from "react";

interface GridMeta {
  /** The zone the grid's days are counted in (the `time_zone` setting). */
  timeZone: string;
  /** The timelines shown, one sub-column each: the unarchived ones, by name. */
  timelines: Timeline[];
  /** The shown timelines' categories by id, archived included (old intervals use them). */
  categories: Map<string, TimelineCategory>;
}

export type GridData =
  | { status: "loading" }
  | { status: "error"; error: string }
  | ({ status: "ready"; intervals: TimelineInterval[] } & GridMeta);

/**
 * What the timeline grid draws for `days`, a run of consecutive dates.
 *
 * Timelines, categories and the zone load once per mount. Home remounts when
 * the user comes back from another page, so edits made there show up. The
 * intervals reload whenever the window moves. Until the new ones arrive, the
 * previous ones stay on screen, so paging doesn't flash empty.
 */
export function useGridData(db: Database, days: readonly LocalDate[]): GridData {
  const [meta, setMeta] = useState<GridMeta | null>(null);
  const [intervals, setIntervals] = useState<TimelineInterval[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const timeZone = await getTimeZone(db);
      const timelines = (await listTimelines(db)).filter((t) => t.archivedAt === null);
      const categories = new Map<string, TimelineCategory>();
      // One at a time: every query shares one connection.
      for (const timeline of timelines) {
        for (const category of await listCategories(db, timeline.id)) {
          categories.set(category.id, category);
        }
      }
      return { timeZone, timelines, categories };
    })()
      .then((loaded) => !cancelled && setMeta(loaded))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [db]);

  const first = days[0];
  const last = days.at(-1);
  useEffect(() => {
    if (!meta || first === undefined || last === undefined) return;
    let cancelled = false;
    const range = {
      from: startOfDay(first, meta.timeZone),
      to: startOfDay(addDays(last, 1), meta.timeZone),
    };
    listIntervalsInRange(
      db,
      meta.timelines.map((t) => t.id),
      range,
    )
      .then((loaded) => {
        if (cancelled) return;
        setIntervals(loaded);
        // A good fetch clears an earlier one's error, so paging away recovers.
        setError(null);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [db, meta, first, last]);

  if (error !== null) return { status: "error", error };
  if (!meta || !intervals) return { status: "loading" };
  return { status: "ready", intervals, ...meta };
}
