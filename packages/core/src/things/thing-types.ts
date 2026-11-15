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
import { SpoorError } from "../lib/spoor-error";
import { type Instant, now } from "../lib/time";
/**
 * Thing types and their fields (see docs/data-spec.md § 4. Things). Fields go through
 * `definitions/engine.ts`, shared with log types.
 *
 * Every thing type has a title field: a required `text` field, never deleted,
 * whose value names each thing in references, categories and merging, so every
 * thing of the type has a value for it. Every write runs in one transaction.
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
 * Stands for the type being created in a `ref` or `multi_ref` field's
 * `thingTypeId`, which `createThingType` replaces with the new type's id: a
 * Person's `{ name: "Parent", valueType: "ref", constraints: { thingTypeId:
 * SELF_THING_TYPE } }`. It is never stored, and is refused anywhere else, as a
 * `thingTypeId` that is not a UUID: a type that exists is referred to by its id.
 */
export const SELF_THING_TYPE = "self";

/**
 * Creates a type with `fields`, positioned in order. The field at
 * `titleFieldIndex` (default: the first) is the title field, so it must be a
 * required `text` field. A `ref` or `multi_ref` field refers to the new type
 * itself with `SELF_THING_TYPE`.
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
  const subject = { entity: "thing_type", id } as const;
  const name = requireName(label, input.name, subject);
  const drafts = draftFields(
    THING_TABLES,
    input.fields.map((field) => resolveSelf(field, id)),
  );
  const title = drafts[input.titleFieldIndex ?? 0];
  if (title === undefined) {
    throw new SpoorError("invalid", `${label}: needs a title field`, {
      ...subject,
      field: "titleFieldIndex",
    });
  }
  if (title.shape.valueType !== "text" || !title.required) {
    throw new SpoorError(
      "invalid",
      `${label}: title field ${title.id} must be a required text field`,
      { ...subject, field: "titleFieldIndex", fieldId: title.id },
    );
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

/**
 * Renames, redescribes, or picks another title field: a required `text` field of
 * the type that every one of its things has a value for. A field added after some
 * things were created is empty on them, so it can become the title only once
 * each of them has a value.
 */
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
        throw new SpoorError(
          "not_found",
          `Thing type ${id}: field ${patch.titleFieldId} is not one of its fields`,
          { entity: "thing_field", id: patch.titleFieldId },
        );
      }
      assertTitleShape(id, field.id, field.shape.valueType, field.required);
      if (field.id !== type.titleFieldId) await assertEveryThingHasValue(db, id, field.id);
    }
    await queryBuilder(db)
      .updateTable("thing_types")
      .set({
        name:
          patch.name === undefined
            ? type.name
            : requireName(`Thing type ${id}`, patch.name, { entity: "thing_type", id }),
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
      throw new SpoorError(
        "invalid",
        `Thing type ${thingTypeId}: title field ${fieldId} must stay required`,
        { entity: "thing_type", id: thingTypeId, field: "required", fieldId },
      );
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
      throw new SpoorError(
        "invalid",
        `Thing type ${thingTypeId}: title field ${fieldId} cannot be deleted`,
        { entity: "thing_type", id: thingTypeId, fieldId },
      );
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

/** `field`, with a `thingTypeId` of `SELF_THING_TYPE` replaced by the new type's `id`. */
function resolveSelf(field: NewField, id: string): NewField {
  const { constraints } = field;
  if (field.valueType !== "ref" && field.valueType !== "multi_ref") return field;
  if (typeof constraints !== "object" || constraints === null) return field;
  if ((constraints as { thingTypeId?: unknown }).thingTypeId !== SELF_THING_TYPE) return field;
  return { ...field, constraints: { ...constraints, thingTypeId: id } };
}

function assertTitleShape(typeId: string, fieldId: string, valueType: string, required: boolean) {
  if (valueType !== "text" || !required) {
    throw new SpoorError(
      "invalid",
      `Thing type ${typeId}: title field ${fieldId} must be a required text field`,
      { entity: "thing_type", id: typeId, field: "titleFieldId", fieldId },
    );
  }
}

/** Refuses a title field that some things of the type have no value for, naming how many. */
async function assertEveryThingHasValue(db: Database, typeId: string, fieldId: string) {
  const q = queryBuilder(db);
  const missing = await q
    .selectFrom("things")
    .select("id")
    .where("thing_type_id", "=", typeId)
    .where(
      "id",
      "not in",
      q.selectFrom("thing_field_values").select("thing_id").where("field_id", "=", fieldId),
    )
    .orderBy("id")
    .execute();
  if (missing.length === 0) return;
  const ids = missing.slice(0, 3).map((t) => t.id);
  const more = missing.length > ids.length ? ", ..." : "";
  throw new SpoorError(
    "conflict",
    `Thing type ${typeId}: title field ${fieldId} has no value on ${missing.length} things (${ids.join(", ")}${more})`,
    { entity: "thing_type", id: typeId, field: "titleFieldId", fieldId, count: missing.length },
  );
}

export async function requireThingType(db: Database, id: string): Promise<ThingType> {
  const type = await getThingType(db, id);
  if (!type) {
    throw new SpoorError("not_found", `Thing type ${id}: not found`, { entity: "thing_type", id });
  }
  return type;
}

async function requireOwnField(db: Database, thingTypeId: string, fieldId: string) {
  const field = await queryBuilder(db)
    .selectFrom("thing_fields")
    .select("id")
    .where("id", "=", fieldId)
    .where("thing_type_id", "=", thingTypeId)
    .executeTakeFirst();
  if (!field) {
    throw new SpoorError(
      "not_found",
      `Thing field ${fieldId}: not a field of thing type ${thingTypeId}`,
      { entity: "thing_field", id: fieldId },
    );
  }
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
