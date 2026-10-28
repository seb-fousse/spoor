import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newId } from "./ids";
import {
  createLogEntry,
  createLogType,
  deleteLogEntry,
  deleteLogType,
  entryDay,
  getLogEntry,
  getLogType,
  getLogTypeVersionFields,
  type LogType,
  listChildEntries,
  listLogEntries,
  listLogTypes,
  logFieldInput,
  moveChildEntry,
  type NewLogField,
  previewLogTypeDeletion,
  reorderLogFields,
  restoreLogRecords,
  reviseLogTypeFields,
  setLogTypeArchived,
  updateLogEntry,
  updateLogField,
  updateLogType,
} from "./logs";
import { mergeThings } from "./merge";
import type { Database } from "./platform/index";
import { migrate } from "./schema/migrate";
import { setTimeZone } from "./settings";
import { createInMemoryDatabase } from "./testing/in-memory-database";
import { createThing, createThingType, deleteThing } from "./things";

const H = 3_600_000;
const TZ = "Europe/Paris";
const T0 = Date.UTC(2026, 9, 27, 16, 30);

describe("logs", () => {
  let db: Database & { close(): void };

  beforeEach(async () => {
    db = createInMemoryDatabase();
    await migrate(db);
    await setTimeZone(db, TZ);
  });

  afterEach(() => {
    db.close();
    vi.useRealTimers();
  });

  /** A thing type whose things have just a name, which is their title. */
  const thingType = async (name: string) => {
    const type = await createThingType(db, {
      name,
      fields: [{ name: "Name", valueType: "text", required: true }],
    });
    return { id: type.id, nameField: type.titleFieldId };
  };

  const thing = async (type: { id: string; nameField: string }, name: string) =>
    (await createThing(db, { thingTypeId: type.id, values: { [type.nameField]: name } })).id;

  /** A "Movie watched" type with a field of every value type, and the things it refers to. */
  const setupMovies = async () => {
    const person = await thingType("Person");
    const movie = await thingType("Movie");
    const alien = await thing(movie, "Alien");
    const people = [
      await thing(person, "Alex"),
      await thing(person, "Sam"),
      await thing(person, "Kim"),
    ];
    const type = await createLogType(db, {
      name: "Movie watched",
      fields: [
        { name: "Movie", valueType: "ref", required: true, constraints: { thingTypeId: movie.id } },
        { name: "Rating", valueType: "number", constraints: { min: 1, max: 5 } },
        {
          name: "Format",
          valueType: "enum",
          constraints: {
            options: [
              { key: "cinema", order: 1 },
              { key: "streaming", order: 2 },
            ],
          },
        },
        { name: "Review", valueType: "text" },
        { name: "Rewatch", valueType: "boolean" },
        { name: "Released", valueType: "date" },
        { name: "Booked at", valueType: "datetime" },
        { name: "With", valueType: "multi_ref", constraints: { thingTypeId: person.id } },
      ],
    });
    const fields = await getLogTypeVersionFields(db, type.id);
    const [film, rating, format, review, rewatch, released, booked, withPeople] = fields.map(
      (f) => f.id,
    );
    return {
      type,
      person,
      movie,
      alien,
      people,
      f: { film, rating, format, review, rewatch, released, booked, withPeople },
    };
  };

  /** A Workout type with a Set child type, as in the spec. */
  const setupWorkouts = async () => {
    const workout = await createLogType(db, {
      name: "Workout",
      fields: [{ name: "Notes", valueType: "text" }],
    });
    const set = await createLogType(db, {
      name: "Set",
      parentTypeId: workout.id,
      fields: [
        { name: "Reps", valueType: "number", required: true },
        { name: "Weight", valueType: "number", constraints: { unit: "kg" } },
      ],
    });
    const [notes] = (await getLogTypeVersionFields(db, workout.id)).map((f) => f.id);
    const [reps, weight] = (await getLogTypeVersionFields(db, set.id)).map((f) => f.id);
    return { workout, set, f: { notes, reps, weight } };
  };

  const simpleType = (
    name = "Diary",
    fields: NewLogField[] = [{ name: "Text", valueType: "text" }],
  ) => createLogType(db, { name, fields });

  const rows = (table: string, where = "1 = 1", params: unknown[] = []) =>
    db.query<Record<string, unknown>>(`SELECT * FROM ${table} WHERE ${where} ORDER BY id`, params);

  describe("log type", () => {
    it("creates version 1 with its fields, trimming text", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_000);
      const type = await createLogType(db, {
        name: "  Movie watched ",
        description: " ",
        fields: [
          { name: "Review", valueType: "text" },
          { name: "Rating", valueType: "number", required: true },
        ],
      });
      expect(type).toEqual({
        id: expect.any(String),
        name: "Movie watched",
        description: null,
        parentTypeId: null,
        schemaVersion: 1,
        createdAt: 1_000,
        updatedAt: 1_000,
        archivedAt: null,
        deletedAt: null,
        deletionId: null,
      });
      expect(await getLogType(db, type.id)).toEqual(type);
      expect(
        (await getLogTypeVersionFields(db, type.id)).map((f) => [f.name, f.position, f.required]),
      ).toEqual([
        ["Review", 0, false],
        ["Rating", 1, true],
      ]);
      expect(await rows("log_type_versions")).toEqual([
        { id: expect.any(String), log_type_id: type.id, version: 1, created_at: 1_000 },
      ]);
    });

    it("allows a type without fields", async () => {
      const type = await createLogType(db, { name: "Took medication", fields: [] });
      expect(await getLogTypeVersionFields(db, type.id)).toEqual([]);
    });

    it("requires a name and valid fields, creating nothing otherwise", async () => {
      await expect(createLogType(db, { name: " ", fields: [] })).rejects.toThrow(
        /Log type .*: name is required/,
      );
      await expect(
        createLogType(db, {
          name: "x",
          fields: [{ name: "Mood", valueType: "multi_enum" as "enum" }],
        }),
      ).rejects.toThrow(/Log field .*: value type must be one of/);
      await expect(
        createLogType(db, {
          name: "x",
          fields: [{ name: "Who", valueType: "ref", constraints: { thingTypeId: newId() } }],
        }),
      ).rejects.toThrow(/Log field .*: thing type .* not found/);
      expect(await listLogTypes(db)).toEqual([]);
      expect(await rows("log_fields")).toEqual([]);
    });

    it("lists live types by name, archived included, or the trashed ones", async () => {
      const b = await simpleType("b");
      const a = await simpleType("A");
      await setLogTypeArchived(db, b.id, true);
      expect((await listLogTypes(db)).map((t) => t.name)).toEqual(["A", "b"]);
      await deleteLogType(db, a.id);
      expect((await listLogTypes(db)).map((t) => t.name)).toEqual(["b"]);
      expect((await listLogTypes(db, { trashed: true })).map((t) => t.name)).toEqual(["A"]);
    });

    it("renames and redescribes, bumping updated_at", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_000);
      const { id } = await simpleType();
      vi.setSystemTime(2_000);
      expect(
        await updateLogType(db, id, { name: "Journal", description: " Daily " }),
      ).toMatchObject({ name: "Journal", description: "Daily", updatedAt: 2_000 });
      await expect(updateLogType(db, id, { name: "" })).rejects.toThrow(/name is required/);
    });

    it("archives and unarchives; an archived type takes no new entries", async () => {
      const type = await simpleType();
      const entry = await createLogEntry(db, { logTypeId: type.id, occurredAt: T0 });
      await setLogTypeArchived(db, type.id, true);
      expect((await getLogType(db, type.id))?.archivedAt).toEqual(expect.any(Number));
      await expect(createLogEntry(db, { logTypeId: type.id, occurredAt: T0 })).rejects.toThrow(
        `Log type ${type.id}: archived`,
      );
      // Existing entries stay valid and editable.
      await updateLogEntry(db, entry.id, { values: { [await firstField(type)]: "edited" } });
      await setLogTypeArchived(db, type.id, false);
      await createLogEntry(db, { logTypeId: type.id, occurredAt: T0 });
    });

    it("needs a live parent type, fixed at creation", async () => {
      const missing = newId();
      await expect(
        createLogType(db, { name: "Set", parentTypeId: missing, fields: [] }),
      ).rejects.toThrow(`Log type ${missing}: not found`);
      const gone = await simpleType("Gone");
      await deleteLogType(db, gone.id);
      await expect(
        createLogType(db, { name: "Set", parentTypeId: gone.id, fields: [] }),
      ).rejects.toThrow(`Log type ${gone.id}: not found`);

      const { workout, set } = await setupWorkouts();
      expect(set.parentTypeId).toBe(workout.id);
      // There is no way to change it, so no cycle can form; the database refuses the one loop
      // its foreign key would allow.
      await expect(
        db.execute("UPDATE log_types SET parent_type_id = id WHERE id = ?", [workout.id]),
      ).rejects.toThrow(/CHECK/);
    });

    it("refuses changes to a deleted type", async () => {
      const type = await simpleType();
      const [field] = await getLogTypeVersionFields(db, type.id);
      await deleteLogType(db, type.id);
      const notFound = `Log type ${type.id}: not found`;
      await expect(updateLogType(db, type.id, { name: "x" })).rejects.toThrow(notFound);
      await expect(setLogTypeArchived(db, type.id, true)).rejects.toThrow(notFound);
      await expect(reviseLogTypeFields(db, type.id, [])).rejects.toThrow(notFound);
      await expect(reorderLogFields(db, type.id, [field.id])).rejects.toThrow(notFound);
      await expect(updateLogField(db, field.id, { name: "x" })).rejects.toThrow(notFound);
      await expect(previewLogTypeDeletion(db, type.id)).rejects.toThrow(notFound);
      await expect(deleteLogType(db, type.id)).rejects.toThrow(notFound);
      // Its fields stay readable, for its trashed entries.
      expect(await getLogTypeVersionFields(db, type.id)).toEqual([field]);
    });
  });

  const firstField = async (type: LogType) => (await getLogTypeVersionFields(db, type.id))[0].id;

  describe("fields and versions", () => {
    it("renames, relabels and reorders without a version", async () => {
      const type = await simpleType("Diary", [
        { name: "Text", valueType: "text" },
        { name: "Mood", valueType: "enum", constraints: { options: [{ key: "ok", order: 1 }] } },
      ]);
      const [text, mood] = (await getLogTypeVersionFields(db, type.id)).map((f) => f.id);
      await updateLogField(db, mood, { name: "Feeling", optionLabels: { ok: "Fine" } });
      await reorderLogFields(db, type.id, [mood, text]);
      expect(
        (await getLogTypeVersionFields(db, type.id)).map((f) => [f.name, f.optionLabels]),
      ).toEqual([
        ["Feeling", { ok: "Fine" }],
        ["Text", {}],
      ]);
      expect((await getLogType(db, type.id))?.schemaVersion).toBe(1);
      await expect(updateLogField(db, newId(), { name: "x" })).rejects.toThrow(
        /Log field .*: not found/,
      );
    });

    it("creates a version for a shape change; an old entry keeps its version", async () => {
      const type = await simpleType("Run", [
        { name: "Distance", valueType: "number" },
        { name: "Notes", valueType: "text" },
      ]);
      const [distance, notes] = (await getLogTypeVersionFields(db, type.id)).map((f) => f.id);
      const old = await createLogEntry(db, {
        logTypeId: type.id,
        occurredAt: T0,
        values: { [distance]: 5, [notes]: "easy" },
      });

      // Version 2: distance gets bounds and is required, notes is retired, feel is added.
      const revised = await reviseLogTypeFields(db, type.id, [
        {
          id: distance,
          name: "Distance",
          valueType: "number",
          required: true,
          constraints: { min: 0 },
        },
        { name: "Feel", valueType: "boolean" },
      ]);
      expect(revised).toEqual({ version: 2, created: true });
      expect((await getLogType(db, type.id))?.schemaVersion).toBe(2);
      const [, feel] = (await getLogTypeVersionFields(db, type.id, 2)).map((f) => f.id);
      expect((await getLogTypeVersionFields(db, type.id, 1)).map((f) => f.id)).toEqual([
        distance,
        notes,
      ]);

      // The old entry still reads, and is edited, against version 1.
      expect(await getLogEntry(db, old.id)).toMatchObject({
        logTypeVersion: 1,
        values: { [distance]: 5, [notes]: "easy" },
      });
      await updateLogEntry(db, old.id, { values: { [notes]: "hard", [distance]: null } });
      expect((await getLogEntry(db, old.id))?.values).toEqual({ [notes]: "hard" });
      await expect(updateLogEntry(db, old.id, { values: { [feel]: true } })).rejects.toThrow(
        `Log entry ${old.id}, field ${feel}: not a field of log type ${type.id} version 1`,
      );

      // New entries use version 2.
      await expect(createLogEntry(db, { logTypeId: type.id, occurredAt: T0 })).rejects.toThrow(
        /field .*: is required/,
      );
      const fresh = await createLogEntry(db, {
        logTypeId: type.id,
        occurredAt: T0,
        values: { [distance]: 10, [feel]: true },
      });
      expect(fresh.logTypeVersion).toBe(2);
      await expect(
        createLogEntry(db, {
          logTypeId: type.id,
          occurredAt: T0,
          values: { [distance]: 1, [notes]: "x" },
        }),
      ).rejects.toThrow(/not a field of log type .* version 2/);
    });

    it("creates no version when only names and order change", async () => {
      const type = await simpleType("Diary", [
        { name: "A", valueType: "text" },
        { name: "B", valueType: "text" },
      ]);
      const [a, b] = (await getLogTypeVersionFields(db, type.id)).map((f) => f.id);
      expect(
        await reviseLogTypeFields(db, type.id, [
          { id: b, name: "Bee", valueType: "text" },
          { id: a, name: "A", valueType: "text" },
        ]),
      ).toEqual({ version: 1, created: false });
      expect((await getLogTypeVersionFields(db, type.id)).map((f) => f.name)).toEqual(["Bee", "A"]);
      // The current fields, resubmitted as they are, change nothing.
      const current = await getLogTypeVersionFields(db, type.id);
      expect(await reviseLogTypeFields(db, type.id, current.map(logFieldInput))).toEqual({
        version: 1,
        created: false,
      });
    });
  });

  describe("entry", () => {
    it("records a value of every field type, including references to things", async () => {
      const { type, alien, people, f } = await setupMovies();
      const values = {
        [f.film]: alien,
        [f.rating]: 4.5,
        [f.format]: "cinema",
        [f.review]: "",
        [f.rewatch]: false,
        [f.released]: "1979-05-25",
        [f.booked]: Date.UTC(2026, 9, 1, 9),
        [f.withPeople]: [people[2], people[0]],
      };
      const entry = await createLogEntry(db, { logTypeId: type.id, occurredAt: T0, values });
      expect(entry.values).toEqual({ ...values, [f.withPeople]: [people[0], people[2]].sort() });
      // One row per value, one per referenced thing.
      const stored = await rows("log_field_values", "log_entry_id = ?", [entry.id]);
      expect(stored).toHaveLength(9);
      expect(stored.find((r) => r.field_id === f.rewatch)).toMatchObject({
        value_bool: 0,
        written_by: "manual",
      });
    });

    it("stores defaults: instant precision, the zone setting, a manual source", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(5_000);
      const type = await simpleType();
      const entry = await createLogEntry(db, { logTypeId: type.id, occurredAt: T0 });
      expect(entry).toEqual({
        id: expect.any(String),
        logTypeId: type.id,
        logTypeVersion: 1,
        occurredAt: T0,
        endedAt: null,
        precision: "instant",
        timeZone: TZ,
        parentEntryId: null,
        position: null,
        source: "manual",
        externalId: null,
        createdAt: 5_000,
        updatedAt: 5_000,
        deletedAt: null,
        deletionId: null,
        resolved: { occurredAt: T0, precision: "instant", timeZone: TZ },
        day: "2026-10-27",
        values: {},
      });
      expect(await getLogEntry(db, entry.id)).toEqual(entry);
    });

    it("writes values as its source unless told otherwise", async () => {
      const type = await simpleType();
      const text = await firstField(type);
      const imported = await createLogEntry(db, {
        logTypeId: type.id,
        occurredAt: T0,
        values: { [text]: "x" },
        source: "import",
        externalId: "letterboxd:1",
      });
      expect(imported).toMatchObject({ source: "import", externalId: "letterboxd:1" });
      const plugin = await createLogEntry(db, {
        logTypeId: type.id,
        occurredAt: T0,
        values: { [text]: "y" },
        source: "import",
        writtenBy: "plugin:tmdb",
      });
      const writers = async (id: string) =>
        (await rows("log_field_values", "log_entry_id = ?", [id])).map((r) => r.written_by);
      expect(await writers(imported.id)).toEqual(["import"]);
      expect(await writers(plugin.id)).toEqual(["plugin:tmdb"]);
    });

    it("keeps (source, external id) unique", async () => {
      const type = await simpleType();
      const first = await createLogEntry(db, {
        logTypeId: type.id,
        occurredAt: T0,
        source: "import",
        externalId: "1",
      });
      await deleteLogEntry(db, first.id);
      // Trashed entries keep theirs, so a re-run import finds them.
      await expect(
        createLogEntry(db, {
          logTypeId: type.id,
          occurredAt: T0,
          source: "import",
          externalId: "1",
        }),
      ).rejects.toThrow(`log entry ${first.id} already has external id "1" from import`);
      await createLogEntry(db, {
        logTypeId: type.id,
        occurredAt: T0,
        source: "healthkit",
        externalId: "1",
      });
      await expect(
        createLogEntry(db, { logTypeId: type.id, occurredAt: T0, externalId: " " }),
      ).rejects.toThrow(/external id must be a non-empty string/);
      await expect(
        createLogEntry(db, { logTypeId: type.id, occurredAt: T0, source: "" }),
      ).rejects.toThrow(/a source is required/);
    });

    it.each([
      ["has no time", {}, /occurredAt is required/],
      ["has a position", { occurredAt: T0, position: 1 }, /only a child entry has a position/],
      [
        "ends before it occurs",
        { occurredAt: T0, endedAt: T0 - 1 },
        /must not end before it occurs/,
      ],
      ["has a fractional time", { occurredAt: 0.5 }, /invalid occurredAt/],
      [
        "has an unknown precision",
        { occurredAt: T0, precision: "week" },
        /precision must be one of/,
      ],
      [
        "has an invalid time zone",
        { occurredAt: T0, timeZone: "Mars/Olympus" },
        /invalid time zone/,
      ],
    ])("refuses a top-level entry that %s, naming it", async (_, input, message) => {
      const type = await simpleType();
      await expect(
        createLogEntry(db, { logTypeId: type.id, ...(input as object) }),
      ).rejects.toThrow(new RegExp(`Log entry [0-9a-f-]+: ${message.source}`));
      expect(await rows("log_entries")).toEqual([]);
    });

    it("allows an entry that ends when it occurs", async () => {
      const type = await simpleType();
      const entry = await createLogEntry(db, { logTypeId: type.id, occurredAt: T0, endedAt: T0 });
      expect(entry.endedAt).toBe(T0);
    });

    it("refuses an unknown or deleted type", async () => {
      const missing = newId();
      await expect(createLogEntry(db, { logTypeId: missing, occurredAt: T0 })).rejects.toThrow(
        `Log type ${missing}: not found`,
      );
      const type = await simpleType();
      await deleteLogType(db, type.id);
      await expect(createLogEntry(db, { logTypeId: type.id, occurredAt: T0 })).rejects.toThrow(
        `Log type ${type.id}: not found`,
      );
    });

    describe("validation names the entry and field, and writes nothing", () => {
      it("refuses an invalid value", async () => {
        const { type, alien, f } = await setupMovies();
        const error = await createLogEntry(db, {
          logTypeId: type.id,
          occurredAt: T0,
          values: { [f.film]: alien, [f.rating]: 9 },
        }).catch((e: Error) => e.message);
        expect(error).toMatch(
          new RegExp(`^Log entry [0-9a-f-]+, field ${f.rating}: must be at most 5$`),
        );
        expect(await rows("log_entries")).toEqual([]);
        expect(await rows("log_field_values")).toEqual([]);
      });

      it("refuses a missing required value", async () => {
        const { type, f } = await setupMovies();
        await expect(
          createLogEntry(db, { logTypeId: type.id, occurredAt: T0, values: { [f.rating]: 3 } }),
        ).rejects.toThrow(new RegExp(`Log entry [0-9a-f-]+, field ${f.film}: is required`));
      });

      it("refuses a field of another type", async () => {
        const { type, alien, f } = await setupMovies();
        const other = await simpleType();
        const foreign = await firstField(other);
        await expect(
          createLogEntry(db, {
            logTypeId: type.id,
            occurredAt: T0,
            values: { [f.film]: alien, [foreign]: "x" },
          }),
        ).rejects.toThrow(
          new RegExp(`field ${foreign}: not a field of log type ${type.id} version 1`),
        );
      });

      it("refuses references to missing, deleted or mistyped things", async () => {
        const { type, alien, people, f } = await setupMovies();
        const missing = newId();
        const create = (values: Record<string, unknown>) =>
          createLogEntry(db, {
            logTypeId: type.id,
            occurredAt: T0,
            values: { [f.film]: alien, ...values } as Record<string, string>,
          });
        await expect(create({ [f.film]: missing })).rejects.toThrow(
          new RegExp(`field ${f.film}: thing ${missing} not found`),
        );
        await expect(create({ [f.withPeople]: [people[0], alien] })).rejects.toThrow(
          new RegExp(`field ${f.withPeople}: thing ${alien} is not of thing type`),
        );
        await deleteThing(db, people[1]);
        await expect(create({ [f.withPeople]: [people[1]] })).rejects.toThrow(
          new RegExp(`field ${f.withPeople}: thing ${people[1]} is deleted`),
        );
        expect(await rows("log_entries")).toEqual([]);
      });

      it("keeps a stored reference to a thing deleted since", async () => {
        const { type, alien, people, f } = await setupMovies();
        const entry = await createLogEntry(db, {
          logTypeId: type.id,
          occurredAt: T0,
          values: { [f.film]: alien, [f.withPeople]: [people[0]] },
        });
        await deleteThing(db, people[0]);
        const { entry: updated } = await updateLogEntry(db, entry.id, {
          values: { [f.withPeople]: [people[0], people[1]] },
        });
        expect(updated.values[f.withPeople]).toEqual([people[0], people[1]].sort());
      });
    });
  });

  describe("precision and days", () => {
    // 2026-10-27T16:30Z is 17:30 on the 27th in Paris and 01:30 on the 28th in Tokyo.
    const TOKYO = "Asia/Tokyo";

    it("assigns an entry to the day in its own zone, not the setting's", async () => {
      const type = await simpleType();
      const paris = await createLogEntry(db, { logTypeId: type.id, occurredAt: T0 });
      const tokyo = await createLogEntry(db, {
        logTypeId: type.id,
        occurredAt: T0,
        timeZone: TOKYO,
      });
      expect(paris.day).toBe("2026-10-27");
      expect(tokyo).toMatchObject({ timeZone: TOKYO, occurredAt: T0, day: "2026-10-28" });
      // Changing the setting moves nothing.
      await setTimeZone(db, TOKYO);
      expect((await getLogEntry(db, paris.id))?.day).toBe("2026-10-27");
    });

    it.each([
      ["day", Date.UTC(2026, 9, 27, 15), "2026-10-28"],
      ["month", Date.UTC(2026, 8, 30, 15), null],
      ["year", Date.UTC(2025, 11, 31, 15), null],
    ] as const)("stores the start of the %s in the entry's zone", async (precision, start, day) => {
      const type = await simpleType();
      const entry = await createLogEntry(db, {
        logTypeId: type.id,
        occurredAt: T0,
        endedAt: T0 + 2 * H,
        precision,
        timeZone: TOKYO,
      });
      expect(entry).toMatchObject({ occurredAt: start, endedAt: start, precision, day });
      expect(entryDay(entry.resolved)).toBe(day);
    });

    it("truncates an end to the precision too", async () => {
      const type = await simpleType();
      const entry = await createLogEntry(db, {
        logTypeId: type.id,
        occurredAt: Date.UTC(2019, 2, 14, 12),
        endedAt: Date.UTC(2019, 5, 20, 12),
        precision: "month",
        timeZone: "UTC",
      });
      expect(entry).toMatchObject({
        occurredAt: Date.UTC(2019, 2, 1),
        endedAt: Date.UTC(2019, 5, 1),
      });
    });

    it("re-truncates on a change of time or precision, in the entry's zone", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_000);
      const type = await simpleType();
      const entry = await createLogEntry(db, {
        logTypeId: type.id,
        occurredAt: T0,
        timeZone: TOKYO,
      });
      vi.setSystemTime(2_000);
      const { entry: coarser } = await updateLogEntry(db, entry.id, { precision: "day" });
      expect(coarser).toMatchObject({
        occurredAt: Date.UTC(2026, 9, 27, 15),
        precision: "day",
        timeZone: TOKYO,
        updatedAt: 2_000,
      });
      const { entry: moved } = await updateLogEntry(db, entry.id, {
        occurredAt: Date.UTC(2026, 10, 5, 12),
      });
      expect(moved).toMatchObject({ occurredAt: Date.UTC(2026, 10, 4, 15), day: "2026-11-05" });
      const { entry: finer } = await updateLogEntry(db, entry.id, {
        precision: "instant",
        occurredAt: T0,
        endedAt: T0 + H,
      });
      expect(finer).toMatchObject({ occurredAt: T0, endedAt: T0 + H, precision: "instant" });
      await expect(updateLogEntry(db, entry.id, { endedAt: T0 - H })).rejects.toThrow(
        /must not end before it occurs/,
      );
      expect((await updateLogEntry(db, entry.id, { endedAt: null })).entry.endedAt).toBeNull();
    });
  });

  describe("child entries", () => {
    const workoutWithSets = async (reps: number[] = [5, 5, 8]) => {
      const setup = await setupWorkouts();
      const workout = await createLogEntry(db, {
        logTypeId: setup.workout.id,
        occurredAt: T0,
        endedAt: T0 + H,
        timeZone: "Asia/Tokyo",
        values: { [setup.f.notes]: "Leg day" },
      });
      const sets = [];
      for (const n of reps) {
        sets.push(
          await createLogEntry(db, {
            logTypeId: setup.set.id,
            parentEntryId: workout.id,
            values: { [setup.f.reps]: n },
          }),
        );
      }
      return { ...setup, entry: workout, sets };
    };

    it("inherits the parent's time and day, ordered by position", async () => {
      const { entry, sets, f } = await workoutWithSets();
      expect(sets.map((s) => s.position)).toEqual([1, 2, 3]);
      expect(sets[0]).toMatchObject({
        parentEntryId: entry.id,
        occurredAt: null,
        endedAt: null,
        precision: null,
        timeZone: null,
        resolved: { occurredAt: T0, precision: "instant", timeZone: "Asia/Tokyo" },
        day: "2026-10-28",
        values: { [f.reps]: 5 },
      });
      expect((await listChildEntries(db, entry.id)).map((s) => s.id)).toEqual(
        sets.map((s) => s.id),
      );
    });

    it("follows its parent when the parent's time changes", async () => {
      const { entry, sets } = await workoutWithSets();
      await updateLogEntry(db, entry.id, {
        occurredAt: T0 + 24 * H,
        endedAt: null,
        precision: "day",
      });
      expect(await getLogEntry(db, sets[0].id)).toMatchObject({
        resolved: { occurredAt: Date.UTC(2026, 9, 28, 15), precision: "day" },
        day: "2026-10-29",
      });
    });

    it("lists a child type's entries by their parents' times", async () => {
      const setup = await setupWorkouts();
      const early = await createLogEntry(db, { logTypeId: setup.workout.id, occurredAt: T0 });
      const late = await createLogEntry(db, { logTypeId: setup.workout.id, occurredAt: T0 + H });
      const set = (parentEntryId: string) =>
        createLogEntry(db, {
          logTypeId: setup.set.id,
          parentEntryId,
          values: { [setup.f.reps]: 1 },
        });
      const e1 = await set(early.id);
      const e2 = await set(early.id);
      const l1 = await set(late.id);
      expect((await listLogEntries(db, setup.set.id)).map((e) => e.id)).toEqual([
        l1.id,
        e1.id,
        e2.id,
      ]);
      expect(
        (await listLogEntries(db, setup.set.id, { from: T0, to: T0 + H })).map((e) => e.id),
      ).toEqual([e1.id, e2.id]);
    });

    it("takes an explicit position, and moves among its siblings", async () => {
      const { entry, set, sets, f } = await workoutWithSets();
      const warmUp = await createLogEntry(db, {
        logTypeId: set.id,
        parentEntryId: entry.id,
        position: 0,
        values: { [f.reps]: 10 },
      });
      const order = async () => (await listChildEntries(db, entry.id)).map((s) => s.id);
      expect(await order()).toEqual([warmUp.id, ...sets.map((s) => s.id)]);

      await moveChildEntry(db, warmUp.id, 4);
      expect(await order()).toEqual([...sets.map((s) => s.id), warmUp.id]);
      expect((await listChildEntries(db, entry.id)).map((s) => s.position)).toEqual([1, 2, 3, 4]);
      await moveChildEntry(db, sets[2].id, 1);
      expect(await order()).toEqual([sets[2].id, sets[0].id, sets[1].id, warmUp.id]);

      await expect(moveChildEntry(db, warmUp.id, 5)).rejects.toThrow(
        /position must be between 1 and 4/,
      );
      await expect(moveChildEntry(db, entry.id, 1)).rejects.toThrow(/not a child entry/);
      await expect(
        createLogEntry(db, {
          logTypeId: set.id,
          parentEntryId: entry.id,
          position: 1.5,
          values: { [f.reps]: 1 },
        }),
      ).rejects.toThrow(/position must be an integer/);
    });

    it("refuses a time of its own", async () => {
      const { entry, set, sets, f } = await workoutWithSets([5]);
      for (const time of [{ occurredAt: T0 }, { precision: "day" as const }, { timeZone: TZ }]) {
        await expect(
          createLogEntry(db, {
            logTypeId: set.id,
            parentEntryId: entry.id,
            values: { [f.reps]: 1 },
            ...time,
          }),
        ).rejects.toThrow(/a child entry inherits its time from its parent entry/);
      }
      await expect(updateLogEntry(db, sets[0].id, { occurredAt: T0 })).rejects.toThrow(
        `Log entry ${sets[0].id}: a child entry inherits its time from its parent entry`,
      );
    });

    it("must match its parent's type", async () => {
      const { workout, set, entry, f } = await workoutWithSets([]);
      const diary = await simpleType();
      const note = await createLogEntry(db, { logTypeId: diary.id, occurredAt: T0 });

      await expect(
        createLogEntry(db, { logTypeId: set.id, occurredAt: T0, values: { [f.reps]: 1 } }),
      ).rejects.toThrow(
        new RegExp(
          `log type ${set.id} is for child entries of log type ${workout.id}, so a parent entry is required`,
        ),
      );
      await expect(
        createLogEntry(db, { logTypeId: diary.id, parentEntryId: entry.id }),
      ).rejects.toThrow(new RegExp(`log type ${diary.id} has no parent type`));
      await expect(
        createLogEntry(db, { logTypeId: set.id, parentEntryId: note.id, values: { [f.reps]: 1 } }),
      ).rejects.toThrow(new RegExp(`but parent entry ${note.id} is of log type ${diary.id}`));

      await deleteLogEntry(db, entry.id);
      await expect(
        createLogEntry(db, { logTypeId: set.id, parentEntryId: entry.id, values: { [f.reps]: 1 } }),
      ).rejects.toThrow(new RegExp(`parent entry ${entry.id} not found`));
    });

    it("nests at any depth, every level on the top entry's day", async () => {
      const { set, sets } = await workoutWithSets([5]);
      const rep = await createLogType(db, {
        name: "Rep",
        parentTypeId: set.id,
        fields: [{ name: "Tempo", valueType: "text" }],
      });
      const child = await createLogEntry(db, { logTypeId: rep.id, parentEntryId: sets[0].id });
      expect(child).toMatchObject({ position: 1, day: "2026-10-28" });
      expect(child.resolved.occurredAt).toBe(T0);
    });
  });

  describe("listing", () => {
    it("lists live entries latest first, within [from, to)", async () => {
      const type = await simpleType();
      const make = (h: number) =>
        createLogEntry(db, { logTypeId: type.id, occurredAt: T0 + h * H });
      const a = await make(0);
      const b = await make(2);
      const c = await make(1);
      expect((await listLogEntries(db, type.id)).map((e) => e.id)).toEqual([b.id, c.id, a.id]);
      expect(
        (await listLogEntries(db, type.id, { from: T0 + H, to: T0 + 2 * H })).map((e) => e.id),
      ).toEqual([c.id]);
      await deleteLogEntry(db, c.id);
      expect((await listLogEntries(db, type.id)).map((e) => e.id)).toEqual([b.id, a.id]);
      expect((await listLogEntries(db, type.id, { trashed: true })).map((e) => e.id)).toEqual([
        c.id,
      ]);
    });
  });

  describe("provenance", () => {
    it("lets the user always win over automated writers", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_000);
      const type = await simpleType("Sleep", [
        { name: "Hours", valueType: "number" },
        { name: "Note", valueType: "text" },
      ]);
      const [hours, note] = (await getLogTypeVersionFields(db, type.id)).map((f) => f.id);
      const entry = await createLogEntry(db, {
        logTypeId: type.id,
        occurredAt: T0,
        source: "healthkit",
        values: { [hours]: 7 },
      });

      vi.setSystemTime(2_000);
      await updateLogEntry(db, entry.id, { values: { [hours]: 8 } });
      vi.setSystemTime(3_000);
      const result = await updateLogEntry(db, entry.id, {
        values: { [hours]: 6, [note]: "from watch" },
        writtenBy: "healthkit",
      });
      expect(result.skipped).toEqual([hours]);
      expect(result.entry.values).toEqual({ [hours]: 8, [note]: "from watch" });
      expect(
        (await rows("log_field_values", "log_entry_id = ?", [entry.id])).map((r) => [
          r.field_id,
          r.written_by,
          r.written_at,
        ]),
      ).toEqual(
        expect.arrayContaining([
          [hours, "manual", 2_000],
          [note, "healthkit", 3_000],
        ]),
      );
      expect(result.entry.updatedAt).toBe(3_000);
      // The source never changes.
      expect(result.entry.source).toBe("healthkit");
    });
  });

  describe("merging things", () => {
    it("re-points refs and multi_refs in log entries, collapsing repeats", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_000);
      const { type, alien, movie, people, f } = await setupMovies();
      const [alex, sam, kim] = people;
      const alienCopy = await thing(movie, "Alien (1979)");
      const both = await createLogEntry(db, {
        logTypeId: type.id,
        occurredAt: T0,
        values: { [f.film]: alienCopy, [f.withPeople]: [alex, sam] },
      });
      const one = await createLogEntry(db, {
        logTypeId: type.id,
        occurredAt: T0,
        values: { [f.film]: alien, [f.withPeople]: [sam, kim] },
      });
      const untouched = await createLogEntry(db, {
        logTypeId: type.id,
        occurredAt: T0,
        values: { [f.film]: alien, [f.withPeople]: [kim] },
      });

      vi.setSystemTime(2_000);
      await mergeThings(db, alien, alienCopy);
      const deletionId = await mergeThings(db, alex, sam);

      // `both` named Alex and Sam: one row each, now one row for Alex.
      expect(await getLogEntry(db, both.id)).toMatchObject({
        values: { [f.film]: alien, [f.withPeople]: [alex] },
        updatedAt: 2_000,
      });
      expect((await getLogEntry(db, one.id))?.values[f.withPeople]).toEqual([alex, kim].sort());
      expect(await getLogEntry(db, untouched.id)).toMatchObject({
        values: { [f.withPeople]: [kim] },
        updatedAt: 1_000,
      });
      const refs = await rows("log_field_values", "log_entry_id = ? AND field_id = ?", [
        both.id,
        f.withPeople,
      ]);
      // Sam's row repeated Alex's and is gone; Alex's row was not rewritten.
      expect(refs.map((r) => [r.value_ref, r.written_at])).toEqual([[alex, 1_000]]);
      const film = await rows("log_field_values", "log_entry_id = ? AND field_id = ?", [
        both.id,
        f.film,
      ]);
      expect(film.map((r) => [r.value_ref, r.written_by, r.written_at])).toEqual([
        [alien, "manual", 2_000],
      ]);
      // A merge trashes no log records, so it is not a log deletion to restore.
      await expect(restoreLogRecords(db, deletionId)).rejects.toThrow(/nothing in the trash/);
    });

    it("redirects a new reference to a merged thing to its survivor", async () => {
      const { type, alien, people, f } = await setupMovies();
      await mergeThings(db, people[0], people[1]);
      const entry = await createLogEntry(db, {
        logTypeId: type.id,
        occurredAt: T0,
        values: { [f.film]: alien, [f.withPeople]: [people[1]] },
      });
      expect(entry.values[f.withPeople]).toEqual([people[0]]);
    });
  });

  describe("trash", () => {
    it("deletes an entry with its children, and restores them together", async () => {
      const { workout, set, f } = await setupWorkouts();
      const entry = await createLogEntry(db, { logTypeId: workout.id, occurredAt: T0 });
      const children = [];
      for (const n of [1, 2]) {
        children.push(
          await createLogEntry(db, {
            logTypeId: set.id,
            parentEntryId: entry.id,
            values: { [f.reps]: n },
          }),
        );
      }
      const deletionId = await deleteLogEntry(db, entry.id);

      expect(await rows("log_entries", "deletion_id = ?", [deletionId])).toHaveLength(3);
      expect(await listLogEntries(db, workout.id)).toEqual([]);
      expect(await listChildEntries(db, entry.id)).toEqual([]);
      expect((await listChildEntries(db, entry.id, { trashed: true })).map((c) => c.id)).toEqual(
        children.map((c) => c.id),
      );
      // A trashed child still resolves its trashed parent's time.
      expect((await getLogEntry(db, children[0].id))?.resolved.occurredAt).toBe(T0);
      await expect(deleteLogEntry(db, entry.id)).rejects.toThrow(/not found/);

      await restoreLogRecords(db, deletionId);
      expect(await listChildEntries(db, entry.id)).toHaveLength(2);
      expect(await getLogEntry(db, entry.id)).toMatchObject({ deletedAt: null, deletionId: null });
    });

    it("deletes a child alone, which cannot return while its parent is deleted", async () => {
      const { workout, set, f } = await setupWorkouts();
      const entry = await createLogEntry(db, { logTypeId: workout.id, occurredAt: T0 });
      const child = await createLogEntry(db, {
        logTypeId: set.id,
        parentEntryId: entry.id,
        values: { [f.reps]: 1 },
      });
      const childDeletion = await deleteLogEntry(db, child.id);
      expect((await getLogEntry(db, entry.id))?.deletedAt).toBeNull();
      const parentDeletion = await deleteLogEntry(db, entry.id);

      await expect(restoreLogRecords(db, childDeletion)).rejects.toThrow(
        `Log entry ${child.id}: cannot be restored while its parent entry is deleted`,
      );
      // Restoring the parent leaves the separately deleted child in the trash.
      await restoreLogRecords(db, parentDeletion);
      expect(await listChildEntries(db, entry.id)).toEqual([]);
      await restoreLogRecords(db, childDeletion);
      expect(await listChildEntries(db, entry.id)).toHaveLength(1);
    });

    it("cascades a type delete to its entries and child types, after a preview", async () => {
      const { workout, set, f } = await setupWorkouts();
      const rep = await createLogType(db, { name: "Rep", parentTypeId: set.id, fields: [] });
      const other = await simpleType();
      await createLogEntry(db, { logTypeId: other.id, occurredAt: T0 });
      for (const h of [0, 1]) {
        const entry = await createLogEntry(db, { logTypeId: workout.id, occurredAt: T0 + h * H });
        const s = await createLogEntry(db, {
          logTypeId: set.id,
          parentEntryId: entry.id,
          values: { [f.reps]: 1 },
        });
        await createLogEntry(db, { logTypeId: rep.id, parentEntryId: s.id });
      }
      // Already in the trash, so not counted or moved.
      const trashedEntry = await createLogEntry(db, { logTypeId: workout.id, occurredAt: T0 });
      const entryDeletion = await deleteLogEntry(db, trashedEntry.id);

      expect(await previewLogTypeDeletion(db, workout.id)).toEqual({ types: 3, entries: 6 });
      expect(await previewLogTypeDeletion(db, set.id)).toEqual({ types: 2, entries: 4 });
      const deletionId = await deleteLogType(db, workout.id);

      expect(await rows("log_types", "deletion_id = ?", [deletionId])).toHaveLength(3);
      expect(await rows("log_entries", "deletion_id = ?", [deletionId])).toHaveLength(6);
      expect((await listLogTypes(db)).map((t) => t.id)).toEqual([other.id]);
      expect((await getLogEntry(db, trashedEntry.id))?.deletionId).toBe(entryDeletion);

      // The separately deleted entry cannot return while its type is deleted.
      await expect(restoreLogRecords(db, entryDeletion)).rejects.toThrow(
        `Log entry ${trashedEntry.id}: cannot be restored while its log type is deleted`,
      );
      await restoreLogRecords(db, deletionId);
      expect(await listLogTypes(db)).toHaveLength(4);
      expect(await listLogEntries(db, workout.id)).toHaveLength(2);
      expect(await listLogEntries(db, rep.id)).toHaveLength(2);
      await restoreLogRecords(db, entryDeletion);
      expect(await listLogEntries(db, workout.id)).toHaveLength(3);
    });

    it("keeps a separately deleted child type in the trash", async () => {
      const { workout, set } = await setupWorkouts();
      const setDeletion = await deleteLogType(db, set.id);
      const workoutDeletion = await deleteLogType(db, workout.id);
      await expect(restoreLogRecords(db, setDeletion)).rejects.toThrow(
        `Log type ${set.id}: cannot be restored while its parent type is deleted`,
      );
      await restoreLogRecords(db, workoutDeletion);
      expect((await listLogTypes(db)).map((t) => t.id)).toEqual([workout.id]);
      await restoreLogRecords(db, setDeletion);
      expect(await listLogTypes(db)).toHaveLength(2);
    });

    it("refuses an unknown or purged deletion", async () => {
      await expect(restoreLogRecords(db, "nope")).rejects.toThrow(/nothing in the trash/);

      const type = await simpleType();
      const entry = await createLogEntry(db, { logTypeId: type.id, occurredAt: T0 });
      const deletionId = await deleteLogEntry(db, entry.id);
      await db.execute(
        `UPDATE log_entries SET purged_at = 1, occurred_at = NULL, precision = NULL,
           time_zone = NULL, source = NULL WHERE id = ?`,
        [entry.id],
      );
      await expect(restoreLogRecords(db, deletionId)).rejects.toThrow(
        `Deletion ${deletionId}: purged, cannot be restored`,
      );
      expect(await getLogEntry(db, entry.id)).toBeUndefined();
      expect(await listLogEntries(db, type.id, { trashed: true })).toEqual([]);
    });
  });

  describe("schema", () => {
    const insert = (columns: Record<string, unknown>) => {
      const names = Object.keys(columns);
      return db.execute(
        `INSERT INTO log_entries (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`,
        Object.values(columns),
      );
    };

    it("enforces the entry rules core relies on", async () => {
      const { workout, set } = await setupWorkouts();
      const parent = await createLogEntry(db, { logTypeId: workout.id, occurredAt: T0 });
      const base = { log_type_version: 1, source: "manual", created_at: 0, updated_at: 0 };
      const top = {
        ...base,
        log_type_id: workout.id,
        occurred_at: 0,
        precision: "day",
        time_zone: "UTC",
      };
      const child = { ...base, log_type_id: set.id, parent_entry_id: parent.id, position: 1 };

      await insert({ ...top, id: newId() });
      await insert({ ...child, id: newId() });
      for (const bad of [
        { ...top, occurred_at: null, precision: null, time_zone: null },
        { ...top, precision: null },
        { ...top, precision: "week" },
        { ...top, ended_at: -1 },
        { ...top, source: null },
        { ...top, position: 1 },
        { ...child, position: null },
        { ...child, ended_at: 5 },
      ]) {
        await expect(insert({ ...bad, id: newId() }), JSON.stringify(bad)).rejects.toThrow(/CHECK/);
      }
      // The tombstone a purge leaves.
      await insert({
        id: newId(),
        log_type_id: set.id,
        log_type_version: 1,
        created_at: 0,
        updated_at: 0,
        deleted_at: 1,
        deletion_id: newId(),
        purged_at: 2,
      });
      await expect(insert({ ...top, id: newId(), log_type_version: 2 })).rejects.toThrow(
        /FOREIGN KEY/,
      );
    });
  });
});
