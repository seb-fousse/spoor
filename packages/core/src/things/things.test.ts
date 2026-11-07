import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../db/platform";
import { migrate } from "../db/schema/migrate";
import type { NewField } from "../definitions/engine";
import { createInMemoryDatabase } from "../testing/in-memory-database";
import { createCategory, getCategory } from "../timelines/categories";
import { createTimeline, getTimeline } from "../timelines/timelines";
import {
  addThingField,
  createThingType,
  deleteThingField,
  deleteThingType,
  getThingType,
  getThingTypeFields,
  listThingTypes,
  previewThingFieldDeletion,
  previewThingTypeDeletion,
  reorderThingFields,
  setThingTypeArchived,
  type ThingType,
  updateThingField,
  updateThingType,
} from "./thing-types";
import {
  createThing,
  deleteThing,
  getThing,
  getThingTitle,
  listThings,
  previewThingDeletion,
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
    const [name, born] = (await getThingTypeFields(db, type.id)).map((f) => f.id);
    return { type, name, born };
  };

  const count = async (table: string) =>
    (await db.query<{ n: number }>(`SELECT count(*) AS n FROM ${table}`))[0].n;

  describe("thing type", () => {
    it("creates, trimming text, with the first field as title", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_000);
      const type = await createThingType(db, {
        name: " Person ",
        description: " ",
        fields: [NAME, BORN],
      });
      const fields = await getThingTypeFields(db, type.id);
      expect(type).toEqual({
        id: expect.any(String),
        name: "Person",
        description: null,
        titleFieldId: fields[0].id,
        createdAt: 1_000,
        updatedAt: 1_000,
        archivedAt: null,
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
      const fields = await getThingTypeFields(db, type.id);
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

    it("lists types by name, archived included", async () => {
      const b = await createThingType(db, { name: "place", fields: [NAME] });
      await createThingType(db, { name: "Movie", fields: [NAME] });
      const c = await createThingType(db, { name: "Person", fields: [NAME] });
      await setThingTypeArchived(db, b.id, true);
      await deleteThingType(db, c.id);
      expect((await listThingTypes(db)).map((t) => t.name)).toEqual(["Movie", "place"]);
    });

    it("renames, redescribes and picks another title field", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_000);
      const { type } = await person();
      const nick = await addThingField(db, type.id, {
        name: "Nickname",
        valueType: "text",
        required: true,
      });
      vi.setSystemTime(2_000);
      const updated = await updateThingType(db, type.id, {
        name: "People",
        description: "Who",
        titleFieldId: nick,
      });
      expect(updated).toMatchObject({
        name: "People",
        description: "Who",
        titleFieldId: nick,
        updatedAt: 2_000,
      });
    });

    it("refuses a title field that is not one of its required text fields", async () => {
      const { type, born } = await person();
      await expect(updateThingType(db, type.id, { titleFieldId: born })).rejects.toThrow(
        /must be a required text field/,
      );
      const other = await person();
      await expect(updateThingType(db, type.id, { titleFieldId: other.name })).rejects.toThrow(
        /is not one of its fields/,
      );
    });

    describe("fields", () => {
      it("adds a field, which existing things lack and new ones must fill if required", async () => {
        const { type, name } = await person();
        const alex = await createThing(db, { thingTypeId: type.id, values: { [name]: "Alex" } });
        const city = await addThingField(db, type.id, {
          name: "City",
          valueType: "text",
          required: true,
        });
        expect((await getThingTypeFields(db, type.id)).map((f) => [f.name, f.position])).toEqual([
          ["Name", 0],
          ["Born", 1],
          ["City", 2],
        ]);
        expect((await getThing(db, alex.id))?.values).toEqual({ [name]: "Alex" });
        await expect(
          createThing(db, { thingTypeId: type.id, values: { [name]: "Sam" } }),
        ).rejects.toThrow(new RegExp(`field ${city}: is required`));
        await expect(
          addThingField(db, type.id, { name: "city", valueType: "text" }),
        ).rejects.toThrow(/already used/);
      });

      it("renames, relabels, requires and reorders fields", async () => {
        const { type, name, born } = await person();
        await updateThingField(db, type.id, born, { name: "Birthday", required: true });
        await reorderThingFields(db, type.id, [born, name]);
        expect((await getThingTypeFields(db, type.id)).map((f) => [f.name, f.required])).toEqual([
          ["Birthday", true],
          ["Name", true],
        ]);
        const other = await person();
        await expect(updateThingField(db, type.id, other.born, { name: "x" })).rejects.toThrow(
          /not a field of thing type/,
        );
      });

      it("previews, then deletes a field with its values", async () => {
        const { type, name, born } = await person();
        await createThing(db, {
          thingTypeId: type.id,
          values: { [name]: "Alex", [born]: "1990-01-01" },
        });
        await createThing(db, { thingTypeId: type.id, values: { [name]: "Sam" } });
        expect(await previewThingFieldDeletion(db, type.id, born)).toEqual({ values: 1 });
        await deleteThingField(db, type.id, born);
        expect((await getThingTypeFields(db, type.id)).map((f) => f.id)).toEqual([name]);
        expect(await count("thing_field_values")).toBe(2);
      });

      it("keeps the title field, required", async () => {
        const { type, name } = await person();
        await expect(deleteThingField(db, type.id, name)).rejects.toThrow(/cannot be deleted/);
        await expect(updateThingField(db, type.id, name, { required: false })).rejects.toThrow(
          /must stay required/,
        );
        await updateThingField(db, type.id, name, { constraints: { maxLength: 10 } });
      });
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

    it("previews, then deletes with its fields and things", async () => {
      const { type, name } = await person();
      const alex = await createThing(db, { thingTypeId: type.id, values: { [name]: "Alex" } });
      await createThing(db, { thingTypeId: type.id, values: { [name]: "Sam" } });
      const movie = await createThingType(db, {
        name: "Movie",
        fields: [
          NAME,
          { name: "Director", valueType: "ref", constraints: { thingTypeId: type.id } },
        ],
      });
      const [title, director] = (await getThingTypeFields(db, movie.id)).map((f) => f.id);
      const alien = await createThing(db, {
        thingTypeId: movie.id,
        values: { [title]: "Alien", [director]: alex.id },
      });
      const people = await createTimeline(db, { name: "People" });
      await db.execute("UPDATE timelines SET default_thing_type_id = ?", [type.id]);
      const category = await createCategory(db, people.id, { thingId: alex.id });

      expect(await previewThingTypeDeletion(db, type.id)).toEqual({
        things: 2,
        references: 1,
        categories: 1,
      });
      await deleteThingType(db, type.id);
      expect(await getThingType(db, type.id)).toBeUndefined();
      expect(await count("things")).toBe(1);
      expect(await count("thing_fields")).toBe(2);
      expect((await getThing(db, alien.id))?.values).toEqual({ [title]: "Alien" });
      expect(await getCategory(db, category.id)).toMatchObject({ name: "Alex", thingId: null });
      expect((await getTimeline(db, people.id))?.defaultThingTypeId).toBeNull();
      await expect(updateThingType(db, type.id, { name: "x" })).rejects.toThrow(/not found/);
    });
  });

  describe("thing", () => {
    it("creates with values against its type's fields", async () => {
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
        source: "manual",
        externalId: null,
        values: { [name]: "Alex", [born]: "1990-04-01" },
        createdAt: 1_000,
        updatedAt: 1_000,
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

    it("lists things by title", async () => {
      const { type, name } = await person();
      for (const title of ["sam", "Alex", "Kim"]) {
        await createThing(db, { thingTypeId: type.id, values: { [name]: title } });
      }
      const [alex] = await listThings(db, type.id);
      await deleteThing(db, alex.id);
      expect((await listThings(db, type.id)).map((t) => t.values[name])).toEqual(["Kim", "sam"]);
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

    it("deletes with its values", async () => {
      const { type, name } = await person();
      const alex = await createThing(db, { thingTypeId: type.id, values: { [name]: "Alex" } });
      expect(await previewThingDeletion(db, alex.id)).toEqual({
        things: 1,
        references: 0,
        categories: 0,
      });
      await deleteThing(db, alex.id);
      expect(await getThing(db, alex.id)).toBeUndefined();
      expect(await getThingTitle(db, alex.id)).toBeUndefined();
      expect(await count("thing_field_values")).toBe(0);
      await expect(updateThingValues(db, alex.id, { [name]: "x" })).rejects.toThrow(/not found/);
      await expect(deleteThing(db, alex.id)).rejects.toThrow(/not found/);
    });

    it("refers to other things, losing the reference when one is deleted", async () => {
      const { type: people, name } = await person();
      const alex = await createThing(db, { thingTypeId: people.id, values: { [name]: "Alex" } });
      const movie: ThingType = await createThingType(db, {
        name: "Movie",
        fields: [
          { name: "Title", valueType: "text", required: true },
          { name: "Director", valueType: "ref", constraints: { thingTypeId: people.id } },
        ],
      });
      const [title, director] = (await getThingTypeFields(db, movie.id)).map((f) => f.id);
      const alien = await createThing(db, {
        thingTypeId: movie.id,
        values: { [title]: "Alien", [director]: alex.id },
      });
      expect(await previewThingDeletion(db, alex.id)).toMatchObject({ references: 1 });
      await deleteThing(db, alex.id);
      expect((await getThing(db, alien.id))?.values).toEqual({ [title]: "Alien" });
      await expect(
        createThing(db, {
          thingTypeId: movie.id,
          values: { [title]: "Heat", [director]: alex.id },
        }),
      ).rejects.toThrow(new RegExp(`thing ${alex.id} not found`));
    });
  });
});
