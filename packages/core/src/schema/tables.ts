/**
 * Row types of every table, as Kysely sees them (see `query.ts`).
 *
 * This must mirror the migrations: one entry per table, one property per
 * column, typed as SQLite returns it (INTEGER as `number`, TEXT as `string`,
 * nullable columns as `T | null`). Kysely trusts it blindly, so
 * `tables.test.ts` checks it against a freshly migrated database.
 */
export interface DB {
  settings: {
    key: string;
    /** JSON text. */
    value: string;
    updated_at: number;
  };
}

/**
 * Every column of every table in `DB`, as a runtime value for the drift test.
 * The type forces it to list exactly the columns `DB` declares, so a table or
 * column added to `DB` alone fails to compile.
 */
export const TABLE_COLUMNS: { readonly [T in keyof DB]: Record<keyof DB[T], true> } = {
  settings: { key: true, value: true, updated_at: true },
};
