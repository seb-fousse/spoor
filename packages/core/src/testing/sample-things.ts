import type { Database } from "../db/platform";
import { now } from "../lib/time";
import { mergeThings } from "../things/merge";
import {
  addThingField,
  createThingType,
  deleteThingField,
  deleteThingType,
  getThingTypeFields,
  setThingTypeArchived,
} from "../things/thing-types";
import { createThing, deleteThing } from "../things/things";
import { createCategory } from "../timelines/categories";
import { createInterval } from "../timelines/intervals";
import { createTimeline } from "../timelines/timelines";

/**
 * TEST-ONLY. Thing types, things and values for the round-trip test: every value
 * column, an archived type, a field added and one deleted, and things merged
 * and deleted, plus a timeline and categories that refer to them.
 *
 * Setting a timeline's default thing type has no operation yet, so it is raw SQL.
 */

const H = 3_600_000;

export async function populateThings(db: Database): Promise<void> {
  const fieldIds = async (typeId: string) =>
    (await getThingTypeFields(db, typeId)).map((f) => f.id);

  // Person: starts with a birth date, which is deleted, and gains friends.
  const name = {
    name: "Name",
    valueType: "text",
    required: true,
    constraints: { maxLength: 200 },
  } as const;
  const person = await createThingType(db, {
    name: "Person",
    description: "Someone",
    fields: [name, { name: "Born", valueType: "date" }],
  });
  const [nameId, bornId] = await fieldIds(person.id);
  const alex = await createThing(db, {
    thingTypeId: person.id,
    values: { [nameId]: "Alex", [bornId]: "1990-04-01" },
  });
  await deleteThingField(db, person.id, bornId);
  const friendsId = await addThingField(db, person.id, {
    name: "Friends",
    valueType: "multi_ref",
    constraints: { thingTypeId: person.id },
  });
  const survivor = await createThing(db, {
    thingTypeId: person.id,
    values: { [nameId]: "Alex Smith" },
  });
  await createThing(db, {
    thingTypeId: person.id,
    values: { [nameId]: "Sam", [friendsId]: [alex.id, survivor.id] },
  });
  const kim = await createThing(db, { thingTypeId: person.id, values: { [nameId]: "Kim" } });
  await deleteThing(db, kim.id);

  // Movie: every other value column, with option labels, a reference, and an
  // imported thing whose value an automated writer set.
  const movie = await createThingType(db, {
    name: "Movie",
    fields: [
      { name: "Title", valueType: "text", required: true },
      { name: "Year", valueType: "number", constraints: { min: 1878, precision: 1 } },
      {
        name: "Format",
        valueType: "enum",
        constraints: {
          options: [
            { key: "cinema", order: 1, score: 2 },
            { key: "tv", order: 2 },
          ],
        },
        optionLabels: { cinema: "Cinema" },
      },
      { name: "Seen", valueType: "boolean" },
      { name: "Released", valueType: "datetime" },
      { name: "Director", valueType: "ref", constraints: { thingTypeId: person.id } },
    ],
  });
  const [title, year, format, seen, released, director] = await fieldIds(movie.id);
  await createThing(db, {
    thingTypeId: movie.id,
    source: "import",
    externalId: "tt0078748",
    values: {
      [title]: "Alien",
      [year]: 1979.5,
      [format]: "cinema",
      [seen]: true,
      [released]: Date.UTC(1979, 4, 25),
      [director]: survivor.id,
    },
  });

  // An archived type, and a deleted one with its thing.
  const place = await createThingType(db, { name: "Place", fields: [name] });
  await setThingTypeArchived(db, place.id, true);
  const old = await createThingType(db, { name: "Old", fields: [name] });
  await createThing(db, { thingTypeId: old.id, values: { [(await fieldIds(old.id))[0]]: "x" } });
  await deleteThingType(db, old.id);

  // A timeline offering people first, with categories that are things, and a
  // duplicate merged into the survivor: one category moves, one is deleted.
  const people = await createTimeline(db, { name: "People", exclusive: false });
  await db.execute("UPDATE timelines SET default_thing_type_id = ? WHERE id = ?", [
    person.id,
    people.id,
  ]);
  const duplicate = await createThing(db, {
    thingTypeId: person.id,
    values: { [nameId]: "alex s" },
  });
  const kept = await createCategory(db, people.id, { thingId: survivor.id });
  const merged = await createCategory(db, people.id, { thingId: duplicate.id });
  const t = now();
  await createInterval(db, { categoryId: kept.id, startAt: t - 3 * H, endAt: t - 2 * H });
  await createInterval(db, { categoryId: merged.id, startAt: t - 2 * H, endAt: t - H });
  await createCategory(db, (await createTimeline(db, { name: "Calls" })).id, {
    thingId: duplicate.id,
  });
  await mergeThings(db, survivor.id, duplicate.id);
}
