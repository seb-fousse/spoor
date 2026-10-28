-- `option_labels` is `{}` for a metric without labels. Core keeps `schema_version`
-- equal to its latest version; a foreign key would make the two tables a cycle.
CREATE TABLE observation_metrics (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  option_labels TEXT NOT NULL CHECK (json_valid(option_labels)),
  schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived_at INTEGER,
  deleted_at INTEGER,
  deletion_id TEXT,
  CHECK ((deleted_at IS NULL) = (deletion_id IS NULL))
) STRICT;

-- Append-only. `UNIQUE (metric_id, version)` is the target of the observations' composite key.
CREATE TABLE observation_metric_versions (
  id TEXT PRIMARY KEY NOT NULL,
  metric_id TEXT NOT NULL REFERENCES observation_metrics (id),
  version INTEGER NOT NULL CHECK (version >= 1),
  value_type TEXT NOT NULL CHECK (value_type IN ('boolean', 'number', 'enum', 'multi_enum')),
  constraints TEXT NOT NULL CHECK (json_valid(constraints)),
  created_at INTEGER NOT NULL,
  UNIQUE (metric_id, version)
) STRICT;

-- Content columns are nullable so a purge can clear them; the tombstone keeps the id, the
-- metric version and the lifecycle columns. A `multi_enum` value sets no value column.
CREATE TABLE observations (
  id TEXT PRIMARY KEY NOT NULL,
  metric_id TEXT NOT NULL,
  metric_version INTEGER NOT NULL,
  date TEXT,
  value_bool INTEGER CHECK (value_bool IN (0, 1)),
  value_num REAL,
  value_enum TEXT,
  source TEXT,
  external_id TEXT,
  written_by TEXT,
  written_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  deletion_id TEXT,
  purged_at INTEGER,
  FOREIGN KEY (metric_id, metric_version)
    REFERENCES observation_metric_versions (metric_id, version),
  CHECK (
    purged_at IS NOT NULL
    OR (date IS NOT NULL AND source IS NOT NULL AND written_by IS NOT NULL
      AND written_at IS NOT NULL)
  ),
  CHECK ((value_bool IS NOT NULL) + (value_num IS NOT NULL) + (value_enum IS NOT NULL) <= 1),
  CHECK ((deleted_at IS NULL) = (deletion_id IS NULL)),
  CHECK (purged_at IS NULL OR deleted_at IS NOT NULL)
) STRICT;

CREATE INDEX observations_metric_version ON observations (metric_id, metric_version);

-- At most one non-deleted observation per metric and day; editing revises it.
CREATE UNIQUE INDEX observations_metric_date ON observations (metric_id, date)
  WHERE deleted_at IS NULL;

-- Re-running an import updates records instead of duplicating them.
CREATE UNIQUE INDEX observations_external_id ON observations (source, external_id)
  WHERE external_id IS NOT NULL;

-- The chosen options of a `multi_enum` observation. None means "recorded, nothing selected".
CREATE TABLE observation_selections (
  id TEXT PRIMARY KEY NOT NULL,
  observation_id TEXT NOT NULL REFERENCES observations (id),
  option_key TEXT NOT NULL,
  UNIQUE (observation_id, option_key)
) STRICT;
