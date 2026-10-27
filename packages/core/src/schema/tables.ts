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
  observation_metrics: {
    id: string;
    name: string;
    description: string | null;
    /** JSON text: option key to label. */
    option_labels: string;
    schema_version: number;
    created_at: number;
    updated_at: number;
    archived_at: number | null;
    deleted_at: number | null;
    deletion_id: string | null;
  };
  observation_metric_versions: {
    id: string;
    metric_id: string;
    version: number;
    value_type: string;
    /** JSON text. */
    constraints: string;
    created_at: number;
  };
  observations: {
    id: string;
    metric_id: string;
    metric_version: number;
    /** Null only once purged, as are `source`, `written_by` and `written_at`. */
    date: string | null;
    /** 0 or 1. */
    value_bool: number | null;
    value_num: number | null;
    value_enum: string | null;
    source: string | null;
    external_id: string | null;
    written_by: string | null;
    written_at: number | null;
    created_at: number;
    updated_at: number;
    deleted_at: number | null;
    deletion_id: string | null;
    purged_at: number | null;
  };
  observation_selections: {
    id: string;
    observation_id: string;
    option_key: string;
  };
  thing_types: {
    id: string;
    name: string;
    description: string | null;
    /** A `thing_fields` id; no foreign key, core enforces it. */
    title_field_id: string;
    schema_version: number;
    created_at: number;
    updated_at: number;
    archived_at: number | null;
    deleted_at: number | null;
    deletion_id: string | null;
  };
  thing_type_versions: {
    id: string;
    thing_type_id: string;
    version: number;
    created_at: number;
  };
  thing_fields: {
    id: string;
    thing_type_id: string;
    name: string;
    position: number;
    /** JSON text: option key to label. */
    option_labels: string;
    created_at: number;
    updated_at: number;
  };
  thing_field_versions: {
    id: string;
    field_id: string;
    thing_type_id: string;
    thing_type_version: number;
    value_type: string;
    /** 0 or 1. */
    required: number;
    /** JSON text. */
    constraints: string;
    created_at: number;
  };
  things: {
    id: string;
    thing_type_id: string;
    thing_type_version: number;
    /** Null only once purged, as is `external_id`. */
    source: string | null;
    external_id: string | null;
    merged_into_id: string | null;
    created_at: number;
    updated_at: number;
    deleted_at: number | null;
    deletion_id: string | null;
    purged_at: number | null;
  };
  thing_field_values: {
    id: string;
    thing_id: string;
    field_id: string;
    /** 0 or 1. */
    value_bool: number | null;
    value_num: number | null;
    value_enum: string | null;
    value_text: string | null;
    value_date: string | null;
    value_instant: number | null;
    value_ref: string | null;
    written_by: string;
    written_at: number;
  };
  log_types: {
    id: string;
    name: string;
    description: string | null;
    /** Set at creation only. */
    parent_type_id: string | null;
    schema_version: number;
    created_at: number;
    updated_at: number;
    archived_at: number | null;
    deleted_at: number | null;
    deletion_id: string | null;
  };
  log_type_versions: {
    id: string;
    log_type_id: string;
    version: number;
    created_at: number;
  };
  log_fields: {
    id: string;
    log_type_id: string;
    name: string;
    position: number;
    /** JSON text: option key to label. */
    option_labels: string;
    created_at: number;
    updated_at: number;
  };
  log_field_versions: {
    id: string;
    field_id: string;
    log_type_id: string;
    log_type_version: number;
    value_type: string;
    /** 0 or 1. */
    required: number;
    /** JSON text. */
    constraints: string;
    created_at: number;
  };
  log_entries: {
    id: string;
    log_type_id: string;
    log_type_version: number;
    /** Null on a child entry, which inherits them, and once purged; as are `precision` and `time_zone`. */
    occurred_at: number | null;
    ended_at: number | null;
    /** `instant`, `day`, `month` or `year`. */
    precision: string | null;
    time_zone: string | null;
    /** Set on child entries only, as is `position`. */
    parent_entry_id: string | null;
    position: number | null;
    /** Null only once purged, as is `external_id`. */
    source: string | null;
    external_id: string | null;
    created_at: number;
    updated_at: number;
    deleted_at: number | null;
    deletion_id: string | null;
    purged_at: number | null;
  };
  log_field_values: {
    id: string;
    log_entry_id: string;
    field_id: string;
    /** 0 or 1. */
    value_bool: number | null;
    value_num: number | null;
    value_enum: string | null;
    value_text: string | null;
    value_date: string | null;
    value_instant: number | null;
    value_ref: string | null;
    written_by: string;
    written_at: number;
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
  observation_metrics: {
    id: true,
    name: true,
    description: true,
    option_labels: true,
    schema_version: true,
    created_at: true,
    updated_at: true,
    archived_at: true,
    deleted_at: true,
    deletion_id: true,
  },
  observation_metric_versions: {
    id: true,
    metric_id: true,
    version: true,
    value_type: true,
    constraints: true,
    created_at: true,
  },
  observations: {
    id: true,
    metric_id: true,
    metric_version: true,
    date: true,
    value_bool: true,
    value_num: true,
    value_enum: true,
    source: true,
    external_id: true,
    written_by: true,
    written_at: true,
    created_at: true,
    updated_at: true,
    deleted_at: true,
    deletion_id: true,
    purged_at: true,
  },
  observation_selections: { id: true, observation_id: true, option_key: true },
  thing_types: {
    id: true,
    name: true,
    description: true,
    title_field_id: true,
    schema_version: true,
    created_at: true,
    updated_at: true,
    archived_at: true,
    deleted_at: true,
    deletion_id: true,
  },
  thing_type_versions: { id: true, thing_type_id: true, version: true, created_at: true },
  thing_fields: {
    id: true,
    thing_type_id: true,
    name: true,
    position: true,
    option_labels: true,
    created_at: true,
    updated_at: true,
  },
  thing_field_versions: {
    id: true,
    field_id: true,
    thing_type_id: true,
    thing_type_version: true,
    value_type: true,
    required: true,
    constraints: true,
    created_at: true,
  },
  things: {
    id: true,
    thing_type_id: true,
    thing_type_version: true,
    source: true,
    external_id: true,
    merged_into_id: true,
    created_at: true,
    updated_at: true,
    deleted_at: true,
    deletion_id: true,
    purged_at: true,
  },
  thing_field_values: {
    id: true,
    thing_id: true,
    field_id: true,
    value_bool: true,
    value_num: true,
    value_enum: true,
    value_text: true,
    value_date: true,
    value_instant: true,
    value_ref: true,
    written_by: true,
    written_at: true,
  },
  log_types: {
    id: true,
    name: true,
    description: true,
    parent_type_id: true,
    schema_version: true,
    created_at: true,
    updated_at: true,
    archived_at: true,
    deleted_at: true,
    deletion_id: true,
  },
  log_type_versions: { id: true, log_type_id: true, version: true, created_at: true },
  log_fields: {
    id: true,
    log_type_id: true,
    name: true,
    position: true,
    option_labels: true,
    created_at: true,
    updated_at: true,
  },
  log_field_versions: {
    id: true,
    field_id: true,
    log_type_id: true,
    log_type_version: true,
    value_type: true,
    required: true,
    constraints: true,
    created_at: true,
  },
  log_entries: {
    id: true,
    log_type_id: true,
    log_type_version: true,
    occurred_at: true,
    ended_at: true,
    precision: true,
    time_zone: true,
    parent_entry_id: true,
    position: true,
    source: true,
    external_id: true,
    created_at: true,
    updated_at: true,
    deleted_at: true,
    deletion_id: true,
    purged_at: true,
  },
  log_field_values: {
    id: true,
    log_entry_id: true,
    field_id: true,
    value_bool: true,
    value_num: true,
    value_enum: true,
    value_text: true,
    value_date: true,
    value_instant: true,
    value_ref: true,
    written_by: true,
    written_at: true,
  },
};
