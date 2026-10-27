/** One schema step. `version` is its position in `MIGRATIONS`, starting at 1. */
export interface Migration {
  version: number;
  name: string;
  /** Run in order inside one transaction. One SQL statement per entry. */
  statements: readonly string[];
}

/**
 * Every schema change Spoor has ever shipped, oldest first.
 *
 * Rules (a file written by an old version must always open in a newer one):
 * - Append-only. Never edit, reorder, or remove a released migration; fix
 *   mistakes with a new one.
 * - One SQL statement per `statements` entry. Neither `Database` backend
 *   accepts several statements in one call.
 * - Every `CREATE TABLE` ends with `STRICT` (see data-spec, Storage).
 * - Table names are snake_case.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "create settings",
    statements: [
      // Settings are configuration, so `value` is JSON text rather than typed columns.
      `CREATE TABLE settings (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL CHECK (json_valid(value)),
        updated_at INTEGER NOT NULL
      ) STRICT`,
    ],
  },
];
