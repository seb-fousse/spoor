-- `option_labels` is `{}` for a metric without labels. `value_type` is set at
-- creation and never changes; `constraints` and the labels may be edited.
-- Deleting a metric deletes its observations.
CREATE TABLE observation_metrics (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  value_type TEXT NOT NULL CHECK (value_type IN ('boolean', 'number', 'enum', 'multi_enum')),
  constraints TEXT NOT NULL CHECK (json_valid(constraints)),
  option_labels TEXT NOT NULL CHECK (json_valid(option_labels)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived_at INTEGER
) STRICT;

-- A `multi_enum` value sets no value column.
CREATE TABLE observations (
  id TEXT PRIMARY KEY NOT NULL,
  metric_id TEXT NOT NULL REFERENCES observation_metrics (id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  value_bool INTEGER CHECK (value_bool IN (0, 1)),
  value_num REAL,
  value_enum TEXT,
  source TEXT NOT NULL,
  external_id TEXT,
  written_by TEXT NOT NULL,
  written_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK ((value_bool IS NOT NULL) + (value_num IS NOT NULL) + (value_enum IS NOT NULL) <= 1)
) STRICT;

-- At most one observation per metric and day; editing revises it. Also finds a
-- metric's observations.
CREATE UNIQUE INDEX observations_metric_date ON observations (metric_id, date);

-- Re-running an import updates records instead of duplicating them.
CREATE UNIQUE INDEX observations_external_id ON observations (source, external_id)
  WHERE external_id IS NOT NULL;

-- The chosen options of a `multi_enum` observation. None means "recorded, nothing selected".
CREATE TABLE observation_selections (
  id TEXT PRIMARY KEY NOT NULL,
  observation_id TEXT NOT NULL REFERENCES observations (id) ON DELETE CASCADE,
  option_key TEXT NOT NULL,
  UNIQUE (observation_id, option_key)
) STRICT;
