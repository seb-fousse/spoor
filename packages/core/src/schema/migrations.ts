import initial from "./migrations/0001_initial.sql?raw";
import timelines from "./migrations/0002_timelines.sql?raw";
import observations from "./migrations/0003_observations.sql?raw";
import { splitStatements } from "./sql";

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
 * Each migration is one file in `./migrations/`, named `NNNN_name.sql`: `NNNN`
 * is its version, zero-padded, and `name` is its snake_case `name`. A test
 * checks that every file there is listed here, in order.
 *
 * Rules (a file written by an old version must always open in a newer one):
 * - Append-only. Once merged to main, a migration is never edited, reordered,
 *   or removed; fix mistakes with a new one. The runner skips versions a
 *   database already has, so an edit would never reach it.
 * - Statements are split by `splitStatements`; see its limits.
 * - Every `CREATE TABLE` ends with `STRICT` (see data-spec, Storage).
 * - Table names are snake_case.
 */
export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: "initial", statements: splitStatements(initial) },
  { version: 2, name: "timelines", statements: splitStatements(timelines) },
  { version: 3, name: "observations", statements: splitStatements(observations) },
];
