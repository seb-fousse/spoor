// @vitest-environment jsdom
import { createQueryClient } from "@lib/queryClient";
import type { Database } from "@spoor/core";
import * as core from "@spoor/core";
import {
  type LocalDate,
  listDayObservations,
  type MetricDay,
  type Observation,
  type ObservationMetric,
  type RecordObservationResult,
  recordObservation,
} from "@spoor/core";
import type { QueryClient } from "@tanstack/react-query";
import { createTestRoot, type TestRoot, tick } from "@test/render";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type DayObservations,
  type ObservationWrites,
  useDayObservations,
  useObservationWrites,
} from "./observations";
import { queryKeys } from "./queryKeys";

// These hooks' job is what they do with the cache around core's reads and
// writes, not the SQL behind them (core's own tests cover that), so core's
// calls are stubbed. The Observations page's writes succeed by default; the
// rail's tests say what the day's read and the record return.
vi.mock("@spoor/core", async (importOriginal) => ({
  ...(await importOriginal<typeof core>()),
  createMetric: vi.fn(async () => ({})),
  updateMetric: vi.fn(async () => ({})),
  setMetricArchived: vi.fn(async () => {}),
  deleteMetric: vi.fn(async () => {}),
  recordObservation: vi.fn(async () => ({ observation: {}, skipped: false })),
  deleteObservation: vi.fn(async () => {}),
  listDayObservations: vi.fn(),
}));

// Never touched: every core call that would use it is stubbed.
const db = {} as Database;

let root: TestRoot;
// A fresh cache per test, so no test sees another's loaded days or saves.
let queryClient: QueryClient;

const invalidated = (key: readonly unknown[]) => queryClient.getQueryState(key)?.isInvalidated;

let writes: ObservationWrites | undefined;

function Probe() {
  writes = useObservationWrites();
  return null;
}

/** What the rail sees, captured on each render. */
let seen: DayObservations | undefined;

function Rail({ day }: { day: LocalDate }) {
  seen = useDayObservations(day);
  return null;
}

describe("useObservationWrites", () => {
  const day = "2026-11-09";

  /** What reads observations: Home's rail and day counts, and this page's lists. */
  const observationKeys = {
    rail: queryKeys.observations.day(day),
    counts: queryKeys.observations.counts("2026-11-05", day),
    page: queryKeys.observations.metrics,
    metric: queryKeys.observations.metric("m1"),
  };
  const unrelated = queryKeys.logs.day(day);

  beforeEach(async () => {
    queryClient = createQueryClient();
    // Loaded data with no component reading it, as Home's is while this page is open.
    for (const key of [...Object.values(observationKeys), unrelated])
      queryClient.setQueryData(key, []);
    root = createTestRoot({ queryClient, db });
    await root.renderAsync(<Probe />);
  });

  afterEach(() => {
    root.unmount();
    queryClient.clear();
    vi.clearAllMocks();
  });

  /** Each of the page's writes, called the way the page calls it. */
  const calls: [string, (w: ObservationWrites) => Promise<unknown>][] = [
    ["creating a metric", (w) => w.createMetric({ name: "Mood", valueType: "number" })],
    ["editing a metric", (w) => w.updateMetric({ id: "m1", patch: { name: "Sleep" } })],
    ["archiving a metric", (w) => w.setMetricArchived({ id: "m1", archived: true })],
    ["deleting a metric", (w) => w.deleteMetric("m1")],
    [
      "recording an observation",
      (w) => w.recordObservation({ metricId: "m1", date: day, value: 7 }),
    ],
    ["deleting an observation", (w) => w.deleteObservation("o1")],
  ];

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

describe("useDayObservations", () => {
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
    root.render(<Rail day={day} />);
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
    root = createTestRoot({ queryClient, db });
    seen = undefined;
  });

  afterEach(() => {
    root.unmount();
    queryClient.clear();
    vi.resetAllMocks();
  });

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

  it("marks the grid's day counts and the metric's list out of date when a save succeeds", async () => {
    vi.mocked(recordObservation).mockResolvedValue({
      observation: observation(MONDAY, 7),
      skipped: false,
    });
    // Loaded earlier: the grid's counts for some window, and the Observations
    // page's lists for sleep and for another metric.
    const counts = queryKeys.observations.counts(MONDAY, TUESDAY);
    const sleepList = queryKeys.observations.metric(sleep.id);
    const otherList = queryKeys.observations.metric("mood");
    for (const key of [counts, sleepList, otherList]) queryClient.setQueryData(key, []);
    await showDay(MONDAY);

    await recordSleep(7);
    await settle();

    expect(queryClient.getQueryState(counts)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(sleepList)?.isInvalidated).toBe(true);
    // Another metric's observations didn't change.
    expect(queryClient.getQueryState(otherList)?.isInvalidated).toBe(false);
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

  it("leaves the grid's day counts and the metric's list alone when a save fails", async () => {
    vi.mocked(recordObservation).mockRejectedValue(new Error("disk full"));
    const counts = queryKeys.observations.counts(MONDAY, TUESDAY);
    const sleepList = queryKeys.observations.metric(sleep.id);
    queryClient.setQueryData(counts, new Map());
    queryClient.setQueryData(sleepList, []);
    await showDay(MONDAY);

    await expect(recordSleep(7)).rejects.toThrow("disk full");
    await settle();

    expect(queryClient.getQueryState(counts)?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(sleepList)?.isInvalidated).toBe(false);
  });
});
