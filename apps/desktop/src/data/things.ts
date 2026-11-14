import { useDatabase } from "@platform/DatabaseProvider";
import {
  type FieldDefinition,
  getThingTitle,
  listThings,
  listThingTypes,
  type ThingType,
  type Value,
} from "@spoor/core";
import {
  keepPreviousData,
  type QueryKey,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { queryKeys } from "./queryKeys";

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

// One empty value per read, for every caller: a new one each render would re-run
// effects that depend on it.
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
  const queryClient = useQueryClient();
  const { mutateAsync } = useMutation({
    mutationFn: ({ action }: { action: () => Promise<unknown>; reach: ThingWriteReach }) =>
      action(),
    onSuccess: (_, { reach }) =>
      Promise.all(
        INVALIDATES[reach].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      ),
  });
  return (action: () => Promise<unknown>, reach: ThingWriteReach = "things") =>
    mutateAsync({ action, reach });
}
