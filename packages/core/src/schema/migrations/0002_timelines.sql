-- `default_thing_type_id` gets its foreign key when the things tables land.
CREATE TABLE timelines (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  exclusive INTEGER NOT NULL DEFAULT 1 CHECK (exclusive IN (0, 1)),
  default_thing_type_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived_at INTEGER,
  deleted_at INTEGER,
  deletion_id TEXT,
  CHECK ((deleted_at IS NULL) = (deletion_id IS NULL))
) STRICT;

-- `UNIQUE (id, timeline_id)` is the target of the intervals' composite key.
-- `thing_id` gets its foreign key when the things tables land.
CREATE TABLE timeline_categories (
  id TEXT PRIMARY KEY NOT NULL,
  timeline_id TEXT NOT NULL REFERENCES timelines (id),
  name TEXT NOT NULL,
  description TEXT,
  thing_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived_at INTEGER,
  deleted_at INTEGER,
  deletion_id TEXT,
  UNIQUE (id, timeline_id),
  CHECK ((deleted_at IS NULL) = (deletion_id IS NULL))
) STRICT;

CREATE INDEX timeline_categories_timeline_id ON timeline_categories (timeline_id);

-- A thing has at most one non-deleted category per timeline.
CREATE UNIQUE INDEX timeline_categories_thing ON timeline_categories (timeline_id, thing_id)
  WHERE thing_id IS NOT NULL AND deleted_at IS NULL;

-- Content columns are nullable so a purge can clear them; core requires them otherwise.
-- The composite key makes `timeline_id` always equal the category's.
CREATE TABLE timeline_intervals (
  id TEXT PRIMARY KEY NOT NULL,
  timeline_id TEXT NOT NULL REFERENCES timelines (id),
  category_id TEXT NOT NULL,
  start_at INTEGER,
  end_at INTEGER,
  time_zone TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  deletion_id TEXT,
  purged_at INTEGER,
  FOREIGN KEY (category_id, timeline_id) REFERENCES timeline_categories (id, timeline_id),
  CHECK (purged_at IS NOT NULL OR (start_at IS NOT NULL AND time_zone IS NOT NULL)),
  CHECK (end_at IS NULL OR end_at > start_at),
  CHECK ((deleted_at IS NULL) = (deletion_id IS NULL)),
  CHECK (purged_at IS NULL OR deleted_at IS NOT NULL)
) STRICT;

CREATE INDEX timeline_intervals_timeline_start ON timeline_intervals (timeline_id, start_at);

CREATE INDEX timeline_intervals_category_id ON timeline_intervals (category_id);

-- Backs the one-ongoing-interval-per-category rule; core checks the rest of the overlap rule.
CREATE UNIQUE INDEX timeline_intervals_ongoing ON timeline_intervals (category_id)
  WHERE end_at IS NULL AND deleted_at IS NULL;
