-- Things (see docs/data-spec.md § 4. Things), then the timeline foreign keys
-- that had to wait for them.

-- `title_field_id` names one of the type's `thing_fields`. It has no foreign key
-- because `thing_fields` references this table: the pair would be circular, so
-- neither could be inserted (or imported) first. Core enforces it.
CREATE TABLE thing_types (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  title_field_id TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived_at INTEGER,
  deleted_at INTEGER,
  deletion_id TEXT,
  CHECK ((deleted_at IS NULL) = (deletion_id IS NULL))
) STRICT;

-- Append-only: core never updates or deletes a version.
-- `UNIQUE (thing_type_id, version)` is the target of the composite keys below.
CREATE TABLE thing_type_versions (
  id TEXT PRIMARY KEY NOT NULL,
  thing_type_id TEXT NOT NULL REFERENCES thing_types (id),
  version INTEGER NOT NULL CHECK (version >= 1),
  created_at INTEGER NOT NULL,
  UNIQUE (thing_type_id, version)
) STRICT;

-- A field's identity across versions. Its shape lives on its versions.
-- `UNIQUE (id, thing_type_id)` is the target of the field versions' composite key.
CREATE TABLE thing_fields (
  id TEXT PRIMARY KEY NOT NULL,
  thing_type_id TEXT NOT NULL REFERENCES thing_types (id),
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  option_labels TEXT NOT NULL CHECK (json_valid(option_labels)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (id, thing_type_id)
) STRICT;

CREATE INDEX thing_fields_thing_type_id ON thing_fields (thing_type_id);

-- Append-only, like type versions. `thing_type_id` is denormalized so the two
-- composite keys make the field and the type version belong to the same type.
CREATE TABLE thing_field_versions (
  id TEXT PRIMARY KEY NOT NULL,
  field_id TEXT NOT NULL,
  thing_type_id TEXT NOT NULL,
  thing_type_version INTEGER NOT NULL,
  value_type TEXT NOT NULL
    CHECK (value_type IN ('boolean', 'number', 'enum', 'text', 'date', 'datetime', 'ref', 'multi_ref')),
  required INTEGER NOT NULL CHECK (required IN (0, 1)),
  constraints TEXT NOT NULL CHECK (json_valid(constraints)),
  created_at INTEGER NOT NULL,
  UNIQUE (field_id, thing_type_version),
  FOREIGN KEY (field_id, thing_type_id) REFERENCES thing_fields (id, thing_type_id),
  FOREIGN KEY (thing_type_id, thing_type_version) REFERENCES thing_type_versions (thing_type_id, version)
) STRICT;

-- A version's field set.
CREATE INDEX thing_field_versions_type_version
  ON thing_field_versions (thing_type_id, thing_type_version);

-- A purge clears `source` and `external_id`: the spec's tombstone keeps only the
-- id, the type reference, the timestamps and `merged_into_id`. Core requires
-- `source` on unpurged things.
CREATE TABLE things (
  id TEXT PRIMARY KEY NOT NULL,
  thing_type_id TEXT NOT NULL,
  thing_type_version INTEGER NOT NULL,
  source TEXT,
  external_id TEXT,
  merged_into_id TEXT REFERENCES things (id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  deletion_id TEXT,
  purged_at INTEGER,
  FOREIGN KEY (thing_type_id, thing_type_version)
    REFERENCES thing_type_versions (thing_type_id, version),
  CHECK (purged_at IS NOT NULL OR source IS NOT NULL),
  CHECK (external_id IS NULL OR source IS NOT NULL),
  CHECK (merged_into_id IS NULL OR merged_into_id <> id),
  CHECK ((deleted_at IS NULL) = (deletion_id IS NULL)),
  CHECK (purged_at IS NULL OR deleted_at IS NOT NULL)
) STRICT;

CREATE INDEX things_thing_type ON things (thing_type_id, thing_type_version);

-- Re-running an import updates records instead of duplicating them.
CREATE UNIQUE INDEX things_external_id ON things (source, external_id)
  WHERE external_id IS NOT NULL;

-- Child rows of a thing: no lifecycle of their own, removed by a purge.
-- At most one value column is set; core sets the one matching the field's type.
CREATE TABLE thing_field_values (
  id TEXT PRIMARY KEY NOT NULL,
  thing_id TEXT NOT NULL REFERENCES things (id),
  field_id TEXT NOT NULL REFERENCES thing_fields (id),
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

-- Reading a thing's values. The unique indexes below are partial, so they cannot serve it.
CREATE INDEX thing_field_values_thing_id ON thing_field_values (thing_id);

-- One row per field, except one per referenced thing for `ref` and `multi_ref`.
-- Core keeps a `ref` field to one row.
CREATE UNIQUE INDEX thing_field_values_single ON thing_field_values (thing_id, field_id)
  WHERE value_ref IS NULL;

CREATE UNIQUE INDEX thing_field_values_ref ON thing_field_values (thing_id, field_id, value_ref)
  WHERE value_ref IS NOT NULL;

-- Finding what refers to a thing, as merging does.
CREATE INDEX thing_field_values_value_ref ON thing_field_values (value_ref)
  WHERE value_ref IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Timeline foreign keys deferred by 0002: `timelines.default_thing_type_id` and
-- `timeline_categories.thing_id`.
--
-- SQLite cannot add a constraint to a table, so the three timeline tables are
-- rebuilt. Foreign keys stay on (the pragma cannot change inside the migration's
-- transaction), so the order avoids ever breaking one:
-- 1. Create each new table referencing the other new ones (`timelines_new`, ...),
--    and copy its rows, parents first. Each insert is checked against rows that
--    are already there.
-- 2. Drop the old tables, children first. Nothing references them any more, so
--    no drop performs the implicit DELETE that would count violations.
-- 3. Rename the new tables. A rename rewrites the references to the renamed
--    table in the other tables, so the `_new` names disappear.
-- 4. Recreate every index exactly as 0002 wrote it.
-- Version 2 had no way to set either column, so the copies cannot fail on them.

CREATE TABLE timelines_new (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  exclusive INTEGER NOT NULL DEFAULT 1 CHECK (exclusive IN (0, 1)),
  default_thing_type_id TEXT REFERENCES thing_types (id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived_at INTEGER,
  deleted_at INTEGER,
  deletion_id TEXT,
  CHECK ((deleted_at IS NULL) = (deletion_id IS NULL))
) STRICT;

INSERT INTO timelines_new (
  id, name, description, exclusive, default_thing_type_id,
  created_at, updated_at, archived_at, deleted_at, deletion_id
)
SELECT
  id, name, description, exclusive, default_thing_type_id,
  created_at, updated_at, archived_at, deleted_at, deletion_id
FROM timelines;

-- `UNIQUE (id, timeline_id)` is the target of the intervals' composite key.
CREATE TABLE timeline_categories_new (
  id TEXT PRIMARY KEY NOT NULL,
  timeline_id TEXT NOT NULL REFERENCES timelines_new (id),
  name TEXT NOT NULL,
  description TEXT,
  thing_id TEXT REFERENCES things (id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived_at INTEGER,
  deleted_at INTEGER,
  deletion_id TEXT,
  UNIQUE (id, timeline_id),
  CHECK ((deleted_at IS NULL) = (deletion_id IS NULL))
) STRICT;

INSERT INTO timeline_categories_new (
  id, timeline_id, name, description, thing_id,
  created_at, updated_at, archived_at, deleted_at, deletion_id
)
SELECT
  id, timeline_id, name, description, thing_id,
  created_at, updated_at, archived_at, deleted_at, deletion_id
FROM timeline_categories;

-- Content columns are nullable so a purge can clear them; core requires them otherwise.
-- The composite key makes `timeline_id` always equal the category's.
CREATE TABLE timeline_intervals_new (
  id TEXT PRIMARY KEY NOT NULL,
  timeline_id TEXT NOT NULL REFERENCES timelines_new (id),
  category_id TEXT NOT NULL,
  start_at INTEGER,
  end_at INTEGER,
  time_zone TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  deletion_id TEXT,
  purged_at INTEGER,
  FOREIGN KEY (category_id, timeline_id) REFERENCES timeline_categories_new (id, timeline_id),
  CHECK (purged_at IS NOT NULL OR (start_at IS NOT NULL AND time_zone IS NOT NULL)),
  CHECK (end_at IS NULL OR end_at > start_at),
  CHECK ((deleted_at IS NULL) = (deletion_id IS NULL)),
  CHECK (purged_at IS NULL OR deleted_at IS NOT NULL)
) STRICT;

INSERT INTO timeline_intervals_new (
  id, timeline_id, category_id, start_at, end_at, time_zone,
  created_at, updated_at, deleted_at, deletion_id, purged_at
)
SELECT
  id, timeline_id, category_id, start_at, end_at, time_zone,
  created_at, updated_at, deleted_at, deletion_id, purged_at
FROM timeline_intervals;

DROP TABLE timeline_intervals;

DROP TABLE timeline_categories;

DROP TABLE timelines;

ALTER TABLE timelines_new RENAME TO timelines;

ALTER TABLE timeline_categories_new RENAME TO timeline_categories;

ALTER TABLE timeline_intervals_new RENAME TO timeline_intervals;

CREATE INDEX timeline_categories_timeline_id ON timeline_categories (timeline_id);

-- A thing has at most one non-deleted category per timeline.
CREATE UNIQUE INDEX timeline_categories_thing ON timeline_categories (timeline_id, thing_id)
  WHERE thing_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX timeline_intervals_timeline_start ON timeline_intervals (timeline_id, start_at);

CREATE INDEX timeline_intervals_category_id ON timeline_intervals (category_id);

-- Backs the one-ongoing-interval-per-category rule; core checks the rest of the overlap rule.
CREATE UNIQUE INDEX timeline_intervals_ongoing ON timeline_intervals (category_id)
  WHERE end_at IS NULL AND deleted_at IS NULL;
