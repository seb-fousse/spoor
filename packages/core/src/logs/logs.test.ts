import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../db/platform";
import { migrate } from "../db/schema/migrate";
import { newId } from "../lib/ids";
import { setTimeZone } from "../settings/settings";
import { createInMemoryDatabase } from "../testing/in-memory-database";
import { mergeThings } from "../things/merge";
import { createThingType } from "../things/thing-types";
import { createThing, deleteThing } from "../things/things";
import {
  createLogEntry,
  deleteLogEntry,
  entryDay,
  getLogEntry,
  listChildEntries,
  listDayLogEntries,
  listLogEntries,
  moveChildEntry,
  previewLogEntryDeletion,
  updateLogEntry,
} from "./entries";
import {
  addLogField,
  createLogType,
  deleteLogField,
  deleteLogType,
  getLogType,
  getLogTypeFields,
  type LogType,
  listLogTypes,
  type NewLogField,
  previewLogFieldDeletion,
  previewLogTypeDeletion,
  reorderLogFields,
  setLogTypeArchived,
  updateLogField,
  updateLogType,
} from "./log-types";

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
    const fields = await getLogTypeFields(db, type.id);
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
    const [notes] = (await getLogTypeFields(db, workout.id)).map((f) => f.id);
    const [reps, weight] = (await getLogTypeFields(db, set.id)).map((f) => f.id);
    return { workout, set, f: { notes, reps, weight } };
  };

  const simpleType = (
    name = "Diary",
    fields: NewLogField[] = [{ name: "Text", valueType: "text" }],
  ) => createLogType(db, { name, fields });

  const rows = (table: string, where = "1 = 1", params: unknown[] = []) =>
    db.query<Record<string, unknown>>(`SELECT * FROM ${table} WHERE ${where} ORDER BY id`, params);

  describe("log type", () => {
    it("creates with its fields, trimming text", async () => {
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
        createdAt: 1_000,
        updatedAt: 1_000,
        archivedAt: null,
      });
      expect(await getLogType(db, type.id)).toEqual(type);
      expect(
        (await getLogTypeFields(db, type.id)).map((f) => [f.name, f.position, f.required]),
      ).toEqual([
        ["Review", 0, false],
        ["Rating", 1, true],
      ]);
    });

    it("allows a type without fields", async () => {
      const type = await createLogType(db, { name: "Took medication", fields: [] });
      expect(await getLogTypeFields(db, type.id)).toEqual([]);
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

    it("lists types by name, archived included", async () => {
      const b = await simpleType("b");
      const a = await simpleType("A");
      await setLogTypeArchived(db, b.id, true);
      expect((await listLogTypes(db)).map((t) => t.name)).toEqual(["A", "b"]);
      await deleteLogType(db, a.id);
      expect((await listLogTypes(db)).map((t) => t.name)).toEqual(["b"]);
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

    it("needs an existing parent type, fixed at creation", async () => {
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
      const [field] = await getLogTypeFields(db, type.id);
      await deleteLogType(db, type.id);
      const notFound = `Log type ${type.id}: not found`;
      await expect(updateLogType(db, type.id, { name: "x" })).rejects.toThrow(notFound);
      await expect(setLogTypeArchived(db, type.id, true)).rejects.toThrow(notFound);
      await expect(addLogField(db, type.id, { name: "x", valueType: "text" })).rejects.toThrow(
        notFound,
      );
      await expect(reorderLogFields(db, type.id, [field.id])).rejects.toThrow(notFound);
      await expect(updateLogField(db, field.id, { name: "x" })).rejects.toThrow(
        `Log field ${field.id}: not found`,
      );
      await expect(previewLogTypeDeletion(db, type.id)).rejects.toThrow(notFound);
      await expect(deleteLogType(db, type.id)).rejects.toThrow(notFound);
      await expect(getLogTypeFields(db, type.id)).rejects.toThrow(notFound);
    });
  });

  const firstField = async (type: LogType) => (await getLogTypeFields(db, type.id))[0].id;

  describe("fields", () => {
    it("renames, relabels and reorders", async () => {
      const type = await simpleType("Diary", [
        { name: "Text", valueType: "text" },
        { name: "Mood", valueType: "enum", constraints: { options: [{ key: "ok", order: 1 }] } },
      ]);
      const [text, mood] = (await getLogTypeFields(db, type.id)).map((f) => f.id);
      await updateLogField(db, mood, { name: "Feeling", optionLabels: { ok: "Fine" } });
      await reorderLogFields(db, type.id, [mood, text]);
      expect((await getLogTypeFields(db, type.id)).map((f) => [f.name, f.optionLabels])).toEqual([
        ["Feeling", { ok: "Fine" }],
        ["Text", {}],
      ]);
      await expect(updateLogField(db, text, { name: "feeling" })).rejects.toThrow(/already used/);
      await expect(updateLogField(db, newId(), { name: "x" })).rejects.toThrow(
        /Log field .*: not found/,
      );
    });

    it("changes constraints and the required flag in place, checked on the next write", async () => {
      const type = await simpleType("Run", [
        { name: "Distance", valueType: "number" },
        { name: "Notes", valueType: "text" },
      ]);
      const [distance, notes] = (await getLogTypeFields(db, type.id)).map((f) => f.id);
      const old = await createLogEntry(db, {
        logTypeId: type.id,
        occurredAt: T0,
        values: { [distance]: -1 },
      });

      await updateLogField(db, distance, { required: true, constraints: { min: 0 } });
      expect((await getLogTypeFields(db, type.id))[0]).toMatchObject({
        required: true,
        shape: { valueType: "number", constraints: { min: 0 } },
      });
      // Stored values are not re-validated, but a new write is.
      expect((await getLogEntry(db, old.id))?.values).toEqual({ [distance]: -1 });
      await updateLogEntry(db, old.id, { values: { [notes]: "hard" } });
      await expect(updateLogEntry(db, old.id, { values: { [distance]: -2 } })).rejects.toThrow(
        /must be at least 0/,
      );
      await expect(createLogEntry(db, { logTypeId: type.id, occurredAt: T0 })).rejects.toThrow(
        new RegExp(`field ${distance}: is required`),
      );
    });

    it("keeps a field's value type and the thing type it refers to", async () => {
      const { movie, person, f } = await setupMovies();
      await expect(updateLogField(db, f.rating, { constraints: { maxLength: 3 } })).rejects.toThrow(
        /maxLength/,
      );
      await expect(
        updateLogField(db, f.film, { constraints: { thingTypeId: person.id } }),
      ).rejects.toThrow(`Log field ${f.film}: cannot change the thing type it refers to`);
      await updateLogField(db, f.film, { constraints: { thingTypeId: movie.id } });
    });

    it("adds a field that older entries lack, then deletes one with its values", async () => {
      const type = await simpleType("Run", [{ name: "Distance", valueType: "number" }]);
      const [distance] = (await getLogTypeFields(db, type.id)).map((f) => f.id);
      const old = await createLogEntry(db, {
        logTypeId: type.id,
        occurredAt: T0,
        values: { [distance]: 5 },
      });
      const feel = await addLogField(db, type.id, { name: "Feel", valueType: "boolean" });
      expect((await getLogEntry(db, old.id))?.values).toEqual({ [distance]: 5 });
      await updateLogEntry(db, old.id, { values: { [feel]: true } });

      expect(await previewLogFieldDeletion(db, distance)).toEqual({ values: 1 });
      await deleteLogField(db, distance);
      expect((await getLogEntry(db, old.id))?.values).toEqual({ [feel]: true });
      await expect(updateLogEntry(db, old.id, { values: { [distance]: 1 } })).rejects.toThrow(
        `Log entry ${old.id}, field ${distance}: not a field of log type ${type.id}`,
      );
      await expect(deleteLogField(db, distance)).rejects.toThrow(/not found/);
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
      const again = {
        logTypeId: type.id,
        occurredAt: T0,
        source: "import",
        externalId: "1",
      };
      await expect(createLogEntry(db, again)).rejects.toThrow(
        `log entry ${first.id} already has external id "1" from import`,
      );
      // A deleted entry leaves nothing behind, so a re-run import adds it again.
      await deleteLogEntry(db, first.id);
      await createLogEntry(db, again);
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
        ).rejects.toThrow(new RegExp(`field ${foreign}: not a field of log type ${type.id}$`));
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
          new RegExp(`field ${f.withPeople}: thing ${people[1]} not found`),
        );
        expect(await rows("log_entries")).toEqual([]);
      });

      it("loses a reference to a thing deleted since, and asks again for a required one", async () => {
        const { type, alien, movie, people, f } = await setupMovies();
        const entry = await createLogEntry(db, {
          logTypeId: type.id,
          occurredAt: T0,
          values: { [f.film]: alien, [f.rating]: 3, [f.withPeople]: [people[0], people[1]] },
        });
        await deleteThing(db, people[0]);
        await deleteThing(db, alien);
        expect((await getLogEntry(db, entry.id))?.values).toEqual({
          [f.rating]: 3,
          [f.withPeople]: [people[1]],
        });
        await expect(updateLogEntry(db, entry.id, { values: { [f.rating]: 4 } })).rejects.toThrow(
          new RegExp(`field ${f.film}: is required`),
        );
        const heat = await thing(movie, "Heat");
        await updateLogEntry(db, entry.id, { values: { [f.film]: heat, [f.rating]: 4 } });
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
    it("lists entries latest first, within [from, to)", async () => {
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
      const [hours, note] = (await getLogTypeFields(db, type.id)).map((f) => f.id);
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
      await mergeThings(db, alex, sam);

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
      expect(await rows("log_entries")).toHaveLength(3);
    });
  });

  describe("delete", () => {
    it("previews, then deletes an entry with its children and values", async () => {
      const { workout, set, f } = await setupWorkouts();
      const entry = await createLogEntry(db, { logTypeId: workout.id, occurredAt: T0 });
      for (const n of [1, 2]) {
        await createLogEntry(db, {
          logTypeId: set.id,
          parentEntryId: entry.id,
          values: { [f.reps]: n },
        });
      }
      expect(await previewLogEntryDeletion(db, entry.id)).toEqual({ childEntries: 2 });
      await deleteLogEntry(db, entry.id);

      expect(await rows("log_entries")).toEqual([]);
      expect(await rows("log_field_values")).toEqual([]);
      await expect(deleteLogEntry(db, entry.id)).rejects.toThrow(/not found/);
    });

    it("deletes a child alone", async () => {
      const { workout, set, f } = await setupWorkouts();
      const entry = await createLogEntry(db, { logTypeId: workout.id, occurredAt: T0 });
      const child = await createLogEntry(db, {
        logTypeId: set.id,
        parentEntryId: entry.id,
        values: { [f.reps]: 1 },
      });
      expect(await previewLogEntryDeletion(db, child.id)).toEqual({ childEntries: 0 });
      await deleteLogEntry(db, child.id);
      expect(await getLogEntry(db, entry.id)).toBeDefined();
      expect(await listChildEntries(db, entry.id)).toEqual([]);
    });

    it("previews, then deletes a type with its child types, fields and entries", async () => {
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

      expect(await previewLogTypeDeletion(db, workout.id)).toEqual({ types: 3, entries: 6 });
      expect(await previewLogTypeDeletion(db, set.id)).toEqual({ types: 2, entries: 4 });
      await deleteLogType(db, workout.id);

      expect((await listLogTypes(db)).map((t) => t.id)).toEqual([other.id]);
      for (const table of ["log_fields", "log_entries"]) {
        expect(
          (await rows(table)).every((r) => r.log_type_id === other.id),
          table,
        ).toBe(true);
      }
      expect(await rows("log_entries")).toHaveLength(1);
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
      const base = { source: "manual", created_at: 0, updated_at: 0 };
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
      await expect(insert({ ...top, id: newId(), source: null })).rejects.toThrow(/NOT NULL/);
      for (const bad of [
        { ...top, occurred_at: null, precision: null, time_zone: null },
        { ...top, precision: null },
        { ...top, precision: "week" },
        { ...top, ended_at: -1 },
        { ...top, position: 1 },
        { ...child, position: null },
        { ...child, ended_at: 5 },
      ]) {
        await expect(insert({ ...bad, id: newId() }), JSON.stringify(bad)).rejects.toThrow(/CHECK/);
      }
      await expect(insert({ ...top, id: newId(), log_type_id: newId() })).rejects.toThrow(
        /FOREIGN KEY/,
      );
    });
  });

  describe("day entries", () => {
    const DAY = "2026-10-27";
    const midnight = Date.UTC(2026, 9, 27, 23); // 00:00 on the 28th in Paris
    const ids = async (date: string) =>
      (await listDayLogEntries(db, date)).map((g) => [g.logType.id, g.entries.map((e) => e.id)]);

    it("lists instant and day entries, not month or year ones", async () => {
      const type = await createLogType(db, { name: "Note", fields: [] });
      const instant = await createLogEntry(db, {
        logTypeId: type.id,
        occurredAt: T0,
        timeZone: TZ,
      });
      const day = await createLogEntry(db, {
        logTypeId: type.id,
        occurredAt: T0,
        precision: "day",
        timeZone: TZ,
      });
      for (const precision of ["month", "year"] as const) {
        await createLogEntry(db, { logTypeId: type.id, occurredAt: T0, precision, timeZone: TZ });
      }
      await createLogEntry(db, { logTypeId: type.id, occurredAt: T0 + 24 * H, timeZone: TZ });
      expect(await ids(DAY)).toEqual([[type.id, [day.id, instant.id]]]);
      expect(await listDayLogEntries(db, "2026-10-01")).toEqual([]);
    });

    it("lists an entry on each day it spans, by its own zone", async () => {
      const type = await createLogType(db, { name: "Sleep", fields: [] });
      const spans = await createLogEntry(db, {
        logTypeId: type.id,
        occurredAt: midnight - 2 * H,
        endedAt: midnight + 2 * H,
        timeZone: TZ,
      });
      const toMidnight = await createLogEntry(db, {
        logTypeId: type.id,
        occurredAt: midnight - 3 * H,
        endedAt: midnight,
        timeZone: TZ,
      });
      // 00:30 on the 28th in Paris, but 2026-10-27 in New York.
      const elsewhere = await createLogEntry(db, {
        logTypeId: type.id,
        occurredAt: midnight + H / 2,
        timeZone: "America/New_York",
      });
      expect(await ids(DAY)).toEqual([[type.id, [toMidnight.id, spans.id, elsewhere.id]]]);
      expect(await ids("2026-10-28")).toEqual([[type.id, [spans.id]]]);
    });

    it("nests children under their parent and groups by type", async () => {
      const { workout, set, f } = await setupWorkouts();
      const note = await createLogType(db, { name: "Note", fields: [] });
      const session = await createLogEntry(db, {
        logTypeId: workout.id,
        occurredAt: T0,
        timeZone: TZ,
      });
      const second = await createLogEntry(db, {
        logTypeId: set.id,
        parentEntryId: session.id,
        values: { [f.reps]: 8 },
      });
      const first = await createLogEntry(db, {
        logTypeId: set.id,
        parentEntryId: session.id,
        position: 0,
        values: { [f.reps]: 10 },
      });
      const memo = await createLogEntry(db, { logTypeId: note.id, occurredAt: T0, timeZone: TZ });
      const groups = await listDayLogEntries(db, DAY);
      const order = (await listLogTypes(db)).map((t) => t.id).filter((id) => id !== set.id);
      expect(groups.map((g) => g.logType.id)).toEqual(order);
      const w = groups.find((g) => g.logType.id === workout.id);
      expect(w?.entries.map((e) => e.id)).toEqual([session.id]);
      expect(w?.entries[0].children.map((c) => c.id)).toEqual([first.id, second.id]);
      expect(groups.find((g) => g.logType.id === note.id)?.entries[0].id).toBe(memo.id);
    });
  });
});
