import type { Database } from "./platform/index";
import { queryBuilder } from "./query";

/**
 * The overlap rule (see docs/data-spec.md § 1. Timelines), checked across every
 * live interval at once: two non-deleted intervals overlap when each starts
 * before the other ends, and an ongoing one never ends. Overlap conflicts on an
 * exclusive timeline, or within one category on a non-exclusive one.
 *
 * Internal to core: not exported from the barrel.
 */
export async function findOverlap(
  db: Database,
  options: {
    /** Only look at this timeline. */
    timelineId?: string;
    /** Treat the timeline as exclusive whatever its flag says. */
    assumeExclusive?: boolean;
  } = {},
): Promise<{ timelineId: string; a: string; b: string } | undefined> {
  let query = queryBuilder(db)
    .selectFrom("timeline_intervals as a")
    .innerJoin("timeline_intervals as b", (join) =>
      join.onRef("b.timeline_id", "=", "a.timeline_id").onRef("b.id", ">", "a.id"),
    )
    .innerJoin("timelines as t", "t.id", "a.timeline_id")
    .select(["a.timeline_id as timelineId", "a.id as a", "b.id as b"])
    .where("a.deleted_at", "is", null)
    .where("b.deleted_at", "is", null)
    .where((eb) => eb.or([eb("a.end_at", "is", null), eb("a.end_at", ">", eb.ref("b.start_at"))]))
    .where((eb) => eb.or([eb("b.end_at", "is", null), eb("b.end_at", ">", eb.ref("a.start_at"))]));
  if (options.timelineId !== undefined)
    query = query.where("a.timeline_id", "=", options.timelineId);
  if (!options.assumeExclusive) {
    query = query.where((eb) =>
      eb.or([eb("t.exclusive", "=", 1), eb("a.category_id", "=", eb.ref("b.category_id"))]),
    );
  }
  return query.limit(1).executeTakeFirst();
}
