import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createFirstVersion,
  type DefinitionTables,
  draftFields,
  getVersionFields,
  MANUAL,
  type NewField,
  readValues,
  reorderFields,
  reviseFields,
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

describe.each<DefinitionTables>([THING_TABLES])("descriptor $typeKind", (tables) => {
  it("names real tables and columns", () => {
    const has = (table: keyof typeof TABLE_COLUMNS, column: string) =>
      expect(Object.keys(TABLE_COLUMNS[table]), `${table}.${column}`).toContain(column);
    for (const table of [
      tables.typeVersions,
      tables.fields,
      tables.fieldVersions,
      tables.records,
    ]) {
      has(table, tables.typeIdColumn);
    }
    has(tables.fieldVersions, tables.typeVersionColumn);
    has(tables.records, tables.typeVersionColumn);
    has(tables.values, tables.recordIdColumn);
    has(tables.types, "schema_version");
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

  /** A thing type with `fields` at version 1, as the things repository will create one. */
  const createType = async (fields: readonly NewField[], name = "Person") => {
    const id = newId();
    const drafts = draftFields(T, fields);
    await db.execute(
      `INSERT INTO thing_types (id, name, title_field_id, schema_version, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?)`,
      [id, name, drafts[0]?.id ?? newId(), AT, AT],
    );
    await createFirstVersion(db, T, id, drafts, AT);
    return { id, fieldIds: drafts.map((d) => d.id) };
  };

  const createThing = async (typeId: string, version = 1): Promise<ValueRecord> => {
    const id = newId();
    await db.execute(
      `INSERT INTO things (id, thing_type_id, thing_type_version, source, created_at, updated_at)
       VALUES (?, ?, ?, 'manual', ?, ?)`,
      [id, typeId, version, AT, AT],
    );
    return { id, typeId, typeVersion: version };
  };

  const schemaVersion = async (typeId: string) =>
    (
      await db.query<{ schema_version: number }>(
        "SELECT schema_version FROM thing_types WHERE id = ?",
        [typeId],
      )
    )[0].schema_version;

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
    it("writes version 1 with fields in input order and canonical shapes", async () => {
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
      expect(await getVersionFields(db, T, id, 1)).toEqual([
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
      expect(await schemaVersion(id)).toBe(1);
      expect(
        await db.query("SELECT constraints FROM thing_field_versions WHERE field_id = ?", [
          fieldIds[1],
        ]),
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
        `INSERT INTO thing_types (id, name, title_field_id, schema_version, created_at, updated_at)
         VALUES (?, 'Person', ?, 1, 0, 0)`,
        [id, drafts[0].id],
      );
      await createFirstVersion(db, T, id, drafts, AT);
      expect(await getVersionFields(db, T, id, 1)).toHaveLength(2);
    });

    it("refuses a type that already has versions", async () => {
      const { id } = await createType([{ name: "Name", valueType: "text" }]);
      await db.execute("UPDATE thing_types SET schema_version = 2 WHERE id = ?", [id]);
      await expect(createFirstVersion(db, T, id, [], AT)).rejects.toThrow(/already has version 2/);
    });

    it("runs inside the caller's transaction", async () => {
      await expect(
        transaction(db, () => createType([{ name: "Name", valueType: "text" }])),
      ).resolves.toBeDefined();
    });
  });

  describe("revising fields", () => {
    const fields: NewField[] = [
      { name: "Name", valueType: "text", required: true },
      { name: "Rating", valueType: "number", constraints: { min: 1, max: 5 } },
    ];

    it("creates no version when only names, labels and order change", async () => {
      const { id, fieldIds } = await createType(fields);
      const [name, rating] = fieldIds;
      const result = await reviseFields(
        db,
        T,
        id,
        [
          { ...fields[1], id: rating, name: "Score", optionLabels: { x: "X" } },
          { ...fields[0], id: name },
        ],
        2_000,
      );
      expect(result).toEqual({ version: 1, created: false });
      expect(await schemaVersion(id)).toBe(1);
      expect(
        (await getVersionFields(db, T, id, 1)).map((f) => [f.name, f.position, f.updatedAt]),
      ).toEqual([
        ["Score", 0, 2_000],
        ["Name", 1, 2_000],
      ]);
    });

    it("keeps option labels a revision leaves out, and clears them with {}", async () => {
      const mood: NewField = {
        name: "Mood",
        valueType: "enum",
        constraints: { options: [{ key: "a", order: 1 }] },
        optionLabels: { a: "Happy" },
      };
      const { id, fieldIds } = await createType([fields[0], mood]);
      const labels = async () => (await getVersionFields(db, T, id, 1))[1].optionLabels;
      const { optionLabels: _, ...unlabelled } = mood;
      await reviseFields(
        db,
        T,
        id,
        [
          { ...fields[0], id: fieldIds[0] },
          { ...unlabelled, id: fieldIds[1] },
        ],
        2_000,
      );
      expect(await labels()).toEqual({ a: "Happy" });
      await reviseFields(
        db,
        T,
        id,
        [
          { ...fields[0], id: fieldIds[0] },
          { ...unlabelled, id: fieldIds[1], optionLabels: {} },
        ],
        3_000,
      );
      expect(await labels()).toEqual({});
    });

    it("leaves untouched fields' rows alone", async () => {
      const { id, fieldIds } = await createType(fields);
      await reviseFields(
        db,
        T,
        id,
        [
          { ...fields[0], id: fieldIds[0] },
          { ...fields[1], id: fieldIds[1] },
        ],
        2_000,
      );
      expect((await getVersionFields(db, T, id, 1)).map((f) => f.updatedAt)).toEqual([AT, AT]);
    });

    it.each([
      [
        "a shape changes",
        (ids: string[]) => [
          { ...fields[0], id: ids[0] },
          { ...fields[1], id: ids[1], constraints: { min: 1, max: 10 } },
        ],
      ],
      [
        "a required flag changes",
        (ids: string[]) => [
          { ...fields[0], id: ids[0], required: false },
          { ...fields[1], id: ids[1] },
        ],
      ],
      [
        "a field is added",
        (ids: string[]) => [
          { ...fields[0], id: ids[0] },
          { ...fields[1], id: ids[1] },
          { name: "Seen", valueType: "boolean" as const },
        ],
      ],
      ["a field is left out", (ids: string[]) => [{ ...fields[0], id: ids[0] }]],
    ])("creates version 2 when %s, keeping version 1", async (_, revise) => {
      const { id, fieldIds } = await createType(fields);
      const v1 = await getVersionFields(db, T, id, 1);
      const inputs = revise(fieldIds);
      expect(await reviseFields(db, T, id, inputs, 2_000)).toEqual({ version: 2, created: true });
      expect(await schemaVersion(id)).toBe(2);
      // Version 1 still reads the same shapes; names and positions are not versioned.
      expect(
        (await getVersionFields(db, T, id, 1)).map((f) => [f.id, f.shape, f.required]),
      ).toEqual(v1.map((f) => [f.id, f.shape, f.required]));
      const v2 = await getVersionFields(db, T, id, 2);
      expect(v2).toHaveLength(inputs.length);
      expect(v2.map((f) => f.position)).toEqual(inputs.map((_, i) => i));
      const versionRows = await db.query(
        "SELECT * FROM thing_field_versions WHERE thing_type_version = 2",
      );
      expect(versionRows).toHaveLength(inputs.length);
    });

    it("retires a left-out field, keeping its row, and can bring it back", async () => {
      const { id, fieldIds } = await createType(fields);
      const [name, rating] = fieldIds;
      await reviseFields(db, T, id, [{ ...fields[0], id: name }], 2_000);
      expect(await db.query("SELECT id FROM thing_fields WHERE id = ?", [rating])).toHaveLength(1);

      const result = await reviseFields(
        db,
        T,
        id,
        [
          { ...fields[0], id: name },
          { ...fields[1], id: rating },
        ],
        3_000,
      );
      expect(result).toEqual({ version: 3, created: true });
      expect((await getVersionFields(db, T, id, 3)).map((f) => f.id)).toEqual([name, rating]);
    });

    it("refuses a field of another type, or one listed twice", async () => {
      const { id, fieldIds } = await createType(fields);
      const other = await createType(fields, "Other");
      await expect(
        reviseFields(db, T, id, [{ ...fields[0], id: other.fieldIds[0] }], 2_000),
      ).rejects.toThrow(
        new RegExp(`Thing field ${other.fieldIds[0]}: not a field of thing type ${id}`),
      );
      await expect(
        reviseFields(
          db,
          T,
          id,
          [
            { ...fields[0], id: fieldIds[0] },
            { ...fields[0], id: fieldIds[0] },
          ],
          2_000,
        ),
      ).rejects.toThrow(/listed twice/);
    });

    it("refuses a new reference to a deleted thing type", async () => {
      const { id, fieldIds } = await createType(fields);
      const gone = await createType(fields, "Gone");
      await db.execute("UPDATE thing_types SET deleted_at = 1, deletion_id = ? WHERE id = ?", [
        newId(),
        gone.id,
      ]);
      await expect(
        reviseFields(
          db,
          T,
          id,
          [
            { ...fields[0], id: fieldIds[0] },
            { name: "Ref", valueType: "ref", constraints: { thingTypeId: gone.id } },
          ],
          2_000,
        ),
      ).rejects.toThrow(/thing type .* not found/);
    });

    it("refuses a new reference to an archived thing type, keeping existing ones", async () => {
      const target = await createType(fields, "Target");
      const ref = {
        name: "Ref",
        valueType: "ref" as const,
        constraints: { thingTypeId: target.id },
      };
      const { id, fieldIds } = await createType([...fields, ref]);
      await db.execute("UPDATE thing_types SET archived_at = 1 WHERE id = ?", [target.id]);
      const [name, rating, existing] = fieldIds;
      const kept = [
        { ...fields[0], id: name },
        { ...fields[1], id: rating },
      ];

      // The existing field keeps its target, even when its required flag changes.
      await expect(
        reviseFields(db, T, id, [...kept, { ...ref, id: existing, required: true }], 2_000),
      ).resolves.toEqual({ version: 2, created: true });
      await expect(
        reviseFields(
          db,
          T,
          id,
          [...kept, { ...ref, id: existing }, { ...ref, name: "Ref 2" }],
          2_000,
        ),
      ).rejects.toThrow(new RegExp(`thing type ${target.id} is archived`));
      await expect(createType([ref], "New")).rejects.toThrow(/is archived/);
    });

    it("requires unique names, ignoring case and surrounding spaces", async () => {
      const { id, fieldIds } = await createType(fields);
      await expect(
        reviseFields(
          db,
          T,
          id,
          [
            { ...fields[0], id: fieldIds[0] },
            { name: " name ", valueType: "text" },
          ],
          2_000,
        ),
      ).rejects.toThrow(new RegExp(`name "name" is already used by field ${fieldIds[0]}`));

      // A retired field's name is free for a new field.
      await reviseFields(db, T, id, [{ ...fields[0], id: fieldIds[0] }], 2_000);
      await expect(
        reviseFields(
          db,
          T,
          id,
          [
            { ...fields[0], id: fieldIds[0] },
            { name: "Rating", valueType: "text" },
          ],
          3_000,
        ),
      ).resolves.toEqual({ version: 3, created: true });
    });

    it("refuses an unknown type", async () => {
      await expect(reviseFields(db, T, newId(), [], 2_000)).rejects.toThrow(
        /Thing type .*: not found/,
      );
    });
  });

  describe("updating and reordering fields", () => {
    it("renames and relabels without a version", async () => {
      const { id, fieldIds } = await createType([{ name: "Name", valueType: "text" }]);
      await updateField(db, T, fieldIds[0], { name: " Title ", optionLabels: { a: "A" } }, 2_000);
      expect((await getVersionFields(db, T, id, 1))[0]).toMatchObject({
        name: "Title",
        optionLabels: { a: "A" },
        updatedAt: 2_000,
      });
      expect(await schemaVersion(id)).toBe(1);
      await expect(updateField(db, T, fieldIds[0], { name: "" }, 2_000)).rejects.toThrow(
        /name is required/,
      );
      await expect(updateField(db, T, newId(), {}, 2_000)).rejects.toThrow(
        /Thing field .*: not found/,
      );
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

    it("reorders the current version's fields, each listed once", async () => {
      const { id, fieldIds } = await createType([
        { name: "A", valueType: "text" },
        { name: "B", valueType: "text" },
        { name: "C", valueType: "text" },
      ]);
      const [a, b, c] = fieldIds;
      await reorderFields(db, T, id, [c, a, b], 2_000);
      expect((await getVersionFields(db, T, id, 1)).map((f) => f.name)).toEqual(["C", "A", "B"]);
      expect(await schemaVersion(id)).toBe(1);
      await expect(reorderFields(db, T, id, [c, a], 2_000)).rejects.toThrow(
        /each of its fields once/,
      );
      await expect(reorderFields(db, T, id, [c, a, a], 2_000)).rejects.toThrow(
        /each of its fields once/,
      );
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

    it("refuses a field not in the record's version, naming the record and field", async () => {
      const { movie, person } = await setup();
      const thing = await createThing(movie.id);
      const foreign = person.fieldIds[0];
      await expect(validateValues(db, T, thing, { [foreign]: "x" })).rejects.toThrow(
        `Thing ${thing.id}, field ${foreign}: not a field of thing type ${movie.id} version 1`,
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

    it("refuses new references to a deleted thing but keeps stored ones valid", async () => {
      const { movie, people, f } = await setup();
      const thing = await createThing(movie.id);
      await setValues(
        db,
        T,
        thing,
        { [f.title]: "Alien", [f.director]: people[0], [f.withPeople]: [people[0]] },
        manual(),
      );
      await db.execute("UPDATE things SET deleted_at = 1, deletion_id = ? WHERE id IN (?, ?)", [
        newId(),
        people[0],
        people[1],
      ]);

      // Stored references survive edits, including re-sending them.
      await setValues(
        db,
        T,
        thing,
        { [f.title]: "Aliens", [f.director]: people[0], [f.withPeople]: [people[0], people[2]] },
        manual(),
      );
      expect((await readValues(db, T, thing))[f.director]).toBe(people[0]);

      await expect(
        validateValues(db, T, thing, { [f.withPeople]: [people[0], people[1]] }),
      ).rejects.toThrow(`Thing ${thing.id}, field ${f.withPeople}: thing ${people[1]} is deleted`);
      const fresh = await createThing(movie.id);
      await expect(
        validateValues(db, T, fresh, { [f.title]: "Alien", [f.director]: people[0] }),
      ).rejects.toThrow(/is deleted/);
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

    it("reads values against the record's own version", async () => {
      const { person, people } = await setup();
      const [name] = person.fieldIds;
      await reviseFields(
        db,
        T,
        person.id,
        [{ id: name, name: "Name", valueType: "text", required: false }],
        2_000,
      );
      const alex: ValueRecord = { id: people[0], typeId: person.id, typeVersion: 1 };
      expect(await readValues(db, T, alex)).toEqual({ [name]: "Alex" });
      await expect(readValues(db, T, { ...alex, typeVersion: 7 })).rejects.toThrow(
        /stored, but not a field of version 7/,
      );
    });
  });
});
