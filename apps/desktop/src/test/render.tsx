import { MantineProvider } from "@mantine/core";
import { DatabaseProvider } from "@platform/DatabaseProvider";
import type { Database } from "@spoor/core";
import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { theme } from "@theme";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

/**
 * Rendering React in tests, in jsdom. `./setup` has already told React it runs
 * under `act`, and given Mantine a reduced-motion media query.
 */

interface Providers {
  /** Wraps what is rendered in a `QueryClientProvider` for this cache. */
  queryClient?: QueryClient;
  /** Gives what is rendered this database, for `useDatabase`. */
  db?: Database;
  /** Wraps what is rendered in the app's Mantine theme, with reduced motion respected. */
  mantine?: boolean;
}

function withProviders(ui: ReactNode, { queryClient, db, mantine }: Providers): ReactNode {
  let tree = ui;
  if (mantine) {
    tree = (
      <MantineProvider theme={{ ...theme, respectReducedMotion: true }}>{tree}</MantineProvider>
    );
  }
  if (db) tree = <DatabaseProvider db={db}>{tree}</DatabaseProvider>;
  if (queryClient) tree = <QueryClientProvider client={queryClient}>{tree}</QueryClientProvider>;
  return tree;
}

/**
 * A React root for one test, inside the `providers` asked for. Its container
 * is on the page, so portals, focus and `document.body` queries work. Render
 * again to change props; `unmount` removes the container too.
 */
export function createTestRoot(providers: Providers = {}) {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  return {
    container,
    /** Renders `ui`, flushing its renders and effects. */
    render(ui: ReactNode) {
      act(() => root.render(withProviders(ui, providers)));
    },
    /** Renders `ui`, then also lets the promises it started settle. */
    async renderAsync(ui: ReactNode) {
      await act(async () => root.render(withProviders(ui, providers)));
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

export type TestRoot = ReturnType<typeof createTestRoot>;

/**
 * One real macrotask, inside `act` so the renders it causes are flushed.
 * TanStack Query tells components about results on a `setTimeout(0)` of its
 * own, so waiting for one lets a query's result render.
 */
export async function tick(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
