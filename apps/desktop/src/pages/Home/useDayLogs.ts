import { type Database, type DayLogGroup, type LocalDate, listDayLogEntries } from "@spoor/core";
import { useEffect, useState } from "react";

export interface DayLogs {
  /** The day `groups` belong to. While another day loads, the previous day's groups stay. */
  day: LocalDate | null;
  /** The day's top-level entries by log type, with child entries nested. */
  groups: DayLogGroup[];
  /** The last load error, cleared by the next success. */
  error: string | null;
}

/** The rail's logs for `day`, reloaded when the day changes or `version` is bumped. */
export function useDayLogs(db: Database, day: LocalDate, version: number): DayLogs {
  const [loaded, setLoaded] = useState<{ day: LocalDate; groups: DayLogGroup[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` is the signal to reload.
  useEffect(() => {
    let cancelled = false;
    listDayLogEntries(db, day)
      .then((groups) => {
        if (cancelled) return;
        setLoaded({ day, groups });
        setError(null);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [db, day, version]);

  return { day: loaded?.day ?? null, groups: loaded?.groups ?? [], error };
}
