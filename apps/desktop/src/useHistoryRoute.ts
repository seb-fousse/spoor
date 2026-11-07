import { useWindowEvent } from "@mantine/hooks";
import { useState } from "react";
import { parseRoute, type RouteId } from "./routes";

// The History API can't say whether there is somewhere to go back or forward
// to, so each entry we push records its position in `history.state`. The
// furthest position is kept in sessionStorage so it survives a reload.
const MAX_KEY = "spoor.history.max";

function readIndex(): number {
  const index = window.history.state?.index;
  return typeof index === "number" ? index : 0;
}

function readMax(index: number): number {
  try {
    const max = Number(sessionStorage.getItem(MAX_KEY));
    return Number.isFinite(max) && max >= index ? max : index;
  } catch {
    return index;
  }
}

function writeMax(max: number) {
  try {
    sessionStorage.setItem(MAX_KEY, String(max));
  } catch {
    // Without storage, forward just can't be offered after a reload.
  }
}

/**
 * The current page, held in the location hash so reload keeps it, plus
 * whether back and forward have anywhere to go.
 */
export function useHistoryRoute() {
  const [nav, setNav] = useState(() => {
    if (typeof window.history.state?.index !== "number") {
      window.history.replaceState({ index: 0 }, "");
    }
    const index = readIndex();
    return { route: parseRoute(window.location.hash), index, max: readMax(index) };
  });

  useWindowEvent("popstate", () => {
    setNav((current) => ({
      ...current,
      route: parseRoute(window.location.hash),
      index: readIndex(),
    }));
  });

  const navigate = (route: RouteId) => {
    if (route === nav.route) return;
    // Pushing drops any forward entries, so the new one is the furthest.
    const index = nav.index + 1;
    window.history.pushState({ index }, "", `#/${route}`);
    writeMax(index);
    setNav({ route, index, max: index });
  };

  return {
    route: nav.route,
    navigate,
    canGoBack: nav.index > 0,
    canGoForward: nav.index < nav.max,
  };
}
