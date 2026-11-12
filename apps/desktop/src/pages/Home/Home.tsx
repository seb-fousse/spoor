import { FluidSplitter } from "@components/FluidSplitter";
import { useShortcuts } from "@keyboard";
import { Splitter } from "@mantine/core";
import type { Database } from "@spoor/core";
import { useMemo, useReducer } from "react";
import { dayShortcuts } from "./dayShortcuts";
import classes from "./Home.module.css";
import { useHomeState } from "./HomeState";
import { windowDays } from "./homeDays";
import { LeftHeader } from "./LeftHeader";
import { LogRail } from "./LogRail";
import { ObservationRail } from "./ObservationRail";
import { RightHeader } from "./RightHeader";
import { TimelineGrid } from "./TimelineGrid";
import { useGridData } from "./useGridData";
import { useTimelineFilter } from "./useTimelineFilter";

/**
 * Home: the timeline grid on the left (70%) and a rail for the active day on
 * the right (at least 30%), split evenly between the day's observations above
 * and its logs below, with a modal card to add one.
 */
export function Home({ db }: { db: Database }) {
  // Held above the routes, so the user's place survives leaving Home.
  const { today, days, dispatch } = useHomeState();
  // A stable array while the window stays put, so the grid's layout isn't redone on every render.
  const visibleDays = useMemo(() => windowDays(days), [days]);
  // Left/Right move the active day; with Alt (macOS) or Ctrl they page the window.
  useShortcuts(dayShortcuts(dispatch));
  // Bumped after each value recorded in the rail, so the grid's day badges recount.
  const [observationsVersion, bumpObservations] = useReducer((n: number) => n + 1, 0);
  // Loaded here, not in the grid, because the header's filter lists the same timelines.
  const gridData = useGridData(db, visibleDays);
  const [hiddenTimelines, setHiddenTimelines] = useTimelineFilter();

  return (
    // Fill the whole area above the bottom bar.
    <FluidSplitter h="calc(100dvh - var(--app-shell-footer-height))">
      <Splitter.Pane defaultSize={70} max={70}>
        <div className={classes.column}>
          <LeftHeader
            days={days}
            today={today}
            dispatch={dispatch}
            timelines={gridData.status === "ready" ? gridData.timelines : []}
            hiddenTimelines={hiddenTimelines}
            onHiddenTimelinesChange={setHiddenTimelines}
          />
          <TimelineGrid
            db={db}
            data={gridData}
            hiddenTimelines={hiddenTimelines}
            onShowAllTimelines={() => setHiddenTimelines(new Set())}
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
                <LogRail db={db} day={days.activeDay} />
              </Splitter.Pane>
            </FluidSplitter>
          </div>
        </div>
      </Splitter.Pane>
    </FluidSplitter>
  );
}
