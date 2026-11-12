// @vitest-environment jsdom
import { createQueryClient } from "@lib/queryClient";
import { queryKeys } from "@lib/queryKeys";
import type { Database } from "@spoor/core";
import * as core from "@spoor/core";
import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ObservationWrites, useObservationWrites } from "./useObservationsData";

// Tell React this is a test environment, so `act` flushes renders and effects.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Core's writes, stubbed: these tests are about what the cache does after one.
vi.mock("@spoor/core", async (importOriginal) => ({
  ...(await importOriginal<typeof core>()),
  createMetric: vi.fn(async () => ({})),
  updateMetric: vi.fn(async () => ({})),
  setMetricArchived: vi.fn(async () => {}),
  deleteMetric: vi.fn(async () => {}),
  recordObservation: vi.fn(async () => ({ observation: {}, skipped: false })),
  deleteObservation: vi.fn(async () => {}),
}));

const db = {} as Database;
const day = "2026-11-09";

/** What reads observations: Home's rail and day counts, and this page's lists. */
const observationKeys = {
  rail: queryKeys.observations.day(day),
  counts: queryKeys.observations.counts("2026-11-05", day),
  page: queryKeys.observations.metrics,
  metric: queryKeys.observations.metric("m1"),
};
const unrelated = queryKeys.logs.day(day);

let writes: ObservationWrites | undefined;

function Probe() {
  writes = useObservationWrites(db);
  return null;
}

let root: Root;
let queryClient: QueryClient;

beforeEach(async () => {
  queryClient = createQueryClient();
  // Loaded data with no component reading it, as Home's is while this page is open.
  for (const key of [...Object.values(observationKeys), unrelated])
    queryClient.setQueryData(key, []);
  root = createRoot(document.createElement("div"));
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>,
    );
  });
});

afterEach(() => {
  act(() => root.unmount());
  queryClient.clear();
  vi.clearAllMocks();
});

const invalidated = (key: readonly unknown[]) => queryClient.getQueryState(key)?.isInvalidated;

/** Each of the page's writes, called the way the page calls it. */
const calls: [string, (w: ObservationWrites) => Promise<unknown>][] = [
  ["creating a metric", (w) => w.createMetric({ name: "Mood", valueType: "number" })],
  ["editing a metric", (w) => w.updateMetric({ id: "m1", patch: { name: "Sleep" } })],
  ["archiving a metric", (w) => w.setMetricArchived({ id: "m1", archived: true })],
  ["deleting a metric", (w) => w.deleteMetric("m1")],
  ["recording an observation", (w) => w.recordObservation({ metricId: "m1", date: day, value: 7 })],
  ["deleting an observation", (w) => w.deleteObservation("o1")],
];

describe("useObservationWrites", () => {
  it.each(calls)("%s invalidates Home's rail and counts and the page's lists", async (_, call) => {
    await act(async () => {
      await call(writes as ObservationWrites);
    });
    for (const key of Object.values(observationKeys)) expect(invalidated(key)).toBe(true);
    expect(invalidated(unrelated)).toBe(false);
  });

  it("invalidates nothing when the write fails", async () => {
    vi.mocked(core.updateMetric).mockRejectedValueOnce(new Error("name required"));
    await act(async () => {
      await expect(
        (writes as ObservationWrites).updateMetric({ id: "m1", patch: { name: "" } }),
      ).rejects.toThrow("name required");
    });
    for (const key of Object.values(observationKeys)) expect(invalidated(key)).toBe(false);
  });
});
