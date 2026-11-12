import { queryKeys } from "@lib/queryKeys";
import {
  addLogField,
  createLogEntry,
  createLogType,
  type Database,
  deleteLogEntry,
  deleteLogField,
  deleteLogType,
  type FieldPatch,
  listChildEntries,
  listLogEntries,
  listLogTypes,
  moveChildEntry,
  type NewLogEntry,
  type NewLogField,
  reorderLogFields,
  setLogTypeArchived,
  updateLogField,
} from "@spoor/core";
import { type QueryKey, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

/** Every log type by name, archived included: the same list Home's new-log modal offers. */
export function useLogTypes(db: Database) {
  return useQuery({ queryKey: queryKeys.logTypes.list, queryFn: () => listLogTypes(db) });
}

/** A log type's entries, latest first. */
export function useLogEntries(db: Database, logTypeId: string) {
  return useQuery({
    queryKey: queryKeys.logs.type(logTypeId),
    queryFn: () => listLogEntries(db, logTypeId),
  });
}

/** An entry's child entries, by position. */
export function useChildEntries(db: Database, parentEntryId: string) {
  return useQuery({
    queryKey: queryKeys.logs.children(parentEntryId),
    queryFn: () => listChildEntries(db, parentEntryId),
  });
}

/**
 * Invalidates `keys` once a write succeeds. The returned promise settles after
 * the shown queries refetch, so a write's caller sees the new data.
 */
function useInvalidate() {
  const queryClient = useQueryClient();
  return (...keys: QueryKey[]) =>
    () =>
      Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
}

/**
 * Writes to log types. Each invalidates the types and their fields. Archiving
 * also invalidates the logs, since Home's day lists embed each type's record,
 * and deleting does, since it deletes the type's entries and its child types'.
 */
export function useLogTypeWrites(db: Database) {
  const invalidate = useInvalidate();
  return {
    create: useMutation({
      mutationFn: (input: Parameters<typeof createLogType>[1]) => createLogType(db, input),
      onSuccess: invalidate(queryKeys.logTypes.all),
    }).mutateAsync,
    setArchived: useMutation({
      mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
        setLogTypeArchived(db, id, archived),
      onSuccess: invalidate(queryKeys.logTypes.all, queryKeys.logs.all),
    }).mutateAsync,
    remove: useMutation({
      mutationFn: (id: string) => deleteLogType(db, id),
      onSuccess: invalidate(queryKeys.logTypes.all, queryKeys.logs.all),
    }).mutateAsync,
  };
}

/**
 * Writes to one log type's fields. Each invalidates the log types; deleting a
 * field also invalidates the logs, since it deletes the field's values.
 */
export function useLogFieldWrites(db: Database, logTypeId: string) {
  const invalidate = useInvalidate();
  return {
    add: useMutation({
      mutationFn: (field: NewLogField) => addLogField(db, logTypeId, field),
      onSuccess: invalidate(queryKeys.logTypes.all),
    }).mutateAsync,
    update: useMutation({
      mutationFn: ({ fieldId, patch }: { fieldId: string; patch: FieldPatch }) =>
        updateLogField(db, fieldId, patch),
      onSuccess: invalidate(queryKeys.logTypes.all),
    }).mutateAsync,
    reorder: useMutation({
      mutationFn: (fieldIds: readonly string[]) => reorderLogFields(db, logTypeId, fieldIds),
      onSuccess: invalidate(queryKeys.logTypes.all),
    }).mutateAsync,
    remove: useMutation({
      mutationFn: (fieldId: string) => deleteLogField(db, fieldId),
      onSuccess: invalidate(queryKeys.logTypes.all, queryKeys.logs.all),
    }).mutateAsync,
  };
}

/**
 * Writes to log entries. Each invalidates the logs: a type's entries, child
 * entries and Home's day lists all sit under `logs.all`.
 */
export function useLogEntryWrites(db: Database) {
  const invalidate = useInvalidate();
  return {
    create: useMutation({
      mutationFn: (input: NewLogEntry) => createLogEntry(db, input),
      onSuccess: invalidate(queryKeys.logs.all),
    }).mutateAsync,
    move: useMutation({
      mutationFn: ({ id, position }: { id: string; position: number }) =>
        moveChildEntry(db, id, position),
      onSuccess: invalidate(queryKeys.logs.all),
    }).mutateAsync,
    remove: useMutation({
      mutationFn: (id: string) => deleteLogEntry(db, id),
      onSuccess: invalidate(queryKeys.logs.all),
    }).mutateAsync,
  };
}
