# Data specification (DRAFT)

## Overview

| Domain | Records | Definition tables | Data tables |
| ------ | ------- | ----------------- | ----------- |
| Timelines | Time spent in a category | `Timeline`, `TimelineCategory` | `TimelineInterval` |
| Observations | One value per metric per day | `ObservationMetric` | `DailyObservation`, `ObservationSelection` |
| Logs | Events at a point in time or over a period | `LogType`, `LogField` | `LogEntry`, `LogFieldValue` |
| Things | Entities independent of time: a movie, a person, a place | `ThingType`, `ThingField` | `Thing`, `ThingFieldValue` |

There are no domain-specific tables. I.e. activity tracking, mood tracking, media
logs, journaling, and anything else the user wants to track are all built from user-created definitions.

## Principles

- **The file is the user's.** The schema is open and documented; export and
  import should be easy.
- **Forward-compatible.** A file written by an old version always opens
  in a newer one.
- **Sync-ready from the first table.** A mobile app for on-the-go data entry is a a future goal. Wanting to design tables & logic with this as a consideration.
- **Definitions, configurable by the user, describe the shape of the
  underlying data.** These abstractions and the definitions built on top of them are the basis for data tracking.
- **Sensitive by default.** Collect only what the user opts into or inputs themselves. Optional file encryption.

## Conventions

Every table lists all of its fields. Shared fields mean the same everywhere:

| Field | Notes |
| ----- | ------- |
| `id` | UUID. |
| `created_at` | When the record was created. |
| `updated_at` | Bumped on every change. |
| `archived_at` | Definitions only. Retired: not offered for new records, still visible and valid for existing ones. |

All timestamps are UTC (see [Storage](#storage)).

**Child rows** (`ObservationSelection`, `LogFieldValue`, `ThingFieldValue`)
have no lifecycle of their own. They are deleted with their parent, and
changing one bumps the parent's `updated_at`.

### Deleting

Deleting is immediate and permanent: there is no trash and no undo. The
database deletes what depends on a record through `ON DELETE CASCADE` foreign
keys, and runs with `PRAGMA secure_delete = ON` so deleted content is
overwritten in the file. A deletion cannot reach exports written before it.

| Deleting | Also deletes |
| -------- | ------------ |
| Timeline | Its categories and their intervals. |
| Timeline category | Its intervals. |
| Observation metric | Its observations. |
| Log type | Its fields and entries, and every log type whose `parent_type_id` is this type, with theirs. |
| Log or thing field | Its values. |
| Log entry | Its values and its child entries. |
| Thing type | Its fields and things, as deleting each thing does. |
| Thing | Its values, and every `ref` and `multi_ref` value referring to it. |

Two links are cleared instead: a timeline category linked to a deleted thing
loses its `thing_id` and keeps its name, and a timeline whose
`default_thing_type_id` is deleted no longer has one. A required `ref` whose
thing was deleted is left empty, so the record needs another before its values
can next be saved.

Before deleting, the user sees what else goes, with counts (“This also deletes
214 entries”), and must confirm. To retire a definition without losing data,
archive it instead. Archiving never cascades. Archiving a timeline stops all
its categories being offered.

A future sync will need to carry deletions to other devices. The planned
operation log records them as operations, so these tables keep no tombstones.

### Source

Observations, log entries, and things record where they came from:

| Field | Meaning |
| ----- | ------- |
| `source` | `manual`, `import` (another app's file, such as a Letterboxd export), or an integration ID such as `healthkit`, `health_connect`, or `plugin:tmdb`. |
| `external_id` | Nullable ID of the record in that source. |

Both are set at creation and never change. `(source, external_id)` is unique
when `external_id` is set, so re-running an import updates records instead of
duplicating them. Importing a Spoor export restores each record's original
`source`.

### Provenance

Each value records who last wrote it:

| Field | Meaning |
| ----- | ------- |
| `written_by` | Writer of the current value, using `source` identifiers. |
| `written_at` | When that writer set it. |

These are on `DailyObservation` (whose value is on the row) and on each
`LogFieldValue` and `ThingFieldValue`. A `multi_enum` selection is written as a
whole, so `ObservationSelection` has none.

**The user always wins.** An automated writer (import, health integration,
plugin) only overwrites values it wrote itself, and every user edit sets
`written_by` to `manual`. An automated writer skips a `(metric_id, date)` that
already has a value from another writer.

## Days and time zones

A **day** runs from 00:00 to 00:00 of the next date in the user's time zone.
The user's time zone is the `time_zone` [setting](#settings), an IANA ID such
as `Europe/Paris`.

Each interval and log entry stores the time zone in force when it was created,
and is assigned to days and displayed in that zone, not the current setting.
Changing the setting or travelling never moves past records to other days.
Displaying records in the current zone instead is a display setting.

An interval crossing midnight counts toward each day it spans; it is split only
in derived data. Log entries with `month` or `year` [precision](#precision)
belong to no day.

## 1. Timelines

A timeline is a set of categories and a sequence of intervals, each selecting
one category. Examples: **Activities**, **Location**, **People**.

### Timeline

| Field | Meaning |
| ----- | ------- |
| `id` | |
| `name` | |
| `description` | Optional. |
| `exclusive` | Boolean, default `true`. |
| `default_thing_type_id` | Nullable. UI only: when creating a category, offer things of this type first. Enforces nothing. |
| `created_at`, `updated_at` | |
| `archived_at` | |

On an **exclusive** timeline (Activities, Location: “what was I doing?”) no two
intervals overlap. On a **non-exclusive** one (People: “who was I with?”) only
intervals of the same category must not overlap, so being with Alex and Sam at
once is two overlapping intervals. A timeline can become non-exclusive at any
time, and exclusive again only if none of its intervals overlap.

### Timeline category

An untyped enum option owned by one timeline, such as “Running” or “At home”.

| Field | Meaning |
| ----- | ------- |
| `id` | |
| `timeline_id` | Owning timeline. |
| `name` | Label. |
| `description` | Optional. |
| `thing_id` | Nullable. The [thing](#4-things) this category represents. |
| `created_at`, `updated_at` | |
| `archived_at` | |

Intervals reference a category by ID, so renaming never changes their meaning.
A category in use is retired by archiving it.

A category with a `thing_id` represents that thing: “Alex” on a People timeline
is the Person “Alex” that log entries refer to, so time with Alex and things
done with Alex can be analysed together. Its `name` follows the thing's title;
if the thing is deleted, the category is unlinked and keeps the last title. A
thing has at most one category per timeline. Categories that are not things, such as
“Commuting” on a Location timeline, have no `thing_id`.

### Timeline interval

| Field | Meaning |
| ----- | ------- |
| `id` | |
| `timeline_id` | Must equal the category's `timeline_id`; denormalized for the overlap rule. |
| `category_id` | The selected category. |
| `start_at` | Required. |
| `end_at` | `null` while ongoing. |
| `time_zone` | IANA ID at creation; see [Days and time zones](#days-and-time-zones). |
| `created_at`, `updated_at` | |

Intervals are half-open, `[start_at, end_at)`, with `end_at` after `start_at`;
adjacent intervals do not overlap. Two intervals overlap when each
starts before the other ends (an ongoing interval never ends). Overlap is a
conflict on the same exclusive timeline, or in the same category on a
non-exclusive one. So an exclusive timeline has at most one ongoing interval,
and a non-exclusive one at most one per category.

An interval selects exactly one category and has no other payload. A category
change closes the current interval and starts another.

Splitting an interval at an instant strictly inside it ends it there and starts
a new interval in the same category and zone, running to where the original
ended (ongoing if it was). The two cover the same time, so a split never
creates an overlap.

Core enforces the overlap rule, checking and writing in one transaction. There
is no database trigger, because a future sync merge must apply a conflict
policy rather than fail. A partial unique index on `category_id` where
`end_at IS NULL` backs the one-ongoing-per-category rule.

## 2. Observations

Daily values, one per metric per day, independent of timelines.

### Observation metric

| Field | Meaning |
| ----- | ------- |
| `id` | |
| `name` | |
| `description` | Optional. |
| `value_type` | `boolean`, `number`, `enum`, or `multi_enum`. Set at creation; see [Changing definitions](#changing-definitions). |
| `constraints` | `number`: unit, bounds, precision. `enum`/`multi_enum`: [options](#enum-options); `multi_enum` also minimum and maximum selections. |
| `option_labels` | For `enum` and `multi_enum`: label per option key. |
| `created_at`, `updated_at` | |
| `archived_at` | |

Examples: boolean “Brushed teeth”, number “Cups of water”, enum “Mood”,
`multi_enum` “Symptoms”.

### Enum options

An ordered list in the definition's `constraints`, shared by observation
metrics and log and thing fields:

| Field | Meaning |
| ----- | ------- |
| `key` | Stored on records. Never reused for another meaning. |
| `order` | Display position. |
| `score` | Optional ordinal value (Mood: 1–5), so analysis can treat the enum as a scale. |

Labels live in `option_labels`, apart from the options, so they can be edited
freely. Removing an option leaves stored values with its key alone; they show
the key's label if it still has one.

### Daily observation

| Field | Meaning |
| ----- | ------- |
| `id` | |
| `metric_id` | |
| `date` | `YYYY-MM-DD`; see [Days and time zones](#days-and-time-zones). |
| `value` | Typed value (see [Storage](#storage)). Unset for `multi_enum`. |
| `source`, `external_id` | See [Source](#source). |
| `written_by`, `written_at` | See [Provenance](#provenance). |
| `created_at`, `updated_at` | |

At most one observation per `(metric_id, date)`, enforced by a unique index;
editing revises it. No observation means “not recorded”,
never `false`, zero, or a default.

Recording a value validates it against the metric's constraints as they are
then. Nothing can be recorded on an archived metric.

### Observation selection

The chosen options of a `multi_enum` observation:

| Field | Meaning |
| ----- | ------- |
| `id` | |
| `observation_id` | |
| `option_key` | |

Unique per `(observation_id, option_key)`. An observation with no selections
means “recorded, nothing selected”, as opposed to no observation.

## 3. Logs

Events at a point in time or over a period, such as a movie watched, a
workout, or a diary entry.

### Log type

| Field | Meaning |
| ----- | ------- |
| `id` | |
| `name` | Such as “Movie watched”. |
| `description` | Optional. |
| `parent_type_id` | Nullable. Makes entries of this type [child entries](#child-entries) of that type's entries. Set at creation and never changed. |
| `created_at`, `updated_at` | |
| `archived_at` | |

A `parent_type_id` must name an existing log type. Since it never changes and
a parent always exists before its children, the types form a tree with no
cycles. A child type can have child types of its own.

### Log field

| Field | Meaning |
| ----- | ------- |
| `id` | Never changes. |
| `log_type_id` | |
| `name` | Unique within its type, ignoring case. |
| `position` | Display order. |
| `value_type` | See below. Set at creation; see [Changing definitions](#changing-definitions). |
| `required` | |
| `constraints` | Bounds; [enum options](#enum-options); or, for `ref` and `multi_ref`, the target `thing_type_id`, which never changes. |
| `option_labels` | For `enum`: label per option key. |
| `created_at`, `updated_at` | |

Log and thing field value types:

| Value type | Example |
| ---------- | ------- |
| `boolean` | Rewatch? |
| `number` | Personal rating. |
| `enum` | Format (cinema, streaming). |
| `text` | Review, diary entry. |
| `date` | Date of birth. |
| `datetime` | A UTC timestamp. |
| `ref` | The movie watched (one [thing](#4-things)). |
| `multi_ref` | The people you watched it with (several things). |

A “Movie watched” entry has a `ref` to a Movie thing, a rating, a review, and a
`multi_ref` to Person things. Facts about the movie belong on the thing, so a
rewatch is a second entry referring to the same movie.

### Log entry

| Field | Meaning |
| ----- | ------- |
| `id` | |
| `log_type_id` | |
| `occurred_at` | Required, except on child entries. |
| `ended_at` | Optional; not before `occurred_at`. |
| `precision` | `instant` (default), `day`, `month`, or `year`. |
| `time_zone` | IANA ID at creation; see [Days and time zones](#days-and-time-zones). |
| `parent_entry_id` | Nullable; see [Child entries](#child-entries). |
| `position` | Order among siblings; null for top-level entries. A new child goes after its siblings. |
| `source`, `external_id` | See [Source](#source). |
| `created_at`, `updated_at` | |

An entry's day is the day containing `occurred_at` in its `time_zone`.

### Precision

For entries without an exact time, such as dates from a Letterboxd export or
“read in 2019”, `occurred_at` and `ended_at` store the start of the day, month,
or year in the entry's time zone, and `precision` says which. The UI shows only
that part (“14 Mar 2019”, “2019”), never an invented time. `day` entries
belong to that day; `month` and `year` entries are left out of per-day data.

Core truncates rather than refuses: any instant inside the period may be given
and its start is stored, so an import need not compute it. `ended_at` is
truncated the same way and must not fall before `occurred_at` once both are.
Changing an entry's precision truncates its stored times again. An entry's
`time_zone` never changes.

### Child entries

A type with a `parent_type_id` models a repeated group inside an entry:

```text
LogType "Workout"   fields: notes (text)
LogType "Set"       fields: exercise (ref → Exercise), reps (number), weight_kg (number)
                    parent_type_id: Workout

LogEntry W1  Workout  occurred_at=18:00  ended_at=19:00   notes="Leg day"
 ├─ LogEntry S1  Set  parent_entry_id=W1  position=1  exercise=Squat  reps=5  weight_kg=100
 ├─ LogEntry S2  Set  parent_entry_id=W1  position=2  exercise=Squat  reps=5  weight_kg=105
 └─ LogEntry S3  Set  parent_entry_id=W1  position=3  exercise=Lunge  reps=8  weight_kg=40
```

A child's type must name its parent's type as `parent_type_id`. A child is an
ordinary entry with its own values. With `occurred_at`,
`precision`, and `time_zone` null it inherits its parent's, and it always
belongs to its parent's day. Deleting a parent deletes its children; a child
can also be deleted alone.

Only a type with a `parent_type_id` has child entries, and its entries are
always child entries. Archiving the parent type does not stop children being
added to its existing entries, since archiving never cascades. Core writes a
child with `occurred_at`, `ended_at`, `precision` and `time_zone` all null. The
schema also accepts a child with its own `occurred_at`, `precision` and
`time_zone`, which are then shown in place of the inherited ones, but its day
is still its parent's.

### Log field value

| Field | Meaning |
| ----- | ------- |
| `id` | |
| `log_entry_id` | |
| `field_id` | |
| `value` | Typed value of the field's `value_type`. |
| `written_by`, `written_at` | See [Provenance](#provenance). |

At most one row per `(log_entry_id, field_id)`, except `multi_ref`: one row per
referenced thing, unique per `(log_entry_id, field_id, value_ref)`. Clearing an
optional value removes its row. A missing value is distinct from an empty
string, zero, or `false`.

## 4. Things

Entities independent of time: a movie, a person, a place, an exercise. A
`Thing` is one instance, such as Alex; its `ThingType`, such as Person, defines
the fields every instance has. Log entries, other things, and timeline
categories refer to things. Things are not assigned to days.

Thing definitions mirror log definitions and use the same value types.

### Thing type

| Field | Meaning |
| ----- | ------- |
| `id` | |
| `name` | Such as “Person”. |
| `description` | Optional. |
| `title_field_id` | A required `text` field, used as each thing's display name in references, categories, and merging. It cannot be deleted or made optional. |
| `created_at`, `updated_at` | |
| `archived_at` | |

### Thing field

The same columns as a [log field](#log-field), with `thing_type_id` in place of
`log_type_id`.

Example: a Movie type with text fields for title and IMDb ID, a number for
year, and a `ref` to a Person for director.

### Thing

| Field | Meaning |
| ----- | ------- |
| `id` | |
| `thing_type_id` | |
| `source`, `external_id` | See [Source](#source). |
| `created_at`, `updated_at` | |

### Thing field value

| Field | Meaning |
| ----- | ------- |
| `id` | |
| `thing_id` | |
| `field_id` | |
| `value` | Typed value of the field's `value_type`. |
| `written_by`, `written_at` | See [Provenance](#provenance). |

Same rules as [log field values](#log-field-value). Deleting a thing deletes the
values that refer to it (see [Deleting](#deleting)).

### Merging things

Duplicates are expected: two devices each create “Alex”, an import adds a
second “Alien”, or one person is entered as “Alex” and “Alex Smith”. To merge,
the user picks the survivor and the duplicate, then core:

1. Re-points every `ref` and `multi_ref` to the survivor, collapsing
   `multi_ref` rows that would then repeat.
2. Re-points every category linked to the duplicate. If the survivor already
   has a category on that timeline, the duplicate's intervals move to the
   survivor's category, intervals that now overlap or touch are joined, and the
   duplicate's category is deleted.
3. Deletes the duplicate, which nothing refers to any more.

Field values are not merged; the user copies over what they want.

## Settings

| Field | Meaning |
| ----- | ------- |
| `key` | Primary key, such as `time_zone`. |
| `value` | JSON. |
| `updated_at` | |

Settings are configuration, so the typed-column rule does not apply. Installed
plugins and the permissions granted to them are stored as settings.

## Changing definitions

A metric's or field's `value_type` is set when it is created and never
changes, and neither does the thing type a `ref` or `multi_ref` field refers
to, so stored values never need reinterpreting. To change either, add a new
field and delete the old one, which deletes its values after a confirmation
with the count.

Everything else is edited in place: names, descriptions, positions,
`required`, `constraints`, option labels, and title fields. Constraints and
`required` are checked when a value is written, never against values already
stored, so tightening a rule leaves existing records as they are until they
are next edited. A field added later is simply empty on existing records.

## Storage

SQLite `STRICT` tables. Values use typed columns, never untyped strings or
JSON:

| Column | SQLite type | Holds |
| ------ | ----------- | ----- |
| `value_bool` | `INTEGER` (0/1) | `boolean` |
| `value_num` | `REAL` | `number` |
| `value_enum` | `TEXT` | `enum` key |
| `value_text` | `TEXT` | `text` |
| `value_date` | `TEXT` (`YYYY-MM-DD`) | `date` |
| `value_instant` | `INTEGER` (epoch ms, UTC) | `datetime` |
| `value_ref` | `TEXT` (UUID) | `ref`, each `multi_ref` row |

Exactly one value column is set, matching the definition's `value_type`; a
`CHECK` constraint allows at most one non-null. A `multi_enum` observation sets
none and stores `ObservationSelection` rows.

All instants are `INTEGER` epoch milliseconds, UTC; dates are `TEXT`
`YYYY-MM-DD`. Export writes instants as ISO 8601 UTC
(`2026-10-24T18:00:00.000Z`).

Unknown value types or fields from a newer version are preserved on import and
export, never coerced or dropped. Validation errors name the failing record
and field.

## Relationships

```text
Timeline ──* TimelineCategory ──* TimelineInterval
Timeline ──* TimelineInterval
TimelineCategory ──> Thing                 (optional)
ObservationMetric ──* DailyObservation ──* ObservationSelection
LogType ──* LogField ──* LogFieldValue
LogType ──* LogEntry ──* LogFieldValue
LogEntry ──* LogEntry                      (child entries)
ThingType ──* ThingField ──* ThingFieldValue
ThingType ──* Thing ──* ThingFieldValue
LogFieldValue, ThingFieldValue ──> Thing   (ref, multi_ref)
```

## Export and import

- Versioned JSON with a top-level `schemaVersion`, plus one CSV per table.
- Includes every table above.
- Round-trip is a core requirement: export then import reproduces IDs,
  timestamps, values, sources, and archive state exactly.
- Import validates definitions and values and refuses invalid data rather than
  dropping or altering it. It checks the whole file before writing anything, so
  a refused import changes nothing.
- Records use camelCase field names. Instants are ISO 8601 UTC, booleans are
  `true`/`false`, and a setting's `value` is its JSON value. Every row is
  exported, archived ones included.
- `schemaVersion` is the version of this format, not of the database. A file
  with a newer version is refused. A table missing from the file is treated as
  empty, so an export from an older Spoor still imports.
- Import needs an empty database, apart from settings, which it overwrites.
  Merging into existing data is not supported.
- Only the JSON export exists so far; the CSV export is not yet built.

```json
{
  "schemaVersion": 1,
  "exportedAt": "2026-10-24T00:00:00.000Z",
  "settings": [],
  "timelines": [],
  "timelineCategories": [],
  "timelineIntervals": [],
  "observationMetrics": [],
  "observations": [],
  "observationSelections": [],
  "logTypes": [],
  "logFields": [],
  "logEntries": [],
  "logFieldValues": [],
  "thingTypes": [],
  "thingFields": [],
  "things": [],
  "thingFieldValues": []
}
```

## Analytics export

A per-day feature table for offline analysis, derived on each export and never
stored. Like the full export, it is user-initiated plaintext.

| Column | Meaning |
| ------ | ------- |
| `date` | `YYYY-MM-DD`. |
| `feature_key` | Built from definition IDs, never labels. |
| `value` | Number, or `null` when nothing was recorded. |

| Feature key | Value |
| ----------- | ----- |
| `obs:<metric_id>` | Number as-is; boolean as 0/1; enum as its option's `score`; `multi_enum` as the count selected. |
| `obs:<metric_id>:<option_key>` | `enum` and `multi_enum`: 1 if that option was recorded, else 0. |
| `tl_min:<category_id>` | Minutes in that category. |
| `tl_cov:<timeline_id>` | Minutes covered by any interval on that timeline, separating zero minutes from untracked. |
| `log_n:<log_type_id>` | Entries of that type, including child entries. |
| `log_mean:<field_id>` | Mean of a numeric field across that day's entries. |

Intervals are split at midnight; an ongoing interval counts up to the export
time. `month` and `year` entries and text fields are excluded. A companion
`features.json` maps each key to its definition's name and value type. Lags,
rolling windows, and the target are left to the analysis code.

## To do

Possible additions, not yet decided:

- **Changes of meaning in the analytics export.** A rating moving from 1–5 to
  1–10 keeps its field ID, so one feature key mixes two scales. Have the UI
  suggest a new field for such changes.
- **Archiving fields.** Hiding a field without deleting its values, as
  definitions can be archived.
- **Definition edits under multi-device sync.** Two offline devices could each
  edit the same field. Decide the conflict policy, and whether records need a
  `device_id` or sync revision counter, when sync is designed.
