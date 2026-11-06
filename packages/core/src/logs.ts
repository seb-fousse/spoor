import type { Selectable } from "kysely";
import { dayOfEntry, isTimeZone, type Precision, truncateToPrecision } from "./days";
import {
  createFirstVersion,
  draftFields,
  type FieldDefinition,
  type FieldInput,
  getVersionFields,
  LOG_TABLES,
  MANUAL,
  type NewField,
  readValues,
  reorderFields,
  reviseFields,
  setValues,
  updateField,
  type ValuePatch,
} from "./definitions";
import { isNonEmptyString, optionalText, requireName } from "./guards";
import { newId } from "./ids";
import type { Database } from "./platform/index";
import { queryBuilder } from "./query";
import type { DB } from "./schema/tables";
import { getTimeZone } from "./settings";
import { type Instant, instantToIso, isInstant, type LocalDate, now } from "./time";

import { transaction } from "./transaction";
import type { FieldValueType, Value } from "./values";

/**
 * Logs (see docs/data-spec.md § 3. Logs): log types with versioned fields, and
 * entries holding values for them, at a point in time or over a period.
 *
 * Fields, versions and values go through `definitions.ts`, shared with things.
 * A type with a `parentTypeId` is for child entries of that type's entries: a
 * child inherits its parent's time and belongs to its parent's day.
 *
 * Deleting is permanent: a type goes with the types below it and all their
 * entries, an entry with its child entries. Every write runs in one transaction.
 */

/** How much of an entry's time is known, coarsest last. */
export const PRECISIONS = [
  "instant",
  "day",
  "month",
  "year",
] as const satisfies readonly Precision[];

export interface LogType {
  id: string;
  name: string;
  description: string | null;
  /** Entries of this type are child entries of that type's entries. Never changes. */
  parentTypeId: string | null;
  /** The current version, which new entries are validated against. */
  schemaVersion: number;
  createdAt: Instant;
  updatedAt: Instant;
  archivedAt: Instant | null;
}

/** A field to add to a log type. */
export type NewLogField = NewField;
/** A field in a revised field list: an existing one by `id`, or a new one without. */
export type LogFieldInput = FieldInput;
/** A log field as it is in one version of its type. */
export type LogField = FieldDefinition;

/** When an entry happened, as stored on a top-level entry. */
export interface EntryTime {
  /** The start of the day, month or year in `timeZone` unless `precision` is `instant`. */
  occurredAt: Instant;
  precision: Precision;
  timeZone: string;
}

export interface LogEntry {
  id: string;
  logTypeId: string;
  /** The version its values were validated against. */
  logTypeVersion: number;
  /** As stored: `null` on a child entry, which inherits its parent's (see `resolved`). */
  occurredAt: Instant | null;
  endedAt: Instant | null;
  precision: Precision | null;
  timeZone: string | null;
  parentEntryId: string | null;
  /** Order among siblings; `null` for a top-level entry. */
  position: number | null;
  source: string;
  externalId: string | null;
  createdAt: Instant;
  updatedAt: Instant;
  /** Its own time, or for a child entry without one, the time it inherits. */
  resolved: EntryTime;
  /** The day it belongs to (a child: its parent's), or `null` for `month` and `year`. */
  day: LocalDate | null;
  /** By field id; fields without a value are absent. See `readValues`. */
  values: Record<string, Value>;
}

export interface NewLogEntry {
  logTypeId: string;
  /** Required for a top-level entry; a child entry inherits it. */
  occurredAt?: Instant;
  endedAt?: Instant | null;
  /** Default `instant`. */
  precision?: Precision;
  /** Default: the `time_zone` setting. */
  timeZone?: string;
  /** Makes it a child entry, of a type whose `parentTypeId` is the parent's type. */
  parentEntryId?: string | null;
  /** A child's order among its siblings. Default: after every sibling. */
  position?: number;
  values?: ValuePatch;
  /** Default `manual`. */
  source?: string;
  externalId?: string | null;
  /** Who writes the values. Default: `source`. */
  writtenBy?: string;
}

export interface LogEntryPatch {
  occurredAt?: Instant;
  /** `null` clears it. */
  endedAt?: Instant | null;
  precision?: Precision;
  values?: ValuePatch;
  /** Who writes the values. Default `manual`; see `setValues` for who wins. */
  writtenBy?: string;
}

/** What `deleteLogType` would delete. */
export interface LogTypeDeletion {
  /** The type itself and every type below it. */
  types: number;
  /** Their entries, child entries included. */
  entries: number;
}

type LogTypeRow = Selectable<DB["log_types"]>;
type EntryRow = Selectable<DB["log_entries"]>;

// ---------------------------------------------------------------------------
// Log types

/**
 * Creates a log type with `fields` as version 1. A `parentTypeId` must name a
 * log type, and can never change afterwards, so types cannot form a cycle.
 */
export async function createLogType(
  db: Database,
  input: {
    name: string;
    description?: string | null;
    parentTypeId?: string | null;
    fields: readonly NewLogField[];
  },
): Promise<LogType> {
  const id = newId();
  const drafts = draftFields(LOG_TABLES, input.fields);
  await transaction(db, async () => {
    const parentTypeId = input.parentTypeId ?? null;
    if (parentTypeId !== null) await requireLogType(db, parentTypeId);
    const t = now();
    await queryBuilder(db)
      .insertInto("log_types")
      .values({
        id,
        name: requireName(`Log type ${id}`, input.name),
        description: optionalText(input.description),
        parent_type_id: parentTypeId,
        schema_version: 1,
        created_at: t,
        updated_at: t,
      })
      .execute();
    await createFirstVersion(db, LOG_TABLES, id, drafts, t);
  });
  return (await getLogType(db, id)) as LogType;
}

/** The log type with `id`, or `undefined`. */
export async function getLogType(db: Database, id: string): Promise<LogType | undefined> {
  const row = await queryBuilder(db)
    .selectFrom("log_types")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  return row && toLogType(row);
}

/** Every log type by name, archived included. */
export async function listLogTypes(db: Database): Promise<LogType[]> {
  const rows = await queryBuilder(db)
    .selectFrom("log_types")
    .selectAll()
    .orderBy("name", (ob) => ob.collate("nocase"))
    .orderBy("id")
    .execute();
  return rows.map(toLogType);
}

/** Renames or redescribes. The parent type is fixed at creation. */
export async function updateLogType(
  db: Database,
  id: string,
  patch: { name?: string; description?: string | null },
): Promise<LogType> {
  await transaction(db, async () => {
    const type = await requireLogType(db, id);
    await queryBuilder(db)
      .updateTable("log_types")
      .set({
        name: patch.name === undefined ? type.name : requireName(`Log type ${id}`, patch.name),
        description:
          patch.description === undefined ? type.description : optionalText(patch.description),
        updated_at: now(),
      })
      .where("id", "=", id)
      .execute();
  });
  return (await getLogType(db, id)) as LogType;
}

/**
 * Replaces the type's field list, in display order; see `reviseFields`. A
 * change of shape, required flag or field set creates a new version, which new
 * entries use; existing entries keep theirs.
 */
export async function reviseLogTypeFields(
  db: Database,
  id: string,
  fields: readonly LogFieldInput[],
): Promise<{ version: number; created: boolean }> {
  return transaction(db, async () => {
    await requireLogType(db, id);
    return reviseFields(db, LOG_TABLES, id, fields, now());
  });
}

/**
 * `field` as an entry of a revised field list, unchanged, so a caller can
 * revise a type by editing its current fields.
 */
export function logFieldInput(field: LogField): LogFieldInput {
  return {
    id: field.id,
    name: field.name,
    // A field's shape is always one of the field value types; `parseShape` checked it.
    valueType: field.shape.valueType as FieldValueType,
    required: field.required,
    constraints: field.shape.constraints,
    optionLabels: field.optionLabels,
  };
}

/** Renames or relabels a field, without a version. */
export async function updateLogField(
  db: Database,
  fieldId: string,
  patch: { name?: string; optionLabels?: Record<string, string> },
): Promise<void> {
  await transaction(db, async () => {
    const field = await queryBuilder(db)
      .selectFrom("log_fields")
      .select("log_type_id")
      .where("id", "=", fieldId)
      .executeTakeFirst();
    if (!field) throw new Error(`Log field ${fieldId}: not found`);
    await requireLogType(db, field.log_type_id);
    await updateField(db, LOG_TABLES, fieldId, patch, now());
  });
}

/** Puts the current version's fields in the order of `fieldIds`, without a version. */
export async function reorderLogFields(
  db: Database,
  id: string,
  fieldIds: readonly string[],
): Promise<void> {
  await transaction(db, async () => {
    await requireLogType(db, id);
    await reorderFields(db, LOG_TABLES, id, fieldIds, now());
  });
}

/**
 * The fields of one version of the type (default: its current one), by
 * position. Empty for an unknown version.
 */
export async function getLogTypeVersionFields(
  db: Database,
  id: string,
  version?: number,
): Promise<LogField[]> {
  const type = await getLogType(db, id);
  if (!type) throw new Error(`Log type ${id}: not found`);
  return getVersionFields(db, LOG_TABLES, id, version ?? type.schemaVersion);
}

/** Archives or unarchives. An archived type is not offered for new entries. */
export async function setLogTypeArchived(
  db: Database,
  id: string,
  archived: boolean,
): Promise<void> {
  await transaction(db, async () => {
    await requireLogType(db, id);
    const t = now();
    await queryBuilder(db)
      .updateTable("log_types")
      .set({ archived_at: archived ? t : null, updated_at: t })
      .where("id", "=", id)
      .execute();
  });
}

/** What `deleteLogType` would delete, for the user to confirm. */
export async function previewLogTypeDeletion(db: Database, id: string): Promise<LogTypeDeletion> {
  await requireLogType(db, id);
  const types = await tree(id, async (parents) =>
    (
      await queryBuilder(db)
        .selectFrom("log_types")
        .select("id")
        .where("parent_type_id", "in", parents)
        .execute()
    ).map((r) => r.id),
  );
  const { entries } = await queryBuilder(db)
    .selectFrom("log_entries")
    .select((eb) => eb.fn.countAll<number>().as("entries"))
    .where("log_type_id", "in", types)
    .executeTakeFirstOrThrow();
  return { types: types.length, entries };
}

/**
 * Deletes the type with every type below it (whose `parentTypeId` is it,
 * recursively), and all their fields, versions and entries. See
 * `previewLogTypeDeletion`.
 */
export async function deleteLogType(db: Database, id: string): Promise<void> {
  await transaction(db, async () => {
    await requireLogType(db, id);
    await queryBuilder(db).deleteFrom("log_types").where("id", "=", id).execute();
  });
}

// ---------------------------------------------------------------------------
// Entries

/**
 * Records an entry of an unarchived type, validating `values` against the
 * type's current version.
 *
 * A top-level entry needs `occurredAt`. With `day`, `month` or `year`
 * precision, `occurredAt` and `endedAt` are stored as the start of their day,
 * month or year in the entry's time zone, so any instant within it may be
 * given. `endedAt` must not fall before `occurredAt` once both are truncated.
 *
 * A child entry takes a `parentEntryId` instead, and no time: it inherits
 * its parent's. Its type's `parentTypeId` must be the parent's type, and only
 * such types can have child entries.
 */
export async function createLogEntry(db: Database, input: NewLogEntry): Promise<LogEntry> {
  const id = newId();
  const label = `Log entry ${id}`;
  const parentEntryId = input.parentEntryId ?? null;
  // Read before the transaction, as `createInterval` does. A child entry has no zone of its own.
  const timeZone =
    parentEntryId === null ? (input.timeZone ?? (await getTimeZone(db))) : input.timeZone;
  const source = input.source ?? MANUAL;
  if (!isNonEmptyString(source)) throw new Error(`${label}: a source is required`);
  const externalId = input.externalId ?? null;
  if (externalId !== null && !isNonEmptyString(externalId)) {
    throw new Error(`${label}: an external id must be a non-empty string`);
  }

  await transaction(db, async () => {
    const q = queryBuilder(db);
    const type = await requireOfferedLogType(db, input.logTypeId);
    let time: StoredTime = { occurred_at: null, ended_at: null, precision: null, time_zone: null };
    let position: number | null = null;

    if (parentEntryId === null) {
      if (type.parentTypeId !== null) {
        throw new Error(
          `${label}: log type ${type.id} is for child entries of log type ${type.parentTypeId}, so a parent entry is required`,
        );
      }
      if (input.position !== undefined) {
        throw new Error(`${label}: only a child entry has a position`);
      }
      if (input.occurredAt === undefined) throw new Error(`${label}: occurredAt is required`);
      time = normaliseTime(label, {
        occurredAt: input.occurredAt,
        endedAt: input.endedAt ?? null,
        precision: input.precision ?? "instant",
        timeZone: timeZone as string,
      });
    } else {
      if (
        input.occurredAt !== undefined ||
        (input.endedAt ?? null) !== null ||
        input.precision !== undefined ||
        timeZone !== undefined
      ) {
        throw new Error(`${label}: a child entry inherits its time from its parent entry`);
      }
      const parent = await q
        .selectFrom("log_entries")
        .select("log_type_id")
        .where("id", "=", parentEntryId)
        .executeTakeFirst();
      if (!parent) throw new Error(`${label}: parent entry ${parentEntryId} not found`);
      if (type.parentTypeId === null) {
        throw new Error(
          `${label}: log type ${type.id} has no parent type, so its entries cannot be child entries`,
        );
      }
      if (type.parentTypeId !== parent.log_type_id) {
        throw new Error(
          `${label}: log type ${type.id} is for child entries of log type ${type.parentTypeId}, ` +
            `but parent entry ${parentEntryId} is of log type ${parent.log_type_id}`,
        );
      }
      position = input.position ?? (await nextPosition(db, parentEntryId));
      if (!Number.isSafeInteger(position)) {
        throw new Error(`${label}: position must be an integer`);
      }
    }

    if (externalId !== null) {
      const clash = await q
        .selectFrom("log_entries")
        .select("id")
        .where("source", "=", source)
        .where("external_id", "=", externalId)
        .executeTakeFirst();
      if (clash) {
        throw new Error(
          `${label}: log entry ${clash.id} already has external id ${JSON.stringify(externalId)} from ${source}`,
        );
      }
    }

    const t = now();
    await q
      .insertInto("log_entries")
      .values({
        id,
        log_type_id: type.id,
        log_type_version: type.schemaVersion,
        ...time,
        parent_entry_id: parentEntryId,
        position,
        source,
        external_id: externalId,
        created_at: t,
        updated_at: t,
      })
      .execute();
    await setValues(
      db,
      LOG_TABLES,
      { id, typeId: type.id, typeVersion: type.schemaVersion },
      input.values ?? {},
      { writtenBy: input.writtenBy ?? source, writtenAt: t },
    );
  });
  return (await getLogEntry(db, id)) as LogEntry;
}

/** The entry with `id`, or `undefined`. */
export async function getLogEntry(db: Database, id: string): Promise<LogEntry | undefined> {
  const row = await queryBuilder(db)
    .selectFrom("log_entries")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  return row && (await toEntries(db, [row]))[0];
}

/**
 * The type's entries, latest first. `from` (inclusive) and `to` (exclusive)
 * bound the resolved `occurredAt`, so a child type's entries are found by their
 * parents' times. Siblings with the same time are listed by position.
 */
export async function listLogEntries(
  db: Database,
  logTypeId: string,
  options: { from?: Instant; to?: Instant } = {},
): Promise<LogEntry[]> {
  const { from, to } = options;
  let query = queryBuilder(db)
    .selectFrom("log_entries")
    .selectAll()
    .where("log_type_id", "=", logTypeId);
  // Top-level entries store their own time, so the index can narrow them.
  const type = await getLogType(db, logTypeId);
  if (type?.parentTypeId === null) {
    if (from !== undefined) query = query.where("occurred_at", ">=", from);
    if (to !== undefined) query = query.where("occurred_at", "<", to);
  }
  const entries = (await toEntries(db, await query.orderBy("id").execute())).filter(
    (e) =>
      (from === undefined || e.resolved.occurredAt >= from) &&
      (to === undefined || e.resolved.occurredAt < to),
  );
  return entries.sort(
    (a, b) =>
      b.resolved.occurredAt - a.resolved.occurredAt ||
      (a.position ?? 0) - (b.position ?? 0) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/** The entry's child entries by position. */
export async function listChildEntries(db: Database, parentEntryId: string): Promise<LogEntry[]> {
  const rows = await queryBuilder(db)
    .selectFrom("log_entries")
    .selectAll()
    .where("parent_entry_id", "=", parentEntryId)
    .orderBy("position")
    .orderBy("id")
    .execute();
  return toEntries(db, rows);
}

/**
 * Changes a top-level entry's time, normalised as by `createLogEntry` (a new
 * precision re-truncates the stored time), and writes `values` against the
 * entry's own version as `writtenBy`, returning the fields an automated writer
 * skipped. The time zone and source never change; a child entry's time is its
 * parent's.
 */
export async function updateLogEntry(
  db: Database,
  id: string,
  patch: LogEntryPatch,
): Promise<{ entry: LogEntry; skipped: string[] }> {
  const label = `Log entry ${id}`;
  const skipped = await transaction(db, async () => {
    const row = await requireEntry(db, id);
    const t = now();
    if (
      patch.occurredAt !== undefined ||
      patch.endedAt !== undefined ||
      patch.precision !== undefined
    ) {
      if (row.parent_entry_id !== null) {
        throw new Error(`${label}: a child entry inherits its time from its parent entry`);
      }
      const time = normaliseTime(label, {
        occurredAt: patch.occurredAt ?? (row.occurred_at as Instant),
        endedAt: patch.endedAt === undefined ? row.ended_at : patch.endedAt,
        precision: patch.precision ?? (row.precision as Precision),
        timeZone: row.time_zone as string,
      });
      await queryBuilder(db)
        .updateTable("log_entries")
        .set({ ...time, updated_at: t })
        .where("id", "=", id)
        .execute();
    }
    if (patch.values === undefined) return [];
    const record = { id, typeId: row.log_type_id, typeVersion: row.log_type_version };
    const result = await setValues(db, LOG_TABLES, record, patch.values, {
      writtenBy: patch.writtenBy ?? MANUAL,
      writtenAt: t,
    });
    return result.skipped;
  });
  return { entry: (await getLogEntry(db, id)) as LogEntry, skipped };
}

/**
 * Moves a child entry to `position` (1 = first) among its siblings, and
 * renumbers them 1, 2, 3, ...
 */
export async function moveChildEntry(db: Database, id: string, position: number): Promise<void> {
  await transaction(db, async () => {
    const q = queryBuilder(db);
    const row = await requireEntry(db, id);
    if (row.parent_entry_id === null) throw new Error(`Log entry ${id}: not a child entry`);
    const siblings = await q
      .selectFrom("log_entries")
      .select(["id", "position"])
      .where("parent_entry_id", "=", row.parent_entry_id)
      .orderBy("position")
      .orderBy("id")
      .execute();
    if (!Number.isSafeInteger(position) || position < 1 || position > siblings.length) {
      throw new Error(`Log entry ${id}: position must be between 1 and ${siblings.length}`);
    }
    const order = siblings.filter((s) => s.id !== id);
    order.splice(position - 1, 0, { id, position: row.position });
    const t = now();
    for (const [i, sibling] of order.entries()) {
      if (sibling.position === i + 1) continue;
      await q
        .updateTable("log_entries")
        .set({ position: i + 1, updated_at: t })
        .where("id", "=", sibling.id)
        .execute();
    }
  });
}

/** What `deleteLogEntry` would delete with the entry, for the user to confirm. */
export async function previewLogEntryDeletion(
  db: Database,
  id: string,
): Promise<{ childEntries: number }> {
  await requireEntry(db, id);
  const entries = await tree(id, async (parents) =>
    (
      await queryBuilder(db)
        .selectFrom("log_entries")
        .select("id")
        .where("parent_entry_id", "in", parents)
        .execute()
    ).map((r) => r.id),
  );
  return { childEntries: entries.length - 1 };
}

/**
 * Deletes the entry with its child entries, recursively. A child entry can be
 * deleted alone. See `previewLogEntryDeletion`.
 */
export async function deleteLogEntry(db: Database, id: string): Promise<void> {
  await transaction(db, async () => {
    await requireEntry(db, id);
    await queryBuilder(db).deleteFrom("log_entries").where("id", "=", id).execute();
  });
}

// ---------------------------------------------------------------------------
// Days

/** The day an entry at `time` belongs to, or `null` for `month` and `year` precision. */
export function entryDay(time: EntryTime): LocalDate | null {
  return dayOfEntry(time.occurredAt, time.precision, time.timeZone);
}

// ---------------------------------------------------------------------------
// Internals

type StoredTime = Pick<EntryRow, "occurred_at" | "ended_at" | "precision" | "time_zone">;

/** A top-level entry's time as stored: validated, and truncated to its precision. */
function normaliseTime(
  label: string,
  input: { occurredAt: Instant; endedAt: Instant | null; precision: Precision; timeZone: string },
): StoredTime {
  const { precision, timeZone } = input;
  if (!PRECISIONS.includes(precision)) {
    throw new Error(`${label}: precision must be one of ${PRECISIONS.join(", ")}`);
  }
  if (!isTimeZone(timeZone)) {
    throw new Error(`${label}: invalid time zone ${JSON.stringify(timeZone)}`);
  }
  if (!isRepresentable(input.occurredAt)) {
    throw new Error(`${label}: invalid occurredAt ${input.occurredAt}`);
  }
  if (input.endedAt !== null && !isRepresentable(input.endedAt)) {
    throw new Error(`${label}: invalid endedAt ${input.endedAt}`);
  }
  const occurredAt = truncateToPrecision(input.occurredAt, precision, timeZone);
  const endedAt =
    input.endedAt === null ? null : truncateToPrecision(input.endedAt, precision, timeZone);
  if (endedAt !== null && endedAt < occurredAt) {
    throw new Error(`${label}: must not end before it occurs`);
  }
  return { occurred_at: occurredAt, ended_at: endedAt, precision, time_zone: timeZone };
}

/** An integer instant within the years 0000-9999, which export can write. */
function isRepresentable(instant: unknown): instant is Instant {
  if (!isInstant(instant)) return false;
  try {
    instantToIso(instant);
    return true;
  } catch {
    return false;
  }
}

/** After every sibling. */
async function nextPosition(db: Database, parentEntryId: string): Promise<number> {
  const { last } = await queryBuilder(db)
    .selectFrom("log_entries")
    .select((eb) => eb.fn.max<number | null>("position").as("last"))
    .where("parent_entry_id", "=", parentEntryId)
    .executeTakeFirstOrThrow();
  return (last ?? 0) + 1;
}

/** `rootId` and everything below it, level by level, as listed by `childrenOf`. */
async function tree(
  rootId: string,
  childrenOf: (parentIds: string[]) => Promise<string[]>,
): Promise<string[]> {
  const ids = [rootId];
  for (let level = [rootId]; level.length > 0; ) {
    level = (await childrenOf(level)).filter((id) => !ids.includes(id));
    ids.push(...level);
  }
  return ids;
}

async function requireLogType(db: Database, id: string): Promise<LogType> {
  const type = await getLogType(db, id);
  if (!type) throw new Error(`Log type ${id}: not found`);
  return type;
}

/** An unarchived type: one offered for new entries. */
async function requireOfferedLogType(db: Database, id: string): Promise<LogType> {
  const type = await requireLogType(db, id);
  if (type.archivedAt !== null) throw new Error(`Log type ${id}: archived`);
  return type;
}

async function requireEntry(db: Database, id: string): Promise<EntryRow> {
  const row = await queryBuilder(db)
    .selectFrom("log_entries")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  if (!row) throw new Error(`Log entry ${id}: not found`);
  return row;
}

function toLogType(row: LogTypeRow): LogType {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    parentTypeId: row.parent_type_id,
    schemaVersion: row.schema_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}

/**
 * The entries in `rows`, in order, with their values, resolved time and day.
 * Ancestors are read as needed.
 */
async function toEntries(db: Database, rows: readonly EntryRow[]): Promise<LogEntry[]> {
  const known = new Map(rows.map((r) => [r.id, r]));
  for (let missing = parentIdsMissing(known); missing.length > 0; ) {
    const parents = await queryBuilder(db)
      .selectFrom("log_entries")
      .selectAll()
      .where("id", "in", missing)
      .execute();
    for (const parent of parents) known.set(parent.id, parent);
    const next = parentIdsMissing(known);
    if (next.some((id) => missing.includes(id))) {
      throw new Error(`Log entry ${next[0]}: not found, but has child entries`);
    }
    missing = next;
  }

  const placed = new Map<string, { resolved: EntryTime; day: LocalDate | null }>();
  const place = (row: EntryRow, path: readonly string[] = []) => {
    const done = placed.get(row.id);
    if (done) return done;
    if (path.includes(row.id)) throw new Error(`Log entry ${row.id}: is its own ancestor`);
    const own = ownTime(row);
    let placement: { resolved: EntryTime; day: LocalDate | null };
    if (row.parent_entry_id === null) {
      if (own === null) throw new Error(`Log entry ${row.id}: has no time`);
      placement = { resolved: own, day: entryDay(own) };
    } else {
      const parent = place(known.get(row.parent_entry_id) as EntryRow, [...path, row.id]);
      // A child always belongs to its parent's day, even with a time of its own.
      placement = { resolved: own ?? parent.resolved, day: parent.day };
    }
    placed.set(row.id, placement);
    return placement;
  };

  const entries: LogEntry[] = [];
  for (const row of rows) {
    const record = { id: row.id, typeId: row.log_type_id, typeVersion: row.log_type_version };
    entries.push({
      id: row.id,
      logTypeId: row.log_type_id,
      logTypeVersion: row.log_type_version,
      occurredAt: row.occurred_at,
      endedAt: row.ended_at,
      precision: row.precision as Precision | null,
      timeZone: row.time_zone,
      parentEntryId: row.parent_entry_id,
      position: row.position,
      source: row.source,
      externalId: row.external_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      ...place(row),
      values: await readValues(db, LOG_TABLES, record),
    });
  }
  return entries;
}

function parentIdsMissing(known: ReadonlyMap<string, EntryRow>): string[] {
  const ids = new Set<string>();
  for (const row of known.values()) {
    if (row.parent_entry_id !== null && !known.has(row.parent_entry_id)) {
      ids.add(row.parent_entry_id);
    }
  }
  return [...ids];
}

/** The row's own time, or `null` for a child entry that inherits its parent's. */
function ownTime(row: EntryRow): EntryTime | null {
  if (row.occurred_at === null || row.precision === null || row.time_zone === null) return null;
  if (!PRECISIONS.includes(row.precision as Precision)) {
    throw new Error(`Log entry ${row.id}: unknown precision ${JSON.stringify(row.precision)}`);
  }
  return {
    occurredAt: row.occurred_at,
    precision: row.precision as Precision,
    timeZone: row.time_zone,
  };
}
