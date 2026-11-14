import { useDatabase } from "@platform/DatabaseProvider";
import {
  addLogField,
  createLogEntry,
  createLogType,
  type Database,
  deleteLogEntry,
  deleteLogField,
  deleteLogType,
  type FieldPatch,
  getLogTypeFields,
  type LocalDate,
  type LogField,
  listChildEntries,
  listDayLogEntries,
  listLogEntries,
  listLogTypes,
  moveChildEntry,
  type NewLogEntry,
  type NewLogField,
  reorderLogFields,
  setLogTypeArchived,
  updateLogField,
} from "@spoor/core";
import { keepPreviousData, queryOptions, useQuery } from "@tanstack/react-query";
import { queryKeys } from "./queryKeys";
import type { ReadOptions } from "./readResult";
import { useDbWrite } from "./useDbWrite";

/**
 * The log reads. Each keeps its key with its query, so `.queryKey` types the
 * cache by its data.
 */
export const logQueries = {
  /** Every log type by name, archived included. */
  types: (db: Database) =>
    queryOptions({ queryKey: queryKeys.logTypes.list, queryFn: () => listLogTypes(db) }),
  /** A log type's fields, by position. */
  fields: (db: Database, typeId: string) =>
    queryOptions({
      queryKey: queryKeys.logTypes.fields(typeId),
      queryFn: () => getLogTypeFields(db, typeId),
    }),
  /** A log type's entries, latest first. */
  entries: (db: Database, logTypeId: string) =>
    queryOptions({
      queryKey: queryKeys.logs.type(logTypeId),
      queryFn: () => listLogEntries(db, logTypeId),
    }),
  /** An entry's child entries, by position. */
  children: (db: Database, parentEntryId: string) =>
    queryOptions({
      queryKey: queryKeys.logs.children(parentEntryId),
      queryFn: () => listChildEntries(db, parentEntryId),
    }),
  /** A day's top-level entries by log type, with child entries nested. */
  day: (db: Database, day: LocalDate) =>
    queryOptions({ queryKey: queryKeys.logs.day(day), queryFn: () => listDayLogEntries(db, day) }),
};

/**
 * Every log type by name, archived included: the same list Home's new-log
 * modal offers. With `enabled: false` it waits, as the modal does until it
 * first opens.
 */
export function useLogTypes({ enabled = true }: ReadOptions = {}) {
  const db = useDatabase();
  return useQuery({ ...logQueries.types(db), enabled });
}

/**
 * The one empty list of fields, for a caller to show until a type's fields
 * load. A new [] each render would re-run effects and memos that depend on it.
 */
export const EMPTY_FIELDS: LogField[] = [];

/**
 * The fields of a log type. Cached per type, so every row of one type shares
 * one query; writes to log types invalidate them.
 */
export function useFields(typeId: string) {
  const db = useDatabase();
  return useQuery(logQueries.fields(db, typeId));
}

/** A log type's entries, latest first. */
export function useLogEntries(logTypeId: string) {
  const db = useDatabase();
  return useQuery(logQueries.entries(db, logTypeId));
}

/** An entry's child entries, by position. */
export function useChildEntries(parentEntryId: string) {
  const db = useDatabase();
  return useQuery(logQueries.children(db, parentEntryId));
}

/**
 * The rail's logs for `day`: its top-level entries by log type, with child
 * entries nested. While another day loads, the previous day's stay
 * (`isPlaceholderData` is then true). Creating an entry invalidates them.
 */
export function useDayLogs(day: LocalDate) {
  const db = useDatabase();
  return useQuery({ ...logQueries.day(db, day), placeholderData: keepPreviousData });
}

// Writes to log types and their fields. Each invalidates the types and their
// fields, which sit under `logTypes.all`.

/** Creates a log type, with its fields. */
export function useCreateLogType() {
  return useDbWrite((db, input: Parameters<typeof createLogType>[1]) => createLogType(db, input), {
    invalidates: [queryKeys.logTypes.all],
  });
}

/**
 * Archives or unarchives a log type. It also invalidates the logs, since
 * Home's day lists embed each type's record.
 */
export function useSetLogTypeArchived() {
  return useDbWrite(
    (db, { id, archived }: { id: string; archived: boolean }) =>
      setLogTypeArchived(db, id, archived),
    { invalidates: [queryKeys.logTypes.all, queryKeys.logs.all] },
  );
}

/**
 * Deletes a log type. It also invalidates the logs, since it deletes the
 * type's entries and its child types'.
 */
export function useDeleteLogType() {
  return useDbWrite((db, id: string) => deleteLogType(db, id), {
    invalidates: [queryKeys.logTypes.all, queryKeys.logs.all],
  });
}

/** Adds a field after `logTypeId`'s others. */
export function useAddLogField(logTypeId: string) {
  return useDbWrite((db, field: NewLogField) => addLogField(db, logTypeId, field), {
    invalidates: [queryKeys.logTypes.all],
  });
}

/** Changes a field; see core's `FieldPatch`. */
export function useUpdateLogField() {
  return useDbWrite(
    (db, { fieldId, patch }: { fieldId: string; patch: FieldPatch }) =>
      updateLogField(db, fieldId, patch),
    { invalidates: [queryKeys.logTypes.all] },
  );
}

/** Puts `logTypeId`'s fields in the order of `fieldIds`. */
export function useReorderLogFields(logTypeId: string) {
  return useDbWrite(
    (db, fieldIds: readonly string[]) => reorderLogFields(db, logTypeId, fieldIds),
    { invalidates: [queryKeys.logTypes.all] },
  );
}

/**
 * Deletes a field. It also invalidates the logs, since it deletes the field's
 * values.
 */
export function useDeleteLogField() {
  return useDbWrite((db, fieldId: string) => deleteLogField(db, fieldId), {
    invalidates: [queryKeys.logTypes.all, queryKeys.logs.all],
  });
}

// Writes to log entries. Each invalidates the logs: a type's entries, child
// entries and Home's day lists all sit under `logs.all`.

/** Records an entry, top-level or inside a parent entry. */
export function useCreateLogEntry() {
  return useDbWrite((db, input: NewLogEntry) => createLogEntry(db, input), {
    invalidates: [queryKeys.logs.all],
  });
}

/** Moves a child entry to `position` among its siblings. */
export function useMoveChildEntry() {
  return useDbWrite(
    (db, { id, position }: { id: string; position: number }) => moveChildEntry(db, id, position),
    { invalidates: [queryKeys.logs.all] },
  );
}

/** Deletes an entry with its child entries. */
export function useDeleteLogEntry() {
  return useDbWrite((db, id: string) => deleteLogEntry(db, id), {
    invalidates: [queryKeys.logs.all],
  });
}
