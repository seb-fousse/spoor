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
  timelines: {
    id: string;
    name: string;
    description: string | null;
    /** 0 or 1. */
    exclusive: number;
    default_thing_type_id: string | null;
    created_at: number;
    updated_at: number;
    archived_at: number | null;
    deleted_at: number | null;
    deletion_id: string | null;
  };
  timeline_categories: {
    id: string;
    timeline_id: string;
    name: string;
    description: string | null;
    thing_id: string | null;
    created_at: number;
    updated_at: number;
    archived_at: number | null;
    deleted_at: number | null;
    deletion_id: string | null;
  };
  timeline_intervals: {
    id: string;
    timeline_id: string;
    category_id: string;
    /** Null only once purged, as is `time_zone`. */
    start_at: number | null;
    end_at: number | null;
    time_zone: string | null;
    created_at: number;
    updated_at: number;
    deleted_at: number | null;
    deletion_id: string | null;
    purged_at: number | null;
  };
}

/**
 * Every column of every table in `DB`, as a runtime value for the drift test.
 * The type forces it to list exactly the columns `DB` declares, so a table or
 * column added to `DB` alone fails to compile.
 */
export const TABLE_COLUMNS: { readonly [T in keyof DB]: Record<keyof DB[T], true> } = {
  settings: { key: true, value: true, updated_at: true },
  timelines: {
    id: true,
    name: true,
    description: true,
    exclusive: true,
    default_thing_type_id: true,
    created_at: true,
    updated_at: true,
    archived_at: true,
    deleted_at: true,
    deletion_id: true,
  },
  timeline_categories: {
    id: true,
    timeline_id: true,
    name: true,
    description: true,
    thing_id: true,
    created_at: true,
    updated_at: true,
    archived_at: true,
    deleted_at: true,
    deletion_id: true,
  },
  timeline_intervals: {
    id: true,
    timeline_id: true,
    category_id: true,
    start_at: true,
    end_at: true,
    time_zone: true,
    created_at: true,
    updated_at: true,
    deleted_at: true,
    deletion_id: true,
    purged_at: true,
  },
};
