import { queryKeys } from "@lib/queryKeys";
import {
  type Database,
  getLogTypeFields,
  getThingTitle,
  type LogEntry,
  type LogField,
  listThings,
  listThingTypes,
  type ThingType,
} from "@spoor/core";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

// One empty list for every caller: a new [] each render would re-run effects that depend on it.
const NO_FIELDS: LogField[] = [];

/**
 * The fields of a log type, empty until they load. Cached per type, so every
 * row of one type shares one query; writes to log types invalidate them.
 */
export function useFields(db: Database, typeId: string): LogField[] {
  const { data } = useQuery({
    queryKey: queryKeys.logTypes.fields(typeId),
    queryFn: () => getLogTypeFields(db, typeId),
  });
  return data ?? NO_FIELDS;
}

/** Thing types a `ref` field can target: live and unarchived. */
export function useThingTypes(db: Database) {
  const [types, setTypes] = useState<ThingType[]>([]);
  useEffect(() => {
    listThingTypes(db).then((all) => setTypes(all.filter((t) => t.archivedAt === null)));
  }, [db]);
  return types;
}

/** The live things of a type, by title, to pick from. */
export function useThings(db: Database, thingTypeId: string | null) {
  const [things, setThings] = useState<{ id: string; title: string }[]>([]);
  useEffect(() => {
    if (thingTypeId === null) return;
    listThings(db, thingTypeId)
      .then((list) =>
        Promise.all(
          list.map(async (t) => ({ id: t.id, title: (await getThingTitle(db, t.id)) ?? t.id })),
        ),
      )
      .then(setThings);
  }, [db, thingTypeId]);
  return things;
}

/** The titles of the things an entry refers to. */
export function useRefTitles(db: Database, fields: LogField[], entry: LogEntry) {
  const [titles, setTitles] = useState(new Map<string, string>());
  useEffect(() => {
    const ids = fields.flatMap((f) => {
      const value = entry.values[f.id];
      if (f.shape.valueType === "ref") return [value as string];
      if (f.shape.valueType === "multi_ref") return value as string[];
      return [];
    });
    Promise.all(
      ids.filter(Boolean).map(async (id) => [id, (await getThingTitle(db, id)) ?? id] as const),
    ).then((pairs) => setTitles(new Map(pairs)));
  }, [db, fields, entry]);
  return titles;
}
