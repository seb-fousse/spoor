import type { Selectable } from "kysely";
import {
  createFirstVersion,
  draftFields,
  type FieldDefinition,
  type FieldInput,
  getVersionFields,
  MANUAL,
  type NewField,
  readValues,
  reorderFields,
  reviseFields,
  setValues,
  THING_TABLES,
  updateField,
  type ValuePatch,
} from "./definitions";
import { isNonEmptyString, optionalText, requireName } from "./guards";
import { newId } from "./ids";
import type { Database } from "./platform/index";
import { queryBuilder } from "./query";
import type { DB } from "./schema/tables";
import { type Instant, now } from "./time";

import { transaction } from "./transaction";
import type { Value } from "./values";

/**
 * Things (see docs/data-spec.md § 4. Things): thing types with versioned fields,
 * and things holding one value per field. The field machinery is shared with
 * log types in `definitions.ts`.
 *
 * Every thing type has a title field: a required `text` field, never retired,
 * whose value names each thing in references, categories and merging. A
 * timeline category linked to a thing stores the title as its name, updated
 * here whenever the title changes, so it keeps the last title once the thing
 * is deleted and the category unlinked.
 *
 * Deleting is permanent. Deleting a thing also removes the references to it
 * held by other things and log entries; `previewThingDeletion` counts them
 * first so the user can confirm. Every write runs in one transaction.
 */

export interface ThingType {
  id: string;
  name: string;
  description: string | null;
  /** The required `text` field that names each thing. */
  titleFieldId: string;
  /** The current version, which new things are validated against. */
  schemaVersion: number;
  createdAt: Instant;
  updatedAt: Instant;
  archivedAt: Instant | null;
}

export interface Thing {
  id: string;
  thingTypeId: string;
  /** The version its values were validated against. */
  thingTypeVersion: number;
  source: string;
  externalId: string | null;
  /** Stored values by field id; fields without a value are absent. */
  values: Record<string, Value>;
  createdAt: Instant;
  updatedAt: Instant;
}

/** What deleting things would delete or change, for the user to confirm. */
export interface ThingDeletion {
  /** The things deleted. */
  things: number;
  /** References to them from other things and from log entries, which are removed. */
  references: number;
  /** Timeline categories linked to them, which are unlinked and keep their names. */
  categories: number;
}

type ThingTypeRow = Selectable<DB["thing_types"]>;
type ThingRow = Selectable<DB["things"]>;

// ---------------------------------------------------------------------------
// Thing types

/**
 * Creates a type at version 1 with `fields`, positioned in order. The field at
 * `titleFieldIndex` (default: the first) is the title field, so it must be a
 * required `text` field.
 */
export async function createThingType(
  db: Database,
  input: {
    name: string;
    description?: string | null;
    fields: readonly NewField[];
    titleFieldIndex?: number;
  },
): Promise<ThingType> {
  const id = newId();
  const label = `Thing type ${id}`;
  const name = requireName(label, input.name);
  const drafts = draftFields(THING_TABLES, input.fields);
  const title = drafts[input.titleFieldIndex ?? 0];
  if (title === undefined) throw new Error(`${label}: needs a title field`);
  if (title.shape.valueType !== "text" || !title.required) {
    throw new Error(`${label}: title field ${title.id} must be a required text field`);
  }
  await transaction(db, async () => {
    const t = now();
    await queryBuilder(db)
      .insertInto("thing_types")
      .values({
        id,
        name,
        description: optionalText(input.description),
        title_field_id: title.id,
        schema_version: 1,
        created_at: t,
        updated_at: t,
      })
      .execute();
    await createFirstVersion(db, THING_TABLES, id, drafts, t);
  });
  return (await getThingType(db, id)) as ThingType;
}

/** The thing type with `id`, or `undefined`. */
export async function getThingType(db: Database, id: string): Promise<ThingType | undefined> {
  const row = await queryBuilder(db)
    .selectFrom("thing_types")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  return row && toThingType(row);
}

/** Every thing type by name, archived included. */
export async function listThingTypes(db: Database): Promise<ThingType[]> {
  const rows = await queryBuilder(db)
    .selectFrom("thing_types")
    .selectAll()
    .orderBy("name", (ob) => ob.collate("nocase"))
    .orderBy("id")
    .execute();
  return rows.map(toThingType);
}

/**
 * Renames, redescribes, or picks another title field: a required `text` field
 * of the current version. None of these creates a version.
 */
export async function updateThingType(
  db: Database,
  id: string,
  patch: { name?: string; description?: string | null; titleFieldId?: string },
): Promise<ThingType> {
  await transaction(db, async () => {
    const type = await requireThingType(db, id);
    if (patch.titleFieldId !== undefined) {
      const fields = await getVersionFields(db, THING_TABLES, id, type.schemaVersion);
      const field = fields.find((f) => f.id === patch.titleFieldId);
      if (!field) {
        throw new Error(
          `Thing type ${id}: field ${patch.titleFieldId} is not in version ${type.schemaVersion}`,
        );
      }
      assertTitleShape(id, field.id, field.shape.valueType, field.required);
    }
    await queryBuilder(db)
      .updateTable("thing_types")
      .set({
        name: patch.name === undefined ? type.name : requireName(`Thing type ${id}`, patch.name),
        description:
          patch.description === undefined ? type.description : optionalText(patch.description),
        title_field_id: patch.titleFieldId ?? type.titleFieldId,
        updated_at: now(),
      })
      .where("id", "=", id)
      .execute();
  });
  return (await getThingType(db, id)) as ThingType;
}

/**
 * Replaces the type's field list; see `reviseFields` in `definitions.ts`. A
 * changed shape or required flag, or an added or left-out field, creates a new
 * version that new things use; existing things keep theirs. The title field
 * must stay in the list as a required `text` field.
 */
export async function reviseThingTypeFields(
  db: Database,
  id: string,
  fields: readonly FieldInput[],
): Promise<ThingType> {
  await transaction(db, async () => {
    const type = await requireThingType(db, id);
    const title = fields.find((f) => f.id === type.titleFieldId);
    if (!title) {
      throw new Error(`Thing type ${id}: title field ${type.titleFieldId} cannot be retired`);
    }
    assertTitleShape(id, type.titleFieldId, title.valueType, title.required ?? false);
    await reviseFields(db, THING_TABLES, id, fields, now());
  });
  return (await getThingType(db, id)) as ThingType;
}

/** Renames or relabels one of the type's fields, without a version. */
export async function updateThingField(
  db: Database,
  thingTypeId: string,
  fieldId: string,
  patch: { name?: string; optionLabels?: Record<string, string> },
): Promise<void> {
  await transaction(db, async () => {
    await requireThingType(db, thingTypeId);
    const field = await queryBuilder(db)
      .selectFrom("thing_fields")
      .select("id")
      .where("id", "=", fieldId)
      .where("thing_type_id", "=", thingTypeId)
      .executeTakeFirst();
    if (!field) throw new Error(`Thing field ${fieldId}: not a field of thing type ${thingTypeId}`);
    await updateField(db, THING_TABLES, fieldId, patch, now());
  });
}

/** Puts the current version's fields in the order of `fieldIds`, without a version. */
export async function reorderThingFields(
  db: Database,
  thingTypeId: string,
  fieldIds: readonly string[],
): Promise<void> {
  await transaction(db, async () => {
    await requireThingType(db, thingTypeId);
    await reorderFields(db, THING_TABLES, thingTypeId, fieldIds, now());
  });
}

/** The fields of a version of the type (default: the current one), by position. */
export async function getThingTypeVersionFields(
  db: Database,
  thingTypeId: string,
  version?: number,
): Promise<FieldDefinition[]> {
  const type = await getThingType(db, thingTypeId);
  if (!type) throw new Error(`Thing type ${thingTypeId}: not found`);
  return getVersionFields(db, THING_TABLES, thingTypeId, version ?? type.schemaVersion);
}

/** Archives or unarchives. An archived type is not offered for new things or new references. */
export async function setThingTypeArchived(
  db: Database,
  id: string,
  archived: boolean,
): Promise<void> {
  await transaction(db, async () => {
    await requireThingType(db, id);
    const t = now();
    await queryBuilder(db)
      .updateTable("thing_types")
      .set({ archived_at: archived ? t : null, updated_at: t })
      .where("id", "=", id)
      .execute();
  });
}

/** What `deleteThingType` would delete or change, for the user to confirm. */
export async function previewThingTypeDeletion(db: Database, id: string): Promise<ThingDeletion> {
  await requireThingType(db, id);
  return previewDeletion(db, "thing_type_id", id);
}

/**
 * Deletes the type with its fields, versions and things, as `deleteThing` does
 * each. A timeline offering it as its default thing type no longer has one.
 * See `previewThingTypeDeletion`.
 */
export async function deleteThingType(db: Database, id: string): Promise<void> {
  await transaction(db, async () => {
    await requireThingType(db, id);
    await queryBuilder(db).deleteFrom("thing_types").where("id", "=", id).execute();
  });
}

// ---------------------------------------------------------------------------
// Things

/**
 * Creates a thing of a live, unarchived type, validated against its current
 * version. `source` (default `manual`) and `externalId` are set once and never
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
        thing_type_version: type.schemaVersion,
        source,
        external_id: externalId,
        created_at: t,
        updated_at: t,
      })
      .execute();
    await setValues(
      db,
      THING_TABLES,
      { id, typeId: type.id, typeVersion: type.schemaVersion },
      input.values,
      { writtenBy: input.writtenBy ?? source, writtenAt: t },
    );
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
 * the thing's own version. The user always wins: a `writtenBy` other than
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
    const result = await setValues(
      db,
      THING_TABLES,
      { id, typeId: thing.thing_type_id, typeVersion: thing.thing_type_version },
      values,
      { writtenBy: options.writtenBy ?? MANUAL, writtenAt: t },
    );
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
 * unknown thing, or one whose version predates its type's current title field.
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
  return previewDeletion(db, "id", id);
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
// Internals

function assertTitleShape(typeId: string, fieldId: string, valueType: string, required: boolean) {
  if (valueType !== "text" || !required) {
    throw new Error(`Thing type ${typeId}: title field ${fieldId} must be a required text field`);
  }
}

async function requireThingType(db: Database, id: string): Promise<ThingType> {
  const type = await getThingType(db, id);
  if (!type) throw new Error(`Thing type ${id}: not found`);
  return type;
}

async function requireThing(db: Database, id: string): Promise<ThingRow> {
  const row = await queryBuilder(db)
    .selectFrom("things")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  if (!row) throw new Error(`Thing ${id}: not found`);
  return row;
}

/** What deleting the things whose `column` is `value` would delete or change. */
async function previewDeletion(
  db: Database,
  column: "id" | "thing_type_id",
  value: string,
): Promise<ThingDeletion> {
  const q = queryBuilder(db);
  const doomed = q.selectFrom("things").select("id").where(column, "=", value);
  const { things } = await q
    .selectFrom("things")
    .select((eb) => eb.fn.countAll<number>().as("things"))
    .where(column, "=", value)
    .executeTakeFirstOrThrow();
  // A thing's own values go with it, so only other things' references count.
  const fromThings = await q
    .selectFrom("thing_field_values")
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where("value_ref", "in", doomed)
    .where("thing_id", "not in", doomed)
    .executeTakeFirstOrThrow();
  const fromEntries = await q
    .selectFrom("log_field_values")
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where("value_ref", "in", doomed)
    .executeTakeFirstOrThrow();
  const { categories } = await q
    .selectFrom("timeline_categories")
    .select((eb) => eb.fn.countAll<number>().as("categories"))
    .where("thing_id", "in", doomed)
    .executeTakeFirstOrThrow();
  return { things, references: fromThings.n + fromEntries.n, categories };
}

async function withValues(db: Database, row: ThingRow): Promise<Thing> {
  const values = await readValues(db, THING_TABLES, {
    id: row.id,
    typeId: row.thing_type_id,
    typeVersion: row.thing_type_version,
  });
  return toThing(row, values);
}

function toThingType(row: ThingTypeRow): ThingType {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    titleFieldId: row.title_field_id,
    schemaVersion: row.schema_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}

function toThing(row: ThingRow, values: Record<string, Value>): Thing {
  return {
    id: row.id,
    thingTypeId: row.thing_type_id,
    thingTypeVersion: row.thing_type_version,
    source: row.source,
    externalId: row.external_id,
    values,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
