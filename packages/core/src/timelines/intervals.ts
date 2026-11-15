import type { Selectable } from "kysely";
import type { Database } from "../db/platform";
import { queryBuilder } from "../db/query";
import type { DB } from "../db/schema/tables";
import { transaction } from "../db/transaction";
import { isTimeZone } from "../lib/days";
import { isUuid, newId } from "../lib/ids";
import { SpoorError } from "../lib/spoor-error";
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
  if (!isInstant(at)) {
    throw new SpoorError("invalid", `Timeline category ${categoryId}: invalid start ${at}`, {
      entity: "timeline_category",
      id: categoryId,
      field: "at",
    });
  }
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
        throw new SpoorError(
          "conflict",
          `Timeline interval ${interval.id}: ongoing since ${instantToIso(interval.startAt)}, ` +
            `cannot start another at ${instantToIso(at)}`,
          { entity: "timeline_interval", id, field: "at" },
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
    throw new SpoorError("invalid", `Invalid interval range: [${from}, ${to})`, { field: "range" });
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
        throw new SpoorError(
          "invalid",
          `Timeline interval ${id}: category ${categoryId} belongs to another timeline`,
          { entity: "timeline_interval", id, field: "categoryId" },
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
    if (interval.endAt !== null) {
      throw new SpoorError("conflict", `Timeline interval ${id}: not ongoing`, {
        entity: "timeline_interval",
        id,
      });
    }
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

/**
 * Cuts the interval in two at `at`, which must fall strictly inside it: the
 * interval keeps its id and now ends at `at`, and a new one in the same
 * category and zone runs from `at` to where it ended (ongoing if it was).
 * Returns both, earlier first. Together they cover the same time, so the
 * split never overlaps anything.
 *
 * `laterId` gives the new interval that id instead of a fresh one, so a split
 * redone after `joinIntervals` undid it brings back the same two ids. It must
 * be a UUID no interval has.
 */
export async function splitInterval(
  db: Database,
  id: string,
  at: Instant,
  options: { laterId?: string } = {},
): Promise<[TimelineInterval, TimelineInterval]> {
  const laterId = options.laterId ?? newId();
  await transaction(db, async () => {
    const interval = await requireInterval(db, id);
    if (options.laterId !== undefined) await assertNewId(db, laterId, id, "laterId");
    if (
      !isInstant(at) ||
      at <= interval.startAt ||
      (interval.endAt !== null && at >= interval.endAt)
    ) {
      throw new SpoorError(
        "invalid",
        `Timeline interval ${id}: cannot split at ${at}, which is not inside it`,
        { entity: "timeline_interval", id, field: "at" },
      );
    }
    const timeline = await requireTimeline(db, interval.timelineId);
    // Shortened first, so the later piece doesn't overlap it.
    await queryBuilder(db)
      .updateTable("timeline_intervals")
      .set({ end_at: at, updated_at: now() })
      .where("id", "=", id)
      .execute();
    await insertInterval(db, timeline, {
      id: laterId,
      categoryId: interval.categoryId,
      startAt: at,
      endAt: interval.endAt,
      timeZone: interval.timeZone,
    });
  });
  return [
    (await getInterval(db, id)) as TimelineInterval,
    (await getInterval(db, laterId)) as TimelineInterval,
  ];
}

/** Deletes the interval. */
export async function deleteInterval(db: Database, id: string): Promise<void> {
  await transaction(db, async () => {
    await requireInterval(db, id);
    await queryBuilder(db).deleteFrom("timeline_intervals").where("id", "=", id).execute();
  });
}

/**
 * Joins the two intervals a split leaves, or any two like them: `secondId`
 * must start where `firstId` ends, on the same timeline and in the same
 * category. The first keeps its id, category and zone and now runs to where
 * the second ended (ongoing if it was); the second is deleted. Undoes
 * `splitInterval`. Together they cover the same time, so a join never
 * overlaps anything.
 */
export async function joinIntervals(
  db: Database,
  firstId: string,
  secondId: string,
): Promise<TimelineInterval> {
  await transaction(db, async () => {
    const first = await requireInterval(db, firstId);
    const second = await requireInterval(db, secondId);
    const refuse = (problem: string) =>
      new SpoorError(
        "invalid",
        `Timeline interval ${firstId}: cannot join ${secondId}, which ${problem}`,
        { entity: "timeline_interval", id: firstId, field: "secondId" },
      );
    if (second.timelineId !== first.timelineId) throw refuse("is on another timeline");
    if (second.categoryId !== first.categoryId) throw refuse("is in another category");
    if (first.endAt === null || second.startAt !== first.endAt) {
      throw refuse("doesn't start where it ends");
    }
    const timeline = await requireTimeline(db, first.timelineId);
    const q = queryBuilder(db);
    // Deleted first, so an ongoing second doesn't clash with the first reopening.
    await q.deleteFrom("timeline_intervals").where("id", "=", secondId).execute();
    await assertValidInterval(db, timeline, { ...first, endAt: second.endAt });
    await q
      .updateTable("timeline_intervals")
      .set({ end_at: second.endAt, updated_at: now() })
      .where("id", "=", firstId)
      .execute();
  });
  return (await getInterval(db, firstId)) as TimelineInterval;
}

/**
 * Brings back a deleted interval, as `getInterval` returned it: the same id,
 * category, range, zone and `createdAt`, with `updatedAt` now, as for any
 * write. Undoes `deleteInterval`, and redoes an undone `createInterval`
 * keeping its id. Fails like `createInterval` when the category or its
 * timeline is gone or archived, or on any overlap conflict, and when an
 * interval has the id.
 */
export async function restoreInterval(
  db: Database,
  interval: Omit<TimelineInterval, "timelineId" | "updatedAt">,
): Promise<TimelineInterval> {
  const { id, categoryId, startAt, endAt, timeZone, createdAt } = interval;
  if (!isInstant(createdAt)) {
    throw new SpoorError("invalid", `Timeline interval ${id}: invalid created at ${createdAt}`, {
      entity: "timeline_interval",
      id,
      field: "createdAt",
    });
  }
  await transaction(db, async () => {
    await assertNewId(db, id, id, "id");
    const { timeline } = await requireOfferedCategory(db, categoryId);
    await insertInterval(db, timeline, { id, categoryId, startAt, endAt, timeZone }, createdAt);
  });
  return (await getInterval(db, id)) as TimelineInterval;
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

async function insertInterval(
  db: Database,
  timeline: Timeline,
  draft: IntervalDraft,
  createdAt?: Instant,
) {
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
      created_at: createdAt ?? t,
      updated_at: t,
    })
    .execute();
}

async function assertValidInterval(db: Database, timeline: Timeline, draft: IntervalDraft) {
  const invalid = (problem: string, field: string) =>
    new SpoorError("invalid", `Timeline interval ${draft.id}: ${problem}`, {
      entity: "timeline_interval",
      id: draft.id,
      field,
    });
  if (!isInstant(draft.startAt)) throw invalid(`invalid start ${draft.startAt}`, "startAt");
  if (draft.endAt !== null && !isInstant(draft.endAt)) {
    throw invalid(`invalid end ${draft.endAt}`, "endAt");
  }
  if (draft.endAt !== null && draft.endAt <= draft.startAt) {
    throw invalid("must end after it starts", "endAt");
  }
  if (!isTimeZone(draft.timeZone)) {
    throw invalid(`invalid time zone ${JSON.stringify(draft.timeZone)}`, "timeZone");
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
    throw new SpoorError(
      "conflict",
      `Timeline interval ${draft.id}: overlaps interval ${conflict.id}`,
      { entity: "timeline_interval", id: draft.id },
    );
  }
}

/**
 * Fails unless `candidate` is a UUID no interval has. The error names `id`,
 * the interval written, and `field`, the input that gave `candidate`.
 */
async function assertNewId(db: Database, candidate: string, id: string, field: string) {
  if (!isUuid(candidate)) {
    throw new SpoorError("invalid", `Timeline interval ${id}: invalid ${field} ${candidate}`, {
      entity: "timeline_interval",
      id,
      field,
    });
  }
  if (await getInterval(db, candidate)) {
    throw new SpoorError("conflict", `Timeline interval ${candidate}: already exists`, {
      entity: "timeline_interval",
      id,
      field,
    });
  }
}

export async function requireInterval(db: Database, id: string): Promise<TimelineInterval> {
  const interval = await getInterval(db, id);
  if (!interval) {
    throw new SpoorError("not_found", `Timeline interval ${id}: not found`, {
      entity: "timeline_interval",
      id,
    });
  }
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
