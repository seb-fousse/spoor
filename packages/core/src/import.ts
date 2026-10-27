import { isUuid } from "./ids";
import type { Database } from "./platform/index";
import {
  TABLES as ALL_TABLES,
  type Column,
  columnsOf,
  EXPORT_SCHEMA_VERSION,
  type TableSpec,
} from "./portable";
import { isInstant, isoToInstant } from "./time";
import { transaction } from "./transaction";

const TABLES: readonly TableSpec[] = ALL_TABLES;

/**
 * Import (see docs/data-spec.md § Export and import): restores an export into an
 * empty database, keeping every id, timestamp and state as written.
 *
 * The whole document is validated before the database is touched, and the inserts
 * run in one transaction, so a refused or failed import changes nothing. Invalid
 * data is refused, never dropped or altered. Cross-record rules (foreign keys,
 * trash and purge consistency) are enforced by the database constraints.
 */

/** Parses `text` as JSON and imports it. See `importData`. */
export async function importJson(db: Database, text: string): Promise<void> {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (cause) {
    throw new Error(
      `Import file is not valid JSON: ${cause instanceof Error ? cause.message : cause}`,
      {
        cause,
      },
    );
  }
  await importData(db, doc);
}

/**
 * Imports an export document. Throws, leaving the database untouched, if the
 * document is invalid, was written by a newer Spoor, or the database already holds
 * data. Settings are the exception to the empty rule: they are overwritten.
 */
export async function importData(db: Database, doc: unknown): Promise<void> {
  const rows = validateDocument(doc);
  await transaction(db, async () => {
    for (const spec of TABLES) {
      if (spec.upsertOn !== undefined) continue;
      const [existing] = await db.query(`SELECT 1 FROM ${spec.table} LIMIT 1`);
      if (existing !== undefined) {
        throw new Error(`Import needs an empty database, but ${spec.table} already has rows`);
      }
    }
    for (const spec of TABLES) {
      const columns = columnsOf(spec);
      const sql = insertSql(spec, columns);
      for (const [i, values] of (rows.get(spec) ?? []).entries()) {
        try {
          await db.execute(sql, values);
        } catch (cause) {
          throw new Error(
            `${spec.key}[${i}]: ${cause instanceof Error ? cause.message : String(cause)}`,
            { cause },
          );
        }
      }
    }
  });
}

function insertSql(spec: TableSpec, columns: readonly Column[]): string {
  const names = columns.map((c) => c.sql);
  let sql = `INSERT INTO ${spec.table} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`;
  if (spec.upsertOn !== undefined) {
    const updates = names.filter((n) => n !== spec.upsertOn).map((n) => `${n} = excluded.${n}`);
    sql += ` ON CONFLICT (${spec.upsertOn}) DO UPDATE SET ${updates.join(", ")}`;
  }
  return sql;
}

// ---------------------------------------------------------------------------
// Validation

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Every table's rows as SQL parameter lists, in column order, or throws on the first problem. */
function validateDocument(doc: unknown): Map<TableSpec, unknown[][]> {
  if (!isObject(doc)) throw new Error("Import file must be a JSON object");

  const version = doc.schemaVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw new Error("Import file: schemaVersion must be a positive integer");
  }
  if (version > EXPORT_SCHEMA_VERSION) {
    throw new Error(
      `Import file has format version ${version}, newer than this version of Spoor supports (${EXPORT_SCHEMA_VERSION}). ` +
        "It was written by a newer version of Spoor; update the app to import it.",
    );
  }
  try {
    isoToInstant(doc.exportedAt as string);
  } catch {
    throw new Error("Import file: exportedAt must be an ISO 8601 UTC instant");
  }

  const known = new Set<string>(["schemaVersion", "exportedAt", ...TABLES.map((t) => t.key)]);
  for (const key of Object.keys(doc)) {
    if (!known.has(key)) throw new Error(`Import file: unknown field ${JSON.stringify(key)}`);
  }

  const result = new Map<TableSpec, unknown[][]>();
  for (const spec of TABLES) {
    const records = doc[spec.key];
    if (records === undefined) continue;
    if (!Array.isArray(records)) throw new Error(`${spec.key} must be an array`);
    const columns = columnsOf(spec);
    result.set(
      spec,
      records.map((record, i) => validateRecord(spec.key, i, columns, record)),
    );
  }
  return result;
}

function validateRecord(
  key: string,
  index: number,
  columns: readonly Column[],
  record: unknown,
): unknown[] {
  const where = (id?: unknown) =>
    typeof id === "string" ? `${key}[${index}] (id ${id})` : `${key}[${index}]`;
  if (!isObject(record)) throw new Error(`${where()}: must be an object`);
  const label = where(record.id);

  const names = new Set(columns.map((c) => c.name));
  for (const field of Object.keys(record)) {
    if (!names.has(field)) throw new Error(`${label}: unknown field ${JSON.stringify(field)}`);
  }
  return columns.map((column) => {
    if (!(column.name in record)) throw new Error(`${label}: ${column.name} is missing`);
    const problem = checkValue(column, record[column.name]);
    if (problem !== undefined) throw new Error(`${label}: ${column.name} ${problem}`);
    return toParam(column, record[column.name]);
  });
}

/** What is wrong with `value` for `column`, or `undefined` if it is fine. */
function checkValue({ kind, nullable }: Column, value: unknown): string | undefined {
  if (value === null) return nullable ? undefined : "must not be null";
  switch (kind) {
    case "text":
      return typeof value === "string" ? undefined : "must be a string";
    case "uuid":
      return isUuid(value) ? undefined : "must be a lowercase UUID";
    case "int":
      return isInstant(value) ? undefined : "must be an integer";
    case "bool":
      return typeof value === "boolean" ? undefined : "must be true or false";
    case "instant":
      try {
        isoToInstant(value as string);
        return undefined;
      } catch {
        return "must be an ISO 8601 UTC instant (YYYY-MM-DDTHH:mm:ss.sssZ)";
      }
    case "json":
      return undefined;
  }
}

/** The SQL parameter for an already-validated value. */
function toParam({ kind }: Column, value: unknown): unknown {
  if (value === null) return null;
  switch (kind) {
    case "instant":
      return isoToInstant(value as string);
    case "bool":
      return value ? 1 : 0;
    case "json":
      return JSON.stringify(value);
    default:
      return value;
  }
}
