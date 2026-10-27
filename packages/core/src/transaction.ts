import type { Database } from "./platform/index";

// The tail of each database's queue of transactions.
const queues = new WeakMap<Database, Promise<unknown>>();

/**
 * Runs `fn` inside one `BEGIN IMMEDIATE` transaction: it commits if `fn`
 * resolves and rolls back if it throws, rethrowing the error.
 *
 * The seam shares one connection, so transactions on the same `db` are queued
 * and never interleave. Statements issued outside `transaction` are not queued
 * and could land inside one, so every core write goes through here. Not
 * reentrant: calling `transaction` from inside `fn` deadlocks.
 */
export function transaction<T>(db: Database, fn: () => Promise<T>): Promise<T> {
  const run = (queues.get(db) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      await db.execute("BEGIN IMMEDIATE");
      try {
        const result = await fn();
        await db.execute("COMMIT");
        return result;
      } catch (error) {
        // A failed ROLLBACK must not hide the error that caused it.
        await db.execute("ROLLBACK").catch(() => {});
        throw error;
      }
    });
  queues.set(db, run);
  return run;
}
