import type { DB } from "./schema/tables";

/**
 * The export format and its table registry (see docs/data-spec.md § Export and import).
 *
 * `TABLES` lists every table that travels in an export. Export, import and their
 * validation read it and never name a table, so a slice that adds tables extends
 * export/import by adding entries here and fixtures to `roundtrip.test.ts`, with no
 * new plumbing. `portable.test.ts` fails if a table or column is missing.
 *
 * To add a table:
 * 1. Add an entry, after the tables it references: import inserts in this order.
 *    A column referencing its own table is declared as `selfReference` instead.
 * 2. Give every column a kind. A trailing `?` marks a nullable column.
 * 3. Extend the fixture in `roundtrip.test.ts` so the table holds live, trashed and,
 *    where it has them, purged rows.
 *
 * Unknown fields from a newer format are refused for now; the spec's rule to preserve
 * them applies once a format newer than this one exists.
 */

/** Version of the export format, not of the database schema. Bumped only for a breaking change. */
export const EXPORT_SCHEMA_VERSION = 1;

/**
 * How a column travels:
 * - `text`: a string. `uuid`: a canonical UUID string.
 * - `int`: a safe integer. `real`: a finite number. `bool`: stored as 0/1, written as true/false.
 * - `instant`: stored as epoch milliseconds, written as ISO 8601 UTC.
 * - `json`: stored as JSON text, written as the parsed value.
 */
export type ColumnKind = "text" | "uuid" | "int" | "real" | "bool" | "instant" | "json";
export type ColumnSpec = ColumnKind | `${ColumnKind}?`;

interface TableSpec {
  /** The top-level key in the export document. */
  readonly key: string;
  readonly table: keyof DB;
  /** Rows are exported in this column's order, so the output is deterministic. */
  readonly orderBy: string;
  /** Import overwrites rows with this key instead of failing, and does not require the table empty. */
  readonly upsertOn?: string;
  /**
   * A column referencing this same table. Import inserts each row after the row it
   * references, whatever their order in the file.
   */
  readonly selfReference?: string;
  /** Checked against `TABLE_COLUMNS` by `portable.test.ts`. */
  readonly columns: Readonly<Record<string, ColumnSpec>>;
}

/** In foreign-key order: parents before the tables that reference them. */
export const TABLES = [
  {
    key: "settings",
    table: "settings",
    orderBy: "key",
    upsertOn: "key",
    columns: { key: "text", value: "json", updated_at: "instant" },
  },
  {
    key: "thingTypes",
    table: "thing_types",
    orderBy: "id",
    columns: {
      id: "uuid",
      name: "text",
      description: "text?",
      title_field_id: "uuid",
      schema_version: "int",
      created_at: "instant",
      updated_at: "instant",
      archived_at: "instant?",
      deleted_at: "instant?",
      deletion_id: "uuid?",
    },
  },
  {
    key: "thingTypeVersions",
    table: "thing_type_versions",
    orderBy: "id",
    columns: { id: "uuid", thing_type_id: "uuid", version: "int", created_at: "instant" },
  },
  {
    key: "thingFields",
    table: "thing_fields",
    orderBy: "id",
    columns: {
      id: "uuid",
      thing_type_id: "uuid",
      name: "text",
      position: "int",
      option_labels: "json",
      created_at: "instant",
      updated_at: "instant",
    },
  },
  {
    key: "thingFieldVersions",
    table: "thing_field_versions",
    orderBy: "id",
    columns: {
      id: "uuid",
      field_id: "uuid",
      thing_type_id: "uuid",
      thing_type_version: "int",
      value_type: "text",
      required: "bool",
      constraints: "json",
      created_at: "instant",
    },
  },
  {
    key: "things",
    table: "things",
    orderBy: "id",
    selfReference: "merged_into_id",
    columns: {
      id: "uuid",
      thing_type_id: "uuid",
      thing_type_version: "int",
      source: "text?",
      external_id: "text?",
      merged_into_id: "uuid?",
      created_at: "instant",
      updated_at: "instant",
      deleted_at: "instant?",
      deletion_id: "uuid?",
      purged_at: "instant?",
    },
  },
  {
    key: "thingFieldValues",
    table: "thing_field_values",
    orderBy: "id",
    columns: {
      id: "uuid",
      thing_id: "uuid",
      field_id: "uuid",
      value_bool: "bool?",
      value_num: "real?",
      value_enum: "text?",
      value_text: "text?",
      value_date: "text?",
      value_instant: "instant?",
      value_ref: "uuid?",
      written_by: "text",
      written_at: "instant",
    },
  },
  {
    key: "timelines",
    table: "timelines",
    orderBy: "id",
    columns: {
      id: "uuid",
      name: "text",
      description: "text?",
      exclusive: "bool",
      default_thing_type_id: "uuid?",
      created_at: "instant",
      updated_at: "instant",
      archived_at: "instant?",
      deleted_at: "instant?",
      deletion_id: "uuid?",
    },
  },
  {
    key: "timelineCategories",
    table: "timeline_categories",
    orderBy: "id",
    columns: {
      id: "uuid",
      timeline_id: "uuid",
      name: "text",
      description: "text?",
      thing_id: "uuid?",
      created_at: "instant",
      updated_at: "instant",
      archived_at: "instant?",
      deleted_at: "instant?",
      deletion_id: "uuid?",
    },
  },
  {
    key: "timelineIntervals",
    table: "timeline_intervals",
    orderBy: "id",
    columns: {
      id: "uuid",
      timeline_id: "uuid",
      category_id: "uuid",
      start_at: "instant?",
      end_at: "instant?",
      time_zone: "text?",
      created_at: "instant",
      updated_at: "instant",
      deleted_at: "instant?",
      deletion_id: "uuid?",
      purged_at: "instant?",
    },
  },
  {
    key: "logTypes",
    table: "log_types",
    orderBy: "id",
    selfReference: "parent_type_id",
    columns: {
      id: "uuid",
      name: "text",
      description: "text?",
      parent_type_id: "uuid?",
      schema_version: "int",
      created_at: "instant",
      updated_at: "instant",
      archived_at: "instant?",
      deleted_at: "instant?",
      deletion_id: "uuid?",
    },
  },
  {
    key: "logTypeVersions",
    table: "log_type_versions",
    orderBy: "id",
    columns: { id: "uuid", log_type_id: "uuid", version: "int", created_at: "instant" },
  },
  {
    key: "logFields",
    table: "log_fields",
    orderBy: "id",
    columns: {
      id: "uuid",
      log_type_id: "uuid",
      name: "text",
      position: "int",
      option_labels: "json",
      created_at: "instant",
      updated_at: "instant",
    },
  },
  {
    key: "logFieldVersions",
    table: "log_field_versions",
    orderBy: "id",
    columns: {
      id: "uuid",
      field_id: "uuid",
      log_type_id: "uuid",
      log_type_version: "int",
      value_type: "text",
      required: "bool",
      constraints: "json",
      created_at: "instant",
    },
  },
  {
    key: "logEntries",
    table: "log_entries",
    orderBy: "id",
    selfReference: "parent_entry_id",
    columns: {
      id: "uuid",
      log_type_id: "uuid",
      log_type_version: "int",
      occurred_at: "instant?",
      ended_at: "instant?",
      precision: "text?",
      time_zone: "text?",
      parent_entry_id: "uuid?",
      position: "int?",
      source: "text?",
      external_id: "text?",
      created_at: "instant",
      updated_at: "instant",
      deleted_at: "instant?",
      deletion_id: "uuid?",
      purged_at: "instant?",
    },
  },
  {
    key: "logFieldValues",
    table: "log_field_values",
    orderBy: "id",
    columns: {
      id: "uuid",
      log_entry_id: "uuid",
      field_id: "uuid",
      value_bool: "bool?",
      value_num: "real?",
      value_enum: "text?",
      value_text: "text?",
      value_date: "text?",
      value_instant: "instant?",
      value_ref: "uuid?",
      written_by: "text",
      written_at: "instant",
    },
  },
] as const satisfies readonly TableSpec[];

export type { TableSpec };

export type TableKey = (typeof TABLES)[number]["key"];

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** One exported row, keyed by camelCase column name. */
export type ExportRecord = Record<string, JsonValue>;

export interface ExportDocument extends Partial<Record<TableKey, ExportRecord[]>> {
  schemaVersion: number;
  /** ISO 8601 UTC. */
  exportedAt: string;
}

/** A column, parsed from its registry entry. */
export interface Column {
  /** Name in SQL, such as `created_at`. */
  sql: string;
  /** Name in the export, such as `createdAt`. */
  name: string;
  kind: ColumnKind;
  nullable: boolean;
}

/** `created_at` as `createdAt`. */
const camelCase = (snake: string) => snake.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/** The columns of `spec` in registry order. */
export function columnsOf(spec: TableSpec): Column[] {
  return Object.entries(spec.columns).map(([sql, column]) => {
    const nullable = column.endsWith("?");
    return {
      sql,
      name: camelCase(sql),
      kind: (nullable ? column.slice(0, -1) : column) as ColumnKind,
      nullable,
    };
  });
}
