import { useWindowEvent } from "@mantine/hooks";
import { dayOf, type LocalDate, now, systemTimeZone } from "@spoor/core";
import { useEffect, useState } from "react";

function currentDay(timeZone: string | undefined): LocalDate {
  return dayOf(now(), timeZone ?? systemTimeZone());
}

/** How often to recheck the date. Short enough to roll over soon after midnight. */
const CHECK_MS = 60_000;

/**
 * Today's date in `timeZone` (default: the device's zone), kept current. It
 * rolls over at midnight while the app is open, and on focus after the machine
 * has slept, because timers don't fire during sleep and the zone may have
 * changed meanwhile. Pass the `time_zone` setting (`getTimeZone`) so today
 * matches the days the data is counted in.
 */
export function useToday(timeZone?: string): LocalDate {
  const [today, setToday] = useState(() => currentDay(timeZone));

  useWindowEvent("focus", () => setToday(currentDay(timeZone)));
  useEffect(() => {
    // Recheck at once when the zone changes, then every CHECK_MS. Same-date
    // updates are no-ops: React skips the render when the string is unchanged.
    setToday(currentDay(timeZone));
    const timer = setInterval(() => setToday(currentDay(timeZone)), CHECK_MS);
    return () => clearInterval(timer);
  }, [timeZone]);

  return today;
}
