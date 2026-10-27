import {
  createFirstVersion,
  draftFields,
  MANUAL,
  type NewField,
  reviseFields,
  setValues,
  THING_TABLES,
  type ValuePatch,
} from "../definitions";
import { newId } from "../ids";
import type { Database } from "../platform/index";
import { now } from "../time";
import { transaction } from "../transaction";

/**
 * TEST-ONLY. Thing types, things and values for the round-trip test: every value
 * column, live/archived/trashed types, two versions with a retired field, and
 * live, trashed, merged and purged things, plus a timeline and a category that
 * refer to them.
 *
 * Types and things are inserted with raw SQL until the things repository exists;
 * fields, versions and values go through `definitions.ts`.
 */

/** Ids above any UUID v7 made today, so this survivor sorts after the thing merged into it. */
const SURVIVOR_ID = "f0000000-0000-7000-8000-000000000001";

export async function populateThings(db: Database): Promise<void> {
  await transaction(db, async () => {
    const t = now();

    const insertType = async (name: string, fields: readonly NewField[], id = newId()) => {
      const drafts = draftFields(THING_TABLES, fields);
      await db.execute(
        `INSERT INTO thing_types (id, name, title_field_id, schema_version, created_at, updated_at)
         VALUES (?, ?, ?, 1, ?, ?)`,
        [id, name, drafts[0].id, t, t],
      );
      await createFirstVersion(db, THING_TABLES, id, drafts, t);
      return { id, fieldIds: drafts.map((d) => d.id) };
    };

    const insertThing = async (
      typeId: string,
      version: number,
      values: ValuePatch,
      options: { id?: string; source?: string; externalId?: string } = {},
    ) => {
      const id = options.id ?? newId();
      await db.execute(
        `INSERT INTO things (id, thing_type_id, thing_type_version, source, external_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, typeId, version, options.source ?? MANUAL, options.externalId ?? null, t, t],
      );
      const record = { id, typeId, typeVersion: version };
      await setValues(db, THING_TABLES, record, values, {
        writtenBy: options.source ?? MANUAL,
        writtenAt: t,
      });
      return id;
    };

    const trash = (table: string, id: string, extra = "") =>
      db.execute(
        `UPDATE ${table} SET deleted_at = ?, deletion_id = ?, updated_at = ?${extra} WHERE id = ?`,
        [t + 1, newId(), t + 1, id],
      );

    // Person: version 1 has a birth date; version 2 retires it and adds friends.
    const person = await insertType("Person", [
      { name: "Name", valueType: "text", required: true, constraints: { maxLength: 200 } },
      { name: "Born", valueType: "date" },
    ]);
    const [name, born] = person.fieldIds;
    const alex = await insertThing(person.id, 1, { [name]: "Alex", [born]: "1990-04-01" });
    await reviseFields(
      db,
      THING_TABLES,
      person.id,
      [
        {
          id: name,
          name: "Name",
          valueType: "text",
          required: true,
          constraints: { maxLength: 200 },
        },
        { name: "Friends", valueType: "multi_ref", constraints: { thingTypeId: person.id } },
      ],
      t,
    );
    const friends = (
      await db.query<{ id: string }>("SELECT id FROM thing_fields WHERE name = 'Friends'")
    )[0].id;
    const survivor = await insertThing(person.id, 2, { [name]: "Alex Smith" }, { id: SURVIVOR_ID });
    await insertThing(person.id, 2, { [name]: "Sam", [friends]: [alex, survivor] });

    // A duplicate merged into the survivor, a trashed thing, and a purged tombstone.
    const duplicate = await insertThing(person.id, 2, { [name]: "alex s" });
    await trash("things", duplicate, `, merged_into_id = '${SURVIVOR_ID}'`);
    const trashed = await insertThing(person.id, 2, { [name]: "Kim" });
    await trash("things", trashed);
    await db.execute(
      `INSERT INTO things
         (id, thing_type_id, thing_type_version, created_at, updated_at, deleted_at, deletion_id, purged_at)
       VALUES (?, ?, 2, ?, ?, ?, ?, ?)`,
      [newId(), person.id, t, t, t + 1, newId(), t + 2],
    );

    // Movie: every other value column, with option labels and a reference.
    const movie = await insertType("Movie", [
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
    ]);
    const [title, year, format, seen, released, director] = movie.fieldIds;
    await insertThing(
      movie.id,
      1,
      {
        [title]: "Alien",
        [year]: 1979.5,
        [format]: "cinema",
        [seen]: true,
        [released]: Date.UTC(1979, 4, 25),
        [director]: survivor,
      },
      { source: "import", externalId: "tt0078748" },
    );

    // An archived type and a trashed one.
    const place = await insertType("Place", [{ name: "Name", valueType: "text", required: true }]);
    await db.execute("UPDATE thing_types SET archived_at = ? WHERE id = ?", [t + 1, place.id]);
    const old = await insertType("Old", [{ name: "Name", valueType: "text", required: true }]);
    await trash("thing_types", old.id);

    // A timeline offering people first, with a category that is a thing.
    const people = newId();
    await db.execute(
      `INSERT INTO timelines (id, name, exclusive, default_thing_type_id, created_at, updated_at)
       VALUES (?, 'People', 0, ?, ?, ?)`,
      [people, person.id, t, t],
    );
    await db.execute(
      `INSERT INTO timeline_categories (id, timeline_id, name, thing_id, created_at, updated_at)
       VALUES (?, ?, 'Alex Smith', ?, ?, ?)`,
      [newId(), people, survivor, t, t],
    );
  });
}
