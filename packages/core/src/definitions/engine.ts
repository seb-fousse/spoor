import type { Database } from "../db/platform";
import { queryBuilder } from "../db/query";
import { isNonEmptyString, requireName } from "../lib/guards";
import { newId } from "../lib/ids";
import type { Instant } from "../lib/time";
import {
  decodeValue,
  encodeValue,
  FIELD_VALUE_TYPES,
  type FieldValueType,
  isMultiValueType,
  parseOptionLabels,
  parseShape,
  type RefConstraints,
  VALUE_COLUMNS,
  type Value,
  type ValueColumns,
  type ValueShape,
  validateValue,
} from "../values/values";
import { type DefinitionDB, definitionQuery } from "./plugin";
import type { DefinitionTables } from "./tables";

/**
 * Definitions with fields (see docs/data-spec.md § 3. Logs, § 4. Things): the
 * machinery thing types and log types share, written once and pointed at each
 * slice's tables by a `DefinitionTables` descriptor.
 *
 * A field's value type is set when it is created and never changes, so stored
 * values never need reinterpreting. Everything else about a field (name,
 * position, required flag, constraints, option labels) is edited in place, and
 * checked only when a value is written: existing values are not re-validated.
 * A record (a thing or a log entry) stores one value row per field, or one per
 * referenced thing for `multi_ref`.
 *
 * Nothing here opens a transaction: every write must run inside the caller's
 * `transaction()`, alongside the caller's own checks (that the type exists,
 * that it is not archived, and so on).
 *
 * Internal to core: not exported from the barrel.
 */

/** The `source` and `written_by` of the user's own edits. */
export const MANUAL = "manual";

/** A field to add, as given by the user or an import. */
export interface NewField {
  name: string;
  valueType: FieldValueType;
  required?: boolean;
  /** Parsed by `parseShape`; see `values/values.ts`. */
  constraints?: unknown;
  optionLabels?: Record<string, string>;
}

/**
 * Changes to a field. Constraints are parsed for its value type, which never
 * changes; a `ref` or `multi_ref` field keeps the thing type it refers to.
 */
export interface FieldPatch {
  name?: string;
  required?: boolean;
  constraints?: unknown;
  optionLabels?: Record<string, string>;
}

/** A validated field, with its id, ready to be written. */
export interface FieldDraft {
  id: string;
  name: string;
  shape: ValueShape;
  required: boolean;
  optionLabels: Record<string, string>;
}

export interface FieldDefinition {
  id: string;
  typeId: string;
  name: string;
  position: number;
  optionLabels: Record<string, string>;
  shape: ValueShape;
  required: boolean;
  createdAt: Instant;
  updatedAt: Instant;
}

/** A record whose values are read or written: a thing or a log entry. */
export interface ValueRecord {
  id: string;
  typeId: string;
}

/** New values by field id. `null` clears a value, as does an empty `multi_ref`. */
export type ValuePatch = Readonly<Record<string, Value | null>>;

/** A validated value for one field; `null` clears it. */
export interface FieldValue {
  field: FieldDefinition;
  value: Value | null;
}

/** Who writes values, and when. */
export interface ValueWriter {
  /** A `source` identifier: `manual` for the user, otherwise an automated writer. */
  writtenBy: string;
  writtenAt: Instant;
}

// ---------------------------------------------------------------------------
// Fields

/**
 * Validates the fields of a new type and gives each a new id, in input order.
 * Names must be unique, ignoring case and surrounding spaces. Touches no
 * database, so a caller can learn the ids before inserting its type row (a
 * thing type names its title field).
 */
export function draftFields(tables: DefinitionTables, inputs: readonly NewField[]): FieldDraft[] {
  const drafts = inputs.map((input) => draftField(tables, newId(), input));
  assertUniqueNames(tables, drafts);
  return drafts;
}

/** Writes the fields of a type whose row the caller has just inserted, positioned in order. */
export async function createFields(
  db: Database,
  tables: DefinitionTables,
  typeId: string,
  fields: readonly FieldDraft[],
  at: Instant,
): Promise<void> {
  await requireType(db, tables, typeId);
  for (const field of fields) await assertRefTarget(db, tables, field);
  for (const [position, field] of fields.entries()) {
    await insertField(db, tables, typeId, field, position, at);
  }
}

/** Adds a field after the type's others; returns its id. Existing records have no value for it. */
export async function addField(
  db: Database,
  tables: DefinitionTables,
  typeId: string,
  input: NewField,
  at: Instant,
): Promise<string> {
  await requireType(db, tables, typeId);
  const draft = draftField(tables, newId(), input);
  const fields = await getFields(db, tables, typeId);
  assertUniqueNames(tables, [...fields, draft]);
  await assertRefTarget(db, tables, draft);
  const position = Math.max(-1, ...fields.map((f) => f.position)) + 1;
  await insertField(db, tables, typeId, draft, position, at);
  return draft.id;
}

/**
 * Changes a field in place; see `FieldPatch`. A new name must be unique among
 * the type's fields. An existing field given no `optionLabels` keeps its
 * stored ones, while `{}` clears them.
 */
export async function updateField(
  db: Database,
  tables: DefinitionTables,
  fieldId: string,
  patch: FieldPatch,
  at: Instant,
): Promise<void> {
  const label = `${tables.fieldKind} ${fieldId}`;
  const field = await requireField(db, tables, fieldId);
  const name = patch.name === undefined ? field.name : requireName(label, patch.name);
  if (patch.name !== undefined) {
    const others = (await getFields(db, tables, field.typeId)).filter((f) => f.id !== fieldId);
    assertUniqueNames(tables, [...others, { id: fieldId, name }]);
  }
  const required = patch.required ?? field.required;
  if (typeof required !== "boolean") throw new Error(`${label}: required must be true or false`);
  const shape =
    patch.constraints === undefined
      ? field.shape
      : parseShape(label, FIELD_VALUE_TYPES, field.shape.valueType, patch.constraints);
  if (
    (shape.valueType === "ref" || shape.valueType === "multi_ref") &&
    shape.constraints.thingTypeId !== (field.shape.constraints as RefConstraints).thingTypeId
  ) {
    throw new Error(`${label}: cannot change the thing type it refers to`);
  }
  await definitionQuery(db, tables)
    .updateTable("def_fields")
    .set({
      name,
      required: Number(required),
      constraints: JSON.stringify(shape.constraints),
      option_labels: JSON.stringify(
        patch.optionLabels === undefined
          ? field.optionLabels
          : parseOptionLabels(label, patch.optionLabels),
      ),
      updated_at: at,
    })
    .where("id", "=", fieldId)
    .execute();
}

/**
 * Puts the type's fields in the order of `fieldIds`, which must list each of
 * them once.
 */
export async function reorderFields(
  db: Database,
  tables: DefinitionTables,
  typeId: string,
  fieldIds: readonly string[],
  at: Instant,
): Promise<void> {
  const fields = await getFields(db, tables, typeId);
  const sorted = (ids: readonly string[]) => JSON.stringify([...ids].sort());
  if (sorted(fieldIds) !== sorted(fields.map((f) => f.id))) {
    throw new Error(
      `${typeLabel(tables, typeId, true)}: a new order must list each of its fields once`,
    );
  }
  const q = definitionQuery(db, tables);
  for (const [position, id] of fieldIds.entries()) {
    if (fields.find((f) => f.id === id)?.position === position) continue;
    await q
      .updateTable("def_fields")
      .set({ position, updated_at: at })
      .where("id", "=", id)
      .execute();
  }
}

/** How many records hold a value for the field, which deleting it would remove. */
export async function countFieldValues(
  db: Database,
  tables: DefinitionTables,
  fieldId: string,
): Promise<number> {
  await requireField(db, tables, fieldId);
  const { n } = await definitionQuery(db, tables)
    .selectFrom("def_values")
    .select((eb) => eb.fn.count<number>("def_record_id").distinct().as("n"))
    .where("field_id", "=", fieldId)
    .executeTakeFirstOrThrow();
  return n;
}

/** Deletes the field with its values. See `countFieldValues`. */
export async function deleteField(
  db: Database,
  tables: DefinitionTables,
  fieldId: string,
): Promise<void> {
  await requireField(db, tables, fieldId);
  await definitionQuery(db, tables).deleteFrom("def_fields").where("id", "=", fieldId).execute();
}

/** The field with `id`, or `undefined`. */
export async function getField(
  db: Database,
  tables: DefinitionTables,
  id: string,
): Promise<FieldDefinition | undefined> {
  const row = await definitionQuery(db, tables)
    .selectFrom("def_fields")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  return row && toField(tables, row);
}

/** The type's fields, by position. */
export async function getFields(
  db: Database,
  tables: DefinitionTables,
  typeId: string,
): Promise<FieldDefinition[]> {
  const rows = await definitionQuery(db, tables)
    .selectFrom("def_fields")
    .selectAll()
    .where("def_type_id", "=", typeId)
    .orderBy("position")
    .orderBy("id")
    .execute();
  return rows.map((row) => toField(tables, row));
}

// ---------------------------------------------------------------------------
// Values

/**
 * Validates `patch` for `record` against its type's fields, before
 * `writeValues`. The record need not exist yet. Refuses, naming the record and
 * field:
 * - a field not of the record's type;
 * - a value `validateValue` refuses;
 * - a required field left without a value, by clearing it or never setting it
 *   (an empty `multi_ref` has no value);
 * - a new reference to a thing that does not exist, or has another type than
 *   the field's `thingTypeId`.
 */
export async function validateValues(
  db: Database,
  tables: DefinitionTables,
  record: ValueRecord,
  patch: ValuePatch,
): Promise<FieldValue[]> {
  const fields = await getFields(db, tables, record.typeId);
  const stored = await storedRows(db, tables, record.id);
  const result: FieldValue[] = [];
  for (const [fieldId, input] of Object.entries(patch)) {
    const label = valueLabel(tables, record.id, fieldId);
    const field = fields.find((f) => f.id === fieldId);
    if (!field) {
      throw new Error(`${label}: not a field of ${typeLabel(tables, record.typeId)}`);
    }
    const value =
      input === null || (Array.isArray(input) && input.length === 0)
        ? null
        : validateValue(label, field.shape, input);
    if (value === null && field.required) throw new Error(`${label}: is required`);
    if (field.shape.valueType === "ref" || field.shape.valueType === "multi_ref") {
      const kept = new Set(stored.filter((r) => r.field_id === fieldId).map((r) => r.value_ref));
      const ids = value === null ? [] : Array.isArray(value) ? value : [value as string];
      await assertRefsTo(
        db,
        label,
        field.shape.constraints,
        ids.filter((id) => !kept.has(id)),
      );
    }
    result.push({ field, value });
  }
  for (const field of fields) {
    if (field.required && !(field.id in patch) && !stored.some((r) => r.field_id === field.id)) {
      throw new Error(`${valueLabel(tables, record.id, field.id)}: is required`);
    }
  }
  return result;
}

/**
 * Writes validated values to the record's value rows: one row per value, one
 * per referenced thing for `multi_ref`, none for a cleared value. A value equal
 * to the stored one is left alone, keeping its provenance; a changed one is
 * marked as `writer`'s. Bumps the record's `updated_at` if anything changed, and
 * says whether it did.
 */
export async function writeValues(
  db: Database,
  tables: DefinitionTables,
  recordId: string,
  values: readonly FieldValue[],
  writer: ValueWriter,
): Promise<boolean> {
  if (!isNonEmptyString(writer.writtenBy)) {
    throw new Error(`${tables.recordKind} ${recordId}: a writer is required`);
  }
  const q = definitionQuery(db, tables);
  const stored = await storedRows(db, tables, recordId);
  const provenance = { written_by: writer.writtenBy, written_at: writer.writtenAt };
  let changed = false;

  for (const { field, value } of values) {
    const rows = stored.filter((r) => r.field_id === field.id);
    const { valueType } = field.shape;
    const insert = (columns: ValueColumns) =>
      q
        .insertInto("def_values")
        .values({
          id: newId(),
          def_record_id: recordId,
          field_id: field.id,
          ...columns,
          ...provenance,
        })
        .execute();
    const remove = (ids: readonly string[]) =>
      ids.length === 0 ? undefined : q.deleteFrom("def_values").where("id", "in", ids).execute();

    // `multi_ref` is the only multi-valued field type.
    if (isMultiValueType(valueType)) {
      const next = new Set(value === null ? [] : (value as string[]));
      const kept = rows.filter((r) => r.value_ref !== null && next.has(r.value_ref));
      const added = [...next].filter((id) => !kept.some((r) => r.value_ref === id));
      if (kept.length === rows.length && added.length === 0) continue;
      changed = true;
      await remove(rows.filter((r) => !kept.includes(r)).map((r) => r.id));
      // The field is written as a whole, so the members kept are now this writer's too.
      for (const row of kept) {
        await q.updateTable("def_values").set(provenance).where("id", "=", row.id).execute();
      }
      for (const id of added) await insert(encodeValue("ref", id));
      continue;
    }

    const [row, ...extra] = rows;
    if (value === null) {
      if (rows.length === 0) continue;
      changed = true;
      await remove(rows.map((r) => r.id));
      continue;
    }
    const columns = encodeValue(valueType, value as string | number | boolean);
    if (row && extra.length === 0 && VALUE_COLUMNS.every((c) => row[c] === columns[c])) continue;
    changed = true;
    await remove(extra.map((r) => r.id));
    if (row) {
      await q
        .updateTable("def_values")
        .set({ ...columns, ...provenance })
        .where("id", "=", row.id)
        .execute();
    } else {
      await insert(columns);
    }
  }

  if (changed) {
    await q
      .updateTable("def_records")
      .set({ updated_at: writer.writtenAt })
      .where("id", "=", recordId)
      .execute();
  }
  return changed;
}

/**
 * Validates and writes `patch` for `record`, as `writer`. The user always wins:
 * an automated writer (anything but `manual`) skips fields whose stored value
 * another writer set, and those field ids are returned.
 */
export async function setValues(
  db: Database,
  tables: DefinitionTables,
  record: ValueRecord,
  patch: ValuePatch,
  writer: ValueWriter,
): Promise<{ skipped: string[] }> {
  const skipped: string[] = [];
  let allowed = patch;
  if (writer.writtenBy !== MANUAL) {
    const stored = await storedRows(db, tables, record.id);
    const ownedByOthers = new Set(
      stored.filter((r) => r.written_by !== writer.writtenBy).map((r) => r.field_id),
    );
    allowed = Object.fromEntries(
      Object.entries(patch).filter(([fieldId]) => {
        if (!ownedByOthers.has(fieldId)) return true;
        skipped.push(fieldId);
        return false;
      }),
    );
  }
  const values = await validateValues(db, tables, record, allowed);
  await writeValues(db, tables, record.id, values, writer);
  return { skipped };
}

/**
 * The record's stored values by field id, in field order: `multi_ref` as thing
 * ids sorted by id, since it is a set. Fields without a value are absent.
 */
export async function readValues(
  db: Database,
  tables: DefinitionTables,
  record: ValueRecord,
): Promise<Record<string, Value>> {
  const fields = await getFields(db, tables, record.typeId);
  const rows = await storedRows(db, tables, record.id);
  for (const row of rows) {
    if (!fields.some((f) => f.id === row.field_id)) {
      throw new Error(
        `${valueLabel(tables, record.id, row.field_id)}: stored, but not a field of ${typeLabel(tables, record.typeId)}`,
      );
    }
  }
  const values: Record<string, Value> = {};
  for (const field of fields) {
    const label = valueLabel(tables, record.id, field.id);
    const own = rows.filter((r) => r.field_id === field.id);
    if (own.length === 0) continue;
    const { valueType } = field.shape;
    if (isMultiValueType(valueType)) {
      values[field.id] = own.map((r) => decodeValue(label, "ref", r) as string).sort();
    } else if (own.length > 1) {
      throw new Error(`${label}: ${own.length} values stored for a ${valueType} field`);
    } else {
      values[field.id] = decodeValue(label, valueType, own[0]);
    }
  }
  return values;
}

// ---------------------------------------------------------------------------
// References

/**
 * Points every reference to thing `fromId` in these values at `toId`, as
 * `writer`, dropping a `multi_ref` row that would then repeat a member. Bumps
 * each changed record's `updated_at`. For merging.
 */
export async function repointRefs(
  db: Database,
  tables: DefinitionTables,
  fromId: string,
  toId: string,
  writer: ValueWriter,
): Promise<void> {
  const q = definitionQuery(db, tables);
  const rows = await q
    .selectFrom("def_values")
    .selectAll()
    .where("value_ref", "=", fromId)
    .execute();
  for (const row of rows) {
    const repeat = await q
      .selectFrom("def_values")
      .select("id")
      .where("def_record_id", "=", row.def_record_id)
      .where("field_id", "=", row.field_id)
      .where("value_ref", "=", toId)
      .executeTakeFirst();
    await (repeat
      ? q.deleteFrom("def_values").where("id", "=", row.id)
      : q
          .updateTable("def_values")
          .set({ value_ref: toId, written_by: writer.writtenBy, written_at: writer.writtenAt })
          .where("id", "=", row.id)
    ).execute();
  }
  const records = [...new Set(rows.map((row) => row.def_record_id))];
  if (records.length > 0) {
    await q
      .updateTable("def_records")
      .set({ updated_at: writer.writtenAt })
      .where("id", "in", records)
      .execute();
  }
}

// ---------------------------------------------------------------------------
// Internals

function draftField(tables: DefinitionTables, id: string, input: NewField): FieldDraft {
  const label = `${tables.fieldKind} ${id}`;
  const required = input.required ?? false;
  if (typeof required !== "boolean") throw new Error(`${label}: required must be true or false`);
  return {
    id,
    name: requireName(label, input.name),
    shape: parseShape(label, FIELD_VALUE_TYPES, input.valueType, input.constraints),
    required,
    optionLabels: parseOptionLabels(label, input.optionLabels),
  };
}

async function insertField(
  db: Database,
  tables: DefinitionTables,
  typeId: string,
  field: FieldDraft,
  position: number,
  at: Instant,
) {
  await definitionQuery(db, tables)
    .insertInto("def_fields")
    .values({
      id: field.id,
      def_type_id: typeId,
      name: field.name,
      position,
      value_type: field.shape.valueType,
      required: Number(field.required),
      constraints: JSON.stringify(field.shape.constraints),
      option_labels: JSON.stringify(field.optionLabels),
      created_at: at,
      updated_at: at,
    })
    .execute();
}

function toField(tables: DefinitionTables, row: DefinitionDB["def_fields"]): FieldDefinition {
  const label = `${tables.fieldKind} ${row.id}`;
  return {
    id: row.id,
    typeId: row.def_type_id,
    name: row.name,
    position: row.position,
    optionLabels: parseOptionLabels(label, JSON.parse(row.option_labels)),
    shape: parseShape(label, FIELD_VALUE_TYPES, row.value_type, JSON.parse(row.constraints)),
    required: row.required === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Field names are unique within a field list, ignoring case and surrounding spaces. */
function assertUniqueNames(
  tables: DefinitionTables,
  fields: readonly { id: string; name: string }[],
) {
  const seen = new Map<string, string>();
  for (const { id, name } of fields) {
    const key = name.trim().toLowerCase();
    const other = seen.get(key);
    if (other !== undefined) {
      throw new Error(
        `${tables.fieldKind} ${id}: name ${JSON.stringify(name.trim())} is already used by field ${other}`,
      );
    }
    seen.set(key, id);
  }
}

/** A new `ref` or `multi_ref` field must target an unarchived thing type. */
async function assertRefTarget(db: Database, tables: DefinitionTables, field: FieldDraft) {
  if (field.shape.valueType !== "ref" && field.shape.valueType !== "multi_ref") return;
  const { thingTypeId } = field.shape.constraints;
  const target = await queryBuilder(db)
    .selectFrom("thing_types")
    .select("archived_at")
    .where("id", "=", thingTypeId)
    .executeTakeFirst();
  if (!target) {
    throw new Error(`${tables.fieldKind} ${field.id}: thing type ${thingTypeId} not found`);
  }
  if (target.archived_at !== null) {
    throw new Error(`${tables.fieldKind} ${field.id}: thing type ${thingTypeId} is archived`);
  }
}

/** Each of `ids` must be a thing of the constraint's type. */
async function assertRefsTo(
  db: Database,
  label: string,
  constraints: RefConstraints,
  ids: readonly string[],
) {
  if (ids.length === 0) return;
  const things = new Map(
    (
      await queryBuilder(db)
        .selectFrom("things")
        .select(["id", "thing_type_id"])
        .where("id", "in", ids)
        .execute()
    ).map((t) => [t.id, t]),
  );
  for (const id of ids) {
    const thing = things.get(id);
    if (!thing) throw new Error(`${label}: thing ${id} not found`);
    if (thing.thing_type_id !== constraints.thingTypeId) {
      throw new Error(`${label}: thing ${id} is not of thing type ${constraints.thingTypeId}`);
    }
  }
}

async function requireType(db: Database, tables: DefinitionTables, typeId: string) {
  const type = await definitionQuery(db, tables)
    .selectFrom("def_types")
    .select("id")
    .where("id", "=", typeId)
    .executeTakeFirst();
  if (!type) throw new Error(`${tables.typeKind} ${typeId}: not found`);
  return type;
}

async function requireField(db: Database, tables: DefinitionTables, id: string) {
  const field = await getField(db, tables, id);
  if (!field) throw new Error(`${tables.fieldKind} ${id}: not found`);
  return field;
}

function storedRows(db: Database, tables: DefinitionTables, recordId: string) {
  return definitionQuery(db, tables)
    .selectFrom("def_values")
    .selectAll()
    .where("def_record_id", "=", recordId)
    .orderBy("id")
    .execute();
}

/** `"Thing <id>, field <id>"`, as `values/values.ts` names failing values. */
function valueLabel(tables: DefinitionTables, recordId: string, fieldId: string) {
  return `${tables.recordKind} ${recordId}, field ${fieldId}`;
}

/** `"thing type <id>"`, or capitalised at the start of an error. */
function typeLabel(tables: DefinitionTables, typeId: string, start = false) {
  return `${start ? tables.typeKind : tables.typeKind.toLowerCase()} ${typeId}`;
}
