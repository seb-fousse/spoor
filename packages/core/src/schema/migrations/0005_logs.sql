-- Logs (see docs/data-spec.md § 3. Logs). The definition tables mirror the thing
-- tables of 0004 column for column, so `definitions.ts` serves both. Deleting a
-- log type deletes its child types, fields and entries, and with them their
-- values.

-- `parent_type_id` makes this type's entries child entries of that type's
-- entries. Core sets it only at creation, so the chain of parents cannot form a
-- cycle: the key needs the parent to exist first, and the check refuses the one
-- loop the key would allow, a type naming itself.
CREATE TABLE log_types (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  parent_type_id TEXT REFERENCES log_types (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived_at INTEGER,
  CHECK (parent_type_id IS NULL OR parent_type_id <> id)
) STRICT;

-- Finding child types, as a cascading delete does.
CREATE INDEX log_types_parent_type_id ON log_types (parent_type_id);

-- `value_type` is set at creation and never changes; the rest may be edited.
-- Deleting a field deletes its values.
CREATE TABLE log_fields (
  id TEXT PRIMARY KEY NOT NULL,
  log_type_id TEXT NOT NULL REFERENCES log_types (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  value_type TEXT NOT NULL
    CHECK (value_type IN ('boolean', 'number', 'enum', 'text', 'date', 'datetime', 'ref', 'multi_ref')),
  required INTEGER NOT NULL CHECK (required IN (0, 1)),
  constraints TEXT NOT NULL CHECK (json_valid(constraints)),
  option_labels TEXT NOT NULL CHECK (json_valid(option_labels)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE INDEX log_fields_log_type_id ON log_fields (log_type_id);

-- A top-level entry has a time: `occurred_at`, `precision` and `time_zone`, set
-- or unset together. A child entry with them unset inherits its parent's; core
-- always writes children that way. `ended_at` needs an own `occurred_at` to be
-- measured from. `position` orders a child among its siblings, so exactly the
-- child entries have one. Deleting an entry deletes its child entries.
CREATE TABLE log_entries (
  id TEXT PRIMARY KEY NOT NULL,
  log_type_id TEXT NOT NULL REFERENCES log_types (id) ON DELETE CASCADE,
  occurred_at INTEGER,
  ended_at INTEGER,
  precision TEXT CHECK (precision IN ('instant', 'day', 'month', 'year')),
  time_zone TEXT,
  parent_entry_id TEXT REFERENCES log_entries (id) ON DELETE CASCADE,
  position INTEGER,
  source TEXT NOT NULL,
  external_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (parent_entry_id IS NOT NULL OR occurred_at IS NOT NULL),
  CHECK ((occurred_at IS NULL) = (precision IS NULL) AND (occurred_at IS NULL) = (time_zone IS NULL)),
  CHECK (ended_at IS NULL OR (occurred_at IS NOT NULL AND ended_at >= occurred_at)),
  CHECK ((parent_entry_id IS NULL) = (position IS NULL)),
  CHECK (parent_entry_id IS NULL OR parent_entry_id <> id)
) STRICT;

CREATE INDEX log_entries_type_occurred ON log_entries (log_type_id, occurred_at);

-- A parent's child entries, by position.
CREATE INDEX log_entries_parent_entry_id ON log_entries (parent_entry_id, position);

-- Re-running an import updates records instead of duplicating them.
CREATE UNIQUE INDEX log_entries_external_id ON log_entries (source, external_id)
  WHERE external_id IS NOT NULL;

-- Child rows of an entry, deleted with it. A value referencing a thing is
-- deleted with that thing too, leaving the field empty.
-- At most one value column is set; core sets the one matching the field's type.
CREATE TABLE log_field_values (
  id TEXT PRIMARY KEY NOT NULL,
  log_entry_id TEXT NOT NULL REFERENCES log_entries (id) ON DELETE CASCADE,
  field_id TEXT NOT NULL REFERENCES log_fields (id) ON DELETE CASCADE,
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

-- Reading an entry's values. The unique indexes below are partial, so they cannot serve it.
CREATE INDEX log_field_values_log_entry_id ON log_field_values (log_entry_id);

-- Finding a field's values, as deleting it does.
CREATE INDEX log_field_values_field_id ON log_field_values (field_id);

-- One row per field, except one per referenced thing for `ref` and `multi_ref`.
-- Core keeps a `ref` field to one row.
CREATE UNIQUE INDEX log_field_values_single ON log_field_values (log_entry_id, field_id)
  WHERE value_ref IS NULL;

CREATE UNIQUE INDEX log_field_values_ref ON log_field_values (log_entry_id, field_id, value_ref)
  WHERE value_ref IS NOT NULL;

-- Finding what refers to a thing, as merging and deleting do.
CREATE INDEX log_field_values_value_ref ON log_field_values (value_ref)
  WHERE value_ref IS NOT NULL;
