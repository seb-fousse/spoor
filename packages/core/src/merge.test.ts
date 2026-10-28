import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mergeThings } from "./merge";
import type { Database } from "./platform/index";
import { migrate } from "./schema/migrate";
import { createInMemoryDatabase } from "./testing/in-memory-database";
import { dumpAll } from "./testing/sample-data";
import {
  createThing,
  createThingType,
  deleteThing,
  getThing,
  getThingTypeVersionFields,
  resolveThing,
  restoreThingRecords,
  type Thing,
} from "./things";
import {
  createCategory,
  createInterval,
  createTimeline,
  getCategory,
  listCategories,
  listIntervals,
  restoreTimelineRecords,
} from "./timelines";

const H = 3_600_000;
const TZ = "Europe/Paris";

describe("mergeThings", () => {
  let db: Database & { close(): void };

  beforeEach(async () => {
    db = createInMemoryDatabase();
    await migrate(db);
  });

  afterEach(() => {
    db.close();
    vi.useRealTimers();
  });

  /** A Person type with friends, a Movie type referring to people, and three people. */
  const setup = async () => {
    const personType = await createThingType(db, {
      name: "Person",
      fields: [{ name: "Name", valueType: "text", required: true }],
    });
    const [name] = (await getThingTypeVersionFields(db, personType.id)).map((f) => f.id);
    const person = (title: string) =>
      createThing(db, { thingTypeId: personType.id, values: { [name]: title } });
    const [alex, alexSmith, sam] = [
      await person("Alex"),
      await person("Alex Smith"),
      await person("Sam"),
    ];
    const movieType = await createThingType(db, {
      name: "Movie",
      fields: [
        { name: "Title", valueType: "text", required: true },
        { name: "Director", valueType: "ref", constraints: { thingTypeId: personType.id } },
        { name: "Cast", valueType: "multi_ref", constraints: { thingTypeId: personType.id } },
      ],
    });
    const [title, director, cast] = (await getThingTypeVersionFields(db, movieType.id)).map(
      (f) => f.id,
    );
    return { personType, movieType, name, alex, alexSmith, sam, f: { title, director, cast } };
  };

  const valuesOf = async (thing: Thing) => (await getThing(db, thing.id))?.values;

  it("re-points references, collapsing repeated members, as the user", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const { movieType, alex, alexSmith, sam, f } = await setup();
    const movie = await createThing(db, {
      thingTypeId: movieType.id,
      source: "import",
      values: {
        [f.title]: "Alien",
        [f.director]: alex.id,
        [f.cast]: [alex.id, alexSmith.id, sam.id],
      },
    });
    vi.setSystemTime(2_000);
    await mergeThings(db, alexSmith.id, alex.id);

    expect(await valuesOf(movie)).toEqual({
      [f.title]: "Alien",
      [f.director]: alexSmith.id,
      [f.cast]: [alexSmith.id, sam.id].sort(),
    });
    expect((await getThing(db, movie.id))?.updatedAt).toBe(2_000);
    const rows = await db.query<{ value_ref: string; written_by: string }>(
      "SELECT value_ref, written_by FROM thing_field_values WHERE field_id = ?",
      [f.director],
    );
    expect(rows).toEqual([{ value_ref: alexSmith.id, written_by: "manual" }]);
  });

  it("trashes the duplicate, recording the survivor", async () => {
    const { alex, alexSmith } = await setup();
    const deletionId = await mergeThings(db, alexSmith.id, alex.id);
    expect(await getThing(db, alex.id)).toMatchObject({
      mergedIntoId: alexSmith.id,
      deletionId,
      deletedAt: expect.any(Number),
    });
    expect(await getThing(db, alexSmith.id)).toMatchObject({ mergedIntoId: null, deletedAt: null });
  });

  it("resolves a merged thing through the chain, and redirects new references to it", async () => {
    const { movieType, alex, alexSmith, sam, f } = await setup();
    await mergeThings(db, alexSmith.id, alex.id);
    await mergeThings(db, sam.id, alexSmith.id);
    expect(await resolveThing(db, alex.id)).toBe(sam.id);
    expect(await resolveThing(db, sam.id)).toBe(sam.id);
    expect(await resolveThing(db, "01900000-0000-7000-8000-000000000000")).toBeUndefined();

    // A reference arriving later, say from another device, lands on the survivor.
    const movie = await createThing(db, {
      thingTypeId: movieType.id,
      values: { [f.title]: "Alien", [f.director]: alex.id, [f.cast]: [alex.id, sam.id] },
    });
    expect(movie.values).toMatchObject({ [f.director]: sam.id, [f.cast]: [sam.id] });
  });

  it.each([
    [
      "into itself",
      (t: Awaited<ReturnType<typeof setup>>) => [t.alex.id, t.alex.id],
      /into itself/,
    ],
    [
      "an unknown duplicate",
      (t: Awaited<ReturnType<typeof setup>>) => [t.alex.id, "01900000-0000-7000-8000-000000000000"],
      /not found/,
    ],
  ])("refuses merging %s", async (_, ids, message) => {
    const things = await setup();
    const [survivor, duplicate] = ids(things);
    await expect(mergeThings(db, survivor, duplicate)).rejects.toThrow(message);
  });

  it("refuses things of different types, and a deleted or merged survivor, changing nothing", async () => {
    const { movieType, alex, alexSmith, sam, f } = await setup();
    const movie = await createThing(db, {
      thingTypeId: movieType.id,
      values: { [f.title]: "Alien" },
    });
    await mergeThings(db, alexSmith.id, alex.id);
    const kim = await createThing(db, { thingTypeId: sam.thingTypeId, values: sam.values });
    await deleteThing(db, kim.id);

    const before = await dumpAll(db);
    await expect(mergeThings(db, movie.id, sam.id)).rejects.toThrow(/of another type/);
    await expect(mergeThings(db, alex.id, sam.id)).rejects.toThrow(/already merged into/);
    await expect(mergeThings(db, kim.id, sam.id)).rejects.toThrow(`Thing ${kim.id}: deleted`);
    await expect(mergeThings(db, sam.id, kim.id)).rejects.toThrow(`Thing ${kim.id}: not found`);
    expect(await dumpAll(db)).toEqual(before);
  });

  it("cannot be undone by a restore", async () => {
    const { alex, alexSmith } = await setup();
    const people = await createTimeline(db, { name: "People", exclusive: false });
    await createCategory(db, people.id, { thingId: alexSmith.id });
    await createCategory(db, people.id, { thingId: alex.id });
    const deletionId = await mergeThings(db, alexSmith.id, alex.id);
    await expect(restoreThingRecords(db, deletionId)).rejects.toThrow(
      `Thing ${alex.id}: merged into thing ${alexSmith.id}, cannot be restored`,
    );
    await expect(restoreTimelineRecords(db, deletionId)).rejects.toThrow(/merged into/);
  });

  describe("categories", () => {
    const interval = (categoryId: string, start: number, end: number | null) =>
      createInterval(db, {
        categoryId,
        startAt: start * H,
        endAt: end === null ? null : end * H,
        timeZone: TZ,
      });

    it("links the duplicate's category to the survivor, taking its title", async () => {
      const { alex, alexSmith } = await setup();
      const people = await createTimeline(db, { name: "People", exclusive: false });
      const category = await createCategory(db, people.id, { thingId: alex.id });
      await interval(category.id, 0, 1);
      await mergeThings(db, alexSmith.id, alex.id);
      expect(await getCategory(db, category.id)).toMatchObject({
        thingId: alexSmith.id,
        name: "Alex Smith",
        deletedAt: null,
      });
      expect(await listIntervals(db, people.id)).toHaveLength(1);
    });

    it("moves intervals into the survivor's category, joining those that overlap or touch", async () => {
      const { alex, alexSmith } = await setup();
      const people = await createTimeline(db, { name: "People", exclusive: false });
      const kept = await createCategory(db, people.id, { thingId: alexSmith.id });
      const merged = await createCategory(db, people.id, { thingId: alex.id });
      await interval(kept.id, 0, 2);
      await interval(merged.id, 1, 3); // overlaps
      await interval(merged.id, 3, 4); // touches
      await interval(kept.id, 6, 7); // apart
      await interval(merged.id, 8, null); // ongoing
      await interval(kept.id, 9, 10); // within the ongoing one

      const deletionId = await mergeThings(db, alexSmith.id, alex.id);
      expect(
        (await listIntervals(db, people.id)).map((i) => [
          i.categoryId,
          i.startAt / H,
          i.endAt && i.endAt / H,
        ]),
      ).toEqual([
        [kept.id, 8, null],
        [kept.id, 6, 7],
        [kept.id, 0, 4],
      ]);
      expect(await getCategory(db, merged.id)).toMatchObject({ deletionId, thingId: alexSmith.id });
      expect(
        (await listIntervals(db, people.id, { trashed: true })).map((i) => i.deletionId),
      ).toEqual([deletionId, deletionId, deletionId]);
      expect((await listCategories(db, people.id)).map((c) => c.id)).toEqual([kept.id]);
    });

    it("joins only touching intervals on an exclusive timeline, moving trashed ones too", async () => {
      const { alex, alexSmith } = await setup();
      const where = await createTimeline(db, { name: "With", exclusive: true });
      const kept = await createCategory(db, where.id, { thingId: alexSmith.id });
      const merged = await createCategory(db, where.id, { thingId: alex.id });
      const other = await createCategory(db, where.id, { name: "Alone" });
      await interval(kept.id, 0, 1);
      await interval(merged.id, 1, 2);
      await interval(other.id, 2, 3);
      await interval(merged.id, 3, 4);
      const trashedId = (
        await db.query<{ id: string }>(
          `SELECT id FROM timeline_intervals WHERE category_id = ? AND start_at = ?`,
          [merged.id, 3 * H],
        )
      )[0].id;
      await db.execute(
        "UPDATE timeline_intervals SET deleted_at = 1, deletion_id = ? WHERE id = ?",
        ["01900000-0000-7000-8000-000000000009", trashedId],
      );

      await mergeThings(db, alexSmith.id, alex.id);
      expect(
        (await listIntervals(db, where.id)).map((i) => [
          i.categoryId,
          i.startAt / H,
          i.endAt && i.endAt / H,
        ]),
      ).toEqual([
        [other.id, 2, 3],
        [kept.id, 0, 2],
      ]);
      const [trashed] = await db.query<{ category_id: string }>(
        "SELECT category_id FROM timeline_intervals WHERE id = ?",
        [trashedId],
      );
      expect(trashed.category_id).toBe(kept.id);
    });

    it("leaves categories on other timelines and of other things alone", async () => {
      const { alex, alexSmith, sam } = await setup();
      const a = await createTimeline(db, { name: "A", exclusive: false });
      const b = await createTimeline(db, { name: "B", exclusive: false });
      await createCategory(db, a.id, { thingId: alexSmith.id });
      const onB = await createCategory(db, b.id, { thingId: alex.id });
      const samOnA = await createCategory(db, a.id, { thingId: sam.id });
      await mergeThings(db, alexSmith.id, alex.id);
      expect(await getCategory(db, onB.id)).toMatchObject({
        thingId: alexSmith.id,
        deletedAt: null,
      });
      expect(await getCategory(db, samOnA.id)).toMatchObject({ thingId: sam.id, name: "Sam" });
    });
  });
});
