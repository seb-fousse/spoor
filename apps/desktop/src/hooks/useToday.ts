import { useWindowEvent } from "@mantine/hooks";
import { dayOf, type LocalDate, now, systemTimeZone } from "@spoor/core";
import { useEffect, useState } from "react";

function currentDay(): LocalDate {
  return dayOf(now(), systemTimeZone());
}

/** How often to recheck the date. Short enough to roll over soon after midnight. */
const CHECK_MS = 60_000;

/**
 * Today's date in the device's time zone, kept current: it rolls over at
 * midnight while the app is open, and on focus after the machine has slept
 * (timers don't fire during sleep, and the zone may have changed meanwhile).
 */
export function useToday(): LocalDate {
  const [today, setToday] = useState(currentDay);

  useWindowEvent("focus", () => setToday(currentDay()));
  useEffect(() => {
    // Same-date updates are no-ops: React skips the render when the string is unchanged.
    const timer = setInterval(() => setToday(currentDay()), CHECK_MS);
    return () => clearInterval(timer);
  }, []);

  return today;
}
