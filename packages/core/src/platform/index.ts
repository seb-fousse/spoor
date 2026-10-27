/**
 * Platform seams.
 *
 * `core` is platform-agnostic. The few things that genuinely differ between a
 * desktop app, a mobile app, and a (future) sync server are expressed as
 * interfaces here. Each app supplies its own implementation and hands it to
 * core. Core never imports a concrete database driver, keychain, or health API.
 *
 * Rule of thumb: if an interface would have exactly one implementation and no
 * real platform difference, it should not exist. Do not add seams speculatively.
 */

/**
 * Low-level access to the single user-owned SQLite database.
 *
 * On desktop, SQLite lives on the Rust side and this is implemented over Tauri
 * IPC. In tests, it is implemented with an in-memory `better-sqlite3` instance
 * (see `testing/in-memory-database.ts`). Encryption at rest (SQLCipher) lives
 * *behind* this interface, so the rest of core never knows whether the file is
 * encrypted.
 */
export interface Database {
  /** Run a statement that returns no rows (INSERT/UPDATE/DELETE/DDL). */
  execute(sql: string, params?: unknown[]): Promise<void>;
  /** Run a query and return the matching rows. */
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
}

/**
 * Secure storage for small secrets (e.g. a future sync passphrase or key).
 *
 * Backed by the OS keychain / credential store per platform. Never used for
 * user data, only for secrets.
 */
export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

/**
 * Read-only source of health metrics the OS can provide.
 *
 * On mobile this maps to HealthKit (iOS) / Health Connect (Android); on desktop
 * there may be no implementation at all, in which case steps are entered
 * manually. `day` is an ISO date (`YYYY-MM-DD`). Returns `null` when the source
 * has no value for that day.
 */
export interface HealthSource {
  getSteps(day: string): Promise<number | null>;
}
