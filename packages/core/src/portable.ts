import { findOverlap } from "./overlap";
import type { Database } from "./platform/index";
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
 * 2. Give every column a kind. A trailing `?` marks a nullable column.
 * 3. Add a `check` for any rule core enforces that the database constraints cannot,
 *    such as the overlap rule, so import refuses data core would never write.
 * 4. Extend the fixture in `roundtrip.test.ts` so the table holds live, trashed and,
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
 * - `trimmed`: a non-empty string with no surrounding whitespace, as core stores
 *   names and descriptions.
 * - `zone`: an IANA time zone ID (see `isTimeZone`).
 * - `int`: a safe integer. `bool`: stored as 0/1, written as true/false.
 * - `instant`: stored as epoch milliseconds, written as ISO 8601 UTC.
 * - `json`: stored as JSON text, written as the parsed value.
 */
export type ColumnKind = "text" | "trimmed" | "zone" | "uuid" | "int" | "bool" | "instant" | "json";
export type ColumnSpec = ColumnKind | `${ColumnKind}?`;

interface TableSpec {
  /** The top-level key in the export document. */
  readonly key: string;
  readonly table: keyof DB;
  /** Rows are exported in this column's order, so the output is deterministic. */
  readonly orderBy: string;
  /** Import overwrites rows with this key instead of failing, and does not require the table empty. */
  readonly upsertOn?: string;
  /** Checked against `TABLE_COLUMNS` by `portable.test.ts`. */
  readonly columns: Readonly<Record<string, ColumnSpec>>;
  /**
   * Cross-record rules the database cannot enforce. Import runs it after every
   * insert, in the same transaction, and refuses the file if it names a problem.
   */
  readonly check?: (db: Database) => Promise<string | undefined>;
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
    key: "timelines",
    table: "timelines",
    orderBy: "id",
    columns: {
      id: "uuid",
      name: "trimmed",
      description: "trimmed?",
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
      name: "trimmed",
      description: "trimmed?",
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
      time_zone: "zone?",
      created_at: "instant",
      updated_at: "instant",
      deleted_at: "instant?",
      deletion_id: "uuid?",
      purged_at: "instant?",
    },
    async check(db: Database) {
      const overlap = await findOverlap(db);
      return (
        overlap &&
        `intervals ${overlap.a} and ${overlap.b} overlap on timeline ${overlap.timelineId}`
      );
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
