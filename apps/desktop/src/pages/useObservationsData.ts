import { queryKeys } from "@lib/queryKeys";
import {
  createMetric,
  type Database,
  deleteMetric,
  deleteObservation,
  type LocalDate,
  listMetrics,
  listObservations,
  recordObservation,
  setMetricArchived,
  updateMetric,
  type Value,
} from "@spoor/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

/** Every metric, archived included, by name. */
export function useMetrics(db: Database) {
  return useQuery({ queryKey: queryKeys.observations.metrics, queryFn: () => listMetrics(db) });
}

/** The metric's observations, latest day first. */
export function useMetricObservations(db: Database, metricId: string) {
  return useQuery({
    queryKey: queryKeys.observations.metric(metricId),
    queryFn: () => listObservations(db, metricId),
  });
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
export function useObservationWrites(db: Database) {
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
