import { FluidSplitter } from "@components/FluidSplitter";
import { useShortcuts } from "@keyboard";
import { Splitter, Stack, Text, Title } from "@mantine/core";
import type { Database } from "@spoor/core";
import { useMemo, useReducer } from "react";
import { dayShortcuts } from "./dayShortcuts";
import classes from "./Home.module.css";
import { useHomeState } from "./HomeState";
import { formatDay, windowDays } from "./homeDays";
import { LeftHeader } from "./LeftHeader";
import { ObservationRail } from "./ObservationRail";
import { RightHeader } from "./RightHeader";
import { TimelineGrid } from "./TimelineGrid";

/**
 * Home: the timeline grid on the left (70%) and a rail for the active day on
 * the right (at least 30%), split evenly between the day's observations above
 * and an entry point for adding logs below. The logs half is a placeholder
 * for now.
 */
export function Home({ db }: { db: Database }) {
  // Held above the routes, so the user's place survives leaving Home.
  const { today, days, dispatch } = useHomeState();
  const activeLabel = formatDay(days.activeDay);
  // A stable array while the window stays put, so the grid's layout isn't redone on every render.
  const visibleDays = useMemo(() => windowDays(days), [days]);
  // Left/Right move the active day; with Alt (macOS) or Ctrl they page the window.
  useShortcuts(dayShortcuts(dispatch));
  // Bumped after each value recorded in the rail, so the grid's day badges recount.
  const [observationsVersion, bumpObservations] = useReducer((n: number) => n + 1, 0);

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
            dispatch={dispatch}
            observationsVersion={observationsVersion}
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
                <ObservationRail db={db} day={days.activeDay} onRecorded={bumpObservations} />
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
