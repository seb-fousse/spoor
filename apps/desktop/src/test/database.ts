import { type Database, migrate } from "@spoor/core";
import { createInMemoryDatabase } from "@spoor/core/testing";
import { onTestFinished } from "vitest";

/**
 * A real database for one test: core's in-memory SQLite, migrated to the
 * current schema, and closed once the test finishes. Call it inside the test,
 * then seed it with core's own functions and pass it to `createTestRoot({ db })`
 * or `renderHook`.
 *
 * Vitest runs a test's `onTestFinished` callbacks last-registered first, so a
 * root mounted after this unmounts before the database closes.
 */
export async function createTestDatabase(): Promise<Database> {
  const db = createInMemoryDatabase();
  onTestFinished(() => db.close());
  await migrate(db);
  return db;
}
