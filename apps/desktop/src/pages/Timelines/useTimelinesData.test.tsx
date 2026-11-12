// @vitest-environment jsdom
import { createQueryClient } from "@lib/queryClient";
import { queryKeys } from "@lib/queryKeys";
import { QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useTimelinesWrite } from "./useTimelinesData";

// Tell React this is a test environment, so `act` flushes renders and effects.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The hook's result, captured on each render. */
let write: ReturnType<typeof useTimelinesWrite> | undefined;

function Page() {
  write = useTimelinesWrite();
  return null;
}

// What Home and this page read, cached as if both had been visited, plus another group's query.
const list = queryKeys.timelines.list;
const grid = queryKeys.timelines.grid;
const intervals = queryKeys.timelines.intervals(["t1"], "2026-11-05", "2026-11-09", "UTC");
const logs = queryKeys.logs.day("2026-11-09");

let root: Root;
let queryClient: ReturnType<typeof createQueryClient>;

/** Runs `action` through the hook, then lets the hook re-render with the outcome. */
async function run(action: () => Promise<unknown>) {
  await act(async () => {
    await write?.mutateAsync(action).catch(() => {});
    // A real macrotask: the query client notifies observers, so the hook re-renders, on one.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const invalidated = (key: readonly unknown[]) => queryClient.getQueryState(key)?.isInvalidated;

beforeEach(async () => {
  queryClient = createQueryClient();
  for (const key of [list, grid, intervals, logs]) queryClient.setQueryData(key, []);
  root = createRoot(document.createElement("div"));
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <Page />
      </QueryClientProvider>,
    );
  });
});

afterEach(() => {
  act(() => root.unmount());
  queryClient.clear();
  write = undefined;
});

describe("useTimelinesWrite", () => {
  it("invalidates this page's list and Home's grid and intervals after a write", async () => {
    await run(async () => {});
    expect(invalidated(list)).toBe(true);
    expect(invalidated(grid)).toBe(true);
    expect(invalidated(intervals)).toBe(true);
    // Timelines writes touch nothing else.
    expect(invalidated(logs)).toBe(false);
  });

  it("invalidates nothing and reports the error when a write fails", async () => {
    await run(async () => {
      throw new Error("Timeline t1: not found");
    });
    expect(invalidated(list)).toBe(false);
    expect(invalidated(grid)).toBe(false);
    expect(write?.error?.message).toBe("Timeline t1: not found");
  });
});
