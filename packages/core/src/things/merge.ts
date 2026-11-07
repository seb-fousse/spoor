import type { Selectable } from "kysely";
import type { Database } from "../db/platform";
import { queryBuilder } from "../db/query";
import type { DB } from "../db/schema/tables";
import { transaction } from "../db/transaction";
import { MANUAL, repointRefs } from "../definitions/engine";
import { REFERENCING_TABLES } from "../definitions/tables";
import { type Instant, now } from "../lib/time";
import { getThingTitle } from "./things";

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
 *    its title. Where the survivor already has a category on that timeline,
 *    the duplicate's intervals move to it, intervals that now overlap or touch
 *    are joined, and the duplicate's category is deleted.
 * 3. The duplicate is deleted, with its own values.
 *
 * Everything that referred to the duplicate was moved first, so deleting it
 * removes nothing else. Refuses merging a thing into itself or into one of
 * another type.
 */
export async function mergeThings(
  db: Database,
  survivorId: string,
  duplicateId: string,
): Promise<void> {
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
    if (!duplicate) throw new Error(`Thing ${duplicateId}: not found`);
    if (duplicate.thing_type_id !== survivor.thing_type_id) {
      throw new Error(
        `Thing ${duplicateId}: of another type than thing ${survivorId}, cannot be merged into it`,
      );
    }

    const t = now();
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
      const target = await q
        .selectFrom("timeline_categories")
        .select("id")
        .where("timeline_id", "=", category.timeline_id)
        .where("thing_id", "=", survivorId)
        .executeTakeFirst();
      if (target) {
        await moveIntervals(db, category.id, target.id, t);
        await q.deleteFrom("timeline_categories").where("id", "=", category.id).execute();
      } else {
        await q
          .updateTable("timeline_categories")
          .set({ thing_id: survivorId, name: title, updated_at: t })
          .where("id", "=", category.id)
          .execute();
      }
    }

    await q.deleteFrom("things").where("id", "=", duplicateId).execute();
  });
}

/**
 * Moves every interval of category `fromId` to `toId`, on the same timeline,
 * then joins the intervals of `toId` that overlap or touch: the earliest of
 * each run spans it and keeps its time zone, the others are deleted.
 */
async function moveIntervals(db: Database, fromId: string, toId: string, at: Instant) {
  const q = queryBuilder(db);
  const intervals = await q
    .selectFrom("timeline_intervals")
    .selectAll()
    .where("category_id", "in", [fromId, toId])
    .orderBy("start_at")
    .orderBy("id")
    .execute();

  const runs: { intervals: IntervalRow[]; end: number | null }[] = [];
  for (const interval of intervals) {
    const run = runs.at(-1);
    // An ongoing run never ends, so everything after it joins it.
    if (run && (run.end === null || interval.start_at <= run.end)) {
      run.intervals.push(interval);
      run.end =
        run.end === null || interval.end_at === null ? null : Math.max(run.end, interval.end_at);
    } else {
      runs.push({ intervals: [interval], end: interval.end_at });
    }
  }

  // Delete the absorbed intervals first, so no moment has two ongoing ones in a category.
  for (const {
    intervals: [, ...absorbed],
  } of runs) {
    if (absorbed.length === 0) continue;
    await q
      .deleteFrom("timeline_intervals")
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
}
