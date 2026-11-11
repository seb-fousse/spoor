import {
  type Database,
  type LocalDate,
  listDayObservations,
  type MetricDay,
  type Observation,
  recordObservation,
  type Value,
} from "@spoor/core";
import { useCallback, useEffect, useState } from "react";

export interface DayObservations {
  /** The day `items` belong to. While another day loads, the previous day's items stay. */
  day: LocalDate | null;
  /** Every active metric with its observation on `day`, in `listMetrics` order. */
  items: MetricDay[];
  /** The last load or record error, cleared by the next success. */
  error: string | null;
  /** Records `value` for the metric on `day`, then shows the stored observation. */
  record: (metricId: string, value: Value) => Promise<void>;
}

/**
 * The rail's observations for `day`, reloaded whenever the day changes.
 *
 * Recording updates the one card from what core stored, rather than reloading
 * the day, and then calls `onRecorded` with the observation, so a view that
 * shows the same data elsewhere (such as the grid) can refresh.
 */
export function useDayObservations(
  db: Database,
  day: LocalDate,
  onRecorded?: (observation: Observation) => void,
): DayObservations {
  const [loaded, setLoaded] = useState<{ day: LocalDate; items: MetricDay[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listDayObservations(db, day)
      .then((items) => {
        if (cancelled) return;
        setLoaded({ day, items });
        setError(null);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [db, day]);

  const record = useCallback(
    async (metricId: string, value: Value) => {
      try {
        const { observation } = await recordObservation(db, metricId, day, value);
        setError(null);
        // Only into the same day's items: the user may have moved on meanwhile.
        setLoaded((current) =>
          current?.day !== observation.date
            ? current
            : {
                ...current,
                items: current.items.map((item) =>
                  item.metric.id === metricId ? { ...item, observation } : item,
                ),
              },
        );
        onRecorded?.(observation);
      } catch (e) {
        setError((e as Error).message);
        throw e;
      }
    },
    [db, day, onRecorded],
  );

  return { day: loaded?.day ?? null, items: loaded?.items ?? [], error, record };
}
