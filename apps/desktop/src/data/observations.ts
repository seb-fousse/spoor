import { useDatabase } from "@platform/DatabaseProvider";
import {
  countDayObservations,
  createMetric,
  type DayObservationCount,
  deleteMetric,
  deleteObservation,
  type LocalDate,
  listDayObservations,
  listMetrics,
  listObservations,
  type MetricDay,
  recordObservation,
  setMetricArchived,
  updateMetric,
  type Value,
} from "@spoor/core";
import {
  keepPreviousData,
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { queryKeys } from "./queryKeys";

/** Every metric, archived included, by name. */
export function useMetrics() {
  const db = useDatabase();
  return useQuery({ queryKey: queryKeys.observations.metrics, queryFn: () => listMetrics(db) });
}

/** The metric's observations, latest day first. */
export function useMetricObservations(metricId: string) {
  const db = useDatabase();
  return useQuery({
    queryKey: queryKeys.observations.metric(metricId),
    queryFn: () => listObservations(db, metricId),
  });
}

/** A day's metrics, tagged with the day so stale ones can be told apart. */
interface LoadedDay {
  day: LocalDate;
  items: MetricDay[];
}

export interface DayObservations {
  /** The day `items` belong to. While another day loads, the previous day's items stay. */
  day: LocalDate | null;
  /** Every active metric with its observation on `day`, in `listMetrics` order. */
  items: MetricDay[];
  /** The last load or record error, cleared by the next success. */
  error: string | null;
  /** Nothing has loaded yet, and nothing has failed. */
  loading: boolean;
  /** `items` are another day's, shown while the requested day's load. */
  stale: boolean;
  /** Records `value` for the metric on `day`, then shows the stored observation. */
  record: (metricId: string, value: Value) => Promise<void>;
}

/**
 * The rail's observations for `day`, reloaded whenever the day changes.
 *
 * Recording writes the stored observation into that day's cached metrics,
 * rather than reloading the day, and invalidates the grid's day counts and the
 * metric's observation list.
 */
export function useDayObservations(day: LocalDate): DayObservations {
  const db = useDatabase();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.observations.day(day),
    queryFn: async (): Promise<LoadedDay> => ({ day, items: await listDayObservations(db, day) }),
    placeholderData: keepPreviousData,
  });

  const mutation = useMutation({
    mutationFn: (vars: { metricId: string; day: LocalDate; value: Value }) =>
      recordObservation(db, vars.metricId, vars.day, vars.value),
    onSuccess: ({ observation }, { metricId }) => {
      // Into the recorded day's cache, even if the user has moved on to another day.
      queryClient.setQueryData<LoadedDay>(
        queryKeys.observations.day(observation.date),
        (current) =>
          current && {
            ...current,
            items: current.items.map((item) =>
              item.metric.id === metricId ? { ...item, observation } : item,
            ),
          },
      );
      // The other reads holding this observation: the grid's day counts and the
      // Observations page's list for the metric. Not all of `observations.all`,
      // which would reload the day just written and every other cached day.
      void queryClient.invalidateQueries({ queryKey: queryKeys.observations.countsAll });
      void queryClient.invalidateQueries({ queryKey: queryKeys.observations.metric(metricId) });
    },
  });

  return {
    day: query.data?.day ?? null,
    items: query.data?.items ?? [],
    // A failed save shows only on the day it was for, so it doesn't follow the user around.
    error:
      (mutation.variables?.day === day ? mutation.error?.message : undefined) ??
      query.error?.message ??
      null,
    loading: query.isPending,
    stale: query.isPlaceholderData,
    record: async (metricId, value) => {
      await mutation.mutateAsync({ metricId, day, value });
    },
  };
}

const NO_COUNTS: ReadonlyMap<LocalDate, DayObservationCount> = new Map();

/**
 * Each of `days`' observation counts by date, for the grid's day badges.
 *
 * They reload when the window moves, and whenever a value recorded in the
 * rail invalidates them. Until the new counts arrive the previous ones stay,
 * so badges don't flash. If loading fails the badges are hidden rather than
 * left showing old counts.
 */
export function useObservationCounts(
  days: readonly LocalDate[],
): ReadonlyMap<LocalDate, DayObservationCount> {
  const db = useDatabase();
  const first = days[0];
  const last = days.at(-1);
  const { data, error } = useQuery({
    queryKey: queryKeys.observations.counts(first, last),
    queryFn:
      first !== undefined && last !== undefined
        ? async (): Promise<ReadonlyMap<LocalDate, DayObservationCount>> => {
            const loaded = await countDayObservations(db, first, last);
            return new Map(loaded.map((c) => [c.date, c]));
          }
        : skipToken,
    placeholderData: keepPreviousData,
  });
  return error ? NO_COUNTS : (data ?? NO_COUNTS);
}

/**
 * The Observations page's writes. Each resolves once it is stored and what it
 * changed has been invalidated, and rejects with core's error.
 *
 * Every one invalidates `observations.all`, not just the page's own keys: a
 * metric's name, constraints, labels or archived state shows in Home's rail and
 * decides which metrics its day counts include, and an observation is a day's
 * rail entry and part of its count. Inactive queries (Home's, while this page
 * is open) only refetch when next shown, so the broad prefix costs little.
 */
export function useObservationWrites() {
  const db = useDatabase();
  const queryClient = useQueryClient();
  const onSuccess = () => queryClient.invalidateQueries({ queryKey: queryKeys.observations.all });

  const create = useMutation({
    mutationFn: (input: Parameters<typeof createMetric>[1]) => createMetric(db, input),
    onSuccess,
  });
  const update = useMutation({
    mutationFn: (vars: { id: string; patch: Parameters<typeof updateMetric>[2] }) =>
      updateMetric(db, vars.id, vars.patch),
    onSuccess,
  });
  const setArchived = useMutation({
    mutationFn: (vars: { id: string; archived: boolean }) =>
      setMetricArchived(db, vars.id, vars.archived),
    onSuccess,
  });
  const remove = useMutation({ mutationFn: (id: string) => deleteMetric(db, id), onSuccess });
  const record = useMutation({
    mutationFn: (vars: { metricId: string; date: LocalDate; value: Value }) =>
      recordObservation(db, vars.metricId, vars.date, vars.value),
    onSuccess,
  });
  const removeObservation = useMutation({
    mutationFn: (id: string) => deleteObservation(db, id),
    onSuccess,
  });

  return {
    createMetric: create.mutateAsync,
    updateMetric: update.mutateAsync,
    setMetricArchived: setArchived.mutateAsync,
    deleteMetric: remove.mutateAsync,
    recordObservation: record.mutateAsync,
    deleteObservation: removeObservation.mutateAsync,
  };
}

export type ObservationWrites = ReturnType<typeof useObservationWrites>;
