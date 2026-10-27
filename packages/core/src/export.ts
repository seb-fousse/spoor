import type { Database } from "./platform/index";
import {
  type Column,
  columnsOf,
  EXPORT_SCHEMA_VERSION,
  type ExportDocument,
  type ExportRecord,
  TABLES,
  type TableSpec,
} from "./portable";
import { instantToIso, now } from "./time";
import { transaction } from "./transaction";

/**
 * Export (see docs/data-spec.md § Export and import): every row of every table in
 * the registry, in every state, so that importing the result restores the database
 * exactly. Rows are read directly rather than through the repositories, which hide
 * trashed and purged records.
 */

/** A snapshot of the whole database, read in one transaction so it is consistent. */
export async function exportData(db: Database): Promise<ExportDocument> {
  return transaction(db, async () => {
    const doc: ExportDocument = {
      schemaVersion: EXPORT_SCHEMA_VERSION,
      exportedAt: instantToIso(now()),
    };
    for (const spec of TABLES) {
      const columns = columnsOf(spec);
      const rows = await db.query<Record<string, unknown>>(selectAll(spec));
      doc[spec.key] = rows.map((row) => toRecord(columns, row));
    }
    return doc;
  });
}

/** `exportData` as JSON text, ready to write to a file. */
export async function exportJson(db: Database): Promise<string> {
  return JSON.stringify(await exportData(db), null, 2);
}

function selectAll(spec: TableSpec): string {
  return `SELECT * FROM ${spec.table} ORDER BY ${spec.orderBy}`;
}

function toRecord(columns: readonly Column[], row: Record<string, unknown>): ExportRecord {
  const record: ExportRecord = {};
  for (const { sql, name, kind } of columns) {
    const value = row[sql];
    if (value === null || value === undefined) {
      record[name] = null;
    } else if (kind === "instant") {
      record[name] = instantToIso(value as number);
    } else if (kind === "bool") {
      record[name] = value === 1;
    } else if (kind === "json") {
      record[name] = JSON.parse(value as string);
    } else {
      record[name] = value as string | number;
    }
  }
  return record;
}
