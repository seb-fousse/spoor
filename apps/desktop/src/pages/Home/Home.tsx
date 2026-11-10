import { FluidSplitter } from "@components/FluidSplitter";
import { useToday } from "@hooks/useToday";
import { Splitter, Stack, Text, Title } from "@mantine/core";
import { type Database, getTimeZone, type LocalDate } from "@spoor/core";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import classes from "./Home.module.css";
import { formatDay, homeDaysReducer, initialHomeDays, windowDays } from "./homeDays";
import { LeftHeader } from "./LeftHeader";
import { RightHeader } from "./RightHeader";
import { TimelineGrid } from "./TimelineGrid";

/**
 * Home: the timeline grid on the left (70%) and a rail for the active day on
 * the right (at least 30%), split evenly between the day's observations above
 * and an entry point for adding logs below. The rail's content is placeholders
 * for now.
 */
export function Home({ db }: { db: Database }) {
  // Today in the `time_zone` setting, the zone the grid counts its days in.
  // Until the setting loads it is the device's today. If the setting's date
  // differs, the rollover below moves the window to it.
  const [timeZone, setTimeZone] = useState<string>();
  useEffect(() => {
    let cancelled = false;
    // On failure, keep the device's zone; the grid reports its own load errors.
    getTimeZone(db)
      .then((zone) => !cancelled && setTimeZone(zone))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [db]);
  const today = useToday(timeZone);
  const [days, dispatch] = useReducer(homeDaysReducer, today, initialHomeDays);

  // When the date changes (midnight, or the zone loading), move to the new today
  // if the user was on the old one.
  const previousToday = useRef(today);
  useEffect(() => {
    if (previousToday.current === today) return;
    dispatch({ type: "rollover", from: previousToday.current, to: today });
    previousToday.current = today;
  }, [today]);
  const activeLabel = formatDay(days.activeDay);
  // A stable array while the window stays put, so the grid's layout isn't redone on every render.
  const visibleDays = useMemo(() => windowDays(days), [days]);
  const selectDay = useCallback((day: LocalDate) => dispatch({ type: "select", day }), []);

  return (
    // Fill the whole area above the bottom bar.
    <FluidSplitter h="calc(100dvh - var(--app-shell-footer-height))">
      <Splitter.Pane defaultSize={70} max={70}>
        <div className={classes.column}>
          <LeftHeader days={days} today={today} dispatch={dispatch} />
          <TimelineGrid
            db={db}
            days={visibleDays}
            activeDay={days.activeDay}
            onSelectDay={selectDay}
          />
        </div>
      </Splitter.Pane>

      <Splitter.Pane defaultSize={30} min={30}>
        <div className={classes.column}>
          <RightHeader activeDay={days.activeDay} dispatch={dispatch} />

          {/* Observations above, logs below, split evenly. */}
          <div className={classes.fill}>
            <FluidSplitter orientation="vertical" h="100%">
              <Splitter.Pane defaultSize={50}>
                <Stack gap="xs" p="md">
                  <Title order={3}>Observations</Title>
                  <Text c="dimmed">Observations for {activeLabel} will live here.</Text>
                </Stack>
              </Splitter.Pane>

              <Splitter.Pane defaultSize={50}>
                <Stack gap="xs" p="md">
                  <Title order={3}>Add log</Title>
                  <Text c="dimmed">Logs for {activeLabel} will live here.</Text>
                </Stack>
              </Splitter.Pane>
            </FluidSplitter>
          </div>
        </div>
      </Splitter.Pane>
    </FluidSplitter>
  );
}
