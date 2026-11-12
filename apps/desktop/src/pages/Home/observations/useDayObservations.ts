import { queryKeys } from "@lib/queryKeys";
import {
  type Database,
  type LocalDate,
  listDayObservations,
  type MetricDay,
  recordObservation,
  type Value,
} from "@spoor/core";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

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
export function useDayObservations(db: Database, day: LocalDate): DayObservations {
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
