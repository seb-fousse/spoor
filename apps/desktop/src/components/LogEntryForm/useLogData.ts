import { queryKeys } from "@lib/queryKeys";
import { useDatabase } from "@platform/DatabaseProvider";
import {
  type FieldDefinition,
  getLogTypeFields,
  getThingTitle,
  type LogField,
  listThings,
  listThingTypes,
  type ThingType,
  type Value,
} from "@spoor/core";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

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

/** Thing types a `ref` field can target: live and unarchived. */
export function useThingTypes(): ThingType[] {
  const db = useDatabase();
  const { data } = useQuery({
    queryKey: queryKeys.things.types,
    queryFn: () => listThingTypes(db),
    select: unarchived,
  });
  return data ?? NO_TYPES;
}

const NO_TYPES: ThingType[] = [];
// Module-level, so the selection is only redone when the types change.
const unarchived = (types: ThingType[]) => types.filter((t) => t.archivedAt === null);

/** The live things of a type, by title, to pick from. */
export function useThings(thingTypeId: string | null) {
  const db = useDatabase();
  const { data } = useQuery({
    queryKey: queryKeys.things.options(thingTypeId ?? ""),
    queryFn: async () => {
      const things = await listThings(db, thingTypeId as string);
      return Promise.all(
        things.map(async (t) => ({ id: t.id, title: (await getThingTitle(db, t.id)) ?? t.id })),
      );
    },
    enabled: thingTypeId !== null,
  });
  return data ?? NO_THINGS;
}

const NO_THINGS: { id: string; title: string }[] = [];

/**
 * The titles of the things a log entry or thing refers to, by id. A thing
 * without a title is left out, so callers show its id instead.
 */
export function useRefTitles(
  fields: FieldDefinition[],
  record: { values: Record<string, Value> },
): Map<string, string> {
  const db = useDatabase();
  const ids = fields
    .flatMap((f) => {
      const value = record.values[f.id];
      if (f.shape.valueType === "ref") return [value as string];
      if (f.shape.valueType === "multi_ref") return value as string[];
      return [];
    })
    .filter(Boolean);
  const { data } = useQuery({
    queryKey: queryKeys.things.titles(ids),
    queryFn: async () => {
      const pairs = await Promise.all(
        ids.map(async (id) => [id, await getThingTitle(db, id)] as const),
      );
      return new Map(pairs.filter((p): p is [string, string] => p[1] !== undefined));
    },
    // Keeps the old titles while edited values' titles load, rather than flashing ids.
    placeholderData: keepPreviousData,
  });
  return data ?? NO_TITLES;
}

const NO_TITLES = new Map<string, string>();
