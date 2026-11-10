import { type Dispatch, useEffect } from "react";
import { dayKeyAction, isMac, ownsArrowKeys } from "./dayKeys";
import type { HomeDaysAction } from "./homeDays";

/**
 * While Home is mounted, the day keys (see `dayKeyAction`) work wherever focus
 * is, except in a field or widget that uses the arrow keys itself. A key some
 * other handler already took (`preventDefault`) is left alone, which is how
 * the grid's day headers handle their own keys and keep focus on the active day.
 */
export function useDayKeys(dispatch: Dispatch<HomeDaysAction>) {
  useEffect(() => {
    const mac = isMac();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || ownsArrowKeys(event.target)) return;
      const action = dayKeyAction(event, mac);
      if (!action) return;
      event.preventDefault();
      dispatch(action);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dispatch]);
}
