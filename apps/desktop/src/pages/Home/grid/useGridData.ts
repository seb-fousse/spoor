import type { ReadResult } from "@data/readResult";
import { useTimeZone } from "@data/settings";
import { type GridMeta, useGridIntervals, useGridMeta } from "@data/timelines";
import type { LocalDate, TimelineInterval } from "@spoor/core";

/** What the timeline grid draws. */
export type GridView = GridMeta & {
  /** The zone the grid's days are counted in (the `time_zone` setting). */
  timeZone: string;
  intervals: TimelineInterval[];
};

/**
 * What the timeline grid draws for `days`, a run of consecutive dates: its
 * reads combined, pending until all three load and failed if any fails.
 *
 * The zone, timelines and categories stay cached across visits to Home:
 * nothing sets the zone yet, and every write that changes timelines,
 * categories or intervals (the Timelines and Things pages', and blocks drawn
 * on the grid) invalidates `timelines.all`, which reloads them. The intervals
 * reload whenever the window moves. Until the new ones arrive, the previous
 * ones stay on screen (`isPlaceholderData`), so paging doesn't flash empty.
 */
export function useGridData(days: readonly LocalDate[]): ReadResult<GridView> {
  const timeZone = useTimeZone();
  const meta = useGridMeta();

  const zone = timeZone.data;
  const timelineIds = meta.data?.timelines.map((t) => t.id);
  const intervals = useGridIntervals(timelineIds, days, zone);

  const error = timeZone.error ?? meta.error ?? intervals.error;
  if (error) return { status: "error", data: undefined, error, isPlaceholderData: false };
  if (zone === undefined || !meta.data || !intervals.data) {
    return { status: "pending", data: undefined, error: null, isPlaceholderData: false };
  }
  return {
    status: "success",
    data: { timeZone: zone, intervals: intervals.data, ...meta.data },
    error: null,
    isPlaceholderData: intervals.isPlaceholderData,
  };
}
