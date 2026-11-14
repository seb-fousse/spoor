import { useDatabase } from "@platform/DatabaseProvider";
import {
  type Database,
  type FieldDefinition,
  getThingTitle,
  listThings,
  listThingTypes,
  type ThingType,
  type Value,
} from "@spoor/core";
import { keepPreviousData, type QueryKey, queryOptions, useQuery } from "@tanstack/react-query";
import { queryKeys } from "./queryKeys";
import { useDbWrite } from "./useDbWrite";

/**
 * The thing reads. Each keeps its key with its query, so `.queryKey` types the
 * cache by its data.
 */
export const thingQueries = {
  /** Every thing type, archived ones too. */
  types: (db: Database) =>
    queryOptions({ queryKey: queryKeys.things.types, queryFn: () => listThingTypes(db) }),
  /** A thing type's live things, by title, to pick from. */
  options: (db: Database, thingTypeId: string) =>
    queryOptions({
      queryKey: queryKeys.things.options(thingTypeId),
      queryFn: async () => {
        const things = await listThings(db, thingTypeId);
        return Promise.all(
          things.map(async (t) => ({ id: t.id, title: (await getThingTitle(db, t.id)) ?? t.id })),
        );
      },
    }),
  /** The titles of the things `ids` names, by id. A thing without a title is left out. */
  titles: (db: Database, ids: readonly string[]) =>
    queryOptions({
      queryKey: queryKeys.things.titles(ids),
      queryFn: async () => {
        const pairs = await Promise.all(
          ids.map(async (id) => [id, await getThingTitle(db, id)] as const),
        );
        return new Map(pairs.filter((p): p is [string, string] => p[1] !== undefined));
      },
    }),
};

// One empty value per read, for a caller to show until it loads. A new one
// each render would re-run effects and memos that depend on it.
export const EMPTY_THING_TYPES: ThingType[] = [];
export const EMPTY_THINGS: { id: string; title: string }[] = [];
export const EMPTY_TITLES: Map<string, string> = new Map();

/** Thing types a `ref` field can target: live and unarchived. */
export function useThingTypes() {
  const db = useDatabase();
  return useQuery({ ...thingQueries.types(db), select: unarchived });
}

// Module-level, so the selection is only redone when the types change.
const unarchived = (types: ThingType[]) => types.filter((t) => t.archivedAt === null);

/** The live things of a type, by title, to pick from. Waits while there is no type. */
export function useThings(thingTypeId: string | null) {
  const db = useDatabase();
  return useQuery({
    ...thingQueries.options(db, thingTypeId ?? ""),
    enabled: thingTypeId !== null,
  });
}

/**
 * The titles of the things a log entry or thing refers to, by id. A thing
 * without a title is left out, so callers show its id instead.
 */
export function useRefTitles(fields: FieldDefinition[], record: { values: Record<string, Value> }) {
  const db = useDatabase();
  // A new array on every render, which is fine: the query's key is hashed by
  // value, so the same ids stay the same query.
  const ids = fields
    .flatMap((f) => {
      const value = record.values[f.id];
      if (f.shape.valueType === "ref") return [value as string];
      if (f.shape.valueType === "multi_ref") return value as string[];
      return [];
    })
    .filter(Boolean);
  return useQuery({
    ...thingQueries.titles(db, ids),
    // Keeps the old titles while edited values' titles load, rather than flashing ids.
    placeholderData: keepPreviousData,
  });
}

/**
 * What a write to thing data changes beyond it, so the screens showing that
 * refresh too:
 *
 * - `"things"`: only thing data: types, fields, things and their titles.
 * - `"titles"`: also timeline categories, which core renames to follow their
 *   thing's title (`updateThingValues`).
 * - `"references"`: also every log entry and timeline category referring to
 *   the things. Deleting a thing removes refs to it from log entries and
 *   unlinks its categories; merging repoints both and moves intervals.
 */
export type ThingWriteReach = "things" | "titles" | "references";

const INVALIDATES: Record<ThingWriteReach, QueryKey[]> = {
  things: [queryKeys.things.all],
  titles: [queryKeys.things.all, queryKeys.timelines.all],
  references: [queryKeys.things.all, queryKeys.logs.all, queryKeys.timelines.all],
};

/**
 * Runs a write to thing data, then invalidates what it changed, per `reach`.
 * Resolves or rejects with the write. One mutation serves every write: they
 * differ only in what they invalidate.
 */
export function useThingWrite() {
  // The page's actions already hold the database.
  const { mutateAsync } = useDbWrite(
    (_db, { action }: { action: () => Promise<unknown>; reach: ThingWriteReach }) => action(),
    { invalidates: (_, { reach }) => INVALIDATES[reach] },
  );
  return (action: () => Promise<unknown>, reach: ThingWriteReach = "things") =>
    mutateAsync({ action, reach });
}
