import type { Selectable } from "kysely";
import type { Database } from "../db/platform";
import { queryBuilder } from "../db/query";
import type { DB } from "../db/schema/tables";
import { transaction } from "../db/transaction";
import { MANUAL, readValues, setValues, type ValuePatch } from "../definitions/engine";
import { LOG_TABLES } from "../definitions/tables";
import {
  dayOf,
  dayOfEntry,
  daysSpanned,
  isTimeZone,
  type Precision,
  startOfDay,
  truncateToPrecision,
} from "../lib/days";
import { isNonEmptyString } from "../lib/guards";
import { newId } from "../lib/ids";
import {
  addDays,
  type Instant,
  instantToIso,
  isInstant,
  isLocalDate,
  type LocalDate,
  now,
} from "../lib/time";
import { tree } from "../lib/tree";
import { getTimeZone } from "../settings/settings";
import type { Value } from "../values/values";

import { getLogType, type LogType, listLogTypes, requireOfferedLogType } from "./log-types";

/**
 * Log entries (see docs/data-spec.md § 3. Logs): entries holding values for a log
 * type, at a point in time or over a period.
 *
 * Fields and values go through `definitions/engine.ts`, shared with things.
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

type EntryRow = Selectable<DB["log_entries"]>;

// ---------------------------------------------------------------------------
// Entries

/**
 * Records an entry of an unarchived type, validating `values` against the
 * type's fields.
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
        ...time,
        parent_entry_id: parentEntryId,
        position,
        source,
        external_id: externalId,
        created_at: t,
        updated_at: t,
      })
      .execute();
    await setValues(db, LOG_TABLES, { id, typeId: type.id }, input.values ?? {}, {
      writtenBy: input.writtenBy ?? source,
      writtenAt: t,
    });
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

/** A top-level entry with its child entries, by position. */
export interface DayLogEntry extends LogEntry {
  children: LogEntry[];
}

/** One log type's entries on a day. */
export interface DayLogGroup {
  logType: LogType;
  entries: DayLogEntry[];
}

/**
 * The top-level entries on `date`, grouped by type in `listLogTypes` order
 * (types without entries left out), earliest first, children nested. An entry
 * is on the days it covers in its own time zone; `month` and `year` entries are
 * on no day.
 */
export async function listDayLogEntries(db: Database, date: LocalDate): Promise<DayLogGroup[]> {
  if (!isLocalDate(date)) throw new Error(`Invalid date ${JSON.stringify(date)}`);
  // Stored zones vary, so narrow by a day either side in UTC and decide exactly below.
  const lower = startOfDay(addDays(date, -1), "UTC");
  const upper = startOfDay(addDays(date, 2), "UTC");
  const q = queryBuilder(db);
  const rows = await q
    .selectFrom("log_entries")
    .selectAll()
    .where("parent_entry_id", "is", null)
    .where("precision", "in", ["instant", "day"])
    .where("occurred_at", "<", upper)
    .where((eb) => eb(eb.fn.coalesce("ended_at", "occurred_at"), ">=", lower))
    .execute();
  const entries = (await toEntries(db, rows)).filter((e) => isOnDay(e, date));
  if (entries.length === 0) return [];

  const childRows = await q
    .selectFrom("log_entries")
    .selectAll()
    .where(
      "parent_entry_id",
      "in",
      entries.map((e) => e.id),
    )
    .execute();
  const children = new Map<string, LogEntry[]>();
  for (const child of await toEntries(db, childRows)) {
    const parentId = child.parentEntryId as string;
    children.set(parentId, [...(children.get(parentId) ?? []), child]);
  }
  for (const list of children.values()) {
    list.sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || compareIds(a.id, b.id));
  }

  entries.sort((a, b) => a.resolved.occurredAt - b.resolved.occurredAt || compareIds(a.id, b.id));
  const byType = new Map<string, DayLogEntry[]>();
  for (const entry of entries) {
    const list = byType.get(entry.logTypeId) ?? [];
    list.push({ ...entry, children: children.get(entry.id) ?? [] });
    byType.set(entry.logTypeId, list);
  }
  return (await listLogTypes(db))
    .filter((t) => byType.has(t.id))
    .map((logType) => ({ logType, entries: byType.get(logType.id) as DayLogEntry[] }));
}

/** True when a top-level entry covers `date` in its own time zone. */
function isOnDay(entry: LogEntry, date: LocalDate): boolean {
  const { occurredAt, precision, timeZone } = entry.resolved;
  if (entryDay(entry.resolved) === null) return false;
  let end = entry.endedAt ?? occurredAt;
  // A day-precision end is the start of its last day, which it covers.
  if (precision === "day" && entry.endedAt !== null) {
    end = startOfDay(addDays(dayOf(end, timeZone), 1), timeZone);
  }
  return daysSpanned(occurredAt, end, timeZone).includes(date);
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
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
 * precision re-truncates the stored time), and writes `values` against its
 * type's fields as `writtenBy`, returning the fields an automated writer
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
    const record = { id, typeId: row.log_type_id };
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

async function requireEntry(db: Database, id: string): Promise<EntryRow> {
  const row = await queryBuilder(db)
    .selectFrom("log_entries")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  if (!row) throw new Error(`Log entry ${id}: not found`);
  return row;
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
    const record = { id: row.id, typeId: row.log_type_id };
    entries.push({
      id: row.id,
      logTypeId: row.log_type_id,
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
