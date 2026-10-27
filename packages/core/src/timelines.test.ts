import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "./platform/index";
import { migrate } from "./schema/migrate";
import { setTimeZone } from "./settings";
import { createInMemoryDatabase } from "./testing/in-memory-database";
import {
  createCategory,
  createInterval,
  createTimeline,
  deleteCategory,
  deleteInterval,
  deleteTimeline,
  getInterval,
  getTimeline,
  listCategories,
  listIntervals,
  listTimelines,
  restoreTimelineRecords,
  setCategoryArchived,
  setTimelineArchived,
  startInterval,
  stopInterval,
  type TimelineCategory,
  updateCategory,
  updateInterval,
  updateTimeline,
} from "./timelines";

const H = 3_600_000;
const TZ = "Europe/Paris";

describe("timelines", () => {
  let db: Database & { close(): void };

  beforeEach(async () => {
    db = createInMemoryDatabase();
    await migrate(db);
  });

  afterEach(() => {
    db.close();
    vi.useRealTimers();
  });

  /** An exclusive (or not) timeline with categories named `names`. */
  const setup = async (exclusive = true, names = ["Work", "Sleep"]) => {
    const timeline = await createTimeline(db, { name: "Activities", exclusive });
    const categories: TimelineCategory[] = [];
    for (const name of names) categories.push(await createCategory(db, timeline.id, { name }));
    return { timeline, categories };
  };

  const interval = (categoryId: string, start: number, end: number | null) =>
    createInterval(db, {
      categoryId,
      startAt: start * H,
      endAt: end === null ? null : end * H,
      timeZone: TZ,
    });

  describe("timeline", () => {
    it("creates with defaults, trimming text", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_000);
      const timeline = await createTimeline(db, { name: "  Location ", description: " " });
      expect(timeline).toEqual({
        id: expect.any(String),
        name: "Location",
        description: null,
        exclusive: true,
        defaultThingTypeId: null,
        createdAt: 1_000,
        updatedAt: 1_000,
        archivedAt: null,
        deletedAt: null,
        deletionId: null,
      });
      expect(await getTimeline(db, timeline.id)).toEqual(timeline);
    });

    it("requires a name", async () => {
      await expect(createTimeline(db, { name: "  " })).rejects.toThrow(/name is required/);
      expect(await listTimelines(db)).toEqual([]);
    });

    it("lists live timelines by name, archived included", async () => {
      const b = await createTimeline(db, { name: "b" });
      const a = await createTimeline(db, { name: "A" });
      await setTimelineArchived(db, b.id, true);
      expect((await listTimelines(db)).map((t) => t.name)).toEqual(["A", "b"]);
      await deleteTimeline(db, a.id);
      expect((await listTimelines(db)).map((t) => t.name)).toEqual(["b"]);
      expect((await listTimelines(db, { trashed: true })).map((t) => t.name)).toEqual(["A"]);
    });

    it("updates fields and bumps updated_at", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_000);
      const { id } = await createTimeline(db, { name: "People", description: "who" });
      vi.setSystemTime(2_000);
      const updated = await updateTimeline(db, id, { name: "Company", exclusive: false });
      expect(updated).toMatchObject({
        name: "Company",
        description: "who",
        exclusive: false,
        updatedAt: 2_000,
      });
    });

    it("archives and unarchives", async () => {
      const { id } = await createTimeline(db, { name: "x" });
      await setTimelineArchived(db, id, true);
      expect((await getTimeline(db, id))?.archivedAt).toEqual(expect.any(Number));
      await setTimelineArchived(db, id, false);
      expect((await getTimeline(db, id))?.archivedAt).toBeNull();
    });

    it("becomes exclusive only without overlapping intervals", async () => {
      const { timeline, categories } = await setup(false);
      const [work, sleep] = categories;
      await interval(work.id, 0, 2);
      const overlapping = await interval(sleep.id, 1, 3);

      await expect(updateTimeline(db, timeline.id, { exclusive: true })).rejects.toThrow(
        /cannot become exclusive/,
      );
      await updateInterval(db, overlapping.id, { startAt: 2 * H });
      expect((await updateTimeline(db, timeline.id, { exclusive: true })).exclusive).toBe(true);
    });
  });

  describe("category", () => {
    it("creates, lists, and renames", async () => {
      const { timeline, categories } = await setup(true, ["Work", "admin"]);
      expect(categories[0]).toMatchObject({ timelineId: timeline.id, name: "Work", thingId: null });
      expect((await listCategories(db, timeline.id)).map((c) => c.name)).toEqual(["admin", "Work"]);

      const renamed = await updateCategory(db, categories[0].id, { name: "Job" });
      expect(renamed.name).toBe("Job");
    });

    it("cannot be added to an archived or deleted timeline", async () => {
      const a = await createTimeline(db, { name: "a" });
      await setTimelineArchived(db, a.id, true);
      await expect(createCategory(db, a.id, { name: "x" })).rejects.toThrow(/archived/);

      const b = await createTimeline(db, { name: "b" });
      await deleteTimeline(db, b.id);
      await expect(createCategory(db, b.id, { name: "x" })).rejects.toThrow(/not found/);
    });

    it("is not offered for new intervals once it or its timeline is archived", async () => {
      const { timeline, categories } = await setup();
      const [work] = categories;
      await setCategoryArchived(db, work.id, true);
      await expect(startInterval(db, work.id)).rejects.toThrow(/category .* archived/);

      await setCategoryArchived(db, work.id, false);
      await setTimelineArchived(db, timeline.id, true);
      await expect(startInterval(db, work.id)).rejects.toThrow(/Timeline .* archived/);
    });
  });

  describe("interval", () => {
    it("records a completed interval", async () => {
      const { timeline, categories } = await setup();
      const created = await interval(categories[0].id, 1, 2);
      expect(created).toMatchObject({
        timelineId: timeline.id,
        categoryId: categories[0].id,
        startAt: H,
        endAt: 2 * H,
        timeZone: TZ,
      });
      expect(await listIntervals(db, timeline.id)).toEqual([created]);
    });

    it("stores the time zone setting by default", async () => {
      const { categories } = await setup();
      await setTimeZone(db, "Asia/Tokyo");
      const created = await createInterval(db, {
        categoryId: categories[0].id,
        startAt: 0,
        endAt: H,
      });
      expect(created.timeZone).toBe("Asia/Tokyo");
    });

    it.each([
      ["ends at its start", H, H, TZ, /must end after it starts/],
      ["ends before its start", 2 * H, H, TZ, /must end after it starts/],
      ["has a fractional start", 0.5, H, TZ, /invalid start/],
      ["has an invalid time zone", H, 2 * H, "Mars/Olympus", /invalid time zone/],
    ])("rejects an interval that %s", async (_, startAt, endAt, timeZone, message) => {
      const { categories } = await setup();
      await expect(
        createInterval(db, { categoryId: categories[0].id, startAt, endAt, timeZone }),
      ).rejects.toThrow(message);
    });

    it("lists latest first", async () => {
      const { timeline, categories } = await setup();
      await interval(categories[0].id, 0, 1);
      await interval(categories[1].id, 2, 3);
      await interval(categories[0].id, 1, 2);
      expect((await listIntervals(db, timeline.id)).map((i) => i.startAt)).toEqual([2 * H, H, 0]);
    });

    describe("overlap rule", () => {
      it("rejects any overlap on an exclusive timeline, allowing adjacent intervals", async () => {
        const { categories } = await setup(true);
        const [work, sleep] = categories;
        await interval(work.id, 1, 3);
        await interval(sleep.id, 3, 4);
        await interval(sleep.id, 0, 1);
        await expect(interval(sleep.id, 2, 5)).rejects.toThrow(/overlaps interval/);
        await expect(interval(work.id, 0, 10)).rejects.toThrow(/overlaps interval/);
      });

      it("rejects overlap only within a category on a non-exclusive timeline", async () => {
        const { categories } = await setup(false, ["Alex", "Sam"]);
        const [alex, sam] = categories;
        await interval(alex.id, 1, 3);
        await interval(sam.id, 2, 4);
        await expect(interval(alex.id, 2, 5)).rejects.toThrow(/overlaps interval/);
      });

      it("treats an ongoing interval as never ending", async () => {
        const { categories } = await setup();
        await interval(categories[0].id, 5, null);
        await expect(interval(categories[1].id, 100, 101)).rejects.toThrow(/overlaps/);
        await interval(categories[1].id, 4, 5);
      });

      it("ignores deleted intervals", async () => {
        const { categories } = await setup();
        const deleted = await interval(categories[0].id, 1, 3);
        await deleteInterval(db, deleted.id);
        await interval(categories[1].id, 2, 4);
      });

      it("is backed by a unique index on ongoing intervals per category", async () => {
        const { timeline, categories } = await setup(false);
        await interval(categories[0].id, 1, null);
        await expect(
          db.execute(
            `INSERT INTO timeline_intervals
               (id, timeline_id, category_id, start_at, time_zone, created_at, updated_at)
             VALUES ('x', ?, ?, 0, 'UTC', 0, 0)`,
            [timeline.id, categories[0].id],
          ),
        ).rejects.toThrow(/UNIQUE/);
      });

      it("keeps an interval's timeline equal to its category's in the database", async () => {
        const { categories } = await setup();
        const other = await createTimeline(db, { name: "Other" });
        await expect(
          db.execute(
            `INSERT INTO timeline_intervals
               (id, timeline_id, category_id, start_at, end_at, time_zone, created_at, updated_at)
             VALUES ('x', ?, ?, 0, 1, 'UTC', 0, 0)`,
            [other.id, categories[0].id],
          ),
        ).rejects.toThrow(/FOREIGN KEY/);
      });
    });

    describe("ongoing", () => {
      it("starts, then stops", async () => {
        const { categories } = await setup();
        const started = await startInterval(db, categories[0].id, { at: H, timeZone: TZ });
        expect(started.endAt).toBeNull();
        const stopped = await stopInterval(db, started.id, 2 * H);
        expect(stopped.endAt).toBe(2 * H);
        await expect(stopInterval(db, started.id, 3 * H)).rejects.toThrow(/not ongoing/);
      });

      it("defaults to now", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(5 * H);
        const { categories } = await setup();
        const started = await startInterval(db, categories[0].id, { timeZone: TZ });
        expect(started.startAt).toBe(5 * H);
        vi.setSystemTime(6 * H);
        expect((await stopInterval(db, started.id)).endAt).toBe(6 * H);
      });

      it("cannot stop at or before its start", async () => {
        const { categories } = await setup();
        const started = await startInterval(db, categories[0].id, { at: H, timeZone: TZ });
        await expect(stopInterval(db, started.id, H)).rejects.toThrow(/must end after/);
      });

      it("closes the ongoing interval on a category change (exclusive)", async () => {
        const { timeline, categories } = await setup();
        const [work, sleep] = categories;
        const first = await startInterval(db, work.id, { at: H, timeZone: TZ });
        const second = await startInterval(db, sleep.id, { at: 2 * H, timeZone: TZ });

        expect((await getInterval(db, first.id))?.endAt).toBe(2 * H);
        expect(second).toMatchObject({ startAt: 2 * H, endAt: null });
        expect(await listIntervals(db, timeline.id)).toHaveLength(2);
      });

      it("closes only the same category's ongoing interval (non-exclusive)", async () => {
        const { categories } = await setup(false, ["Alex", "Sam"]);
        const [alex, sam] = categories;
        const a1 = await startInterval(db, alex.id, { at: H, timeZone: TZ });
        const s1 = await startInterval(db, sam.id, { at: 2 * H, timeZone: TZ });
        await startInterval(db, alex.id, { at: 3 * H, timeZone: TZ });

        expect((await getInterval(db, a1.id))?.endAt).toBe(3 * H);
        expect((await getInterval(db, s1.id))?.endAt).toBeNull();
      });

      it("refuses to start before the ongoing interval does, changing nothing", async () => {
        const { categories } = await setup();
        const ongoing = await startInterval(db, categories[0].id, { at: 2 * H, timeZone: TZ });
        await expect(startInterval(db, categories[1].id, { at: H, timeZone: TZ })).rejects.toThrow(
          /ongoing since/,
        );
        expect((await getInterval(db, ongoing.id))?.endAt).toBeNull();
      });

      it("refuses to start before a later completed interval", async () => {
        const { categories } = await setup();
        await interval(categories[0].id, 5, 6);
        await expect(startInterval(db, categories[1].id, { at: H, timeZone: TZ })).rejects.toThrow(
          /overlaps/,
        );
      });
    });

    describe("update", () => {
      it("changes category, start, and end", async () => {
        const { categories } = await setup();
        const [work, sleep] = categories;
        const created = await interval(work.id, 1, 2);
        const updated = await updateInterval(db, created.id, {
          categoryId: sleep.id,
          startAt: 0,
          endAt: 3 * H,
        });
        expect(updated).toMatchObject({ categoryId: sleep.id, startAt: 0, endAt: 3 * H });
      });

      it("reopens with endAt null, subject to the overlap rule", async () => {
        const { categories } = await setup();
        const early = await interval(categories[0].id, 1, 2);
        await interval(categories[1].id, 3, 4);
        await expect(updateInterval(db, early.id, { endAt: null })).rejects.toThrow(/overlaps/);
      });

      it("rejects a conflicting change, leaving the interval unchanged", async () => {
        const { categories } = await setup();
        const a = await interval(categories[0].id, 1, 2);
        await interval(categories[1].id, 3, 4);
        await expect(updateInterval(db, a.id, { endAt: 3.5 * H })).rejects.toThrow(/overlaps/);
        expect(await getInterval(db, a.id)).toEqual(a);
      });

      it("rejects a category on another timeline", async () => {
        const { categories } = await setup();
        const other = await setup();
        const created = await interval(categories[0].id, 1, 2);
        await expect(
          updateInterval(db, created.id, { categoryId: other.categories[0].id }),
        ).rejects.toThrow(/another timeline/);
      });
    });
  });

  describe("trash", () => {
    it("deletes and restores an interval", async () => {
      const { timeline, categories } = await setup();
      const created = await interval(categories[0].id, 1, 2);
      const deletionId = await deleteInterval(db, created.id);

      expect(await listIntervals(db, timeline.id)).toEqual([]);
      expect(await listIntervals(db, timeline.id, { trashed: true })).toEqual([
        expect.objectContaining({ id: created.id, deletionId }),
      ]);
      await expect(deleteInterval(db, created.id)).rejects.toThrow(/not found/);

      await restoreTimelineRecords(db, deletionId);
      expect(await listIntervals(db, timeline.id)).toEqual([
        expect.objectContaining({ id: created.id, deletedAt: null, deletionId: null }),
      ]);
    });

    it("cascades a timeline delete to its categories and intervals, and restores them", async () => {
      const { timeline, categories } = await setup();
      await interval(categories[0].id, 1, 2);
      await interval(categories[1].id, 2, null);
      const deletionId = await deleteTimeline(db, timeline.id);

      const ids = async (table: string) =>
        db.query(`SELECT id FROM ${table} WHERE deletion_id = ?`, [deletionId]);
      expect(await ids("timelines")).toHaveLength(1);
      expect(await ids("timeline_categories")).toHaveLength(2);
      expect(await ids("timeline_intervals")).toHaveLength(2);

      await restoreTimelineRecords(db, deletionId);
      expect(await listTimelines(db)).toHaveLength(1);
      expect(await listCategories(db, timeline.id)).toHaveLength(2);
      expect(await listIntervals(db, timeline.id)).toHaveLength(2);
    });

    it("cascades a category delete to its intervals only", async () => {
      const { timeline, categories } = await setup();
      await interval(categories[0].id, 1, 2);
      await interval(categories[1].id, 2, 3);
      await deleteCategory(db, categories[0].id);

      expect((await listCategories(db, timeline.id)).map((c) => c.name)).toEqual(["Sleep"]);
      expect(await listIntervals(db, timeline.id)).toEqual([
        expect.objectContaining({ categoryId: categories[1].id }),
      ]);
    });

    it("keeps separately deleted records in the trash when their parent is restored", async () => {
      const { timeline, categories } = await setup();
      const alone = await interval(categories[0].id, 1, 2);
      const intervalDeletion = await deleteInterval(db, alone.id);
      const categoryDeletion = await deleteCategory(db, categories[1].id);
      const timelineDeletion = await deleteTimeline(db, timeline.id);

      // Children cannot come back while their parent is in the trash.
      await expect(restoreTimelineRecords(db, intervalDeletion)).rejects.toThrow(
        /while its parent is deleted/,
      );
      await expect(restoreTimelineRecords(db, categoryDeletion)).rejects.toThrow(
        /while its parent is deleted/,
      );

      await restoreTimelineRecords(db, timelineDeletion);
      expect((await listCategories(db, timeline.id)).map((c) => c.name)).toEqual(["Work"]);
      expect(await listIntervals(db, timeline.id)).toEqual([]);

      await restoreTimelineRecords(db, intervalDeletion);
      expect(await listIntervals(db, timeline.id)).toHaveLength(1);
    });

    it("refuses a restore that would overlap a live interval, restoring nothing", async () => {
      const { timeline, categories } = await setup();
      const old = await startInterval(db, categories[0].id, { at: 0, timeZone: TZ });
      const deletionId = await deleteInterval(db, old.id);
      await startInterval(db, categories[0].id, { at: H, timeZone: TZ });

      await expect(restoreTimelineRecords(db, deletionId)).rejects.toThrow(/overlaps interval/);
      expect(await listIntervals(db, timeline.id, { trashed: true })).toHaveLength(1);
    });

    it("refuses a restore whose intervals overlap each other", async () => {
      const { timeline, categories } = await setup(false);
      await interval(categories[0].id, 0, 2);
      await interval(categories[1].id, 1, 3);
      const deletionId = await deleteTimeline(db, timeline.id);
      // Overlaps were allowed when trashed, but the timeline is exclusive now.
      await db.execute("UPDATE timelines SET exclusive = 1");

      await expect(restoreTimelineRecords(db, deletionId)).rejects.toThrow(/overlaps interval/);
      expect(await listTimelines(db)).toEqual([]);
    });

    it("refuses an unknown or purged deletion", async () => {
      await expect(restoreTimelineRecords(db, "nope")).rejects.toThrow(/nothing in the trash/);

      const { categories } = await setup();
      const created = await interval(categories[0].id, 1, 2);
      const deletionId = await deleteInterval(db, created.id);
      await db.execute(
        "UPDATE timeline_intervals SET purged_at = 1, start_at = NULL, end_at = NULL, time_zone = NULL",
      );
      await expect(restoreTimelineRecords(db, deletionId)).rejects.toThrow(/purged/);
      expect(await getInterval(db, created.id)).toBeUndefined();
    });
  });
});
