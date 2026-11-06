import type { Selectable } from "kysely";
import { isTimeZone } from "./days";
import { optionalText, requireName } from "./guards";
import { newId } from "./ids";
import { findOverlap } from "./overlap";
import type { Database } from "./platform/index";
import { queryBuilder } from "./query";
import type { DB } from "./schema/tables";
import { getTimeZone } from "./settings";
import { getThingTitle } from "./things";
import { type Instant, instantToIso, isInstant, now } from "./time";
import { transaction } from "./transaction";

/**
 * Timelines (see docs/data-spec.md § 1. Timelines): timelines, their
 * categories, and intervals that each select one category.
 *
 * Deleting is permanent: the database deletes what depends on the record (see
 * the migrations), and the `preview*Deletion` functions count it first so the
 * user can confirm. Every write runs in one transaction, so the overlap rule is
 * checked and written atomically.
 */

export interface Timeline {
  id: string;
  name: string;
  description: string | null;
  exclusive: boolean;
  defaultThingTypeId: string | null;
  createdAt: Instant;
  updatedAt: Instant;
  archivedAt: Instant | null;
}

export interface TimelineCategory {
  id: string;
  timelineId: string;
  name: string;
  description: string | null;
  thingId: string | null;
  createdAt: Instant;
  updatedAt: Instant;
  archivedAt: Instant | null;
}

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
export interface TimelineDeletion {
  categories: number;
  intervals: number;
}

type TimelineRow = Selectable<DB["timelines"]>;
type CategoryRow = Selectable<DB["timeline_categories"]>;
type IntervalRow = Selectable<DB["timeline_intervals"]>;

// ---------------------------------------------------------------------------
// Timelines

export async function createTimeline(
  db: Database,
  input: { name: string; description?: string | null; exclusive?: boolean },
): Promise<Timeline> {
  const id = newId();
  const t = now();
  await transaction(db, () =>
    queryBuilder(db)
      .insertInto("timelines")
      .values({
        id,
        name: requireName(`Timeline ${id}`, input.name),
        description: optionalText(input.description),
        exclusive: Number(input.exclusive ?? true),
        created_at: t,
        updated_at: t,
      })
      .execute(),
  );
  return (await getTimeline(db, id)) as Timeline;
}

/** The timeline with `id`, or `undefined`. */
export async function getTimeline(db: Database, id: string): Promise<Timeline | undefined> {
  const row = await queryBuilder(db)
    .selectFrom("timelines")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  return row && toTimeline(row);
}

/** Every timeline by name, archived included. */
export async function listTimelines(db: Database): Promise<Timeline[]> {
  const rows = await queryBuilder(db)
    .selectFrom("timelines")
    .selectAll()
    .orderBy("name", (ob) => ob.collate("nocase"))
    .orderBy("id")
    .execute();
  return rows.map(toTimeline);
}

/**
 * Renames, redescribes, or changes `exclusive`. A timeline can become exclusive
 * only if none of its intervals overlap.
 */
export async function updateTimeline(
  db: Database,
  id: string,
  patch: { name?: string; description?: string | null; exclusive?: boolean },
): Promise<Timeline> {
  await transaction(db, async () => {
    const q = queryBuilder(db);
    const timeline = await requireTimeline(db, id);
    if (patch.exclusive && !timeline.exclusive) {
      const overlap = await findOverlap(db, { timelineId: id, assumeExclusive: true });
      if (overlap) {
        throw new Error(
          `Timeline ${id}: cannot become exclusive, intervals ${overlap.a} and ${overlap.b} overlap`,
        );
      }
    }
    await q
      .updateTable("timelines")
      .set({
        name: patch.name === undefined ? timeline.name : requireName(`Timeline ${id}`, patch.name),
        description:
          patch.description === undefined ? timeline.description : optionalText(patch.description),
        exclusive: Number(patch.exclusive ?? timeline.exclusive),
        updated_at: now(),
      })
      .where("id", "=", id)
      .execute();
  });
  return (await getTimeline(db, id)) as Timeline;
}

/** Archives or unarchives. Archiving stops the timeline and its categories being offered. */
export async function setTimelineArchived(
  db: Database,
  id: string,
  archived: boolean,
): Promise<void> {
  await transaction(db, async () => {
    await requireTimeline(db, id);
    const t = now();
    await queryBuilder(db)
      .updateTable("timelines")
      .set({ archived_at: archived ? t : null, updated_at: t })
      .where("id", "=", id)
      .execute();
  });
}

/** What `deleteTimeline` would delete, for the user to confirm. */
export async function previewTimelineDeletion(db: Database, id: string): Promise<TimelineDeletion> {
  await requireTimeline(db, id);
  const count = async (table: "timeline_categories" | "timeline_intervals") =>
    (
      await queryBuilder(db)
        .selectFrom(table)
        .select((eb) => eb.fn.countAll<number>().as("n"))
        .where("timeline_id", "=", id)
        .executeTakeFirstOrThrow()
    ).n;
  return {
    categories: await count("timeline_categories"),
    intervals: await count("timeline_intervals"),
  };
}

/** Deletes the timeline with its categories and intervals. See `previewTimelineDeletion`. */
export async function deleteTimeline(db: Database, id: string): Promise<void> {
  await transaction(db, async () => {
    await requireTimeline(db, id);
    await queryBuilder(db).deleteFrom("timelines").where("id", "=", id).execute();
  });
}

// ---------------------------------------------------------------------------
// Categories

/**
 * Adds a category, named by `name`, or one representing the thing `thingId`,
 * named by its title. A thing has at most one category per timeline. A linked
 * category's name follows the thing's title (the things repository renames it);
 * deleting the thing unlinks the category, which keeps the last title.
 */
export async function createCategory(
  db: Database,
  timelineId: string,
  input: { name?: string; description?: string | null; thingId?: string | null },
): Promise<TimelineCategory> {
  const id = newId();
  const label = `Timeline category ${id}`;
  const thingId = input.thingId ?? null;
  if (thingId !== null && input.name !== undefined) {
    throw new Error(`${label}: takes its name from thing ${thingId}, so cannot be given one`);
  }
  await transaction(db, async () => {
    const q = queryBuilder(db);
    const timeline = await requireTimeline(db, timelineId);
    if (timeline.archivedAt !== null) {
      throw new Error(`Timeline ${timelineId}: archived, cannot add categories`);
    }
    let name: string;
    if (thingId === null) {
      name = requireName(label, input.name ?? "");
    } else {
      const title = await getThingTitle(db, thingId);
      if (title === undefined) throw new Error(`Thing ${thingId}: not found`);
      name = title;
      // Backed by a partial unique index; checked first for a clear error.
      const existing = await q
        .selectFrom("timeline_categories")
        .select("id")
        .where("timeline_id", "=", timelineId)
        .where("thing_id", "=", thingId)
        .executeTakeFirst();
      if (existing) {
        throw new Error(
          `Thing ${thingId}: already has category ${existing.id} on timeline ${timelineId}`,
        );
      }
    }
    const t = now();
    await q
      .insertInto("timeline_categories")
      .values({
        id,
        timeline_id: timelineId,
        name,
        description: optionalText(input.description),
        thing_id: thingId,
        created_at: t,
        updated_at: t,
      })
      .execute();
  });
  return (await getCategory(db, id)) as TimelineCategory;
}

/** The category with `id`, or `undefined`. */
export async function getCategory(db: Database, id: string): Promise<TimelineCategory | undefined> {
  const row = await queryBuilder(db)
    .selectFrom("timeline_categories")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  return row && toCategory(row);
}

/** The timeline's categories by name, archived included. */
export async function listCategories(
  db: Database,
  timelineId: string,
): Promise<TimelineCategory[]> {
  const rows = await queryBuilder(db)
    .selectFrom("timeline_categories")
    .selectAll()
    .where("timeline_id", "=", timelineId)
    .orderBy("name", (ob) => ob.collate("nocase"))
    .orderBy("id")
    .execute();
  return rows.map(toCategory);
}

/**
 * Renames or redescribes. Intervals refer to the category by id, so their
 * meaning is kept. A category linked to a thing takes its name from the thing,
 * so cannot be renamed.
 */
export async function updateCategory(
  db: Database,
  id: string,
  patch: { name?: string; description?: string | null },
): Promise<TimelineCategory> {
  await transaction(db, async () => {
    const category = await requireCategory(db, id);
    if (patch.name !== undefined && category.thingId !== null) {
      throw new Error(
        `Timeline category ${id}: takes its name from thing ${category.thingId}, so cannot be renamed`,
      );
    }
    await queryBuilder(db)
      .updateTable("timeline_categories")
      .set({
        name:
          patch.name === undefined
            ? category.name
            : requireName(`Timeline category ${id}`, patch.name),
        description:
          patch.description === undefined ? category.description : optionalText(patch.description),
        updated_at: now(),
      })
      .where("id", "=", id)
      .execute();
  });
  return (await getCategory(db, id)) as TimelineCategory;
}

/** Archives or unarchives. An archived category is not offered for new intervals. */
export async function setCategoryArchived(
  db: Database,
  id: string,
  archived: boolean,
): Promise<void> {
  await transaction(db, async () => {
    await requireCategory(db, id);
    const t = now();
    await queryBuilder(db)
      .updateTable("timeline_categories")
      .set({ archived_at: archived ? t : null, updated_at: t })
      .where("id", "=", id)
      .execute();
  });
}

/** What `deleteCategory` would delete with the category, for the user to confirm. */
export async function previewCategoryDeletion(
  db: Database,
  id: string,
): Promise<{ intervals: number }> {
  await requireCategory(db, id);
  const { n } = await queryBuilder(db)
    .selectFrom("timeline_intervals")
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where("category_id", "=", id)
    .executeTakeFirstOrThrow();
  return { intervals: n };
}

/** Deletes the category with its intervals. See `previewCategoryDeletion`. */
export async function deleteCategory(db: Database, id: string): Promise<void> {
  await transaction(db, async () => {
    await requireCategory(db, id);
    await queryBuilder(db).deleteFrom("timeline_categories").where("id", "=", id).execute();
  });
}

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

async function requireTimeline(db: Database, id: string): Promise<Timeline> {
  const timeline = await getTimeline(db, id);
  if (!timeline) throw new Error(`Timeline ${id}: not found`);
  return timeline;
}

async function requireCategory(db: Database, id: string): Promise<TimelineCategory> {
  const category = await getCategory(db, id);
  if (!category) throw new Error(`Timeline category ${id}: not found`);
  return category;
}

/** An unarchived category on an unarchived timeline: one offered for new intervals. */
async function requireOfferedCategory(db: Database, id: string) {
  const category = await requireCategory(db, id);
  const timeline = await requireTimeline(db, category.timelineId);
  if (category.archivedAt !== null) throw new Error(`Timeline category ${id}: archived`);
  if (timeline.archivedAt !== null) throw new Error(`Timeline ${timeline.id}: archived`);
  return { category, timeline };
}

async function requireInterval(db: Database, id: string): Promise<TimelineInterval> {
  const interval = await getInterval(db, id);
  if (!interval) throw new Error(`Timeline interval ${id}: not found`);
  return interval;
}

function toTimeline(row: TimelineRow): Timeline {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    exclusive: row.exclusive === 1,
    defaultThingTypeId: row.default_thing_type_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}

function toCategory(row: CategoryRow): TimelineCategory {
  return {
    id: row.id,
    timelineId: row.timeline_id,
    name: row.name,
    description: row.description,
    thingId: row.thing_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
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
