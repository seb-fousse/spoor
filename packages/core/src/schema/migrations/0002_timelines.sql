-- Deleting a timeline deletes its categories and their intervals.
--
-- `default_thing_type_id` and `thing_id` reference tables 0004 creates. SQLite
-- resolves a foreign key when a row is written, not when the table is created,
-- and every migration runs before the app writes anything.
CREATE TABLE timelines (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  exclusive INTEGER NOT NULL DEFAULT 1 CHECK (exclusive IN (0, 1)),
  default_thing_type_id TEXT REFERENCES thing_types (id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived_at INTEGER
) STRICT;

-- `UNIQUE (id, timeline_id)` is the target of the intervals' composite key.
-- Deleting a category's thing unlinks it; it keeps the thing's last title as its name.
CREATE TABLE timeline_categories (
  id TEXT PRIMARY KEY NOT NULL,
  timeline_id TEXT NOT NULL REFERENCES timelines (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  thing_id TEXT REFERENCES things (id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived_at INTEGER,
  UNIQUE (id, timeline_id)
) STRICT;

CREATE INDEX timeline_categories_timeline_id ON timeline_categories (timeline_id);

-- A thing has at most one category per timeline.
CREATE UNIQUE INDEX timeline_categories_thing ON timeline_categories (timeline_id, thing_id)
  WHERE thing_id IS NOT NULL;

-- The composite key makes `timeline_id` always equal the category's.
CREATE TABLE timeline_intervals (
  id TEXT PRIMARY KEY NOT NULL,
  timeline_id TEXT NOT NULL REFERENCES timelines (id) ON DELETE CASCADE,
  category_id TEXT NOT NULL,
  start_at INTEGER NOT NULL,
  end_at INTEGER,
  time_zone TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (category_id, timeline_id)
    REFERENCES timeline_categories (id, timeline_id) ON DELETE CASCADE,
  CHECK (end_at IS NULL OR end_at > start_at)
) STRICT;

CREATE INDEX timeline_intervals_timeline_start ON timeline_intervals (timeline_id, start_at);

CREATE INDEX timeline_intervals_category_id ON timeline_intervals (category_id);

-- Backs the one-ongoing-interval-per-category rule; core checks the rest of the overlap rule.
CREATE UNIQUE INDEX timeline_intervals_ongoing ON timeline_intervals (category_id)
  WHERE end_at IS NULL;
