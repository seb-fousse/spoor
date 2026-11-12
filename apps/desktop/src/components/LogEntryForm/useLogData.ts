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
import { useEffect, useState } from "react";

/** The fields of a log type, reloaded when `reload` changes. */
export function useFields(db: Database, typeId: string, reload: number) {
  const [fields, setFields] = useState<LogField[]>([]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `reload` triggers the reload.
  useEffect(() => {
    getLogTypeFields(db, typeId).then(setFields);
  }, [db, typeId, reload]);
  return fields;
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
