import type { Selectable } from "kysely";
import type { Database } from "../db/platform";
import { queryBuilder } from "../db/query";
import type { DB } from "../db/schema/tables";
import { transaction } from "../db/transaction";
import { optionalText, requireName } from "../lib/guards";
import { newId } from "../lib/ids";
import { type Instant, now } from "../lib/time";
import { findOverlap } from "./overlap";

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

export interface TimelineDeletion {
  categories: number;
  intervals: number;
}

type TimelineRow = Selectable<DB["timelines"]>;
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

export async function requireTimeline(db: Database, id: string): Promise<Timeline> {
  const timeline = await getTimeline(db, id);
  if (!timeline) throw new Error(`Timeline ${id}: not found`);
  return timeline;
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
