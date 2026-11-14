import { useTimeZone } from "@data/settings";
import { type GridMeta, useGridIntervals, useGridMeta } from "@data/timelines";
import type { LocalDate, TimelineInterval } from "@spoor/core";

export type GridData =
  | { status: "loading" }
  | { status: "error"; error: string }
  | ({
      status: "ready";
      /** The zone the grid's days are counted in (the `time_zone` setting). */
      timeZone: string;
      intervals: TimelineInterval[];
    } & GridMeta);

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
  const timeZone = useTimeZone();
  const meta = useGridMeta();

  const zone = timeZone.data;
  const timelineIds = meta.data?.timelines.map((t) => t.id);
  const intervals = useGridIntervals(timelineIds, days, zone);

  const error = timeZone.error ?? meta.error ?? intervals.error;
  if (error) return { status: "error", error: error.message };
  if (zone === undefined || !meta.data || !intervals.data) return { status: "loading" };
  return { status: "ready", timeZone: zone, intervals: intervals.data, ...meta.data };
}
