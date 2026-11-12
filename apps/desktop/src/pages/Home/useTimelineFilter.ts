import { useState } from "react";
import type { HiddenTimelines } from "./timelineVisibility";

/**
 * Which of the grid's timelines are hidden. It lives in the grid for now, so it
 * resets when Home is left. Keeping it across visits or restarts would only
 * change this hook.
 */
export function useTimelineFilter() {
  return useState<HiddenTimelines>(() => new Set());
}
