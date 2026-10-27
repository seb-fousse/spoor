import type { Database } from "../platform/index";
import { MIGRATIONS, type Migration } from "./migrations";

/**
 * Brings the database schema up to the latest known version.
 *
 * The schema version lives in SQLite's own `PRAGMA user_version`. Each
 * migration runs in one `BEGIN IMMEDIATE` transaction that also bumps
 * `user_version`, so the version changes atomically with the DDL: a failed
 * migration leaves both untouched, and no bookkeeping table is needed.
 *
 * A database whose version is newer than any known migration was written by a
 * newer Spoor. It is refused, never touched.
 *
 * Run it once, before anything else uses `db`: the seam shares one connection,
 * so statements from other callers would land inside the migration transaction.
 */
export async function migrate(
  db: Database,
  migrations: readonly Migration[] = MIGRATIONS,
): Promise<{ from: number; to: number }> {
  migrations.forEach((m, i) => {
    if (m.version !== i + 1) {
      throw new Error(`Migration versions must be 1..n in order; got ${m.version} at index ${i}`);
    }
  });

  const latest = migrations.length;
  const [row] = await db.query<{ user_version: number }>("PRAGMA user_version");
  const from = row?.user_version ?? 0;

  if (from > latest) {
    throw new Error(
      `Database schema version ${from} is newer than this version of Spoor supports (${latest}). ` +
        "It was written by a newer version of Spoor; update the app to open it.",
    );
  }

  for (const { version, name, statements } of migrations.slice(from)) {
    const fail = (cause: unknown) =>
      new Error(
        `Migration ${version} (${name}) failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        { cause },
      );

    // Outside the try: if BEGIN fails there is no transaction of ours to roll back.
    await db.execute("BEGIN IMMEDIATE").catch((cause) => {
      throw fail(cause);
    });
    try {
      for (const sql of statements) {
        await db.execute(sql);
      }
      // Pragmas cannot take bound params; `version` is a validated integer.
      await db.execute(`PRAGMA user_version = ${version}`);
      await db.execute("COMMIT");
    } catch (cause) {
      // A failed ROLLBACK must not hide the error that caused it.
      await db.execute("ROLLBACK").catch(() => {});
      throw fail(cause);
    }
  }

  return { from, to: latest };
}
