// @vitest-environment jsdom
import { createQueryClient } from "@lib/queryClient";
import { setTimeZone } from "@spoor/core";
import { createTestDatabase } from "@test/database";
import { renderHook, waitFor } from "@test/render";
import { describe, expect, it } from "vitest";
import { useTimeZone } from "./settings";

// The hooks on core's real database. Nothing in the app writes settings yet,
// so this only reads.

describe("useTimeZone", () => {
  it("reads the stored zone", async () => {
    const db = await createTestDatabase();
    // Not the zone the tests run in, so the device's zone can't pass for it.
    await setTimeZone(db, "Pacific/Chatham");

    const hooks = await renderHook(() => useTimeZone(), { db, queryClient: createQueryClient() });

    await waitFor(() => expect(hooks.current.data).toBe("Pacific/Chatham"));
  });
});
