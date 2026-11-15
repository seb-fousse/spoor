// @vitest-environment jsdom
import { createQueryClient } from "@lib/queryClient";
import { createLogType, setTimeZone } from "@spoor/core";
import { createTestDatabase } from "@test/database";
import { renderHook, run, waitFor } from "@test/render";
import { describe, expect, it } from "vitest";
import { useCreateLogEntry, useDayLogs, useLogEntries } from "./logs";

// The hooks on core's real database: a write has to reach the reads already on screen.

const DAY = "2026-11-09";

describe("creating a log entry", () => {
  it("shows it in its day's logs and its type's entries", async () => {
    const db = await createTestDatabase();
    await setTimeZone(db, "UTC");
    const coffee = await createLogType(db, { name: "Coffee", fields: [] });

    const hooks = await renderHook(
      () => ({
        day: useDayLogs(DAY),
        entries: useLogEntries(coffee.id),
        create: useCreateLogEntry(),
      }),
      { db, queryClient: createQueryClient() },
    );
    await waitFor(() => {
      expect(hooks.current.day.data).toEqual([]);
      expect(hooks.current.entries.data).toEqual([]);
    });

    const entry = await run(() =>
      hooks.current.create.mutateAsync({
        logTypeId: coffee.id,
        occurredAt: Date.UTC(2026, 10, 9, 8),
      }),
    );

    // Home's log rail for the day.
    const day = hooks.current.day.data ?? [];
    expect(day.map((group) => group.logType.id)).toEqual([coffee.id]);
    expect(day[0]?.entries.map((e) => e.id)).toEqual([entry.id]);
    // The Logs page's list for the type.
    expect(hooks.current.entries.data?.map((e) => e.id)).toEqual([entry.id]);
  });
});
