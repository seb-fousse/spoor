import { FluidSplitter } from "@components/FluidSplitter";
import { useShortcuts } from "@keyboard";
import { Splitter } from "@mantine/core";
import { useMemo, useState } from "react";
import { dayShortcuts } from "./dayShortcuts";
import { type HiddenTimelines, TimelineGrid, useGridData } from "./grid";
import classes from "./Home.module.css";
import { useHomeState } from "./HomeState";
import { windowDays } from "./homeDays";
import { LeftHeader } from "./LeftHeader";
import { LogRail } from "./logs/LogRail";
import { ObservationRail } from "./observations/ObservationRail";
import { RightHeader } from "./RightHeader";

/**
 * Home: the timeline grid on the left (70%) and a rail for the active day on
 * the right (at least 30%), split evenly between the day's observations above
 * and its logs below, with a modal card to add one.
 */
export function Home() {
  // Held above the routes, so the user's place survives leaving Home.
  const { today, days, dispatch } = useHomeState();
  // A stable array while the window stays put, so the grid's layout isn't redone on every render.
  const visibleDays = useMemo(() => windowDays(days), [days]);
  // Left/Right move the active day; with Alt (macOS) or Ctrl they page the window.
  useShortcuts(dayShortcuts(dispatch));
  // Loaded here, not in the grid, because the header's filter lists the same timelines.
  const gridData = useGridData(visibleDays);
  // Kept in Home, so the filter resets when the user leaves the page.
  const [hiddenTimelines, setHiddenTimelines] = useState<HiddenTimelines>(() => new Set());

  return (
    <FluidSplitter h="calc(100dvh - var(--app-shell-footer-height))">
      <Splitter.Pane defaultSize={70} max={70}>
        <div className={classes.column}>
          <LeftHeader
            days={days}
            today={today}
            dispatch={dispatch}
            timelines={gridData.status === "success" ? gridData.data.timelines : []}
            hiddenTimelines={hiddenTimelines}
            onHiddenTimelinesChange={setHiddenTimelines}
          />
          <TimelineGrid
            read={gridData}
            hiddenTimelines={hiddenTimelines}
            onShowAllTimelines={() => setHiddenTimelines(new Set())}
            days={visibleDays}
            activeDay={days.activeDay}
            dispatch={dispatch}
          />
        </div>
      </Splitter.Pane>

      <Splitter.Pane defaultSize={30} min={30}>
        <div className={classes.column}>
          <RightHeader activeDay={days.activeDay} dispatch={dispatch} />

          <div className={classes.fill}>
            <FluidSplitter orientation="vertical" h="100%">
              <Splitter.Pane defaultSize={50}>
                <ObservationRail day={days.activeDay} />
              </Splitter.Pane>

              <Splitter.Pane defaultSize={50}>
                <LogRail day={days.activeDay} />
              </Splitter.Pane>
            </FluidSplitter>
          </div>
        </div>
      </Splitter.Pane>
    </FluidSplitter>
  );
}
