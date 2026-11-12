import { ArrowButtons } from "@components/ArrowButtons";
import { SegmentedControl, UnstyledButton } from "@mantine/core";
import type { LocalDate, Timeline } from "@spoor/core";
import type { Dispatch } from "react";
import { TimelineFilter } from "./grid/filter/TimelineFilter";
import type { HiddenTimelines } from "./grid/filter/timelineVisibility";
import classes from "./Home.module.css";
import {
  type DayRange,
  formatWindow,
  type HomeDays,
  type HomeDaysAction,
  isAtToday,
  RANGES,
} from "./homeDays";

interface LeftHeaderProps {
  days: HomeDays;
  today: LocalDate;
  dispatch: Dispatch<HomeDaysAction>;
  /** The timelines the grid could show, for the filter. Empty until they load. */
  timelines: Timeline[];
  hiddenTimelines: HiddenTimelines;
  onHiddenTimelinesChange: (hidden: HiddenTimelines) => void;
}

/**
 * Above the timeline: the visible days and how many to show on the left, then
 * the toggles that choose which timelines to show; on the right, back to today
 * (resetting the right header's day too) and the arrows that page the days.
 */
export function LeftHeader({
  days,
  today,
  dispatch,
  timelines,
  hiddenTimelines,
  onHiddenTimelinesChange,
}: LeftHeaderProps) {
  const atToday = isAtToday(days, today);

  return (
    <div className={classes.leftHeader}>
      <div className={classes.bar}>
        <div className={`${classes.label} ${classes.leftLabel}`} aria-live="polite">
          <span>{formatWindow(days)}</span>
        </div>

        <SegmentedControl
          aria-label="Days shown"
          className={classes.ranges}
          data={RANGES.map(({ value, label }) => ({ value, label }))}
          value={days.range}
          onChange={(range) => dispatch({ type: "setRange", range: range as DayRange })}
        />

        {timelines.length > 0 && (
          <TimelineFilter
            timelines={timelines}
            hidden={hiddenTimelines}
            onChange={onHiddenTimelinesChange}
          />
        )}

        <div className={classes.end}>
          <UnstyledButton
            className={classes.today}
            disabled={atToday}
            onClick={() => dispatch({ type: "goToday", today })}
          >
            {/* Counter-clockwise arrow: going back. 1em, so it matches the text. */}
            <svg
              aria-hidden="true"
              className={classes.todayIcon}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M7.07 5.7A8 8 0 1 1 4.55 15M4.05 20v-5h5" />
            </svg>
            Today
          </UnstyledButton>
          <ArrowButtons
            className={classes.endArrows}
            backLabel="Earlier days"
            forwardLabel="Later days"
            onBack={() => dispatch({ type: "pageWindow", by: -1 })}
            onForward={() => dispatch({ type: "pageWindow", by: 1 })}
            backShortcut="earlierDays"
            forwardShortcut="laterDays"
          />
        </div>
      </div>
    </div>
  );
}
