// @vitest-environment jsdom
import { createQueryClient } from "@lib/queryClient";
import { createMetric } from "@spoor/core";
import { createTestDatabase } from "@test/database";
import { renderHook, run, waitFor } from "@test/render";
import { describe, expect, it } from "vitest";
import {
  useDayObservations,
  useMetricObservations,
  useObservationCounts,
  useRecordObservation,
} from "./observations";

// The hooks on core's real database: a write has to reach the reads already on screen.

const DAY = "2026-11-09";
// The grid's visible window, as Home passes it.
const DAYS = ["2026-11-08", DAY, "2026-11-10"];

describe("recording an observation", () => {
  it("shows it in its day's observations, the grid's day counts and the metric's list", async () => {
    const db = await createTestDatabase();
    const mood = await createMetric(db, { name: "Mood", valueType: "number" });

    const hooks = await renderHook(
      () => ({
        day: useDayObservations(DAY),
        counts: useObservationCounts(DAYS),
        metric: useMetricObservations(mood.id),
        record: useRecordObservation(),
      }),
      { db, queryClient: createQueryClient() },
    );
    await waitFor(() => {
      expect(hooks.current.day.data?.items.map((i) => i.observation)).toEqual([null]);
      expect(hooks.current.counts.data?.get(DAY)?.recorded).toBe(0);
      expect(hooks.current.metric.data).toEqual([]);
    });

    const { observation } = await run(() =>
      hooks.current.record.mutateAsync({ metricId: mood.id, date: DAY, value: 7 }),
    );

    // Home's rail for the day.
    expect(hooks.current.day.data?.items.map((i) => i.observation?.value)).toEqual([7]);
    // The grid's badge for the day.
    expect(hooks.current.counts.data?.get(DAY)).toMatchObject({ recorded: 1, total: 1 });
    // The Observations page's list for the metric.
    expect(hooks.current.metric.data?.map((o) => o.id)).toEqual([observation.id]);
  });
});
