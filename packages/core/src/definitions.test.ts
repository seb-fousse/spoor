import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addField,
  countFieldValues,
  createFields,
  type DefinitionTables,
  deleteField,
  draftFields,
  getFields,
  LOG_TABLES,
  MANUAL,
  type NewField,
  readValues,
  reorderFields,
  setValues,
  THING_TABLES,
  updateField,
  type ValueRecord,
  validateValues,
  writeValues,
} from "./definitions";
import { newId } from "./ids";
import type { Database } from "./platform/index";
import { migrate } from "./schema/migrate";
import { TABLE_COLUMNS } from "./schema/tables";
import { createInMemoryDatabase } from "./testing/in-memory-database";
import { transaction } from "./transaction";

// Exercised through the thing tables; another slice's descriptor reuses all of it.
const T = THING_TABLES;
const AT = 1_000;

describe.each<DefinitionTables>([THING_TABLES, LOG_TABLES])("descriptor $typeKind", (tables) => {
  it("names real tables and columns", () => {
    const has = (table: keyof typeof TABLE_COLUMNS, column: string) =>
      expect(Object.keys(TABLE_COLUMNS[table]), `${table}.${column}`).toContain(column);
    for (const table of [tables.fields, tables.records]) has(table, tables.typeIdColumn);
    for (const column of ["value_type", "required", "constraints", "option_labels"]) {
      has(tables.fields, column);
    }
    has(tables.values, tables.recordIdColumn);
    has(tables.types, "updated_at");
  });
});

describe("definitions", () => {
  let db: Database & { close(): void };

  beforeEach(async () => {
    db = createInMemoryDatabase();
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  /** A thing type with `fields`, as the things repository creates one. */
  const createType = async (fields: readonly NewField[], name = "Person") => {
    const id = newId();
    const drafts = draftFields(T, fields);
    await db.execute(
      `INSERT INTO thing_types (id, name, title_field_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [id, name, drafts[0]?.id ?? newId(), AT, AT],
    );
    await createFields(db, T, id, drafts, AT);
    return { id, fieldIds: drafts.map((d) => d.id) };
  };

  const createThing = async (typeId: string): Promise<ValueRecord> => {
    const id = newId();
    await db.execute(
      `INSERT INTO things (id, thing_type_id, source, created_at, updated_at)
       VALUES (?, ?, 'manual', ?, ?)`,
      [id, typeId, AT, AT],
    );
    return { id, typeId };
  };

  const valueRows = (thingId: string) =>
    db.query<Record<string, unknown>>(
      "SELECT * FROM thing_field_values WHERE thing_id = ? ORDER BY value_ref, field_id",
      [thingId],
    );

  const updatedAt = async (thingId: string) =>
    (
      await db.query<{ updated_at: number }>("SELECT updated_at FROM things WHERE id = ?", [
        thingId,
      ])
    )[0].updated_at;

  const manual = (writtenAt = 2_000) => ({ writtenBy: MANUAL, writtenAt });

  describe("creating a type", () => {
    it("writes fields in input order with canonical shapes", async () => {
      const { id, fieldIds } = await createType([
        { name: " Name ", valueType: "text", required: true },
        {
          name: "Mood",
          valueType: "enum",
          constraints: {
            options: [
              { order: 2, key: "b" },
              { key: "a", order: 1 },
            ],
          },
          optionLabels: { a: " Happy " },
        },
      ]);
      expect(await getFields(db, T, id)).toEqual([
        {
          id: fieldIds[0],
          typeId: id,
          name: "Name",
          position: 0,
          optionLabels: {},
          shape: { valueType: "text", constraints: {} },
          required: true,
          createdAt: AT,
          updatedAt: AT,
        },
        expect.objectContaining({
          id: fieldIds[1],
          position: 1,
          optionLabels: { a: "Happy" },
          shape: {
            valueType: "enum",
            constraints: {
              options: [
                { key: "a", order: 1 },
                { key: "b", order: 2 },
              ],
            },
          },
          required: false,
        }),
      ]);
      expect(
        await db.query("SELECT constraints FROM thing_fields WHERE id = ?", [fieldIds[1]]),
      ).toEqual([{ constraints: '{"options":[{"key":"a","order":1},{"key":"b","order":2}]}' }]);
    });

    it.each([
      ["a blank name", { name: " ", valueType: "text" }, /Thing field .*: name is required/],
      ["a metric-only type", { name: "x", valueType: "multi_enum" }, /value type must be one of/],
      ["bad constraints", { name: "x", valueType: "number", constraints: { min: "1" } }, /min/],
      ["bad labels", { name: "x", valueType: "text", optionLabels: { a: "" } }, /label/],
    ])("refuses a field with %s, naming it", (_, field, message) => {
      expect(() => draftFields(T, [field as NewField])).toThrow(message);
    });

    it("refuses two fields with the same name", () => {
      expect(() =>
        draftFields(T, [
          { name: "Title", valueType: "text" },
          { name: " TITLE", valueType: "number" },
        ]),
      ).toThrow(/Thing field .*: name "TITLE" is already used by field/);
    });

    it("refuses a reference to a thing type that does not exist", async () => {
      const missing = newId();
      await expect(
        createType([{ name: "Friend", valueType: "ref", constraints: { thingTypeId: missing } }]),
      ).rejects.toThrow(new RegExp(`Thing field .*: thing type ${missing} not found`));
    });

    it("allows a type to reference itself", async () => {
      const id = newId();
      const drafts = draftFields(T, [
        { name: "Name", valueType: "text", required: true },
        { name: "Friends", valueType: "multi_ref", constraints: { thingTypeId: id } },
      ]);
      await db.execute(
        `INSERT INTO thing_types (id, name, title_field_id, created_at, updated_at)
         VALUES (?, 'Person', ?, 0, 0)`,
        [id, drafts[0].id],
      );
      await createFields(db, T, id, drafts, AT);
      expect(await getFields(db, T, id)).toHaveLength(2);
    });

    it("runs inside the caller's transaction", async () => {
      await expect(
        transaction(db, () => createType([{ name: "Name", valueType: "text" }])),
      ).resolves.toBeDefined();
    });
  });

  describe("adding fields", () => {
    const fields: NewField[] = [
      { name: "Name", valueType: "text", required: true },
      { name: "Rating", valueType: "number", constraints: { min: 1, max: 5 } },
    ];

    it("adds a field after the others", async () => {
      const { id, fieldIds } = await createType(fields);
      const seen = await addField(db, T, id, { name: "Seen", valueType: "boolean" }, 2_000);
      expect((await getFields(db, T, id)).map((f) => [f.id, f.position, f.createdAt])).toEqual([
        [fieldIds[0], 0, AT],
        [fieldIds[1], 1, AT],
        [seen, 2, 2_000],
      ]);
    });

    it("requires unique names, ignoring case and surrounding spaces", async () => {
      const { id, fieldIds } = await createType(fields);
      await expect(
        addField(db, T, id, { name: " name ", valueType: "text" }, 2_000),
      ).rejects.toThrow(new RegExp(`name "name" is already used by field ${fieldIds[0]}`));
      // A deleted field's name is free again.
      await deleteField(db, T, fieldIds[1]);
      await addField(db, T, id, { name: "Rating", valueType: "text" }, 2_000);
    });

    it("refuses a reference to a deleted or archived thing type", async () => {
      const { id } = await createType(fields);
      const gone = await createType(fields, "Gone");
      await db.execute("DELETE FROM thing_types WHERE id = ?", [gone.id]);
      const ref = (thingTypeId: string) => ({
        name: "Ref",
        valueType: "ref" as const,
        constraints: { thingTypeId },
      });
      await expect(addField(db, T, id, ref(gone.id), 2_000)).rejects.toThrow(
        /thing type .* not found/,
      );
      const target = await createType(fields, "Target");
      await db.execute("UPDATE thing_types SET archived_at = 1 WHERE id = ?", [target.id]);
      await expect(addField(db, T, id, ref(target.id), 2_000)).rejects.toThrow(
        new RegExp(`thing type ${target.id} is archived`),
      );
      await expect(createType([ref(target.id)], "New")).rejects.toThrow(/is archived/);
    });

    it("refuses an unknown type", async () => {
      await expect(addField(db, T, newId(), fields[0], 2_000)).rejects.toThrow(
        /Thing type .*: not found/,
      );
    });
  });

  describe("updating, reordering and deleting fields", () => {
    it("renames and relabels", async () => {
      const { id, fieldIds } = await createType([{ name: "Name", valueType: "text" }]);
      await updateField(db, T, fieldIds[0], { name: " Title ", optionLabels: { a: "A" } }, 2_000);
      expect((await getFields(db, T, id))[0]).toMatchObject({
        name: "Title",
        optionLabels: { a: "A" },
        updatedAt: 2_000,
      });
      await expect(updateField(db, T, fieldIds[0], { name: "" }, 2_000)).rejects.toThrow(
        /name is required/,
      );
      await expect(updateField(db, T, newId(), {}, 2_000)).rejects.toThrow(
        /Thing field .*: not found/,
      );
    });

    it("keeps option labels a patch leaves out, and clears them with {}", async () => {
      const { id, fieldIds } = await createType([
        {
          name: "Mood",
          valueType: "enum",
          constraints: { options: [{ key: "a", order: 1 }] },
          optionLabels: { a: "Happy" },
        },
      ]);
      const labels = async () => (await getFields(db, T, id))[0].optionLabels;
      await updateField(db, T, fieldIds[0], { required: true }, 2_000);
      expect(await labels()).toEqual({ a: "Happy" });
      await updateField(db, T, fieldIds[0], { optionLabels: {} }, 3_000);
      expect(await labels()).toEqual({});
    });

    it("changes the required flag and constraints for the same value type", async () => {
      const { id, fieldIds } = await createType([
        { name: "Rating", valueType: "number", constraints: { min: 1, max: 5 } },
      ]);
      await updateField(db, T, fieldIds[0], { required: true, constraints: { max: 10 } }, 2_000);
      expect((await getFields(db, T, id))[0]).toMatchObject({
        required: true,
        shape: { valueType: "number", constraints: { max: 10 } },
      });
      await expect(
        updateField(db, T, fieldIds[0], { constraints: { options: [] } }, 2_000),
      ).rejects.toThrow(/options/);
      await expect(
        updateField(db, T, fieldIds[0], { required: "yes" as never }, 2_000),
      ).rejects.toThrow(/required must be true or false/);
    });

    it("keeps the thing type a reference field refers to", async () => {
      const person = await createType([{ name: "Name", valueType: "text" }]);
      const other = await createType([{ name: "Name", valueType: "text" }], "Other");
      const { fieldIds } = await createType(
        [{ name: "Friend", valueType: "ref", constraints: { thingTypeId: person.id } }],
        "Group",
      );
      await expect(
        updateField(db, T, fieldIds[0], { constraints: { thingTypeId: other.id } }, 2_000),
      ).rejects.toThrow(`Thing field ${fieldIds[0]}: cannot change the thing type it refers to`);
      await updateField(db, T, fieldIds[0], { constraints: { thingTypeId: person.id } }, 2_000);
    });

    it("refuses a rename to another field's name, but not to its own in another case", async () => {
      const { fieldIds } = await createType([
        { name: "Title", valueType: "text" },
        { name: "Year", valueType: "number" },
      ]);
      await expect(updateField(db, T, fieldIds[1], { name: "title " }, 2_000)).rejects.toThrow(
        /already used/,
      );
      await updateField(db, T, fieldIds[0], { name: "TITLE" }, 2_000);
    });

    it("reorders the type's fields, each listed once", async () => {
      const { id, fieldIds } = await createType([
        { name: "A", valueType: "text" },
        { name: "B", valueType: "text" },
        { name: "C", valueType: "text" },
      ]);
      const [a, b, c] = fieldIds;
      await reorderFields(db, T, id, [c, a, b], 2_000);
      expect((await getFields(db, T, id)).map((f) => f.name)).toEqual(["C", "A", "B"]);
      await expect(reorderFields(db, T, id, [c, a], 2_000)).rejects.toThrow(
        /each of its fields once/,
      );
      await expect(reorderFields(db, T, id, [c, a, a], 2_000)).rejects.toThrow(
        /each of its fields once/,
      );
    });

    it("counts, then deletes a field's values with it", async () => {
      const person = await createType([{ name: "Name", valueType: "text" }]);
      const { id, fieldIds } = await createType(
        [
          { name: "Title", valueType: "text" },
          { name: "Cast", valueType: "multi_ref", constraints: { thingTypeId: person.id } },
        ],
        "Movie",
      );
      const [title, cast] = fieldIds;
      const people = [await createThing(person.id), await createThing(person.id)];
      for (const t of ["Alien", "Heat"]) {
        const movie = await createThing(id);
        await setValues(
          db,
          T,
          movie,
          { [title]: t, [cast]: t === "Alien" ? people.map((p) => p.id) : [] },
          manual(),
        );
      }
      // Two rows for one movie: records are counted, not rows.
      expect(await countFieldValues(db, T, cast)).toBe(1);
      expect(await countFieldValues(db, T, title)).toBe(2);
      await deleteField(db, T, cast);
      expect((await getFields(db, T, id)).map((f) => f.id)).toEqual([title]);
      expect(
        await db.query("SELECT id FROM thing_field_values WHERE field_id = ?", [cast]),
      ).toEqual([]);
      await expect(deleteField(db, T, cast)).rejects.toThrow(/not found/);
      await expect(countFieldValues(db, T, cast)).rejects.toThrow(/not found/);
    });
  });

  describe("values", () => {
    /** A Person type and a Movie type covering every field value type. */
    const setup = async () => {
      const person = await createType([{ name: "Name", valueType: "text", required: true }]);
      const movie = await createType(
        [
          { name: "Title", valueType: "text", required: true },
          { name: "Year", valueType: "number" },
          {
            name: "Format",
            valueType: "enum",
            constraints: { options: [{ key: "cinema", order: 1 }] },
          },
          { name: "Seen", valueType: "boolean" },
          { name: "Watched on", valueType: "date" },
          { name: "Released", valueType: "datetime" },
          { name: "Director", valueType: "ref", constraints: { thingTypeId: person.id } },
          { name: "With", valueType: "multi_ref", constraints: { thingTypeId: person.id } },
        ],
        "Movie",
      );
      const [title, year, format, seen, watched, released, director, withPeople] = movie.fieldIds;
      const people = [];
      for (const name of ["Alex", "Sam", "Kim"]) {
        const thing = await createThing(person.id);
        await setValues(db, T, thing, { [person.fieldIds[0]]: name }, manual(AT));
        people.push(thing.id);
      }
      return {
        person,
        movie,
        people,
        f: { title, year, format, seen, watched, released, director, withPeople },
      };
    };

    it("writes one row per value and one per referenced thing, and reads them back", async () => {
      const { movie, people, f } = await setup();
      const thing = await createThing(movie.id);
      const values = {
        [f.title]: "Alien",
        [f.year]: 1979,
        [f.format]: "cinema",
        [f.seen]: false,
        [f.watched]: "2026-10-27",
        [f.released]: Date.UTC(1979, 4, 25),
        [f.director]: people[0],
        [f.withPeople]: [people[2], people[1]],
      };
      await setValues(db, T, thing, values, manual());
      expect(await readValues(db, T, thing)).toEqual({
        ...values,
        [f.withPeople]: [people[1], people[2]].sort(),
      });
      const rows = await valueRows(thing.id);
      expect(rows).toHaveLength(9);
      expect(rows.find((r) => r.field_id === f.seen)).toMatchObject({
        value_bool: 0,
        value_text: null,
        written_by: "manual",
        written_at: 2_000,
      });
      expect(await updatedAt(thing.id)).toBe(2_000);
    });

    it("clears an optional value by removing its rows", async () => {
      const { movie, people, f } = await setup();
      const thing = await createThing(movie.id);
      await setValues(
        db,
        T,
        thing,
        { [f.title]: "Alien", [f.year]: 1979, [f.withPeople]: people },
        manual(),
      );
      await setValues(db, T, thing, { [f.year]: null, [f.withPeople]: [] }, manual());
      expect(await readValues(db, T, thing)).toEqual({ [f.title]: "Alien" });
      expect(await valueRows(thing.id)).toHaveLength(1);
    });

    it("updates rows in place and diffs multi_ref members", async () => {
      const { movie, people, f } = await setup();
      const thing = await createThing(movie.id);
      await setValues(
        db,
        T,
        thing,
        { [f.title]: "Alien", [f.withPeople]: [people[0], people[1]] },
        manual(),
      );
      const before = await valueRows(thing.id);
      await setValues(
        db,
        T,
        thing,
        { [f.title]: "Aliens", [f.withPeople]: [people[1], people[2]] },
        manual(3_000),
      );
      const after = await valueRows(thing.id);
      const idOf = (rows: Record<string, unknown>[], match: Record<string, unknown>) =>
        rows.find((r) => Object.entries(match).every(([k, v]) => r[k] === v))?.id;
      expect(idOf(after, { field_id: f.title })).toBe(idOf(before, { field_id: f.title }));
      expect(idOf(after, { value_ref: people[1] })).toBe(idOf(before, { value_ref: people[1] }));
      expect(idOf(after, { value_ref: people[0] })).toBeUndefined();
      // The field is written as a whole, so the kept member's provenance moves too.
      expect(after.filter((r) => r.field_id === f.withPeople).map((r) => r.written_at)).toEqual([
        3_000, 3_000,
      ]);
    });

    it("leaves unchanged values and the record's updated_at alone", async () => {
      const { movie, people, f } = await setup();
      const thing = await createThing(movie.id);
      await setValues(db, T, thing, { [f.title]: "Alien", [f.withPeople]: [people[0]] }, manual());
      const before = await valueRows(thing.id);
      const changed = await transaction(db, async () => {
        const values = await validateValues(db, T, thing, {
          [f.title]: "Alien",
          [f.withPeople]: [people[0]],
        });
        return writeValues(db, T, thing.id, values, manual(5_000));
      });
      expect(changed).toBe(false);
      expect(await valueRows(thing.id)).toEqual(before);
      expect(await updatedAt(thing.id)).toBe(2_000);
    });

    it("refuses a field not of the record's type, naming the record and field", async () => {
      const { movie, person } = await setup();
      const thing = await createThing(movie.id);
      const foreign = person.fieldIds[0];
      await expect(validateValues(db, T, thing, { [foreign]: "x" })).rejects.toThrow(
        `Thing ${thing.id}, field ${foreign}: not a field of thing type ${movie.id}`,
      );
    });

    it("refuses an invalid value, naming the record and field", async () => {
      const { movie, f } = await setup();
      const thing = await createThing(movie.id);
      await expect(
        validateValues(db, T, thing, { [f.title]: "Alien", [f.year]: "1979" }),
      ).rejects.toThrow(`Thing ${thing.id}, field ${f.year}: must be a number`);
    });

    it("requires required fields, counting an empty multi_ref as missing", async () => {
      const { person, movie, f } = await setup();
      const thing = await createThing(movie.id);
      await expect(validateValues(db, T, thing, { [f.year]: 1 })).rejects.toThrow(
        `Thing ${thing.id}, field ${f.title}: is required`,
      );
      await setValues(db, T, thing, { [f.title]: "Alien" }, manual());
      // Once stored, a patch need not repeat it, but cannot clear it.
      await expect(validateValues(db, T, thing, { [f.year]: 1 })).resolves.toHaveLength(1);
      await expect(validateValues(db, T, thing, { [f.title]: null })).rejects.toThrow(
        /is required/,
      );

      const group = await createType(
        [
          {
            name: "Members",
            valueType: "multi_ref",
            required: true,
            constraints: { thingTypeId: person.id },
          },
        ],
        "Group",
      );
      const g = await createThing(group.id);
      await expect(validateValues(db, T, g, { [group.fieldIds[0]]: [] })).rejects.toThrow(
        /is required/,
      );
    });

    it("refuses references to missing things and things of another type", async () => {
      const { movie, f } = await setup();
      const thing = await createThing(movie.id);
      const missing = newId();
      await expect(
        validateValues(db, T, thing, { [f.title]: "Alien", [f.director]: missing }),
      ).rejects.toThrow(`Thing ${thing.id}, field ${f.director}: thing ${missing} not found`);

      const other = await createThing(movie.id);
      await setValues(db, T, other, { [f.title]: "Other" }, manual());
      await expect(
        validateValues(db, T, thing, { [f.title]: "Alien", [f.withPeople]: [other.id] }),
      ).rejects.toThrow(`thing ${other.id} is not of thing type`);
    });

    it("drops stored references to a deleted thing, and refuses new ones", async () => {
      const { movie, people, f } = await setup();
      const thing = await createThing(movie.id);
      await setValues(
        db,
        T,
        thing,
        { [f.title]: "Alien", [f.director]: people[0], [f.withPeople]: [people[0]] },
        manual(),
      );
      await db.execute("DELETE FROM things WHERE id = ?", [people[0]]);

      expect(await readValues(db, T, thing)).toEqual({ [f.title]: "Alien" });
      await expect(
        validateValues(db, T, thing, { [f.withPeople]: [people[0], people[1]] }),
      ).rejects.toThrow(`Thing ${thing.id}, field ${f.withPeople}: thing ${people[0]} not found`);
    });

    it("lets the user always win over automated writers", async () => {
      const { movie, f } = await setup();
      const thing = await createThing(movie.id);
      const plugin = (writtenAt: number) => ({ writtenBy: "plugin:tmdb", writtenAt });

      await setValues(db, T, thing, { [f.title]: "Alien" }, manual());
      expect(
        await setValues(db, T, thing, { [f.title]: "ALIEN", [f.year]: 1979 }, plugin(3_000)),
      ).toEqual({ skipped: [f.title] });
      expect(await readValues(db, T, thing)).toEqual({ [f.title]: "Alien", [f.year]: 1979 });

      // A writer overwrites its own values; the user overwrites anyone's.
      await setValues(db, T, thing, { [f.year]: 1980 }, plugin(4_000));
      await setValues(db, T, thing, { [f.year]: 1981 }, manual(5_000));
      expect(await setValues(db, T, thing, { [f.year]: 1982 }, plugin(6_000))).toEqual({
        skipped: [f.year],
      });
      expect((await valueRows(thing.id)).find((r) => r.field_id === f.year)).toMatchObject({
        value_num: 1981,
        written_by: "manual",
        written_at: 5_000,
      });
    });

    it("requires a writer", async () => {
      const { movie, f } = await setup();
      const thing = await createThing(movie.id);
      const values = await validateValues(db, T, thing, { [f.title]: "Alien" });
      await expect(
        writeValues(db, T, thing.id, values, { writtenBy: " ", writtenAt: 1 }),
      ).rejects.toThrow(/a writer is required/);
    });

    it("reads values against the type's fields, as they are now", async () => {
      const { movie, f } = await setup();
      const thing = await createThing(movie.id);
      await setValues(db, T, thing, { [f.title]: "Alien", [f.year]: 1979 }, manual());
      // A constraint added since is not applied to the stored value.
      await updateField(db, T, f.year, { constraints: { min: 2000 } }, 3_000);
      expect(await readValues(db, T, thing)).toEqual({ [f.title]: "Alien", [f.year]: 1979 });
      await deleteField(db, T, f.year);
      expect(await readValues(db, T, thing)).toEqual({ [f.title]: "Alien" });
    });
  });
});
