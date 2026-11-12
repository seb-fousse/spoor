import type { QueryKey } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { createQueryClient } from "./queryClient";
import { queryKeys } from "./queryKeys";

/** How many times `queryKey`'s read runs when fetched twice in a row. */
async function readsWhenFetchedTwice(queryKey: QueryKey) {
  const queryClient = createQueryClient();
  const queryFn = vi.fn(async () => "data");
  await queryClient.fetchQuery({ queryKey, queryFn });
  await queryClient.fetchQuery({ queryKey, queryFn });
  return queryFn.mock.calls.length;
}

describe("createQueryClient", () => {
  it("keeps database queries fresh until a write invalidates them", async () => {
    const queryClient = createQueryClient();
    for (const key of [queryKeys.timeZone, queryKeys.timelines.grid, queryKeys.logs.all]) {
      expect(queryClient.getQueryDefaults(key).staleTime).toBe(Infinity);
    }
    expect(await readsWhenFetchedTwice(queryKeys.timelines.grid)).toBe(1);
  });

  it("leaves other queries at TanStack's default, stale at once", async () => {
    const queryClient = createQueryClient();
    expect(queryClient.getQueryDefaults(["api", "weather"]).staleTime).toBeUndefined();
    expect(await readsWhenFetchedTwice(["api", "weather"])).toBe(2);
  });
});
