import { useDatabase } from "@platform/DatabaseProvider";
import {
  addLogField,
  createLogEntry,
  createLogType,
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
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { queryKeys } from "./queryKeys";
import { useDbWrite } from "./useDbWrite";

/** Every log type by name, archived included: the same list Home's new-log modal offers. */
export function useLogTypes() {
  const db = useDatabase();
  return useQuery({ queryKey: queryKeys.logTypes.list, queryFn: () => listLogTypes(db) });
}

// One empty list for every caller: a new [] each render would re-run effects that depend on it.
const NO_FIELDS: LogField[] = [];

/**
 * The fields of a log type, empty until they load. Cached per type, so every
 * row of one type shares one query; writes to log types invalidate them.
 */
export function useFields(typeId: string): LogField[] {
  const db = useDatabase();
  const { data } = useQuery({
    queryKey: queryKeys.logTypes.fields(typeId),
    queryFn: () => getLogTypeFields(db, typeId),
  });
  return data ?? NO_FIELDS;
}

/** A log type's entries, latest first. */
export function useLogEntries(logTypeId: string) {
  const db = useDatabase();
  return useQuery({
    queryKey: queryKeys.logs.type(logTypeId),
    queryFn: () => listLogEntries(db, logTypeId),
  });
}

/** An entry's child entries, by position. */
export function useChildEntries(parentEntryId: string) {
  const db = useDatabase();
  return useQuery({
    queryKey: queryKeys.logs.children(parentEntryId),
    queryFn: () => listChildEntries(db, parentEntryId),
  });
}

/**
 * The rail's logs for `day`: its top-level entries by log type, with child
 * entries nested. While another day loads, the previous day's stay
 * (`isPlaceholderData` is then true). Creating an entry invalidates them.
 */
export function useDayLogs(day: LocalDate) {
  const db = useDatabase();
  return useQuery({
    queryKey: queryKeys.logs.day(day),
    queryFn: () => listDayLogEntries(db, day),
    placeholderData: keepPreviousData,
  });
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
