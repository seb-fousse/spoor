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
import { LOG_TABLES } from "../definitions/tables";
import { optionalText, requireName } from "../lib/guards";
import { newId } from "../lib/ids";
import { type Instant, now } from "../lib/time";
import { tree } from "../lib/tree";

/**
 * Log types and their fields (see docs/data-spec.md § 3. Logs). Fields go through
 * `definitions/engine.ts`, shared with things.
 *
 * Deleting is permanent: a type goes with the types below it and all their
 * entries. Every write runs in one transaction.
 */

export interface LogType {
  id: string;
  name: string;
  description: string | null;
  /** Entries of this type are child entries of that type's entries. Never changes. */
  parentTypeId: string | null;
  createdAt: Instant;
  updatedAt: Instant;
  archivedAt: Instant | null;
}

/** A field to add to a log type. */
export type NewLogField = NewField;
export type LogField = FieldDefinition;

/** What `deleteLogType` would delete. */
export interface LogTypeDeletion {
  /** The type itself and every type below it. */
  types: number;
  /** Their entries, child entries included. */
  entries: number;
}

type LogTypeRow = Selectable<DB["log_types"]>;

// ---------------------------------------------------------------------------
// Log types

/**
 * Creates a log type with `fields`, positioned in order. A `parentTypeId` must
 * name a log type, and can never change afterwards, so types cannot form a cycle.
 */
export async function createLogType(
  db: Database,
  input: {
    name: string;
    description?: string | null;
    parentTypeId?: string | null;
    fields: readonly NewLogField[];
  },
): Promise<LogType> {
  const id = newId();
  const drafts = draftFields(LOG_TABLES, input.fields);
  await transaction(db, async () => {
    const parentTypeId = input.parentTypeId ?? null;
    if (parentTypeId !== null) await requireLogType(db, parentTypeId);
    const t = now();
    await queryBuilder(db)
      .insertInto("log_types")
      .values({
        id,
        name: requireName(`Log type ${id}`, input.name),
        description: optionalText(input.description),
        parent_type_id: parentTypeId,
        created_at: t,
        updated_at: t,
      })
      .execute();
    await createFields(db, LOG_TABLES, id, drafts, t);
  });
  return (await getLogType(db, id)) as LogType;
}

/** The log type with `id`, or `undefined`. */
export async function getLogType(db: Database, id: string): Promise<LogType | undefined> {
  const row = await queryBuilder(db)
    .selectFrom("log_types")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  return row && toLogType(row);
}

/** Every log type by name, archived included. */
export async function listLogTypes(db: Database): Promise<LogType[]> {
  const rows = await queryBuilder(db)
    .selectFrom("log_types")
    .selectAll()
    .orderBy("name", (ob) => ob.collate("nocase"))
    .orderBy("id")
    .execute();
  return rows.map(toLogType);
}

/** Renames or redescribes. The parent type is fixed at creation. */
export async function updateLogType(
  db: Database,
  id: string,
  patch: { name?: string; description?: string | null },
): Promise<LogType> {
  await transaction(db, async () => {
    const type = await requireLogType(db, id);
    await queryBuilder(db)
      .updateTable("log_types")
      .set({
        name: patch.name === undefined ? type.name : requireName(`Log type ${id}`, patch.name),
        description:
          patch.description === undefined ? type.description : optionalText(patch.description),
        updated_at: now(),
      })
      .where("id", "=", id)
      .execute();
  });
  return (await getLogType(db, id)) as LogType;
}

/** Adds a field after the type's others; existing entries have no value for it. Returns its id. */
export async function addLogField(db: Database, id: string, field: NewLogField): Promise<string> {
  return transaction(db, async () => {
    await requireLogType(db, id);
    return addField(db, LOG_TABLES, id, field, now());
  });
}

/** Changes a field; see `FieldPatch`. Its value type never changes. */
export async function updateLogField(
  db: Database,
  fieldId: string,
  patch: FieldPatch,
): Promise<void> {
  await transaction(db, () => updateField(db, LOG_TABLES, fieldId, patch, now()));
}

/** How many entries hold a value for the field, for the user to confirm its deletion. */
export async function previewLogFieldDeletion(
  db: Database,
  fieldId: string,
): Promise<{ values: number }> {
  return { values: await countFieldValues(db, LOG_TABLES, fieldId) };
}

/** Deletes a field with its values. See `previewLogFieldDeletion`. */
export async function deleteLogField(db: Database, fieldId: string): Promise<void> {
  await transaction(db, () => deleteField(db, LOG_TABLES, fieldId));
}

/** Puts the type's fields in the order of `fieldIds`. */
export async function reorderLogFields(
  db: Database,
  id: string,
  fieldIds: readonly string[],
): Promise<void> {
  await transaction(db, async () => {
    await requireLogType(db, id);
    await reorderFields(db, LOG_TABLES, id, fieldIds, now());
  });
}

/** The type's fields, by position. */
export async function getLogTypeFields(db: Database, id: string): Promise<LogField[]> {
  await requireLogType(db, id);
  return getFields(db, LOG_TABLES, id);
}

/** Archives or unarchives. An archived type is not offered for new entries. */
export async function setLogTypeArchived(
  db: Database,
  id: string,
  archived: boolean,
): Promise<void> {
  await transaction(db, async () => {
    await requireLogType(db, id);
    const t = now();
    await queryBuilder(db)
      .updateTable("log_types")
      .set({ archived_at: archived ? t : null, updated_at: t })
      .where("id", "=", id)
      .execute();
  });
}

/** What `deleteLogType` would delete, for the user to confirm. */
export async function previewLogTypeDeletion(db: Database, id: string): Promise<LogTypeDeletion> {
  await requireLogType(db, id);
  const types = await tree(id, async (parents) =>
    (
      await queryBuilder(db)
        .selectFrom("log_types")
        .select("id")
        .where("parent_type_id", "in", parents)
        .execute()
    ).map((r) => r.id),
  );
  const { entries } = await queryBuilder(db)
    .selectFrom("log_entries")
    .select((eb) => eb.fn.countAll<number>().as("entries"))
    .where("log_type_id", "in", types)
    .executeTakeFirstOrThrow();
  return { types: types.length, entries };
}

/**
 * Deletes the type with every type below it (whose `parentTypeId` is it,
 * recursively), and all their fields and entries. See
 * `previewLogTypeDeletion`.
 */
export async function deleteLogType(db: Database, id: string): Promise<void> {
  await transaction(db, async () => {
    await requireLogType(db, id);
    await queryBuilder(db).deleteFrom("log_types").where("id", "=", id).execute();
  });
}

export async function requireLogType(db: Database, id: string): Promise<LogType> {
  const type = await getLogType(db, id);
  if (!type) throw new Error(`Log type ${id}: not found`);
  return type;
}

/** An unarchived type: one offered for new entries. */
export async function requireOfferedLogType(db: Database, id: string): Promise<LogType> {
  const type = await requireLogType(db, id);
  if (type.archivedAt !== null) throw new Error(`Log type ${id}: archived`);
  return type;
}

function toLogType(row: LogTypeRow): LogType {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    parentTypeId: row.parent_type_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}
