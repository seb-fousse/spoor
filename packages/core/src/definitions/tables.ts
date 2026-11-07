import type { DB } from "../db/schema/tables";

/** Where one kind of definition lives. Each slice declares one. */
export interface DefinitionTables {
  /** Names the type in errors, such as `"Thing type"`. */
  readonly typeKind: string;
  /** Names a field in errors, such as `"Thing field"`. */
  readonly fieldKind: string;
  /** Names a record holding values in errors, such as `"Thing"`. */
  readonly recordKind: string;
  /** Types: `id`, `updated_at`, plus the slice's own columns. */
  readonly types: keyof DB;
  /**
   * Fields: `id`, type id, `name`, `position`, `value_type`, `required`,
   * `constraints`, `option_labels`, `created_at`, `updated_at`.
   */
  readonly fields: keyof DB;
  /** Records: `id`, type id, `updated_at`, plus the slice's own columns. */
  readonly records: keyof DB;
  /** Values: `id`, record id, `field_id`, the seven `value_*` columns, `written_by`, `written_at`. */
  readonly values: keyof DB;
  /** The type id column of fields and records. */
  readonly typeIdColumn: string;
  /** The record id column of values. */
  readonly recordIdColumn: string;
}

export const THING_TABLES = {
  typeKind: "Thing type",
  fieldKind: "Thing field",
  recordKind: "Thing",
  types: "thing_types",
  fields: "thing_fields",
  records: "things",
  values: "thing_field_values",
  typeIdColumn: "thing_type_id",
  recordIdColumn: "thing_id",
} as const satisfies DefinitionTables;

export const LOG_TABLES = {
  typeKind: "Log type",
  fieldKind: "Log field",
  recordKind: "Log entry",
  types: "log_types",
  fields: "log_fields",
  records: "log_entries",
  values: "log_field_values",
  typeIdColumn: "log_type_id",
  recordIdColumn: "log_entry_id",
} as const satisfies DefinitionTables;

/**
 * Every value table whose `ref` and `multi_ref` values point at things, for the
 * operations that must reach all references to a thing, such as merging. A
 * slice whose values can reference things adds its descriptor here.
 */
export const REFERENCING_TABLES: readonly DefinitionTables[] = [THING_TABLES, LOG_TABLES];
