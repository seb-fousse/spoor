/** The app's pages, in tab order. Home comes first and is the default. */
export const routes = [
  { id: "home", label: "Home" },
  { id: "analytics", label: "Analytics" },
  { id: "timelines", label: "Timelines" },
  { id: "observations", label: "Observations" },
  { id: "logs", label: "Logs" },
  { id: "things", label: "Things" },
  { id: "settings", label: "Settings" },
] as const;

export type RouteId = (typeof routes)[number]["id"];

/** Reads a route from a location hash such as `#/logs`; anything unknown is Home. */
export function parseRoute(hash: string): RouteId {
  const id = hash.replace(/^#\/?/, "");
  return routes.find((route) => route.id === id)?.id ?? "home";
}
