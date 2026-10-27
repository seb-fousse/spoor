import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../platform/index";
import { createInMemoryDatabase } from "../testing/in-memory-database";
import { migrate } from "./migrate";
import { TABLE_COLUMNS } from "./tables";

// `DB` is only a type, so these tests compare the migrated schema with
// `TABLE_COLUMNS`, which the compiler keeps in step with `DB`.
describe("DB matches the migrated schema", () => {
  let db: Database & { close(): void };

  beforeEach(async () => {
    db = createInMemoryDatabase();
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it("declares every table and no others", async () => {
    const tables = await db.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    );
    expect(tables.map((t) => t.name)).toEqual(Object.keys(TABLE_COLUMNS).sort());
  });

  it.each(Object.entries(TABLE_COLUMNS))(
    "declares every column of %s and no others",
    async (table, columns) => {
      const info = await db.query<{ name: string }>(`PRAGMA table_info(${table})`);
      expect(info.map((c) => c.name).sort()).toEqual(Object.keys(columns).sort());
    },
  );
});
