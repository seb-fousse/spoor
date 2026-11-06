-- Things (see docs/data-spec.md § 4. Things). Deleting a thing type deletes its
-- versions and fields, and through them its things and their values.

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
  archived_at INTEGER
) STRICT;

-- Append-only: core never updates a version.
-- `UNIQUE (thing_type_id, version)` is the target of the composite keys below.
CREATE TABLE thing_type_versions (
  id TEXT PRIMARY KEY NOT NULL,
  thing_type_id TEXT NOT NULL REFERENCES thing_types (id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version >= 1),
  created_at INTEGER NOT NULL,
  UNIQUE (thing_type_id, version)
) STRICT;

-- A field's identity across versions. Its shape lives on its versions.
-- `UNIQUE (id, thing_type_id)` is the target of the field versions' composite key.
CREATE TABLE thing_fields (
  id TEXT PRIMARY KEY NOT NULL,
  thing_type_id TEXT NOT NULL REFERENCES thing_types (id) ON DELETE CASCADE,
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
  FOREIGN KEY (field_id, thing_type_id)
    REFERENCES thing_fields (id, thing_type_id) ON DELETE CASCADE,
  FOREIGN KEY (thing_type_id, thing_type_version)
    REFERENCES thing_type_versions (thing_type_id, version) ON DELETE CASCADE
) STRICT;

-- A version's field set.
CREATE INDEX thing_field_versions_type_version
  ON thing_field_versions (thing_type_id, thing_type_version);

CREATE TABLE things (
  id TEXT PRIMARY KEY NOT NULL,
  thing_type_id TEXT NOT NULL,
  thing_type_version INTEGER NOT NULL,
  source TEXT NOT NULL,
  external_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (thing_type_id, thing_type_version)
    REFERENCES thing_type_versions (thing_type_id, version) ON DELETE CASCADE
) STRICT;

CREATE INDEX things_thing_type ON things (thing_type_id, thing_type_version);

-- Re-running an import updates records instead of duplicating them.
CREATE UNIQUE INDEX things_external_id ON things (source, external_id)
  WHERE external_id IS NOT NULL;

-- Child rows of a thing, deleted with it. A value referencing a thing is
-- deleted with that thing too, leaving the field empty.
-- At most one value column is set; core sets the one matching the field's type.
CREATE TABLE thing_field_values (
  id TEXT PRIMARY KEY NOT NULL,
  thing_id TEXT NOT NULL REFERENCES things (id) ON DELETE CASCADE,
  field_id TEXT NOT NULL REFERENCES thing_fields (id) ON DELETE CASCADE,
  value_bool INTEGER CHECK (value_bool IN (0, 1)),
  value_num REAL,
  value_enum TEXT,
  value_text TEXT,
  value_date TEXT,
  value_instant INTEGER,
  value_ref TEXT REFERENCES things (id) ON DELETE CASCADE,
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

-- Finding what refers to a thing, as merging and deleting do.
CREATE INDEX thing_field_values_value_ref ON thing_field_values (value_ref)
  WHERE value_ref IS NOT NULL;
