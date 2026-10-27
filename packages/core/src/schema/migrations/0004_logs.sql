-- Logs (see docs/data-spec.md § 3. Logs). The definition tables mirror the thing
-- tables of 0003 column for column, so `definitions.ts` serves both.

-- `parent_type_id` makes this type's entries child entries of that type's
-- entries. Core sets it only at creation, so the chain of parents cannot form a
-- cycle: the key needs the parent to exist first, and the check refuses the one
-- loop the key would allow, a type naming itself.
CREATE TABLE log_types (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  parent_type_id TEXT REFERENCES log_types (id),
  schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived_at INTEGER,
  deleted_at INTEGER,
  deletion_id TEXT,
  CHECK (parent_type_id IS NULL OR parent_type_id <> id),
  CHECK ((deleted_at IS NULL) = (deletion_id IS NULL))
) STRICT;

-- Finding child types, as a cascading delete does.
CREATE INDEX log_types_parent_type_id ON log_types (parent_type_id);

-- Append-only: core never updates or deletes a version.
-- `UNIQUE (log_type_id, version)` is the target of the composite keys below.
CREATE TABLE log_type_versions (
  id TEXT PRIMARY KEY NOT NULL,
  log_type_id TEXT NOT NULL REFERENCES log_types (id),
  version INTEGER NOT NULL CHECK (version >= 1),
  created_at INTEGER NOT NULL,
  UNIQUE (log_type_id, version)
) STRICT;

-- A field's identity across versions. Its shape lives on its versions.
-- `UNIQUE (id, log_type_id)` is the target of the field versions' composite key.
CREATE TABLE log_fields (
  id TEXT PRIMARY KEY NOT NULL,
  log_type_id TEXT NOT NULL REFERENCES log_types (id),
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  option_labels TEXT NOT NULL CHECK (json_valid(option_labels)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (id, log_type_id)
) STRICT;

CREATE INDEX log_fields_log_type_id ON log_fields (log_type_id);

-- Append-only, like type versions. `log_type_id` is denormalized so the two
-- composite keys make the field and the type version belong to the same type.
CREATE TABLE log_field_versions (
  id TEXT PRIMARY KEY NOT NULL,
  field_id TEXT NOT NULL,
  log_type_id TEXT NOT NULL,
  log_type_version INTEGER NOT NULL,
  value_type TEXT NOT NULL
    CHECK (value_type IN ('boolean', 'number', 'enum', 'text', 'date', 'datetime', 'ref', 'multi_ref')),
  required INTEGER NOT NULL CHECK (required IN (0, 1)),
  constraints TEXT NOT NULL CHECK (json_valid(constraints)),
  created_at INTEGER NOT NULL,
  UNIQUE (field_id, log_type_version),
  FOREIGN KEY (field_id, log_type_id) REFERENCES log_fields (id, log_type_id),
  FOREIGN KEY (log_type_id, log_type_version) REFERENCES log_type_versions (log_type_id, version)
) STRICT;

-- A version's field set.
CREATE INDEX log_field_versions_type_version
  ON log_field_versions (log_type_id, log_type_version);

-- Content columns are nullable so a purge can clear them. The spec's tombstone
-- keeps only the id, the type reference and the timestamps, so a purge clears
-- the time, the parent and position, and the source.
--
-- An unpurged entry has a source and, unless it is a child entry, a time:
-- `occurred_at`, `precision` and `time_zone`, set or unset together. A child
-- entry with them unset inherits its parent's; core always writes children that
-- way. `ended_at` needs an own `occurred_at` to be measured from. `position`
-- orders a child among its siblings, so exactly the child entries have one.
CREATE TABLE log_entries (
  id TEXT PRIMARY KEY NOT NULL,
  log_type_id TEXT NOT NULL,
  log_type_version INTEGER NOT NULL,
  occurred_at INTEGER,
  ended_at INTEGER,
  precision TEXT CHECK (precision IN ('instant', 'day', 'month', 'year')),
  time_zone TEXT,
  parent_entry_id TEXT REFERENCES log_entries (id),
  position INTEGER,
  source TEXT,
  external_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  deletion_id TEXT,
  purged_at INTEGER,
  FOREIGN KEY (log_type_id, log_type_version)
    REFERENCES log_type_versions (log_type_id, version),
  CHECK (purged_at IS NOT NULL OR source IS NOT NULL),
  CHECK (purged_at IS NOT NULL OR parent_entry_id IS NOT NULL OR occurred_at IS NOT NULL),
  CHECK ((occurred_at IS NULL) = (precision IS NULL) AND (occurred_at IS NULL) = (time_zone IS NULL)),
  CHECK (ended_at IS NULL OR (occurred_at IS NOT NULL AND ended_at >= occurred_at)),
  CHECK ((parent_entry_id IS NULL) = (position IS NULL)),
  CHECK (parent_entry_id IS NULL OR parent_entry_id <> id),
  CHECK (external_id IS NULL OR source IS NOT NULL),
  CHECK ((deleted_at IS NULL) = (deletion_id IS NULL)),
  CHECK (purged_at IS NULL OR deleted_at IS NOT NULL)
) STRICT;

CREATE INDEX log_entries_type_occurred ON log_entries (log_type_id, occurred_at);

-- A parent's child entries, by position.
CREATE INDEX log_entries_parent_entry_id ON log_entries (parent_entry_id, position);

-- Re-running an import updates records instead of duplicating them.
CREATE UNIQUE INDEX log_entries_external_id ON log_entries (source, external_id)
  WHERE external_id IS NOT NULL;

-- Child rows of an entry: no lifecycle of their own, removed by a purge.
-- At most one value column is set; core sets the one matching the field's type.
CREATE TABLE log_field_values (
  id TEXT PRIMARY KEY NOT NULL,
  log_entry_id TEXT NOT NULL REFERENCES log_entries (id),
  field_id TEXT NOT NULL REFERENCES log_fields (id),
  value_bool INTEGER CHECK (value_bool IN (0, 1)),
  value_num REAL,
  value_enum TEXT,
  value_text TEXT,
  value_date TEXT,
  value_instant INTEGER,
  value_ref TEXT REFERENCES things (id),
  written_by TEXT NOT NULL,
  written_at INTEGER NOT NULL,
  CHECK (
    (value_bool IS NOT NULL) + (value_num IS NOT NULL) + (value_enum IS NOT NULL)
      + (value_text IS NOT NULL) + (value_date IS NOT NULL) + (value_instant IS NOT NULL)
      + (value_ref IS NOT NULL) <= 1
  )
) STRICT;

-- Reading an entry's values. The unique indexes below are partial, so they cannot serve it.
CREATE INDEX log_field_values_log_entry_id ON log_field_values (log_entry_id);

-- One row per field, except one per referenced thing for `ref` and `multi_ref`.
-- Core keeps a `ref` field to one row.
CREATE UNIQUE INDEX log_field_values_single ON log_field_values (log_entry_id, field_id)
  WHERE value_ref IS NULL;

CREATE UNIQUE INDEX log_field_values_ref ON log_field_values (log_entry_id, field_id, value_ref)
  WHERE value_ref IS NOT NULL;

-- Finding what refers to a thing, as merging does.
CREATE INDEX log_field_values_value_ref ON log_field_values (value_ref)
  WHERE value_ref IS NOT NULL;
