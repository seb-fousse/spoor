// @vitest-environment jsdom
/**
 * Example: an integration test on core's in-memory database. Illustrates
 * docs/conventions/testing.md.
 *
 * Nothing is stubbed, and there is no vi.mock: the real hooks run against a real,
 * migrated SQLite database. A write has to reach the reads already on screen, so the
 * test renders both, makes the write, and checks the read.
 */
import { createQueryClient } from "@lib/queryClient";
import { createMetric } from "@spoor/core";
import { createTestDatabase } from "@test/database";
import { renderHook, run, waitFor } from "@test/render";
import { describe, expect, it } from "vitest";
import { useMetricList, useRenameMetric } from "./metrics";

describe("renaming a metric", () => {
  it("shows the new name in the list on screen", async () => {
    // Closed when the test finishes. Seeded with core's own functions.
    const db = await createTestDatabase();
    const sleep = await createMetric(db, { name: "Sleep", valueType: "number" });

    const hooks = await renderHook(() => ({ list: useMetricList(), rename: useRenameMetric() }), {
      db,
      queryClient: createQueryClient(),
    });
    await waitFor(() => expect(hooks.current.list.data?.map((m) => m.name)).toEqual(["Sleep"]));

    await run(() => hooks.current.rename.mutateAsync({ id: sleep.id, name: "Rest" }));

    expect(hooks.current.list.data?.map((m) => m.name)).toEqual(["Rest"]);
  });

  it("keeps the old name when core refuses the new one", async () => {
    const db = await createTestDatabase();
    const sleep = await createMetric(db, { name: "Sleep", valueType: "number" });

    const hooks = await renderHook(() => ({ list: useMetricList(), rename: useRenameMetric() }), {
      db,
      queryClient: createQueryClient(),
    });
    await waitFor(() => expect(hooks.current.list.data).toHaveLength(1));

    await run(() =>
      hooks.current.rename.mutateAsync({ id: sleep.id, name: " " }).catch(() => null),
    );

    // Tests assert an error's code and details, never its message.
    expect(hooks.current.rename.error).toMatchObject({
      code: "invalid",
      details: { field: "name" },
    });
    expect(hooks.current.list.data?.map((m) => m.name)).toEqual(["Sleep"]);
  });
});
