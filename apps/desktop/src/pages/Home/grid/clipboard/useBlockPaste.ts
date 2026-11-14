import type {
  Database,
  Instant,
  LocalDate,
  Timeline,
  TimelineCategory,
  TimelineInterval,
} from "@spoor/core";
import { useRef } from "react";
import { useCreateInterval } from "../data/useIntervalWrites";
import { type DrawnRange, daysWindow } from "../layout/dragRange";
import { type BlockCopy, type PasteTarget, pasteTarget } from "./blockCopy";
import type { PastePoint } from "./usePasteMenu";

interface BlockPasteOptions {
  db: Database;
  /** The copied block, or `null` until one is copied. */
  copied: BlockCopy | null;
  /** The timelines shown; a paste on a hidden one is refused. */
  timelines: readonly Timeline[];
  intervals: readonly TimelineInterval[];
  categories: Map<string, TimelineCategory>;
  days: readonly LocalDate[];
  timeZone: string;
  now: Instant;
  /** Runs the write, showing a failure above the grid. */
  run: (action: () => Promise<unknown>) => void;
}

/**
 * Pasting the copied block on the grid, from the paste menu or the paste key.
 *
 * Pastes still being saved count as blocks until the grid has refetched with
 * them, so pasting again right away lands clear of them rather than on top.
 */
export function useBlockPaste({
  db,
  copied,
  timelines,
  intervals,
  categories,
  days,
  timeZone,
  now,
  run,
}: BlockPasteOptions) {
  const write = useCreateInterval(db);
  const inFlight = useRef<TimelineInterval[]>([]);
  const count = useRef(0);
  const visible = daysWindow(days, timeZone);

  /** Where pasting the copy at `point` lands, or why it can't. */
  const targetAt = (point: PastePoint): PasteTarget => {
    const timeline = timelines.find((t) => t.id === point.timelineId);
    if (!timeline) return { reason: "This timeline is hidden" };
    return pasteTarget(copied, point.timelineId, point.at, {
      intervals: [...intervals, ...inFlight.current],
      timeline,
      category: copied ? categories.get(copied.categoryId) : undefined,
      window: visible,
    });
  };

  /** Records the copy over `range`, a target from `targetAt`. */
  const paste = (range: DrawnRange) => {
    if (!copied) return;
    const { timelineId, categoryId } = copied;
    count.current += 1;
    const pending: TimelineInterval = {
      id: `paste-${count.current}`,
      timelineId,
      categoryId,
      ...range,
      timeZone,
      createdAt: now,
      updatedAt: now,
    };
    inFlight.current = [...inFlight.current, pending];
    run(() =>
      write.mutateAsync({ ...range, timelineId, categoryId }).finally(() => {
        inFlight.current = inFlight.current.filter((i) => i !== pending);
      }),
    );
  };

  return { targetAt, paste };
}
