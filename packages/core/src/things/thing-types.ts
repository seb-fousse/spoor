import type { Selectable } from "kysely";
import type { Database } from "../db/platform";
import { queryBuilder } from "../db/query";
import type { DB } from "../db/schema/tables";
import { transaction } from "../db/transaction";
import {
  addField,
  countFieldValues,
  createFields,
  deleteField,
  draftFields,
  type FieldDefinition,
  type FieldPatch,
  getFields,
  type NewField,
  reorderFields,
  updateField,
} from "../definitions/engine";
import { THING_TABLES } from "../definitions/tables";
import { optionalText, requireName } from "../lib/guards";
import { newId } from "../lib/ids";
import { type Instant, now } from "../lib/time";
/**
 * Thing types and their fields (see docs/data-spec.md § 4. Things). Fields go through
 * `definitions/engine.ts`, shared with log types.
 *
 * Every thing type has a title field: a required `text` field, never deleted,
 * whose value names each thing in references, categories and merging. Every
 * write runs in one transaction.
 */

export interface ThingType {
  id: string;
  name: string;
  description: string | null;
  /** The required `text` field that names each thing. */
  titleFieldId: string;
  createdAt: Instant;
  updatedAt: Instant;
  archivedAt: Instant | null;
}

export interface ThingDeletion {
  /** The things deleted. */
  things: number;
  /** References to them from other things and from log entries, which are removed. */
  references: number;
  /** Timeline categories linked to them, which are unlinked and keep their names. */
  categories: number;
}

type ThingTypeRow = Selectable<DB["thing_types"]>;

// ---------------------------------------------------------------------------
// Thing types

/**
 * Creates a type with `fields`, positioned in order. The field at
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
        created_at: t,
        updated_at: t,
      })
      .execute();
    await createFields(db, THING_TABLES, id, drafts, t);
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

/** Renames, redescribes, or picks another title field: a required `text` field of the type. */
export async function updateThingType(
  db: Database,
  id: string,
  patch: { name?: string; description?: string | null; titleFieldId?: string },
): Promise<ThingType> {
  await transaction(db, async () => {
    const type = await requireThingType(db, id);
    if (patch.titleFieldId !== undefined) {
      const fields = await getFields(db, THING_TABLES, id);
      const field = fields.find((f) => f.id === patch.titleFieldId);
      if (!field) {
        throw new Error(`Thing type ${id}: field ${patch.titleFieldId} is not one of its fields`);
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

/** Adds a field after the type's others; existing things have no value for it. Returns its id. */
export async function addThingField(
  db: Database,
  thingTypeId: string,
  field: NewField,
): Promise<string> {
  return transaction(db, async () => {
    await requireThingType(db, thingTypeId);
    return addField(db, THING_TABLES, thingTypeId, field, now());
  });
}

/**
 * Changes one of the type's fields; see `FieldPatch`. Its value type never
 * changes. The title field stays required.
 */
export async function updateThingField(
  db: Database,
  thingTypeId: string,
  fieldId: string,
  patch: FieldPatch,
): Promise<void> {
  await transaction(db, async () => {
    const type = await requireThingType(db, thingTypeId);
    await requireOwnField(db, thingTypeId, fieldId);
    if (fieldId === type.titleFieldId && patch.required === false) {
      throw new Error(`Thing type ${thingTypeId}: title field ${fieldId} must stay required`);
    }
    await updateField(db, THING_TABLES, fieldId, patch, now());
  });
}

/** How many things hold a value for the field, for the user to confirm its deletion. */
export async function previewThingFieldDeletion(
  db: Database,
  thingTypeId: string,
  fieldId: string,
): Promise<{ values: number }> {
  await requireThingType(db, thingTypeId);
  await requireOwnField(db, thingTypeId, fieldId);
  return { values: await countFieldValues(db, THING_TABLES, fieldId) };
}

/**
 * Deletes one of the type's fields with its values. The title field cannot be
 * deleted. See `previewThingFieldDeletion`.
 */
export async function deleteThingField(
  db: Database,
  thingTypeId: string,
  fieldId: string,
): Promise<void> {
  await transaction(db, async () => {
    const type = await requireThingType(db, thingTypeId);
    await requireOwnField(db, thingTypeId, fieldId);
    if (fieldId === type.titleFieldId) {
      throw new Error(`Thing type ${thingTypeId}: title field ${fieldId} cannot be deleted`);
    }
    await deleteField(db, THING_TABLES, fieldId);
  });
}

/** Puts the type's fields in the order of `fieldIds`. */
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

/** The type's fields, by position. */
export async function getThingTypeFields(
  db: Database,
  thingTypeId: string,
): Promise<FieldDefinition[]> {
  await requireThingType(db, thingTypeId);
  return getFields(db, THING_TABLES, thingTypeId);
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
  return previewThingsDeletion(db, "thing_type_id", id);
}

/**
 * Deletes the type with its fields and things, as `deleteThing` does
 * each. A timeline offering it as its default thing type no longer has one.
 * See `previewThingTypeDeletion`.
 */
export async function deleteThingType(db: Database, id: string): Promise<void> {
  await transaction(db, async () => {
    await requireThingType(db, id);
    await queryBuilder(db).deleteFrom("thing_types").where("id", "=", id).execute();
  });
}

// Internals

function assertTitleShape(typeId: string, fieldId: string, valueType: string, required: boolean) {
  if (valueType !== "text" || !required) {
    throw new Error(`Thing type ${typeId}: title field ${fieldId} must be a required text field`);
  }
}

export async function requireThingType(db: Database, id: string): Promise<ThingType> {
  const type = await getThingType(db, id);
  if (!type) throw new Error(`Thing type ${id}: not found`);
  return type;
}

async function requireOwnField(db: Database, thingTypeId: string, fieldId: string) {
  const field = await queryBuilder(db)
    .selectFrom("thing_fields")
    .select("id")
    .where("id", "=", fieldId)
    .where("thing_type_id", "=", thingTypeId)
    .executeTakeFirst();
  if (!field) throw new Error(`Thing field ${fieldId}: not a field of thing type ${thingTypeId}`);
}

/** What deleting the things whose `column` is `value` would delete or change. */
export async function previewThingsDeletion(
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

function toThingType(row: ThingTypeRow): ThingType {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    titleFieldId: row.title_field_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}
