import BetterSqlite3 from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "./index";

/**
 * A tiny, TEST-ONLY implementation of the `Database` seam backed by in-memory
 * SQLite. This is not product code and ships with no runtime dependency on
 * `better-sqlite3` (it is a devDependency).
 *
 * The point it proves: core logic can be written against the `Database`
 * interface and exercised in plain Node, in milliseconds, with no app running.
 * For a data tracker, silent data loss is the worst possible bug, so being able
 * to test persistence this cheaply is the whole reason the seam exists.
 */
type SqlParam = number | string | bigint | Uint8Array | null;

function createInMemoryDatabase(): Database & { close(): void } {
  const db = new BetterSqlite3(":memory:");
  return {
    async execute(sql: string, params: unknown[] = []): Promise<void> {
      db.prepare(sql).run(...(params as SqlParam[]));
    },
    async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      return db.prepare(sql).all(...(params as SqlParam[])) as T[];
    },
    close(): void {
      db.close();
    },
  };
}

describe("Database seam (in-memory adapter)", () => {
  let db: Database & { close(): void };

  beforeEach(async () => {
    db = createInMemoryDatabase();
    await db.execute("CREATE TABLE note (id TEXT PRIMARY KEY, body TEXT NOT NULL)");
  });

  afterEach(() => {
    db.close();
  });

  it("round-trips a written row through the interface", async () => {
    await db.execute("INSERT INTO note (id, body) VALUES (?, ?)", ["n1", "hello"]);

    const rows = await db.query<{ id: string; body: string }>(
      "SELECT id, body FROM note WHERE id = ?",
      ["n1"],
    );

    expect(rows).toEqual([{ id: "n1", body: "hello" }]);
  });

  it("returns an empty array when nothing matches", async () => {
    const rows = await db.query("SELECT * FROM note WHERE id = ?", ["missing"]);
    expect(rows).toEqual([]);
  });
});
