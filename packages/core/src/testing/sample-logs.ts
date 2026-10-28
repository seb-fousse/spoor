import { createFirstVersion, draftFields, LOG_TABLES, MANUAL, setValues } from "../definitions";
import { newId } from "../ids";
import {
  createLogEntry,
  createLogType,
  deleteLogEntry,
  deleteLogType,
  getLogTypeVersionFields,
  logFieldInput,
  reviseLogTypeFields,
  setLogTypeArchived,
} from "../logs";
import type { Database } from "../platform/index";
import { listThings, listThingTypes, type Thing, type ThingType } from "../things";
import { now } from "../time";
import { transaction } from "../transaction";

/**
 * TEST-ONLY. Log types, entries and values for the round-trip test: every value
 * column, references to the things `populateThings` made, live/archived/trashed
 * types, two versions, a parent and child type, a workout with child sets,
 * `day`, `month` and `year` precision, a trashed entry with a trashed child, and
 * a purged tombstone.
 *
 * The Workout type and one workout are written with ids above any UUID v7 made
 * today, so their child type and child entries sort before them and import has
 * to order the self-references itself.
 */

const WORKOUT_TYPE_ID = "f0000000-0000-7000-8000-0000000000a1";
const WORKOUT_ID = "f0000000-0000-7000-8000-0000000000a2";

const H = 3_600_000;
const T0 = Date.UTC(2026, 9, 20, 18);

export async function populateLogs(db: Database): Promise<void> {
  const thingOf = async (typeName: string, title: string) => {
    const type = (await listThingTypes(db)).find((t) => t.name === typeName) as ThingType;
    const things = await listThings(db, type.id);
    const thing = things.find((t) => t.values[type.titleFieldId] === title) as Thing;
    return { id: thing.id, thing_type_id: type.id };
  };
  const alien = await thingOf("Movie", "Alien");
  const alex = await thingOf("Person", "Alex Smith");
  const sam = await thingOf("Person", "Sam");

  // Movie watched: every value type. Version 2 retires the booking time and adds a seat.
  const movieWatched = await createLogType(db, {
    name: "Movie watched",
    description: "Films",
    fields: [
      {
        name: "Movie",
        valueType: "ref",
        required: true,
        constraints: { thingTypeId: alien.thing_type_id },
      },
      { name: "Rating", valueType: "number", constraints: { min: 0.5, max: 5, precision: 1 } },
      {
        name: "Format",
        valueType: "enum",
        constraints: {
          options: [
            { key: "cinema", order: 1, score: 1 },
            { key: "streaming", order: 2 },
          ],
        },
        optionLabels: { cinema: "Cinema" },
      },
      { name: "Review", valueType: "text" },
      { name: "Rewatch", valueType: "boolean" },
      { name: "Released", valueType: "date" },
      { name: "Booked at", valueType: "datetime" },
      { name: "With", valueType: "multi_ref", constraints: { thingTypeId: alex.thing_type_id } },
    ],
  });
  const v1 = await getLogTypeVersionFields(db, movieWatched.id, 1);
  const [film, rating, format, review, rewatch, released, booked, withPeople] = v1.map((f) => f.id);
  await createLogEntry(db, {
    logTypeId: movieWatched.id,
    occurredAt: T0,
    precision: "day",
    timeZone: "America/New_York",
    source: "import",
    externalId: "letterboxd:1",
    values: {
      [film]: alien.id,
      [rating]: 4.5,
      [format]: "cinema",
      [review]: "Still scary.",
      [rewatch]: true,
      [released]: "1979-05-25",
      [booked]: T0 - 24 * H,
      [withPeople]: [alex.id, sam.id],
    },
  });
  await reviseLogTypeFields(db, movieWatched.id, [
    ...v1.filter((f) => f.id !== booked).map(logFieldInput),
    { name: "Seat", valueType: "text" },
  ]);
  const seat = (await getLogTypeVersionFields(db, movieWatched.id)).at(-1)?.id as string;
  await createLogEntry(db, {
    logTypeId: movieWatched.id,
    occurredAt: T0,
    endedAt: T0 + 31 * 24 * H,
    precision: "month",
    values: { [film]: alien.id, [rating]: 3, [seat]: "F12", [withPeople]: [sam.id] },
  });

  // Book read, with only a year known.
  const book = await createLogType(db, {
    name: "Book read",
    fields: [{ name: "Title", valueType: "text", required: true }],
  });
  await createLogEntry(db, {
    logTypeId: book.id,
    occurredAt: Date.UTC(2019, 5, 1),
    precision: "year",
    values: { [(await getLogTypeVersionFields(db, book.id))[0].id]: "Dune" },
  });

  // Workout and its child Set type, the parent written with a late-sorting id.
  await transaction(db, async () => {
    const t = now();
    const drafts = draftFields(LOG_TABLES, [{ name: "Notes", valueType: "text" }]);
    await db.execute(
      `INSERT INTO log_types (id, name, schema_version, created_at, updated_at)
       VALUES (?, 'Workout', 1, ?, ?)`,
      [WORKOUT_TYPE_ID, t, t],
    );
    await createFirstVersion(db, LOG_TABLES, WORKOUT_TYPE_ID, drafts, t);
    await db.execute(
      `INSERT INTO log_entries
         (id, log_type_id, log_type_version, occurred_at, ended_at, precision, time_zone,
          source, created_at, updated_at)
       VALUES (?, ?, 1, ?, ?, 'instant', 'Europe/Paris', ?, ?, ?)`,
      [WORKOUT_ID, WORKOUT_TYPE_ID, T0, T0 + H, MANUAL, t, t],
    );
    await setValues(
      db,
      LOG_TABLES,
      { id: WORKOUT_ID, typeId: WORKOUT_TYPE_ID, typeVersion: 1 },
      { [drafts[0].id]: "Leg day" },
      { writtenBy: MANUAL, writtenAt: t },
    );
  });
  const set = await createLogType(db, {
    name: "Set",
    parentTypeId: WORKOUT_TYPE_ID,
    fields: [
      { name: "Reps", valueType: "number", required: true },
      { name: "Weight", valueType: "number", constraints: { unit: "kg" } },
    ],
  });
  const [reps, weight] = (await getLogTypeVersionFields(db, set.id)).map((f) => f.id);
  const addSet = (parentEntryId: string, n: number, kg: number) =>
    createLogEntry(db, {
      logTypeId: set.id,
      parentEntryId,
      values: { [reps]: n, [weight]: kg },
    });
  await addSet(WORKOUT_ID, 5, 100);
  await addSet(WORKOUT_ID, 5, 105);
  // A set deleted alone.
  await deleteLogEntry(db, (await addSet(WORKOUT_ID, 8, 40)).id);

  // A trashed workout, with its trashed set.
  const skipped = await createLogEntry(db, {
    logTypeId: WORKOUT_TYPE_ID,
    occurredAt: T0 + 24 * H,
    timeZone: "Asia/Tokyo",
  });
  await addSet(skipped.id, 3, 60);
  await deleteLogEntry(db, skipped.id);

  // An archived type, and a trashed one with its entry.
  const meditation = await createLogType(db, { name: "Meditation", fields: [] });
  await createLogEntry(db, { logTypeId: meditation.id, occurredAt: T0 - 2 * H });
  await setLogTypeArchived(db, meditation.id, true);
  const habit = await createLogType(db, { name: "Old habit", fields: [] });
  await createLogEntry(db, { logTypeId: habit.id, occurredAt: T0 - 3 * H });
  await deleteLogType(db, habit.id);

  // The purge operation does not exist yet, so write the tombstone it will leave.
  const t = now();
  await db.execute(
    `INSERT INTO log_entries
       (id, log_type_id, log_type_version, created_at, updated_at, deleted_at, deletion_id, purged_at)
     VALUES (?, ?, 1, ?, ?, ?, ?, ?)`,
    [newId(), movieWatched.id, t, t + 1, t + 2, newId(), t + 3],
  );
}
