import type { Selectable } from "kysely";
import { MANUAL, REFERENCING_TABLES, repointRefs } from "./definitions";
import { newId } from "./ids";
import type { Database } from "./platform/index";
import { queryBuilder } from "./query";
import type { DB } from "./schema/tables";
import { getThingTitle } from "./things";
import { type Instant, now } from "./time";
import { transaction } from "./transaction";

/**
 * Merging things (see docs/data-spec.md § Merging things). Duplicates are
 * expected: two devices each create "Alex", or an import adds a second "Alien".
 * Merging keeps one, the survivor, and moves everything that referred to the
 * other, the duplicate, onto it. Field values are not merged.
 *
 * It spans things, every value table that can reference a thing, and
 * timelines, so it lives apart from each of them.
 */

type IntervalRow = Selectable<DB["timeline_intervals"]>;

/**
 * Merges thing `duplicateId` into `survivorId`, in one transaction:
 * 1. Every `ref` and `multi_ref` to the duplicate, in any value table that can
 *    reference things, points at the survivor instead, collapsing `multi_ref`
 *    rows that would repeat. The user made the change, so it is `manual`.
 * 2. Every category linked to the duplicate is linked to the survivor and takes
 *    its title. Where the survivor already has a live category on that
 *    timeline, the duplicate's intervals move to it, intervals that now overlap
 *    or touch are joined, and the duplicate's category is trashed.
 * 3. The duplicate records `merged_into_id` and goes to the trash.
 *
 * Everything trashed shares the returned `deletion_id`, which cannot be
 * restored. Refuses merging a thing into itself or into one of another type,
 * a duplicate that is not live, and a survivor that is deleted or merged.
 */
export async function mergeThings(
  db: Database,
  survivorId: string,
  duplicateId: string,
): Promise<string> {
  const deletionId = newId();
  await transaction(db, async () => {
    const q = queryBuilder(db);
    if (survivorId === duplicateId) {
      throw new Error(`Thing ${duplicateId}: cannot be merged into itself`);
    }
    const thing = (id: string) =>
      q.selectFrom("things").selectAll().where("id", "=", id).executeTakeFirst();
    const survivor = await thing(survivorId);
    const duplicate = await thing(duplicateId);
    if (!survivor) throw new Error(`Thing ${survivorId}: not found`);
    if (survivor.merged_into_id !== null) {
      throw new Error(`Thing ${survivorId}: already merged into thing ${survivor.merged_into_id}`);
    }
    if (survivor.deleted_at !== null) throw new Error(`Thing ${survivorId}: deleted`);
    if (!duplicate || duplicate.deleted_at !== null) {
      throw new Error(`Thing ${duplicateId}: not found`);
    }
    if (duplicate.thing_type_id !== survivor.thing_type_id) {
      throw new Error(
        `Thing ${duplicateId}: of another type than thing ${survivorId}, cannot be merged into it`,
      );
    }

    const t = now();
    const trash = { deleted_at: t, deletion_id: deletionId, updated_at: t };
    for (const tables of REFERENCING_TABLES) {
      await repointRefs(db, tables, duplicateId, survivorId, { writtenBy: MANUAL, writtenAt: t });
    }

    const title = (await getThingTitle(db, survivorId)) as string;
    const categories = await q
      .selectFrom("timeline_categories")
      .selectAll()
      .where("thing_id", "=", duplicateId)
      .execute();
    for (const category of categories) {
      const target =
        category.deleted_at === null
          ? await q
              .selectFrom("timeline_categories")
              .select("id")
              .where("timeline_id", "=", category.timeline_id)
              .where("thing_id", "=", survivorId)
              .where("deleted_at", "is", null)
              .executeTakeFirst()
          : undefined;
      if (target) {
        await moveIntervals(db, category.id, target.id, { at: t, deletionId });
        await q
          .updateTable("timeline_categories")
          .set(trash)
          .where("id", "=", category.id)
          .execute();
      }
      await q
        .updateTable("timeline_categories")
        .set({ thing_id: survivorId, name: title, updated_at: t })
        .where("id", "=", category.id)
        .execute();
    }

    await q
      .updateTable("things")
      .set({ ...trash, merged_into_id: survivorId })
      .where("id", "=", duplicateId)
      .execute();
  });
  return deletionId;
}

/**
 * Moves every interval of category `fromId` to `toId`, on the same timeline,
 * then joins the live intervals of `toId` that overlap or touch: the earliest
 * of each run spans it and keeps its time zone, the others are trashed.
 */
async function moveIntervals(
  db: Database,
  fromId: string,
  toId: string,
  { at, deletionId }: { at: Instant; deletionId: string },
) {
  const q = queryBuilder(db);
  const live = await q
    .selectFrom("timeline_intervals")
    .selectAll()
    .where("category_id", "in", [fromId, toId])
    .where("deleted_at", "is", null)
    .orderBy("start_at")
    .orderBy("id")
    .execute();

  // Live intervals are never purged, so `start_at` is set.
  const runs: { intervals: IntervalRow[]; end: number | null }[] = [];
  for (const interval of live) {
    const run = runs.at(-1);
    // An ongoing run never ends, so everything after it joins it.
    if (run && (run.end === null || (interval.start_at as number) <= run.end)) {
      run.intervals.push(interval);
      run.end =
        run.end === null || interval.end_at === null ? null : Math.max(run.end, interval.end_at);
    } else {
      runs.push({ intervals: [interval], end: interval.end_at });
    }
  }

  // Trash the absorbed intervals first, so no moment has two ongoing ones in a category.
  for (const {
    intervals: [, ...absorbed],
  } of runs) {
    if (absorbed.length === 0) continue;
    await q
      .updateTable("timeline_intervals")
      .set({ deleted_at: at, deletion_id: deletionId, updated_at: at })
      .where(
        "id",
        "in",
        absorbed.map((i) => i.id),
      )
      .execute();
  }
  for (const {
    intervals: [first],
    end,
  } of runs) {
    if (first.category_id === toId && first.end_at === end) continue;
    await q
      .updateTable("timeline_intervals")
      .set({ category_id: toId, end_at: end, updated_at: at })
      .where("id", "=", first.id)
      .execute();
  }
  // Trashed and purged intervals follow, so a restore finds them in the survivor's category.
  await q
    .updateTable("timeline_intervals")
    .set({ category_id: toId, updated_at: at })
    .where("category_id", "=", fromId)
    .execute();
}
