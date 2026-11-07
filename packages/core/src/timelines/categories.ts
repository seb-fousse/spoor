import type { Selectable } from "kysely";
import type { Database } from "../db/platform";
import { queryBuilder } from "../db/query";
import type { DB } from "../db/schema/tables";
import { transaction } from "../db/transaction";
import { optionalText, requireName } from "../lib/guards";
import { newId } from "../lib/ids";
import { type Instant, now } from "../lib/time";
import { getThingTitle } from "../things/things";
import { requireTimeline } from "./timelines";

/** Timeline categories (see docs/data-spec.md § 1. Timelines). */

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

type CategoryRow = Selectable<DB["timeline_categories"]>;

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

export async function requireCategory(db: Database, id: string): Promise<TimelineCategory> {
  const category = await getCategory(db, id);
  if (!category) throw new Error(`Timeline category ${id}: not found`);
  return category;
}

/** An unarchived category on an unarchived timeline: one offered for new intervals. */
export async function requireOfferedCategory(db: Database, id: string) {
  const category = await requireCategory(db, id);
  const timeline = await requireTimeline(db, category.timelineId);
  if (category.archivedAt !== null) throw new Error(`Timeline category ${id}: archived`);
  if (timeline.archivedAt !== null) throw new Error(`Timeline ${timeline.id}: archived`);
  return { category, timeline };
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
