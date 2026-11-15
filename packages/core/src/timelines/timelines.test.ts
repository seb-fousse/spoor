import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../db/platform";
import { migrate } from "../db/schema/migrate";
import { dayRange } from "../lib/days";
import { setTimeZone } from "../settings/settings";
import { expectSpoorError } from "../testing/expect-spoor-error";
import { createInMemoryDatabase } from "../testing/in-memory-database";
import { createThingType, getThingTypeFields } from "../things/thing-types";
import { createThing, deleteThing, updateThingValues } from "../things/things";
import {
  createCategory,
  deleteCategory,
  getCategory,
  listCategories,
  previewCategoryDeletion,
  setCategoryArchived,
  type TimelineCategory,
  updateCategory,
} from "./categories";
import {
  createInterval,
  deleteInterval,
  getInterval,
  joinIntervals,
  listIntervals,
  listIntervalsInRange,
  restoreInterval,
  splitInterval,
  startInterval,
  stopInterval,
  updateInterval,
} from "./intervals";
import {
  createTimeline,
  deleteTimeline,
  getTimeline,
  listTimelines,
  previewTimelineDeletion,
  setTimelineArchived,
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
      });
      expect(await getTimeline(db, timeline.id)).toEqual(timeline);
    });

    it("requires a name", async () => {
      await expectSpoorError(createTimeline(db, { name: "  " }), "invalid", {
        entity: "timeline",
        field: "name",
      });
      expect(await listTimelines(db)).toEqual([]);
    });

    it("lists timelines by name, archived included", async () => {
      const b = await createTimeline(db, { name: "b" });
      const a = await createTimeline(db, { name: "A" });
      await setTimelineArchived(db, b.id, true);
      expect((await listTimelines(db)).map((t) => t.name)).toEqual(["A", "b"]);
      await deleteTimeline(db, a.id);
      expect((await listTimelines(db)).map((t) => t.name)).toEqual(["b"]);
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

      await expectSpoorError(updateTimeline(db, timeline.id, { exclusive: true }), "conflict", {
        entity: "timeline",
        id: timeline.id,
        field: "exclusive",
      });
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
      await expectSpoorError(createCategory(db, a.id, { name: "x" }), "archived", {
        entity: "timeline",
        id: a.id,
      });

      const b = await createTimeline(db, { name: "b" });
      await deleteTimeline(db, b.id);
      await expectSpoorError(createCategory(db, b.id, { name: "x" }), "not_found", {
        entity: "timeline",
        id: b.id,
      });
    });

    it("is not offered for new intervals once it or its timeline is archived", async () => {
      const { timeline, categories } = await setup();
      const [work] = categories;
      await setCategoryArchived(db, work.id, true);
      await expectSpoorError(startInterval(db, work.id), "archived", {
        entity: "timeline_category",
        id: work.id,
      });

      await setCategoryArchived(db, work.id, false);
      await setTimelineArchived(db, timeline.id, true);
      await expectSpoorError(startInterval(db, work.id), "archived", {
        entity: "timeline",
        id: timeline.id,
      });
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
      ["ends at its start", H, H, TZ, "endAt"],
      ["ends before its start", 2 * H, H, TZ, "endAt"],
      ["has a fractional start", 0.5, H, TZ, "startAt"],
      ["has an invalid time zone", H, 2 * H, "Mars/Olympus", "timeZone"],
    ])(
      "rejects an interval that %s, naming the field",
      async (_, startAt, endAt, timeZone, field) => {
        const { categories } = await setup();
        await expectSpoorError(
          createInterval(db, { categoryId: categories[0].id, startAt, endAt, timeZone }),
          "invalid",
          { entity: "timeline_interval", field },
        );
      },
    );

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
        await expectSpoorError(interval(sleep.id, 2, 5), "conflict", {
          entity: "timeline_interval",
        });
        await expectSpoorError(interval(work.id, 0, 10), "conflict", {
          entity: "timeline_interval",
        });
      });

      it("rejects overlap only within a category on a non-exclusive timeline", async () => {
        const { categories } = await setup(false, ["Alex", "Sam"]);
        const [alex, sam] = categories;
        await interval(alex.id, 1, 3);
        await interval(sam.id, 2, 4);
        await expectSpoorError(interval(alex.id, 2, 5), "conflict", {
          entity: "timeline_interval",
        });
      });

      it("treats an ongoing interval as never ending", async () => {
        const { categories } = await setup();
        await interval(categories[0].id, 5, null);
        await expectSpoorError(interval(categories[1].id, 100, 101), "conflict", {
          entity: "timeline_interval",
        });
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
        await expectSpoorError(stopInterval(db, started.id, 3 * H), "conflict", {
          entity: "timeline_interval",
          id: started.id,
        });
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
        await expectSpoorError(stopInterval(db, started.id, H), "invalid", {
          entity: "timeline_interval",
          id: started.id,
          field: "endAt",
        });
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
        await expectSpoorError(
          startInterval(db, categories[1].id, { at: H, timeZone: TZ }),
          "conflict",
          {
            entity: "timeline_interval",
            field: "at",
          },
        );
        expect((await getInterval(db, ongoing.id))?.endAt).toBeNull();
      });

      it("refuses to start before a later completed interval", async () => {
        const { categories } = await setup();
        await interval(categories[0].id, 5, 6);
        await expectSpoorError(
          startInterval(db, categories[1].id, { at: H, timeZone: TZ }),
          "conflict",
          { entity: "timeline_interval" },
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
        await expectSpoorError(updateInterval(db, early.id, { endAt: null }), "conflict", {
          entity: "timeline_interval",
          id: early.id,
        });
      });

      it("rejects a conflicting change, leaving the interval unchanged", async () => {
        const { categories } = await setup();
        const a = await interval(categories[0].id, 1, 2);
        await interval(categories[1].id, 3, 4);
        await expectSpoorError(updateInterval(db, a.id, { endAt: 3.5 * H }), "conflict", {
          entity: "timeline_interval",
          id: a.id,
        });
        expect(await getInterval(db, a.id)).toEqual(a);
      });

      it("rejects a category on another timeline", async () => {
        const { categories } = await setup();
        const other = await setup();
        const created = await interval(categories[0].id, 1, 2);
        await expectSpoorError(
          updateInterval(db, created.id, { categoryId: other.categories[0].id }),
          "invalid",
          { entity: "timeline_interval", id: created.id, field: "categoryId" },
        );
      });
    });

    describe("split", () => {
      it("cuts an interval in two, in the same category", async () => {
        const { timeline, categories } = await setup();
        const created = await interval(categories[0].id, 1, 4);
        const [earlier, later] = await splitInterval(db, created.id, 2 * H);
        expect(earlier).toMatchObject({ id: created.id, startAt: H, endAt: 2 * H });
        expect(later).toMatchObject({
          categoryId: categories[0].id,
          startAt: 2 * H,
          endAt: 4 * H,
          timeZone: TZ,
        });
        expect(later.id).not.toBe(created.id);
        expect(await listIntervals(db, timeline.id)).toHaveLength(2);
      });

      it("keeps the later piece ongoing", async () => {
        const { categories } = await setup();
        const ongoing = await interval(categories[0].id, 1, null);
        const [earlier, later] = await splitInterval(db, ongoing.id, 3 * H);
        expect(earlier.endAt).toBe(3 * H);
        expect(later).toMatchObject({ startAt: 3 * H, endAt: null });
      });

      it("rejects a point that isn't strictly inside, leaving the interval unchanged", async () => {
        const { timeline, categories } = await setup();
        const created = await interval(categories[0].id, 1, 4);
        for (const at of [0, H, 4 * H, 5 * H]) {
          await expectSpoorError(splitInterval(db, created.id, at), "invalid", {
            entity: "timeline_interval",
            id: created.id,
            field: "at",
          });
        }
        expect(await listIntervals(db, timeline.id)).toEqual([created]);
      });

      it("takes the later piece's id, which must be a new UUID", async () => {
        const { timeline, categories } = await setup();
        const a = await interval(categories[0].id, 1, 4);
        const b = await interval(categories[1].id, 5, 6);
        const laterId = "0190a4f2-7c3e-7000-8000-000000000001";
        await expectSpoorError(splitInterval(db, a.id, 2 * H, { laterId: b.id }), "conflict", {
          entity: "timeline_interval",
          id: a.id,
          field: "laterId",
        });
        await expectSpoorError(splitInterval(db, a.id, 2 * H, { laterId: "x" }), "invalid", {
          entity: "timeline_interval",
          id: a.id,
          field: "laterId",
        });
        expect(await listIntervals(db, timeline.id)).toEqual([b, a]);
        const [, later] = await splitInterval(db, a.id, 2 * H, { laterId });
        expect(later.id).toBe(laterId);
      });
    });

    describe("join", () => {
      it("undoes a split, restoring the original interval", async () => {
        const { timeline, categories } = await setup();
        const created = await interval(categories[0].id, 1, 4);
        const [earlier, later] = await splitInterval(db, created.id, 2 * H);
        const joined = await joinIntervals(db, earlier.id, later.id);
        expect(joined).toEqual({ ...created, updatedAt: expect.any(Number) });
        expect(await listIntervals(db, timeline.id)).toEqual([joined]);
      });

      it("undoes a split of an ongoing interval, which is ongoing again", async () => {
        const { timeline, categories } = await setup();
        const ongoing = await interval(categories[0].id, 1, null);
        const [earlier, later] = await splitInterval(db, ongoing.id, 3 * H);
        const joined = await joinIntervals(db, earlier.id, later.id);
        expect(joined).toEqual({ ...ongoing, updatedAt: expect.any(Number) });
        expect(await listIntervals(db, timeline.id)).toEqual([joined]);
      });

      it("redoes the split with the same ids", async () => {
        const { categories } = await setup();
        const created = await interval(categories[0].id, 1, 4);
        const [earlier, later] = await splitInterval(db, created.id, 2 * H);
        await joinIntervals(db, earlier.id, later.id);
        const redone = await splitInterval(db, created.id, 2 * H, { laterId: later.id });
        expect(redone).toMatchObject([
          { id: earlier.id, startAt: H, endAt: 2 * H },
          { id: later.id, categoryId: later.categoryId, startAt: 2 * H, endAt: 4 * H },
        ]);
      });

      it("refuses intervals that don't meet, changing nothing", async () => {
        const { timeline, categories } = await setup();
        const a = await interval(categories[0].id, 1, 2);
        const b = await interval(categories[0].id, 3, 4);
        const ongoing = await interval(categories[0].id, 5, null);
        for (const [first, second] of [
          [a, b],
          [b, a],
          [ongoing, a],
          [a, a],
        ]) {
          await expectSpoorError(joinIntervals(db, first.id, second.id), "invalid", {
            entity: "timeline_interval",
            id: first.id,
            field: "secondId",
          });
        }
        expect(await listIntervals(db, timeline.id)).toEqual([ongoing, b, a]);
      });

      it("refuses another category or timeline", async () => {
        const { categories } = await setup(false);
        const other = await setup();
        const a = await interval(categories[0].id, 1, 2);
        const sleep = await interval(categories[1].id, 2, 3);
        const elsewhere = await interval(other.categories[0].id, 2, 3);
        for (const second of [sleep, elsewhere]) {
          await expectSpoorError(joinIntervals(db, a.id, second.id), "invalid", {
            entity: "timeline_interval",
            id: a.id,
            field: "secondId",
          });
          expect(await getInterval(db, second.id)).toEqual(second);
        }
        expect(await getInterval(db, a.id)).toEqual(a);
      });

      it("refuses a missing interval", async () => {
        const { categories } = await setup();
        const a = await interval(categories[0].id, 1, 2);
        const missing = "0190a4f2-7c3e-7000-8000-000000000001";
        await expectSpoorError(joinIntervals(db, a.id, missing), "not_found", {
          entity: "timeline_interval",
          id: missing,
        });
      });
    });

    describe("restore", () => {
      it("undoes a delete, bringing back every column but updatedAt", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000);
        const { timeline, categories } = await setup();
        const created = await interval(categories[1].id, 1, 2);
        await deleteInterval(db, created.id);
        vi.setSystemTime(5_000);
        const restored = await restoreInterval(db, created);
        expect(restored).toEqual({ ...created, updatedAt: 5_000 });
        expect(await listIntervals(db, timeline.id)).toEqual([restored]);
      });

      it("brings back an ongoing interval", async () => {
        const { categories } = await setup();
        const ongoing = await interval(categories[0].id, 1, null);
        await deleteInterval(db, ongoing.id);
        expect(await restoreInterval(db, ongoing)).toMatchObject({ id: ongoing.id, endAt: null });
      });

      it("refuses an id in use", async () => {
        const { timeline, categories } = await setup();
        const created = await interval(categories[0].id, 1, 2);
        await expectSpoorError(restoreInterval(db, created), "conflict", {
          entity: "timeline_interval",
          id: created.id,
          field: "id",
        });
        await expectSpoorError(restoreInterval(db, { ...created, id: "x" }), "invalid", {
          entity: "timeline_interval",
          id: "x",
          field: "id",
        });
        expect(await listIntervals(db, timeline.id)).toEqual([created]);
      });

      it("refuses an overlap, writing nothing", async () => {
        const { timeline, categories } = await setup();
        const created = await interval(categories[0].id, 1, 3);
        await deleteInterval(db, created.id);
        const since = await interval(categories[1].id, 2, 4);
        await expectSpoorError(restoreInterval(db, created), "conflict", {
          entity: "timeline_interval",
          id: created.id,
        });
        expect(await listIntervals(db, timeline.id)).toEqual([since]);
      });

      it("refuses an archived or deleted category, or an archived timeline", async () => {
        const { timeline, categories } = await setup();
        const [work, sleep] = categories;
        const a = await interval(work.id, 1, 2);
        const b = await interval(sleep.id, 3, 4);
        await deleteInterval(db, a.id);
        await deleteInterval(db, b.id);

        await setCategoryArchived(db, work.id, true);
        await expectSpoorError(restoreInterval(db, a), "archived", {
          entity: "timeline_category",
          id: work.id,
        });
        await setTimelineArchived(db, timeline.id, true);
        await expectSpoorError(restoreInterval(db, b), "archived", {
          entity: "timeline",
          id: timeline.id,
        });
        await deleteCategory(db, sleep.id);
        await expectSpoorError(restoreInterval(db, b), "not_found", {
          entity: "timeline_category",
          id: sleep.id,
        });
        expect(await listIntervals(db, timeline.id)).toEqual([]);
      });
    });
  });

  describe("delete", () => {
    const count = async (table: string) =>
      (await db.query<{ n: number }>(`SELECT count(*) AS n FROM ${table}`))[0].n;

    it("deletes an interval", async () => {
      const { timeline, categories } = await setup();
      const created = await interval(categories[0].id, 1, 2);
      await deleteInterval(db, created.id);

      expect(await listIntervals(db, timeline.id)).toEqual([]);
      expect(await getInterval(db, created.id)).toBeUndefined();
      await expectSpoorError(deleteInterval(db, created.id), "not_found", {
        entity: "timeline_interval",
        id: created.id,
      });
    });

    it("previews, then deletes a timeline with its categories and intervals", async () => {
      const { timeline, categories } = await setup();
      await interval(categories[0].id, 1, 2);
      await interval(categories[1].id, 2, null);
      const other = await setup();
      await interval(other.categories[0].id, 1, 2);

      expect(await previewTimelineDeletion(db, timeline.id)).toEqual({
        categories: 2,
        intervals: 2,
      });
      await deleteTimeline(db, timeline.id);
      expect(await listTimelines(db)).toEqual([other.timeline]);
      expect(await count("timeline_categories")).toBe(2);
      expect(await count("timeline_intervals")).toBe(1);
      await expectSpoorError(previewTimelineDeletion(db, timeline.id), "not_found", {
        entity: "timeline",
        id: timeline.id,
      });
    });

    it("previews, then deletes a category with its intervals only", async () => {
      const { timeline, categories } = await setup();
      await interval(categories[0].id, 1, 2);
      await interval(categories[1].id, 2, 3);
      expect(await previewCategoryDeletion(db, categories[0].id)).toEqual({ intervals: 1 });
      await deleteCategory(db, categories[0].id);

      expect((await listCategories(db, timeline.id)).map((c) => c.name)).toEqual(["Sleep"]);
      expect(await listIntervals(db, timeline.id)).toEqual([
        expect.objectContaining({ categoryId: categories[1].id }),
      ]);
    });
  });
  describe("intervals in range", () => {
    const ids = (list: { id: string }[]) => list.map((i) => i.id);

    it("includes overlapping, straddling and ongoing intervals", async () => {
      const { timeline, categories } = await setup(false, ["A", "B", "C"]);
      const [a, b, c] = categories.map((cat) => cat.id);
      const before = await interval(a, 0, 10);
      const straddleFrom = await interval(a, 10, 12);
      const inside = await interval(b, 11, 13);
      const straddleTo = await interval(c, 19, 21);
      await interval(b, 20, 22);
      const ongoing = await interval(a, 15, null);
      expect(before.endAt).toBe(10 * H);
      const found = await listIntervalsInRange(db, [timeline.id], { from: 10 * H, to: 20 * H });
      expect(ids(found)).toEqual(ids([straddleFrom, inside, ongoing, straddleTo]));
    });

    it("excludes ongoing intervals starting at or after to", async () => {
      const { timeline, categories } = await setup();
      await interval(categories[0].id, 20, null);
      expect(await listIntervalsInRange(db, [timeline.id], { from: 10 * H, to: 20 * H })).toEqual(
        [],
      );
    });

    it("covers only the given timelines, ordered by timeline", async () => {
      const one = await setup();
      const two = await setup();
      const three = await setup();
      const x = await interval(one.categories[0].id, 1, 2);
      const y = await interval(two.categories[0].id, 1, 2);
      await interval(three.categories[0].id, 1, 2);
      const found = await listIntervalsInRange(db, [one.timeline.id, two.timeline.id], {
        from: 0,
        to: 5 * H,
      });
      expect(ids(found).sort()).toEqual(ids([x, y]).sort());
      expect(found.map((i) => i.timelineId)).toEqual([one.timeline.id, two.timeline.id].sort());
    });

    it("returns nothing for no timelines, and rejects an empty range", async () => {
      expect(await listIntervalsInRange(db, [], { from: 0, to: H })).toEqual([]);
      await expectSpoorError(listIntervalsInRange(db, ["x"], { from: H, to: H }), "invalid", {
        field: "range",
      });
    });

    it("takes a day range built in a zone", async () => {
      const { timeline, categories } = await setup();
      const [start, end] = dayRange("2026-10-25", TZ); // 25 hours: DST ends
      const late = await createInterval(db, {
        categoryId: categories[0].id,
        startAt: start - H,
        endAt: start + H,
        timeZone: TZ,
      });
      await createInterval(db, {
        categoryId: categories[1].id,
        startAt: end,
        endAt: end + H,
        timeZone: TZ,
      });
      expect(ids(await listIntervalsInRange(db, [timeline.id], { from: start, to: end }))).toEqual([
        late.id,
      ]);
    });
  });
});

describe("categories linked to things", () => {
  let db: Database & { close(): void };

  beforeEach(async () => {
    db = createInMemoryDatabase();
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  /** A non-exclusive People timeline and a person named `title`. */
  const setup = async (title = "Alex") => {
    const timeline = await createTimeline(db, { name: "People", exclusive: false });
    const type = await createThingType(db, {
      name: "Person",
      fields: [{ name: "Name", valueType: "text", required: true }],
    });
    const [name] = (await getThingTypeFields(db, type.id)).map((f) => f.id);
    const thing = await createThing(db, { thingTypeId: type.id, values: { [name]: title } });
    return { timeline, type, name, thing };
  };

  it("takes the thing's title as its name", async () => {
    const { timeline, thing } = await setup();
    const category = await createCategory(db, timeline.id, {
      thingId: thing.id,
      description: "Friend",
    });
    expect(category).toMatchObject({ name: "Alex", thingId: thing.id, description: "Friend" });
    const name = { entity: "timeline_category", field: "name" } as const;
    await expectSpoorError(
      createCategory(db, timeline.id, { name: "Al", thingId: thing.id }),
      "invalid",
      name,
    );
    await expectSpoorError(createCategory(db, timeline.id, {}), "invalid", name);
  });

  it("follows the title, and is unlinked keeping the last one once the thing is deleted", async () => {
    const { timeline, name, thing } = await setup();
    const category = await createCategory(db, timeline.id, { thingId: thing.id });
    await updateThingValues(db, thing.id, { [name]: "Alex Smith" });
    expect((await getCategory(db, category.id))?.name).toBe("Alex Smith");
    await expectSpoorError(updateCategory(db, category.id, { name: "Alex" }), "invalid", {
      entity: "timeline_category",
      id: category.id,
      field: "name",
    });
    await deleteThing(db, thing.id);
    expect(await getCategory(db, category.id)).toMatchObject({
      name: "Alex Smith",
      thingId: null,
    });
    await updateCategory(db, category.id, { name: "Alex" });
  });

  it("requires an existing thing", async () => {
    const { timeline, thing } = await setup();
    await deleteThing(db, thing.id);
    await expectSpoorError(createCategory(db, timeline.id, { thingId: thing.id }), "not_found", {
      entity: "thing",
      id: thing.id,
    });
  });

  it("allows one category per thing per timeline", async () => {
    const { timeline, thing } = await setup();
    const first = await createCategory(db, timeline.id, { thingId: thing.id });
    await expectSpoorError(createCategory(db, timeline.id, { thingId: thing.id }), "conflict", {
      entity: "timeline_category",
      field: "thingId",
    });
    const other = await createTimeline(db, { name: "Calls" });
    await createCategory(db, other.id, { thingId: thing.id });

    await deleteCategory(db, first.id);
    await createCategory(db, timeline.id, { thingId: thing.id });
  });
});
