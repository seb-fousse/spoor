import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "./platform/index";
import { columnsOf, TABLES } from "./portable";
import { migrate } from "./schema/migrate";
import { TABLE_COLUMNS } from "./schema/tables";
import { createInMemoryDatabase } from "./testing/in-memory-database";

// The registry is hand-written, so these fail when a slice adds a table or column
// and forgets to register it for export and import.
describe("the export registry matches the schema", () => {
  let db: Database & { close(): void };

  beforeEach(async () => {
    db = createInMemoryDatabase();
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it("registers every table once and no others", async () => {
    const tables = await db.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    );
    expect(TABLES.map((t) => t.table).sort()).toEqual(tables.map((t) => t.name).sort());
    expect(new Set(TABLES.map((t) => t.key)).size).toBe(TABLES.length);
  });

  it.each(TABLES)("registers every column of $table and no others", (spec) => {
    const declared = Object.keys(TABLE_COLUMNS[spec.table]);
    expect(
      columnsOf(spec)
        .map((c) => c.sql)
        .sort(),
    ).toEqual(declared.sort());
    expect(declared).toContain(spec.orderBy);
  });

  it.each(TABLES)("marks nullable columns of $table as the schema does", async (spec) => {
    const info = await db.query<{ name: string; notnull: number; pk: number }>(
      `PRAGMA table_info(${spec.table})`,
    );
    for (const column of columnsOf(spec)) {
      const c = info.find((i) => i.name === column.sql);
      // A primary key is never null in practice even where SQLite does not say so.
      if (c?.notnull === 0 && c.pk === 0) continue;
      expect(column.nullable, `${spec.table}.${column.sql}`).toBe(false);
    }
  });

  it("lists parents before the tables that reference them", async () => {
    const order = TABLES.map((t) => t.table as string);
    for (const { table } of TABLES) {
      const fks = await db.query<{ table: string }>(`PRAGMA foreign_key_list(${table})`);
      for (const fk of fks) {
        expect(order.indexOf(fk.table), `${table} -> ${fk.table}`).toBeLessThan(
          order.indexOf(table),
        );
      }
    }
  });
});
