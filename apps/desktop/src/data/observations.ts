import { useDatabase } from "@platform/DatabaseProvider";
import {
  countDayObservations,
  createMetric,
  type Database,
  type DayObservationCount,
  deleteMetric,
  deleteObservation,
  type LocalDate,
  listDayObservations,
  listMetrics,
  listObservations,
  recordObservation,
  setMetricArchived,
  updateMetric,
  type Value,
} from "@spoor/core";
import { keepPreviousData, queryOptions, skipToken, useQuery } from "@tanstack/react-query";
import { queryKeys } from "./queryKeys";
import { useDbWrite } from "./useDbWrite";

/**
 * The metric and observation reads. Each keeps its key with its query, so
 * `.queryKey` types the cache by its data.
 */
export const observationQueries = {
  /** Every metric, archived included, by name. */
  metrics: (db: Database) =>
    queryOptions({ queryKey: queryKeys.observations.metrics, queryFn: () => listMetrics(db) }),
  /** The metric's observations, latest day first. */
  metric: (db: Database, metricId: string) =>
    queryOptions({
      queryKey: queryKeys.observations.metric(metricId),
      queryFn: () => listObservations(db, metricId),
    }),
  /**
   * Every active metric with its observation on `day`, in `listMetrics` order,
   * tagged with the day: while another day loads, the previous day's stay as
   * placeholder data, and the tag tells which day they are.
   */
  day: (db: Database, day: LocalDate) =>
    queryOptions({
      queryKey: queryKeys.observations.day(day),
      queryFn: async () => ({ day, items: await listDayObservations(db, day) }),
    }),
  /** Each of `days`' observation counts by date. Waits for at least one day. */
  counts: (db: Database, days: readonly LocalDate[]) => {
    const first = days[0];
    const last = days.at(-1);
    return queryOptions({
      queryKey: queryKeys.observations.counts(first, last),
      queryFn:
        first !== undefined && last !== undefined
          ? async (): Promise<ReadonlyMap<LocalDate, DayObservationCount>> => {
              const loaded = await countDayObservations(db, first, last);
              return new Map(loaded.map((c) => [c.date, c]));
            }
          : skipToken,
    });
  },
};

/** Every metric, archived included, by name. */
export function useMetrics() {
  const db = useDatabase();
  return useQuery(observationQueries.metrics(db));
}

/** The metric's observations, latest day first. */
export function useMetricObservations(metricId: string) {
  const db = useDatabase();
  return useQuery(observationQueries.metric(db, metricId));
}

/**
 * The rail's observations for `day`: every active metric with its observation
 * on that day, tagged with the day they belong to. While another day loads,
 * the previous day's stay (`isPlaceholderData` is then true). Recording an
 * observation writes it into its day's cache (see `useRecordObservation`).
 */
export function useDayObservations(day: LocalDate) {
  const db = useDatabase();
  return useQuery({ ...observationQueries.day(db, day), placeholderData: keepPreviousData });
}

/**
 * Each of `days`' observation counts by date, for the grid's day badges.
 *
 * They reload when the window moves, and whenever a recorded value
 * invalidates them. Until the new counts arrive the previous ones stay, so
 * badges don't flash.
 */
export function useObservationCounts(days: readonly LocalDate[]) {
  const db = useDatabase();
  return useQuery({ ...observationQueries.counts(db, days), placeholderData: keepPreviousData });
}

// The writes to metrics and observations. Each resolves once it is stored and
// what it changed has refetched, and rejects with core's error.
//
// The Observations page's own writes invalidate `observations.all`, not just
// the page's keys: a metric's name, constraints, labels or archived state shows
// in Home's rail and decides which metrics its day counts include, and an
// observation is a day's rail entry and part of its count. Inactive queries
// (Home's, while this page is open) only refetch when next shown, so the broad
// prefix costs little. Recording, which the rail shares, is narrower.

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

/**
 * Records the metric's value for `date`, or revises the day's observation:
 * the rail's records and the Observations page's.
 *
 * It writes the stored observation into that day's cached metrics, rather
 * than reloading the day, and invalidates the other reads holding it: the
 * grid's day counts and the Observations page's list for the metric. Not all
 * of `observations.all`, which would reload the day just written and every
 * other cached day.
 */
export function useRecordObservation() {
  // For the day's cache key, which comes from the day's query; the write uses it too.
  const db = useDatabase();
  return useDbWrite(
    (_db, vars: { metricId: string; date: LocalDate; value: Value }) =>
      recordObservation(db, vars.metricId, vars.date, vars.value),
    {
      // Into the recorded day's cache, even if the user has moved on to another
      // day; a day that isn't cached stays so.
      update: (queryClient, { observation }, { metricId }) => {
        queryClient.setQueryData(
          observationQueries.day(db, observation.date).queryKey,
          (current) =>
            current && {
              ...current,
              items: current.items.map((item) =>
                item.metric.id === metricId ? { ...item, observation } : item,
              ),
            },
        );
      },
      invalidates: (_, { metricId }) => [
        queryKeys.observations.countsAll,
        queryKeys.observations.metric(metricId),
      ],
    },
  );
}

/** Deletes an observation. */
export function useDeleteObservation() {
  return useDbWrite((db, id: string) => deleteObservation(db, id), {
    invalidates: [queryKeys.observations.all],
  });
}
