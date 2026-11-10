import { ArrowButtons } from "@components/ArrowButtons";
import type { LocalDate } from "@spoor/core";
import type { Dispatch } from "react";
import classes from "./Home.module.css";
import { formatDay, type HomeDaysAction } from "./homeDays";

interface RightHeaderProps {
  activeDay: LocalDate;
  dispatch: Dispatch<HomeDaysAction>;
}

/** Above the right pane (the rail): the active day, and arrows at the right edge to step it a day at a time. */
export function RightHeader({ activeDay, dispatch }: RightHeaderProps) {
  return (
    <div className={classes.bar}>
      <div className={`${classes.label} ${classes.rightLabel}`} aria-live="polite">
        <span>{formatDay(activeDay)}</span>
      </div>

      <ArrowButtons
        className={`${classes.endArrows} ${classes.pushRight}`}
        backLabel="Previous day"
        forwardLabel="Next day"
        onBack={() => dispatch({ type: "stepActive", by: -1 })}
        onForward={() => dispatch({ type: "stepActive", by: 1 })}
      />
    </div>
  );
}
