import type { Database } from "@spoor/core";
import { invoke } from "@tauri-apps/api/core";

/**
 * Desktop implementation of core's `Database` seam.
 *
 * SQLite lives on the Rust side (`src-tauri/src/db.rs`); each call is one IPC
 * round trip to `db_execute` / `db_query`, run on a single connection in the
 * order received. Params must be JSON scalars (null, boolean, number, string).
 * Integers beyond 2^53 lose precision on the way back.
 */
export function createTauriDatabase(): Database {
  return {
    async execute(sql: string, params: unknown[] = []): Promise<void> {
      await call<void>("db_execute", sql, params);
    },
    async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      return call<T[]>("db_query", sql, params);
    },
  };
}

// Rust commands reject with a plain string; wrap it so callers get an `Error`.
async function call<T>(cmd: string, sql: string, params: unknown[]): Promise<T> {
  try {
    return await invoke<T>(cmd, { sql, params });
  } catch (e) {
    throw e instanceof Error ? e : new Error(String(e));
  }
}
