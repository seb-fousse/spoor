import { useWindowEvent } from "@mantine/hooks";
import { type Instant, now } from "@spoor/core";
import { useEffect, useState } from "react";

/**
 * The current instant, updated every `intervalMs` (default: a minute) and on
 * focus, because timers don't fire while the machine sleeps. Good enough for
 * a "now" line and ongoing intervals, which move a pixel or so a minute.
 */
export function useNow(intervalMs = 60_000): Instant {
  const [current, setCurrent] = useState(now);

  useWindowEvent("focus", () => setCurrent(now()));
  useEffect(() => {
    const timer = setInterval(() => setCurrent(now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return current;
}
