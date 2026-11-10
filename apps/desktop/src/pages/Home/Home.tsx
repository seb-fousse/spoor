import { FluidSplitter } from "@components/FluidSplitter";
import { useToday } from "@hooks/useToday";
import { Splitter, Stack, Text, Title } from "@mantine/core";
import { useEffect, useReducer, useRef } from "react";
import classes from "./Home.module.css";
import { formatDay, homeDaysReducer, initialHomeDays, windowDays } from "./homeDays";
import { RailHeader } from "./RailHeader";
import { TimelineToolbar } from "./TimelineToolbar";

/**
 * Home: a timeline on the left (70%) and a rail for the active day on the
 * right (at least 30%), split evenly between the day's observations above and
 * an entry point for adding logs below. The content is placeholders for now;
 * the visible days and the active day are live.
 */
export function Home() {
  const today = useToday();
  const [days, dispatch] = useReducer(homeDaysReducer, today, initialHomeDays);

  // When midnight passes, move to the new today if the user was on the old one.
  const previousToday = useRef(today);
  useEffect(() => {
    if (previousToday.current === today) return;
    dispatch({ type: "rollover", from: previousToday.current, to: today });
    previousToday.current = today;
  }, [today]);
  const activeLabel = formatDay(days.activeDay);

  return (
    // Fill the whole area above the bottom bar.
    <FluidSplitter h="calc(100dvh - var(--app-shell-footer-height))">
      <Splitter.Pane defaultSize={70} max={70}>
        <div className={classes.column}>
          <TimelineToolbar days={days} today={today} dispatch={dispatch} />
          <Stack gap="xs" p="md">
            <Title order={2}>Timeline</Title>
            <Text c="dimmed">The timeline for {windowDays(days).join(", ")} will live here.</Text>
          </Stack>
        </div>
      </Splitter.Pane>

      <Splitter.Pane defaultSize={30} min={30}>
        <div className={classes.column}>
          <RailHeader activeDay={days.activeDay} dispatch={dispatch} />

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
