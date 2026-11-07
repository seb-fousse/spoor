import type { Selectable } from "kysely";
import type { Database } from "../db/platform";
import { queryBuilder } from "../db/query";
import type { DB } from "../db/schema/tables";
import { transaction } from "../db/transaction";
import { isTimeZone } from "../lib/days";
import { newId } from "../lib/ids";
import { type Instant, instantToIso, isInstant, now } from "../lib/time";
import { getTimeZone } from "../settings/settings";
import { requireOfferedCategory } from "./categories";
import type { Timeline } from "./timelines";
import { requireTimeline } from "./timelines";

/** Timeline intervals (see docs/data-spec.md § 1. Timelines). */

export interface TimelineInterval {
  id: string;
  timelineId: string;
  categoryId: string;
  startAt: Instant;
  /** `null` while ongoing. */
  endAt: Instant | null;
  timeZone: string;
  createdAt: Instant;
  updatedAt: Instant;
}

/** What `deleteTimeline` would delete with the timeline. */
type IntervalRow = Selectable<DB["timeline_intervals"]>;

// ---------------------------------------------------------------------------
// Intervals

/**
 * Starts an ongoing interval in the category at `at` (default: now). An ongoing
 * interval it would overlap (any on an exclusive timeline, the same category's
 * on a non-exclusive one) is first closed at `at`, so a category change closes
 * the current interval and starts another.
 */
export async function startInterval(
  db: Database,
  categoryId: string,
  options: { at?: Instant; timeZone?: string } = {},
): Promise<TimelineInterval> {
  const at = options.at ?? now();
  if (!isInstant(at)) throw new Error(`Timeline category ${categoryId}: invalid start ${at}`);
  const timeZone = options.timeZone ?? (await getTimeZone(db));
  const id = newId();
  await transaction(db, async () => {
    const q = queryBuilder(db);
    const { timeline } = await requireOfferedCategory(db, categoryId);
    let ongoing = q
      .selectFrom("timeline_intervals")
      .selectAll()
      .where("timeline_id", "=", timeline.id)
      .where("end_at", "is", null);
    if (!timeline.exclusive) ongoing = ongoing.where("category_id", "=", categoryId);
    for (const interval of (await ongoing.execute()).map(toInterval)) {
      if (interval.startAt >= at) {
        throw new Error(
          `Timeline interval ${interval.id}: ongoing since ${instantToIso(interval.startAt)}, ` +
            `cannot start another at ${instantToIso(at)}`,
        );
      }
      await q
        .updateTable("timeline_intervals")
        .set({ end_at: at, updated_at: now() })
        .where("id", "=", interval.id)
        .execute();
    }
    await insertInterval(db, timeline, { id, categoryId, startAt: at, endAt: null, timeZone });
  });
  return (await getInterval(db, id)) as TimelineInterval;
}

/** Records an interval, ongoing if `endAt` is `null`. Fails on any overlap conflict. */
export async function createInterval(
  db: Database,
  input: { categoryId: string; startAt: Instant; endAt: Instant | null; timeZone?: string },
): Promise<TimelineInterval> {
  const timeZone = input.timeZone ?? (await getTimeZone(db));
  const id = newId();
  await transaction(db, async () => {
    const { timeline } = await requireOfferedCategory(db, input.categoryId);
    await insertInterval(db, timeline, { ...input, id, timeZone });
  });
  return (await getInterval(db, id)) as TimelineInterval;
}

/** The interval with `id`, or `undefined`. */
export async function getInterval(db: Database, id: string): Promise<TimelineInterval | undefined> {
  const row = await queryBuilder(db)
    .selectFrom("timeline_intervals")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  return row && toInterval(row);
}

/** The timeline's intervals, latest start first. */
export async function listIntervals(db: Database, timelineId: string): Promise<TimelineInterval[]> {
  const rows = await queryBuilder(db)
    .selectFrom("timeline_intervals")
    .selectAll()
    .where("timeline_id", "=", timelineId)
    .orderBy("start_at", "desc")
    .orderBy("id")
    .execute();
  return rows.map(toInterval);
}

/**
 * The intervals of `timelineIds` overlapping the half-open range `[from, to)`,
 * by timeline then start. Ongoing intervals count when they started before
 * `to`. Build the range with `dayRange`/`startOfDay` in the `getTimeZone`
 * zone; splitting intervals at midnight is left to `daysSpanned`.
 */
export async function listIntervalsInRange(
  db: Database,
  timelineIds: readonly string[],
  range: { from: Instant; to: Instant },
): Promise<TimelineInterval[]> {
  const { from, to } = range;
  if (!isInstant(from) || !isInstant(to) || to <= from) {
    throw new Error(`Invalid interval range: [${from}, ${to})`);
  }
  if (timelineIds.length === 0) return [];
  const rows = await queryBuilder(db)
    .selectFrom("timeline_intervals")
    .selectAll()
    .where("timeline_id", "in", [...timelineIds])
    .where("start_at", "<", to)
    .where((eb) => eb.or([eb("end_at", "is", null), eb("end_at", ">", from)]))
    .orderBy("timeline_id")
    .orderBy("start_at")
    .orderBy("id")
    .execute();
  return rows.map(toInterval);
}

/**
 * Changes an interval's category (within its timeline), start, or end
 * (`null` reopens it). Fails on any overlap conflict.
 */
export async function updateInterval(
  db: Database,
  id: string,
  patch: { categoryId?: string; startAt?: Instant; endAt?: Instant | null },
): Promise<TimelineInterval> {
  await transaction(db, async () => {
    const interval = await requireInterval(db, id);
    const categoryId = patch.categoryId ?? interval.categoryId;
    if (categoryId !== interval.categoryId) {
      const { category } = await requireOfferedCategory(db, categoryId);
      if (category.timelineId !== interval.timelineId) {
        throw new Error(
          `Timeline interval ${id}: category ${categoryId} belongs to another timeline`,
        );
      }
    }
    const next = {
      id,
      categoryId,
      startAt: patch.startAt ?? interval.startAt,
      endAt: patch.endAt === undefined ? interval.endAt : patch.endAt,
      timeZone: interval.timeZone,
    };
    const timeline = await requireTimeline(db, interval.timelineId);
    await assertValidInterval(db, timeline, next);
    await queryBuilder(db)
      .updateTable("timeline_intervals")
      .set({
        category_id: next.categoryId,
        start_at: next.startAt,
        end_at: next.endAt,
        updated_at: now(),
      })
      .where("id", "=", id)
      .execute();
  });
  return (await getInterval(db, id)) as TimelineInterval;
}

/** Ends an ongoing interval at `at` (default: now). */
export async function stopInterval(
  db: Database,
  id: string,
  at: Instant = now(),
): Promise<TimelineInterval> {
  await transaction(db, async () => {
    const interval = await requireInterval(db, id);
    if (interval.endAt !== null) throw new Error(`Timeline interval ${id}: not ongoing`);
    const timeline = await requireTimeline(db, interval.timelineId);
    await assertValidInterval(db, timeline, { ...interval, endAt: at });
    await queryBuilder(db)
      .updateTable("timeline_intervals")
      .set({ end_at: at, updated_at: now() })
      .where("id", "=", id)
      .execute();
  });
  return (await getInterval(db, id)) as TimelineInterval;
}

/** Deletes the interval. */
export async function deleteInterval(db: Database, id: string): Promise<void> {
  await transaction(db, async () => {
    await requireInterval(db, id);
    await queryBuilder(db).deleteFrom("timeline_intervals").where("id", "=", id).execute();
  });
}

// ---------------------------------------------------------------------------
// Internals

interface IntervalDraft {
  id: string;
  categoryId: string;
  startAt: Instant;
  endAt: Instant | null;
  timeZone: string;
}

async function insertInterval(db: Database, timeline: Timeline, draft: IntervalDraft) {
  await assertValidInterval(db, timeline, draft);
  const t = now();
  await queryBuilder(db)
    .insertInto("timeline_intervals")
    .values({
      id: draft.id,
      timeline_id: timeline.id,
      category_id: draft.categoryId,
      start_at: draft.startAt,
      end_at: draft.endAt,
      time_zone: draft.timeZone,
      created_at: t,
      updated_at: t,
    })
    .execute();
}

async function assertValidInterval(db: Database, timeline: Timeline, draft: IntervalDraft) {
  const label = `Timeline interval ${draft.id}`;
  if (!isInstant(draft.startAt)) throw new Error(`${label}: invalid start ${draft.startAt}`);
  if (draft.endAt !== null && !isInstant(draft.endAt)) {
    throw new Error(`${label}: invalid end ${draft.endAt}`);
  }
  if (draft.endAt !== null && draft.endAt <= draft.startAt) {
    throw new Error(`${label}: must end after it starts`);
  }
  if (!isTimeZone(draft.timeZone)) {
    throw new Error(`${label}: invalid time zone ${JSON.stringify(draft.timeZone)}`);
  }
  await assertNoOverlap(db, timeline, draft);
}

/**
 * Two intervals overlap when each starts before the other ends; an ongoing one
 * never ends. Overlap conflicts on an exclusive timeline, or within one
 * category on a non-exclusive one.
 */
async function assertNoOverlap(
  db: Database,
  timeline: Timeline,
  draft: Pick<IntervalDraft, "id" | "categoryId" | "startAt" | "endAt">,
) {
  let query = queryBuilder(db)
    .selectFrom("timeline_intervals")
    .select("id")
    .where("timeline_id", "=", timeline.id)
    .where("id", "<>", draft.id)
    .where((eb) => eb.or([eb("end_at", "is", null), eb("end_at", ">", draft.startAt)]));
  if (!timeline.exclusive) query = query.where("category_id", "=", draft.categoryId);
  if (draft.endAt !== null) query = query.where("start_at", "<", draft.endAt);
  const conflict = await query.limit(1).executeTakeFirst();
  if (conflict) {
    throw new Error(`Timeline interval ${draft.id}: overlaps interval ${conflict.id}`);
  }
}

export async function requireInterval(db: Database, id: string): Promise<TimelineInterval> {
  const interval = await getInterval(db, id);
  if (!interval) throw new Error(`Timeline interval ${id}: not found`);
  return interval;
}

function toInterval(row: IntervalRow): TimelineInterval {
  return {
    id: row.id,
    timelineId: row.timeline_id,
    categoryId: row.category_id,
    startAt: row.start_at,
    endAt: row.end_at,
    timeZone: row.time_zone,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
