// @vitest-environment jsdom
import { createQueryClient } from "@lib/queryClient";
import { useGridData } from "@pages/Home/grid/useGridData";
import { createCategory, createInterval, createTimeline, setTimeZone } from "@spoor/core";
import { createTestDatabase } from "@test/database";
import { renderHook, run, waitFor } from "@test/render";
import { describe, expect, it } from "vitest";
import { useCreateInterval, useDeleteInterval, useUpdateInterval } from "./timelines";

// The hooks on core's real database: a write has to reach the reads already on screen.

// The grid's visible window, as Home passes it.
const DAYS = ["2026-11-08", "2026-11-09", "2026-11-10"];
const at = (hour: number) => Date.UTC(2026, 10, 9, hour);

/** A timeline with one category, and Home's grid mounted with the interval writes. */
async function setup() {
  const db = await createTestDatabase();
  await setTimeZone(db, "UTC");
  const timeline = await createTimeline(db, { name: "Activities", exclusive: true });
  const work = await createCategory(db, timeline.id, { name: "Work" });
  const mount = async () => {
    const hooks = await renderHook(
      () => ({
        grid: useGridData(DAYS),
        create: useCreateInterval(),
        update: useUpdateInterval(),
        remove: useDeleteInterval(),
      }),
      { db, queryClient: createQueryClient() },
    );
    await waitFor(() => expect(hooks.current.grid.status).toBe("success"));
    return hooks;
  };
  return { db, timeline, work, mount };
}

describe("the grid's intervals", () => {
  it("show a block drawn on the grid", async () => {
    const { timeline, work, mount } = await setup();
    const hooks = await mount();
    expect(hooks.current.grid.data?.intervals).toEqual([]);

    const created = await run(() =>
      hooks.current.create.mutateAsync({
        timelineId: timeline.id,
        categoryId: work.id,
        startAt: at(9),
        endAt: at(10),
      }),
    );

    expect(hooks.current.grid.data?.intervals.map((i) => i.id)).toEqual([created.id]);
  });

  it("show a block where it was moved", async () => {
    const { db, timeline, work, mount } = await setup();
    const block = await createInterval(db, { categoryId: work.id, startAt: at(9), endAt: at(10) });
    const hooks = await mount();
    expect(hooks.current.grid.data?.intervals.map((i) => i.startAt)).toEqual([at(9)]);

    await run(() =>
      hooks.current.update.mutateAsync({
        id: block.id,
        timelineId: timeline.id,
        startAt: at(14),
        endAt: at(15),
      }),
    );

    expect(hooks.current.grid.data?.intervals).toMatchObject([
      { id: block.id, startAt: at(14), endAt: at(15) },
    ]);
  });

  it("drop a deleted block", async () => {
    const { db, work, mount } = await setup();
    const block = await createInterval(db, { categoryId: work.id, startAt: at(9), endAt: at(10) });
    const hooks = await mount();
    expect(hooks.current.grid.data?.intervals.map((i) => i.id)).toEqual([block.id]);

    await run(() => hooks.current.remove.mutateAsync(block.id));

    expect(hooks.current.grid.data?.intervals).toEqual([]);
  });
});
