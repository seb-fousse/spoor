import { ArrowButtons } from "@components/ArrowButtons";
import type { Dispatch } from "react";
import classes from "./Home.module.css";
import type { HomeDaysAction } from "./homeDays";

interface RightHeaderProps {
  dispatch: Dispatch<HomeDaysAction>;
}

/** Above the right pane (the rail): arrows at the right edge to step the active day a day at a time. The rail's panels name the day. */
export function RightHeader({ dispatch }: RightHeaderProps) {
  return (
    <div className={classes.bar}>
      <ArrowButtons
        className={`${classes.endArrows} ${classes.pushRight}`}
        backLabel="Previous day"
        forwardLabel="Next day"
        onBack={() => dispatch({ type: "stepActive", by: -1 })}
        onForward={() => dispatch({ type: "stepActive", by: 1 })}
        backShortcut="previousDay"
        forwardShortcut="nextDay"
      />
    </div>
  );
}
