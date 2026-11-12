// @vitest-environment jsdom
import { createQueryClient } from "@lib/queryClient";
import { queryKeys } from "@lib/queryKeys";
import {
  type Database,
  type LocalDate,
  listDayObservations,
  type MetricDay,
  type Observation,
  type ObservationMetric,
  type RecordObservationResult,
  recordObservation,
} from "@spoor/core";
import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type DayObservations, useDayObservations } from "./useDayObservations";

// The hook's job is what it does with the cache around core's reads and writes,
// not the SQL behind them (core's own tests cover that), so core's two calls
// are stubbed and each test says what they return.
vi.mock("@spoor/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@spoor/core")>()),
  listDayObservations: vi.fn(),
  recordObservation: vi.fn(),
}));

// Tell React this is a test environment, so `act` flushes renders and effects.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Never touched: every core call that would use it is stubbed.
const db = {} as Database;

const MONDAY = "2026-11-09" as LocalDate;
const TUESDAY = "2026-11-10" as LocalDate;

// Only the fields the hook reads; the rest of a metric doesn't matter here.
const sleep = { id: "sleep" } as ObservationMetric;

function observation(date: LocalDate, value: number): Observation {
  return { id: `obs-${date}`, metricId: sleep.id, date, value } as Observation;
}

/** A promise the test settles when it chooses, to hold a save in flight. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** What the rail sees, captured on each render. */
let seen: DayObservations | undefined;

function Rail({ day }: { day: LocalDate }) {
  seen = useDayObservations(db, day);
  return null;
}

let root: Root;
// A fresh cache per test, so no test sees another's loaded days or saves.
let queryClient: QueryClient;

/** One real macrotask, inside `act` so the renders it causes are flushed. */
async function tick() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/**
 * Lets every query in flight finish, and its result render. TanStack Query tells
 * components on a `setTimeout(0)` of its own, so one tick can run before it does;
 * hence the last tick once nothing is loading. Saves aren't waited for here: the
 * tests await `record` themselves, and one holds a save open across a day change.
 */
async function settle() {
  do await tick();
  while (queryClient.isFetching() > 0);
  await tick();
}

/** Shows the rail for `day`, then lets that day load. */
async function showDay(day: LocalDate) {
  act(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <Rail day={day} />
      </QueryClientProvider>,
    ),
  );
  await settle();
}

function current(): DayObservations {
  if (!seen) throw new Error("The rail did not render");
  return seen;
}

/** The user records `value` for sleep on the day shown; returns the save, still running. */
function recordSleep(value: number): Promise<void> {
  let saving: Promise<void> = Promise.resolve();
  act(() => {
    saving = current().record(sleep.id, value);
  });
  return saving;
}

function cachedDay(day: LocalDate) {
  return queryClient.getQueryData<{ day: LocalDate; items: MetricDay[] }>(
    queryKeys.observations.day(day),
  );
}

beforeEach(() => {
  // Every day starts with sleep not yet observed.
  vi.mocked(listDayObservations).mockResolvedValue([{ metric: sleep, observation: null }]);
  queryClient = createQueryClient();
  root = createRoot(document.createElement("div"));
  seen = undefined;
});

afterEach(() => {
  act(() => root.unmount());
  queryClient.clear();
  vi.resetAllMocks();
});

describe("useDayObservations", () => {
  it("shows the stored observation on the day it was recorded, without reloading the day", async () => {
    const stored = observation(MONDAY, 7);
    vi.mocked(recordObservation).mockResolvedValue({ observation: stored, skipped: false });
    await showDay(MONDAY);

    await recordSleep(7);
    await settle();

    expect(recordObservation).toHaveBeenCalledWith(db, sleep.id, MONDAY, 7);
    expect(current().items).toEqual([{ metric: sleep, observation: stored }]);
    expect(listDayObservations).toHaveBeenCalledTimes(1);
  });

  it("writes a save into its own day when the user has moved to another day before it finishes", async () => {
    const save = deferred<RecordObservationResult>();
    vi.mocked(recordObservation).mockReturnValue(save.promise);
    await showDay(MONDAY);

    const saving = recordSleep(7);
    await showDay(TUESDAY);
    const stored = observation(MONDAY, 7);
    save.resolve({ observation: stored, skipped: false });
    await saving;
    await settle();

    expect(cachedDay(MONDAY)?.items).toEqual([{ metric: sleep, observation: stored }]);
    // Tuesday, on screen, is untouched.
    expect(current().day).toBe(TUESDAY);
    expect(current().items).toEqual([{ metric: sleep, observation: null }]);
  });

  it("marks the grid's day counts out of date when a save succeeds", async () => {
    vi.mocked(recordObservation).mockResolvedValue({
      observation: observation(MONDAY, 7),
      skipped: false,
    });
    // The grid's counts for some window, loaded earlier.
    const counts = queryKeys.observations.counts(MONDAY, TUESDAY);
    queryClient.setQueryData(counts, new Map());
    await showDay(MONDAY);

    await recordSleep(7);
    await settle();

    expect(queryClient.getQueryState(counts)?.isInvalidated).toBe(true);
  });

  it("shows a failed save on its day, and not on other days", async () => {
    vi.mocked(recordObservation).mockRejectedValue(new Error("disk full"));
    await showDay(MONDAY);

    await expect(recordSleep(7)).rejects.toThrow("disk full");
    await settle();
    expect(current().error).toBe("disk full");

    await showDay(TUESDAY);
    expect(current().error).toBeNull();

    await showDay(MONDAY);
    expect(current().error).toBe("disk full");
  });

  it("leaves the grid's day counts alone when a save fails", async () => {
    vi.mocked(recordObservation).mockRejectedValue(new Error("disk full"));
    const counts = queryKeys.observations.counts(MONDAY, TUESDAY);
    queryClient.setQueryData(counts, new Map());
    await showDay(MONDAY);

    await expect(recordSleep(7)).rejects.toThrow("disk full");
    await settle();

    expect(queryClient.getQueryState(counts)?.isInvalidated).toBe(false);
  });
});
