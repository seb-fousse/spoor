import type { Database } from "../platform/index";
import { TABLE_COLUMNS } from "../schema/tables";
import { setSetting, setTimeZone } from "../settings";
import {
  createCategory,
  createInterval,
  createTimeline,
  deleteCategory,
  deleteInterval,
  setCategoryArchived,
  setTimelineArchived,
  startInterval,
} from "../timelines";
import { populateLogs } from "./sample-logs";
import { populateObservations } from "./sample-observations";
import { populateThings } from "./sample-things";

/**
 * TEST-ONLY. A database holding at least one row of every kind the export has to
 * carry, for the round-trip test. Each slice that adds tables extends `populate`
 * so the round trip covers them.
 */

const H = 3_600_000;
const T0 = Date.UTC(2026, 9, 20, 8);

/** Settings, live/archived/trashed timelines, categories and intervals, and a purged interval. */
export async function populate(db: Database): Promise<void> {
  await setTimeZone(db, "Europe/Paris");
  await setSetting(db, "theme", {
    mode: "dark",
    accents: ["a", "b"],
    size: 1.5,
    on: true,
    none: null,
  });

  const activities = await createTimeline(db, {
    name: "Activities",
    description: "Day",
    exclusive: true,
  });
  const work = await createCategory(db, activities.id, { name: "Work" });
  const sleep = await createCategory(db, activities.id, { name: "Sleep", description: "Night" });
  const idle = await createCategory(db, activities.id, { name: "Idle" });

  await createInterval(db, { categoryId: sleep.id, startAt: T0 - 8 * H, endAt: T0 });
  await createInterval(db, {
    categoryId: work.id,
    startAt: T0,
    endAt: T0 + 4 * H,
    timeZone: "Asia/Tokyo",
  });
  const trashed = await createInterval(db, {
    categoryId: work.id,
    startAt: T0 + 5 * H,
    endAt: T0 + 6 * H,
  });
  await deleteInterval(db, trashed.id);
  await startInterval(db, work.id, { at: T0 + 7 * H });

  await setCategoryArchived(db, idle.id, true);
  const gone = await createCategory(db, activities.id, { name: "Gone" });
  await deleteCategory(db, gone.id);

  // The purge operation does not exist yet, so write the tombstone it will leave.
  await db.execute(
    `INSERT INTO timeline_intervals
       (id, timeline_id, category_id, created_at, updated_at, deleted_at, deletion_id, purged_at)
     VALUES ('01900000-0000-7000-8000-000000000001', ?, ?, ?, ?, ?, ?, ?)`,
    [activities.id, work.id, T0, T0 + 1, T0 + 2, "01900000-0000-7000-8000-000000000002", T0 + 3],
  );

  const habits = await createTimeline(db, { name: "Habits", exclusive: false });
  await createCategory(db, habits.id, { name: "Read" });
  await setTimelineArchived(db, habits.id, true);

  await populateObservations(db);
  await populateThings(db);
  await populateLogs(db);
}

/** Every row of every table, for comparing two databases exactly. */
export async function dumpAll(db: Database): Promise<Record<string, unknown[]>> {
  const dump: Record<string, unknown[]> = {};
  for (const table of Object.keys(TABLE_COLUMNS)) {
    dump[table] = await db.query(`SELECT * FROM ${table} ORDER BY 1`);
  }
  return dump;
}
