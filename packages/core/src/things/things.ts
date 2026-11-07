import type { Selectable } from "kysely";
import type { Database } from "../db/platform";
import { queryBuilder } from "../db/query";
import type { DB } from "../db/schema/tables";
import { transaction } from "../db/transaction";
import { MANUAL, readValues, setValues, type ValuePatch } from "../definitions/engine";
import { THING_TABLES } from "../definitions/tables";
import { isNonEmptyString } from "../lib/guards";
import { newId } from "../lib/ids";
import { type Instant, now } from "../lib/time";
import type { Value } from "../values/values";
import { previewThingsDeletion, requireThingType, type ThingDeletion } from "./thing-types";

/**
 * Things (see docs/data-spec.md § 4. Things): things holding one value per field of
 * their type. A timeline category linked to a thing stores the title as its name,
 * updated here whenever the title changes, so it keeps the last title once the
 * thing is deleted and the category unlinked.
 *
 * Deleting is permanent. Deleting a thing also removes the references to it
 * held by other things and log entries; `previewThingDeletion` counts them
 * first so the user can confirm. Every write runs in one transaction.
 */

export interface Thing {
  id: string;
  thingTypeId: string;
  source: string;
  externalId: string | null;
  /** Stored values by field id; fields without a value are absent. */
  values: Record<string, Value>;
  createdAt: Instant;
  updatedAt: Instant;
}

/** What deleting things would delete or change, for the user to confirm. */
type ThingRow = Selectable<DB["things"]>;

// ---------------------------------------------------------------------------
// Things

/**
 * Creates a thing of an unarchived type, validated against its fields. `source` (default `manual`) and `externalId` are set once and never
 * change; a `(source, externalId)` pair names at most one thing. Values are
 * written by `writtenBy`, which defaults to `source`.
 */
export async function createThing(
  db: Database,
  input: {
    thingTypeId: string;
    values: ValuePatch;
    source?: string;
    externalId?: string | null;
    writtenBy?: string;
  },
): Promise<Thing> {
  const id = newId();
  const label = `Thing ${id}`;
  const source = input.source ?? MANUAL;
  if (!isNonEmptyString(source)) throw new Error(`${label}: source is required`);
  const externalId = input.externalId ?? null;
  if (externalId !== null && !isNonEmptyString(externalId)) {
    throw new Error(`${label}: external id must be a non-empty string`);
  }
  await transaction(db, async () => {
    const q = queryBuilder(db);
    const type = await requireThingType(db, input.thingTypeId);
    if (type.archivedAt !== null) throw new Error(`Thing type ${type.id}: archived`);
    if (externalId !== null) {
      const existing = await q
        .selectFrom("things")
        .select("id")
        .where("source", "=", source)
        .where("external_id", "=", externalId)
        .executeTakeFirst();
      if (existing) {
        throw new Error(
          `${label}: thing ${existing.id} already has external id ${JSON.stringify(externalId)} from ${source}`,
        );
      }
    }
    const t = now();
    await q
      .insertInto("things")
      .values({
        id,
        thing_type_id: type.id,
        source,
        external_id: externalId,
        created_at: t,
        updated_at: t,
      })
      .execute();
    await setValues(db, THING_TABLES, { id, typeId: type.id }, input.values, {
      writtenBy: input.writtenBy ?? source,
      writtenAt: t,
    });
  });
  return (await getThing(db, id)) as Thing;
}

/** The thing with `id`, with its values, or `undefined`. */
export async function getThing(db: Database, id: string): Promise<Thing | undefined> {
  const row = await queryBuilder(db)
    .selectFrom("things")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  return row && withValues(db, row);
}

/** The type's things by title. */
export async function listThings(db: Database, thingTypeId: string): Promise<Thing[]> {
  const rows = await queryBuilder(db)
    .selectFrom("things as t")
    .innerJoin("thing_types as ty", "ty.id", "t.thing_type_id")
    .leftJoin("thing_field_values as v", (join) =>
      join.onRef("v.thing_id", "=", "t.id").onRef("v.field_id", "=", "ty.title_field_id"),
    )
    .selectAll("t")
    .where("t.thing_type_id", "=", thingTypeId)
    .orderBy("v.value_text", (ob) => ob.collate("nocase"))
    .orderBy("t.id")
    .execute();
  return Promise.all(rows.map((row) => withValues(db, row)));
}

/**
 * Sets values by field id (`null` clears an optional one), validated against
 * its type's fields. The user always wins: a `writtenBy` other than
 * `manual` (the default) skips fields another writer set, which are returned.
 * A new title renames the thing's timeline categories.
 */
export async function updateThingValues(
  db: Database,
  id: string,
  values: ValuePatch,
  options: { writtenBy?: string } = {},
): Promise<{ thing: Thing; skipped: string[] }> {
  const { skipped } = await transaction(db, async () => {
    const thing = await requireThing(db, id);
    const t = now();
    const result = await setValues(db, THING_TABLES, { id, typeId: thing.thing_type_id }, values, {
      writtenBy: options.writtenBy ?? MANUAL,
      writtenAt: t,
    });
    const title = await getThingTitle(db, id);
    if (title !== undefined) {
      await queryBuilder(db)
        .updateTable("timeline_categories")
        .set({ name: title, updated_at: t })
        .where("thing_id", "=", id)
        .where("name", "<>", title)
        .execute();
    }
    return result;
  });
  return { thing: (await getThing(db, id)) as Thing, skipped };
}

/**
 * The thing's title: the value of its type's title field. `undefined` for an
 * unknown thing, or one never given a value for a title field added since.
 */
export async function getThingTitle(db: Database, id: string): Promise<string | undefined> {
  const row = await queryBuilder(db)
    .selectFrom("things as t")
    .innerJoin("thing_types as ty", "ty.id", "t.thing_type_id")
    .innerJoin("thing_field_values as v", (join) =>
      join.onRef("v.thing_id", "=", "t.id").onRef("v.field_id", "=", "ty.title_field_id"),
    )
    .select("v.value_text")
    .where("t.id", "=", id)
    .executeTakeFirst();
  return row?.value_text ?? undefined;
}

/** What `deleteThing` would delete or change, for the user to confirm. */
export async function previewThingDeletion(db: Database, id: string): Promise<ThingDeletion> {
  await requireThing(db, id);
  return previewThingsDeletion(db, "id", id);
}

/**
 * Deletes the thing with its values. A `ref` or `multi_ref` value referring to
 * it, in another thing or a log entry, is removed, leaving that field without
 * it; a timeline category linked to it is unlinked and keeps its name. See
 * `previewThingDeletion`.
 */
export async function deleteThing(db: Database, id: string): Promise<void> {
  await transaction(db, async () => {
    await requireThing(db, id);
    await queryBuilder(db).deleteFrom("things").where("id", "=", id).execute();
  });
}

// ---------------------------------------------------------------------------
async function requireThing(db: Database, id: string): Promise<ThingRow> {
  const row = await queryBuilder(db)
    .selectFrom("things")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  if (!row) throw new Error(`Thing ${id}: not found`);
  return row;
}
async function withValues(db: Database, row: ThingRow): Promise<Thing> {
  const values = await readValues(db, THING_TABLES, { id: row.id, typeId: row.thing_type_id });
  return toThing(row, values);
}

function toThing(row: ThingRow, values: Record<string, Value>): Thing {
  return {
    id: row.id,
    thingTypeId: row.thing_type_id,
    source: row.source,
    externalId: row.external_id,
    values,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
