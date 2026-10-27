import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NewField } from "./definitions";
import type { Database } from "./platform/index";
import { migrate } from "./schema/migrate";
import { createInMemoryDatabase } from "./testing/in-memory-database";
import {
  createThing,
  createThingType,
  deleteThing,
  deleteThingType,
  getThing,
  getThingTitle,
  getThingType,
  getThingTypeVersionFields,
  listThings,
  listThingTypes,
  previewThingTypeDeletion,
  reorderThingFields,
  restoreThingRecords,
  reviseThingTypeFields,
  setThingTypeArchived,
  type ThingType,
  updateThingField,
  updateThingType,
  updateThingValues,
} from "./things";

const NAME: NewField = { name: "Name", valueType: "text", required: true };
const BORN: NewField = { name: "Born", valueType: "date" };

describe("things", () => {
  let db: Database & { close(): void };

  beforeEach(async () => {
    db = createInMemoryDatabase();
    await migrate(db);
  });

  afterEach(() => {
    db.close();
    vi.useRealTimers();
  });

  /** A Person type with a title and a birth date, and its field ids. */
  const person = async () => {
    const type = await createThingType(db, { name: "Person", fields: [NAME, BORN] });
    const [name, born] = (await getThingTypeVersionFields(db, type.id)).map((f) => f.id);
    return { type, name, born };
  };

  const count = async (table: string) =>
    (await db.query<{ n: number }>(`SELECT count(*) AS n FROM ${table}`))[0].n;

  describe("thing type", () => {
    it("creates version 1, trimming text, with the first field as title", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_000);
      const type = await createThingType(db, {
        name: " Person ",
        description: " ",
        fields: [NAME, BORN],
      });
      const fields = await getThingTypeVersionFields(db, type.id);
      expect(type).toEqual({
        id: expect.any(String),
        name: "Person",
        description: null,
        titleFieldId: fields[0].id,
        schemaVersion: 1,
        createdAt: 1_000,
        updatedAt: 1_000,
        archivedAt: null,
        deletedAt: null,
        deletionId: null,
      });
      expect(fields.map((f) => [f.name, f.position, f.shape.valueType, f.required])).toEqual([
        ["Name", 0, "text", true],
        ["Born", 1, "date", false],
      ]);
      expect(await getThingType(db, type.id)).toEqual(type);
    });

    it("takes the title field by index", async () => {
      const type = await createThingType(db, {
        name: "Movie",
        fields: [BORN, NAME],
        titleFieldIndex: 1,
      });
      const fields = await getThingTypeVersionFields(db, type.id);
      expect(type.titleFieldId).toBe(fields[1].id);
    });

    it.each([
      ["no fields", { fields: [] }, /needs a title field/],
      ["an index past the fields", { fields: [NAME], titleFieldIndex: 1 }, /needs a title field/],
      ["a non-text title", { fields: [BORN] }, /must be a required text field/],
      ["an optional title", { fields: [{ ...NAME, required: false }] }, /required text field/],
      ["a blank name", { name: " ", fields: [NAME] }, /name is required/],
      ["duplicate field names", { fields: [NAME, { ...BORN, name: "name" }] }, /already used/],
    ])("refuses %s, writing nothing", async (_, input, message) => {
      await expect(createThingType(db, { name: "Person", ...input })).rejects.toThrow(message);
      expect(await count("thing_types")).toBe(0);
      expect(await count("thing_fields")).toBe(0);
    });

    it("lists live types by name, archived included, and trashed ones", async () => {
      const b = await createThingType(db, { name: "place", fields: [NAME] });
      await createThingType(db, { name: "Movie", fields: [NAME] });
      const c = await createThingType(db, { name: "Person", fields: [NAME] });
      await setThingTypeArchived(db, b.id, true);
      await deleteThingType(db, c.id);
      expect((await listThingTypes(db)).map((t) => t.name)).toEqual(["Movie", "place"]);
      expect((await listThingTypes(db, { trashed: true })).map((t) => t.id)).toEqual([c.id]);
    });

    it("renames, redescribes and picks another title field without a version", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_000);
      const { type, name } = await person();
      const nick = { name: "Nickname", valueType: "text" as const, required: true };
      await reviseThingTypeFields(db, type.id, [{ ...NAME, id: name }, nick]);
      const nickId = (await getThingTypeVersionFields(db, type.id))[1].id;
      vi.setSystemTime(2_000);
      const updated = await updateThingType(db, type.id, {
        name: "People",
        description: "Who",
        titleFieldId: nickId,
      });
      expect(updated).toMatchObject({
        name: "People",
        description: "Who",
        titleFieldId: nickId,
        schemaVersion: 2,
        updatedAt: 2_000,
      });
    });

    it("refuses a title field that is not a required text field of the current version", async () => {
      const { type, name, born } = await person();
      await expect(updateThingType(db, type.id, { titleFieldId: born })).rejects.toThrow(
        /must be a required text field/,
      );
      await reviseThingTypeFields(db, type.id, [{ ...NAME, id: name }]);
      await expect(updateThingType(db, type.id, { titleFieldId: born })).rejects.toThrow(
        /is not in version 2/,
      );
    });

    describe("revising fields", () => {
      it("creates a version that new things use, while old things keep theirs", async () => {
        const { type, name, born } = await person();
        const alex = await createThing(db, { thingTypeId: type.id, values: { [name]: "Alex" } });
        const revised = await reviseThingTypeFields(db, type.id, [
          { ...NAME, id: name },
          { ...BORN, id: born, required: true },
        ]);
        expect(revised.schemaVersion).toBe(2);
        await expect(
          createThing(db, { thingTypeId: type.id, values: { [name]: "Sam" } }),
        ).rejects.toThrow(/is required/);
        const sam = await createThing(db, {
          thingTypeId: type.id,
          values: { [name]: "Sam", [born]: "1990-01-01" },
        });
        expect(sam.thingTypeVersion).toBe(2);
        expect((await getThing(db, alex.id))?.thingTypeVersion).toBe(1);
        // Alex is still valid against version 1.
        await updateThingValues(db, alex.id, { [name]: "Alexandra" });
      });

      it("creates no version for renames and reordering", async () => {
        const { type, name, born } = await person();
        const revised = await reviseThingTypeFields(db, type.id, [
          { ...BORN, id: born },
          { ...NAME, id: name, name: "Full name" },
        ]);
        expect(revised.schemaVersion).toBe(1);
        expect((await getThingTypeVersionFields(db, type.id)).map((f) => f.name)).toEqual([
          "Born",
          "Full name",
        ]);
      });

      it.each([
        ["retires", (_name: string, born: string) => [{ ...BORN, id: born }], /cannot be retired/],
        [
          "retypes",
          (name: string) => [
            { id: name, name: "Name", valueType: "number" as const, required: true },
          ],
          /required text field/,
        ],
        [
          "makes optional",
          (name: string) => [{ ...NAME, id: name, required: false }],
          /required text/,
        ],
      ])("refuses a revision that %s the title field", async (_, fields, message) => {
        const { type, name, born } = await person();
        await expect(reviseThingTypeFields(db, type.id, fields(name, born))).rejects.toThrow(
          message,
        );
        expect((await getThingType(db, type.id))?.schemaVersion).toBe(1);
      });

      it("reads older versions' fields", async () => {
        const { type, name } = await person();
        await reviseThingTypeFields(db, type.id, [{ ...NAME, id: name }]);
        expect(await getThingTypeVersionFields(db, type.id)).toHaveLength(1);
        expect(await getThingTypeVersionFields(db, type.id, 1)).toHaveLength(2);
      });
    });

    it("renames, relabels and reorders fields", async () => {
      const { type, name, born } = await person();
      await updateThingField(db, type.id, born, { name: "Birthday" });
      await reorderThingFields(db, type.id, [born, name]);
      expect((await getThingTypeVersionFields(db, type.id)).map((f) => f.name)).toEqual([
        "Birthday",
        "Name",
      ]);
      const other = await person();
      await expect(updateThingField(db, type.id, other.born, { name: "x" })).rejects.toThrow(
        /not a field of thing type/,
      );
    });

    it("is not offered for new things once archived", async () => {
      const { type, name } = await person();
      await setThingTypeArchived(db, type.id, true);
      await expect(
        createThing(db, { thingTypeId: type.id, values: { [name]: "Alex" } }),
      ).rejects.toThrow(/archived/);
      await setThingTypeArchived(db, type.id, false);
      await createThing(db, { thingTypeId: type.id, values: { [name]: "Alex" } });
    });

    it("deletes with its live things under one deletion, and restores them", async () => {
      const { type, name } = await person();
      const alex = await createThing(db, { thingTypeId: type.id, values: { [name]: "Alex" } });
      await createThing(db, { thingTypeId: type.id, values: { [name]: "Sam" } });
      const gone = await createThing(db, { thingTypeId: type.id, values: { [name]: "Kim" } });
      const earlier = await deleteThing(db, gone.id);
      expect(await previewThingTypeDeletion(db, type.id)).toEqual({ things: 2 });

      const deletionId = await deleteThingType(db, type.id);
      expect((await getThingType(db, type.id))?.deletionId).toBe(deletionId);
      expect((await getThing(db, alex.id))?.deletionId).toBe(deletionId);
      expect((await getThing(db, gone.id))?.deletionId).toBe(earlier);
      expect(await listThings(db, type.id)).toEqual([]);
      await expect(updateThingType(db, type.id, { name: "x" })).rejects.toThrow(/not found/);

      await restoreThingRecords(db, deletionId);
      expect((await listThings(db, type.id)).map((t) => t.values[name])).toEqual(["Alex", "Sam"]);
      expect((await getThing(db, gone.id))?.deletionId).toBe(earlier);
    });
  });

  describe("thing", () => {
    it("creates with values against the current version", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_000);
      const { type, name, born } = await person();
      const alex = await createThing(db, {
        thingTypeId: type.id,
        values: { [name]: "Alex", [born]: "1990-04-01" },
      });
      expect(alex).toEqual({
        id: expect.any(String),
        thingTypeId: type.id,
        thingTypeVersion: 1,
        source: "manual",
        externalId: null,
        mergedIntoId: null,
        values: { [name]: "Alex", [born]: "1990-04-01" },
        createdAt: 1_000,
        updatedAt: 1_000,
        deletedAt: null,
        deletionId: null,
      });
      expect(await getThing(db, alex.id)).toEqual(alex);
      expect(await getThingTitle(db, alex.id)).toBe("Alex");
    });

    it("refuses invalid values, writing nothing", async () => {
      const { type, name, born } = await person();
      await expect(
        createThing(db, { thingTypeId: type.id, values: { [born]: "1990-04-01" } }),
      ).rejects.toThrow(new RegExp(`Thing .*, field ${name}: is required`));
      await expect(
        createThing(db, { thingTypeId: type.id, values: { [name]: "Alex", [born]: "April" } }),
      ).rejects.toThrow(new RegExp(`field ${born}: must be a YYYY-MM-DD date`));
      expect(await count("things")).toBe(0);
      expect(await count("thing_field_values")).toBe(0);
    });

    it("refuses a deleted type", async () => {
      const { type, name } = await person();
      await deleteThingType(db, type.id);
      await expect(
        createThing(db, { thingTypeId: type.id, values: { [name]: "Alex" } }),
      ).rejects.toThrow(/Thing type .*: not found/);
    });

    it("records its source and external id, unique together", async () => {
      const { type, name } = await person();
      const imported = { thingTypeId: type.id, source: "import", externalId: "42" };
      const alex = await createThing(db, { ...imported, values: { [name]: "Alex" } });
      expect(alex).toMatchObject({ source: "import", externalId: "42" });
      const [row] = await db.query<{ written_by: string }>(
        "SELECT written_by FROM thing_field_values WHERE thing_id = ?",
        [alex.id],
      );
      expect(row.written_by).toBe("import");

      await expect(createThing(db, { ...imported, values: { [name]: "Sam" } })).rejects.toThrow(
        new RegExp(`thing ${alex.id} already has external id "42" from import`),
      );
      await createThing(db, { ...imported, source: "plugin:x", values: { [name]: "Sam" } });
      await expect(
        createThing(db, { thingTypeId: type.id, externalId: "", values: { [name]: "Kim" } }),
      ).rejects.toThrow(/external id must be a non-empty string/);
      await expect(
        createThing(db, { thingTypeId: type.id, source: " ", values: { [name]: "Kim" } }),
      ).rejects.toThrow(/source is required/);
    });

    it("lists live things by title, and trashed ones", async () => {
      const { type, name } = await person();
      for (const title of ["sam", "Alex", "Kim"]) {
        await createThing(db, { thingTypeId: type.id, values: { [name]: title } });
      }
      const [alex] = await listThings(db, type.id);
      await deleteThing(db, alex.id);
      expect((await listThings(db, type.id)).map((t) => t.values[name])).toEqual(["Kim", "sam"]);
      expect((await listThings(db, type.id, { trashed: true })).map((t) => t.id)).toEqual([
        alex.id,
      ]);
    });

    it("updates values, bumping updated_at", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_000);
      const { type, name, born } = await person();
      const alex = await createThing(db, {
        thingTypeId: type.id,
        values: { [name]: "Alex", [born]: "1990-04-01" },
      });
      vi.setSystemTime(2_000);
      const { thing, skipped } = await updateThingValues(db, alex.id, {
        [name]: "Alex Smith",
        [born]: null,
      });
      expect(skipped).toEqual([]);
      expect(thing).toMatchObject({ values: { [name]: "Alex Smith" }, updatedAt: 2_000 });
      await expect(updateThingValues(db, alex.id, { [name]: null })).rejects.toThrow(/is required/);
    });

    it("lets the user always win over automated writers", async () => {
      const { type, name, born } = await person();
      const alex = await createThing(db, { thingTypeId: type.id, values: { [name]: "Alex" } });
      const { thing, skipped } = await updateThingValues(
        db,
        alex.id,
        { [name]: "ALEX", [born]: "1990-04-01" },
        { writtenBy: "healthkit" },
      );
      expect(skipped).toEqual([name]);
      expect(thing.values).toEqual({ [name]: "Alex", [born]: "1990-04-01" });
    });

    it("deletes and restores, keeping its title while trashed", async () => {
      const { type, name } = await person();
      const alex = await createThing(db, { thingTypeId: type.id, values: { [name]: "Alex" } });
      const deletionId = await deleteThing(db, alex.id);
      expect(await getThingTitle(db, alex.id)).toBe("Alex");
      await expect(updateThingValues(db, alex.id, { [name]: "x" })).rejects.toThrow(/not found/);
      await expect(deleteThing(db, alex.id)).rejects.toThrow(/not found/);

      await restoreThingRecords(db, deletionId);
      expect((await getThing(db, alex.id))?.deletedAt).toBeNull();
      await expect(restoreThingRecords(db, deletionId)).rejects.toThrow(/nothing in the trash/);
    });

    it("cannot be restored while its type is deleted by another deletion", async () => {
      const { type, name } = await person();
      const alex = await createThing(db, { thingTypeId: type.id, values: { [name]: "Alex" } });
      const deletionId = await deleteThing(db, alex.id);
      await deleteThingType(db, type.id);
      await expect(restoreThingRecords(db, deletionId)).rejects.toThrow(
        `Thing ${alex.id}: cannot be restored while its parent is deleted`,
      );
    });

    it("cannot be restored once purged", async () => {
      const { type, name } = await person();
      const alex = await createThing(db, { thingTypeId: type.id, values: { [name]: "Alex" } });
      const deletionId = await deleteThing(db, alex.id);
      // The purge operation does not exist yet, so write the tombstone it will leave.
      await db.execute("DELETE FROM thing_field_values WHERE thing_id = ?", [alex.id]);
      await db.execute(
        "UPDATE things SET purged_at = 1, source = NULL, external_id = NULL WHERE id = ?",
        [alex.id],
      );
      await expect(restoreThingRecords(db, deletionId)).rejects.toThrow(/purged/);
      expect(await getThing(db, alex.id)).toBeUndefined();
      expect(await getThingTitle(db, alex.id)).toBeUndefined();
    });

    it("refers to other things, which stay referenced once deleted", async () => {
      const { type: people, name } = await person();
      const alex = await createThing(db, { thingTypeId: people.id, values: { [name]: "Alex" } });
      const movie: ThingType = await createThingType(db, {
        name: "Movie",
        fields: [
          { name: "Title", valueType: "text", required: true },
          { name: "Director", valueType: "ref", constraints: { thingTypeId: people.id } },
        ],
      });
      const [title, director] = (await getThingTypeVersionFields(db, movie.id)).map((f) => f.id);
      const alien = await createThing(db, {
        thingTypeId: movie.id,
        values: { [title]: "Alien", [director]: alex.id },
      });
      await deleteThing(db, alex.id);
      const { thing } = await updateThingValues(db, alien.id, { [title]: "Aliens" });
      expect(thing.values[director]).toBe(alex.id);
      await expect(
        createThing(db, {
          thingTypeId: movie.id,
          values: { [title]: "Heat", [director]: alex.id },
        }),
      ).rejects.toThrow(/is deleted/);
    });
  });
});
