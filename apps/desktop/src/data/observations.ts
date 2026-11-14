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
import { keepPreviousData, skipToken, useQuery } from "@tanstack/react-query";
import { queryKeys } from "./queryKeys";
import { useDbWrite } from "./useDbWrite";

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

  const query = useQuery({
    queryKey: queryKeys.observations.day(day),
    queryFn: async (): Promise<LoadedDay> => ({ day, items: await listDayObservations(db, day) }),
    placeholderData: keepPreviousData,
  });

  const mutation = useDbWrite(
    (db, vars: { metricId: string; day: LocalDate; value: Value }) =>
      recordObservation(db, vars.metricId, vars.day, vars.value),
    {
      // Into the recorded day's cache, even if the user has moved on to another day.
      update: (queryClient, { observation }, { metricId }) => {
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
      },
      // The other reads holding this observation: the grid's day counts and the
      // Observations page's list for the metric. Not all of `observations.all`,
      // which would reload the day just written and every other cached day.
      invalidates: (_, { metricId }) => [
        queryKeys.observations.countsAll,
        queryKeys.observations.metric(metricId),
      ],
    },
  );

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

// The Observations page's writes. Each resolves once it is stored and what it
// changed has refetched, and rejects with core's error.
//
// Every one invalidates `observations.all`, not just the page's own keys: a
// metric's name, constraints, labels or archived state shows in Home's rail and
// decides which metrics its day counts include, and an observation is a day's
// rail entry and part of its count. Inactive queries (Home's, while this page
// is open) only refetch when next shown, so the broad prefix costs little.

/** Creates a metric. */
export function useCreateMetric() {
  return useDbWrite((db, input: Parameters<typeof createMetric>[1]) => createMetric(db, input), {
    invalidates: [queryKeys.observations.all],
  });
}

/** Renames or redescribes a metric, or replaces its constraints or option labels. */
export function useUpdateMetric() {
  return useDbWrite(
    (db, vars: { id: string; patch: Parameters<typeof updateMetric>[2] }) =>
      updateMetric(db, vars.id, vars.patch),
    { invalidates: [queryKeys.observations.all] },
  );
}

/** Archives or unarchives a metric. */
export function useSetMetricArchived() {
  return useDbWrite(
    (db, vars: { id: string; archived: boolean }) => setMetricArchived(db, vars.id, vars.archived),
    { invalidates: [queryKeys.observations.all] },
  );
}

/** Deletes a metric with its observations. */
export function useDeleteMetric() {
  return useDbWrite((db, id: string) => deleteMetric(db, id), {
    invalidates: [queryKeys.observations.all],
  });
}

/** Records the metric's value for `date`, or revises the day's observation. */
export function useRecordObservation() {
  return useDbWrite(
    (db, vars: { metricId: string; date: LocalDate; value: Value }) =>
      recordObservation(db, vars.metricId, vars.date, vars.value),
    { invalidates: [queryKeys.observations.all] },
  );
}

/** Deletes an observation. */
export function useDeleteObservation() {
  return useDbWrite((db, id: string) => deleteObservation(db, id), {
    invalidates: [queryKeys.observations.all],
  });
}
