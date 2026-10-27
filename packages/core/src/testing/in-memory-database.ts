import BetterSqlite3 from "better-sqlite3";
import type { Database } from "../platform/index";

/**
 * A tiny, TEST-ONLY implementation of the `Database` seam backed by in-memory
 * SQLite. This is not product code and ships with no runtime dependency on
 * `better-sqlite3` (it is a devDependency); it is excluded from the build and
 * not exported from the barrel.
 *
 * The point it proves: core logic can be written against the `Database`
 * interface and exercised in plain Node, in milliseconds, with no app running.
 * For a data tracker, silent data loss is the worst possible bug, so being able
 * to test persistence this cheaply is the whole reason the seam exists.
 *
 * Foreign keys are switched on to match the desktop connection settings.
 */
type SqlParam = number | string | bigint | Uint8Array | null;

export function createInMemoryDatabase(): Database & { close(): void } {
  const db = new BetterSqlite3(":memory:");
  db.pragma("foreign_keys = ON");
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
