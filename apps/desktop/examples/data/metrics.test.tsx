// @vitest-environment jsdom
/**
 * Example: a hook test that stubs core. Illustrates docs/conventions/testing.md.
 *
 * It tests what the hooks do with the cache: which reads a write invalidates, and
 * that a failed write keeps core's error. Core's own tests cover the SQL, so the
 * core calls are stubbed and the database is never touched.
 */
import { queryKeys } from "@data/queryKeys";
import { createQueryClient } from "@lib/queryClient";
import {
  type Database,
  listMetrics,
  type ObservationMetric,
  SpoorError,
  updateMetric,
} from "@spoor/core";
import type { QueryClient, QueryKey, UseQueryResult } from "@tanstack/react-query";
import { renderHook, run, waitFor } from "@test/render";
import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { useMetricList, useRenameMetric } from "./metrics";

// Only the calls under test are stubbed; the rest of core, such as SpoorError, is real.
vi.mock("@spoor/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@spoor/core")>()),
  listMetrics: vi.fn(),
  updateMetric: vi.fn(),
}));

// Never touched: every core call that would use it is stubbed.
const db = {} as Database;

const sleep = { id: "sleep", name: "Sleep" } as ObservationMetric;

// Reads other screens hold: the Observations page's list, Home's rail for a day, and
// the time zone, which a metric write doesn't change.
const list = queryKeys.observations.metrics;
const day = queryKeys.observations.day("2026-11-09");
const timeZone = queryKeys.timeZone;

let queryClient: QueryClient;

beforeEach(() => {
  vi.mocked(listMetrics).mockReset();
  vi.mocked(updateMetric).mockReset();
  queryClient = createQueryClient();
  // Cached with no component showing them, so invalidating only marks them.
  for (const key of [list, day, timeZone]) queryClient.setQueryData(key, []);
});

const invalidated = (key: QueryKey) => queryClient.getQueryState(key)?.isInvalidated;

describe("useMetricList", () => {
  it("returns the query's result, typed from core", async () => {
    // Checked by tsc: the data type comes from listMetrics, not from a hand-written type.
    expectTypeOf(useMetricList).returns.toEqualTypeOf<UseQueryResult<ObservationMetric[], Error>>();

    vi.mocked(listMetrics).mockResolvedValue([sleep]);
    queryClient.removeQueries({ queryKey: list });
    const read = await renderHook(useMetricList, { db, queryClient });

    await waitFor(() => expect(read.current.data).toEqual([sleep]));
    expect(listMetrics).toHaveBeenCalledWith(db);
  });
});

describe("useRenameMetric", () => {
  it("invalidates every observation read, Home's rail included", async () => {
    vi.mocked(updateMetric).mockResolvedValue({ ...sleep, name: "Rest" });
    const rename = await renderHook(useRenameMetric, { db, queryClient });

    await run(() => rename.current.mutateAsync({ id: "sleep", name: "Rest" }));

    expect(updateMetric).toHaveBeenCalledWith(db, "sleep", { name: "Rest" });
    expect({ list: invalidated(list), day: invalidated(day), zone: invalidated(timeZone) }).toEqual(
      { list: true, day: true, zone: false },
    );
  });

  it("keeps core's error when the write fails, and invalidates nothing", async () => {
    const refused = new SpoorError("invalid", "Observation metric sleep: name is required", {
      entity: "observation_metric",
      id: "sleep",
      field: "name",
    });
    vi.mocked(updateMetric).mockRejectedValue(refused);
    const rename = await renderHook(useRenameMetric, { db, queryClient });

    await run(() => rename.current.mutateAsync({ id: "sleep", name: "" }).catch(() => null));

    expect(rename.current.error).toBe(refused);
    expect(invalidated(list)).toBe(false);
    expect(invalidated(day)).toBe(false);
  });
});
