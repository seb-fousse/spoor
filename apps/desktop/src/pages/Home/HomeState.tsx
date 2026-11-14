import { useTimeZone } from "@hooks/useTimeZone";
import { useToday } from "@hooks/useToday";
import type { LocalDate } from "@spoor/core";
import {
  createContext,
  type Dispatch,
  type ReactNode,
  use,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import { type HomeDays, type HomeDaysAction, homeDaysReducer, initialHomeDays } from "./homeDays";

/** What Home reads and changes, kept outside the page so it survives navigation. */
export interface HomeState {
  /** Today in the `time_zone` setting, the zone the grid counts its days in. */
  today: LocalDate;
  days: HomeDays;
  dispatch: Dispatch<HomeDaysAction>;
}

const HomeStateContext = createContext<HomeState | null>(null);

/**
 * Holds Home's state for as long as the app runs. Home unmounts whenever the
 * user goes to another page, so state kept in it would reset to five days
 * ending today on every return. Mount this above the routes instead.
 *
 * Midnight rollover runs here too, so it keeps applying while Home is not on
 * screen: a user who left on today comes back to the new today.
 */
export function HomeStateProvider({ children }: { children: ReactNode }) {
  // Until the setting loads, today is the device's today. If the setting's
  // date differs, the rollover below moves the window to it.
  // On failure, keep the device's zone; the grid reports its own load errors.
  // The grid reads the same query, so both always count days in the same zone.
  const { data: timeZone } = useTimeZone();
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

  const value = useMemo(() => ({ today, days, dispatch }), [today, days]);
  return <HomeStateContext value={value}>{children}</HomeStateContext>;
}

/** Home's state, from the enclosing `HomeStateProvider`. */
export function useHomeState(): HomeState {
  const state = use(HomeStateContext);
  if (!state) throw new Error("useHomeState must be used inside a HomeStateProvider");
  return state;
}
