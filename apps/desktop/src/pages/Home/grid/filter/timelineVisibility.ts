import type { Timeline } from "@spoor/core";

/**
 * The grid's timeline filter keeps the ids of the timelines that are hidden,
 * not the shown ones. Nothing hidden is the default, so a timeline created
 * later shows up on its own, and an id whose timeline is gone does no harm.
 */
export type HiddenTimelines = ReadonlySet<string>;

/** The timelines that aren't hidden, in their order. */
export function visibleTimelines(timelines: Timeline[], hidden: HiddenTimelines): Timeline[] {
  return timelines.filter((t) => !hidden.has(t.id));
}

/** `hidden` with the timeline `id` shown if it was hidden, or hidden if it was shown. */
export function toggleTimeline(hidden: HiddenTimelines, id: string): HiddenTimelines {
  const next = new Set(hidden);
  if (!next.delete(id)) next.add(id);
  return next;
}
