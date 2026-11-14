// @vitest-environment jsdom
import { createQueryClient } from "@lib/queryClient";
import type { Database, FieldDefinition } from "@spoor/core";
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { createTestRoot, type TestRoot, tick } from "@test/render";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "./queryKeys";
import { type ThingWriteReach, useRefTitles, useThingWrite } from "./things";

// The stored title of thing "t1", which a write below changes.
let storedTitle = "Alex";
vi.mock("@spoor/core", () => ({ getThingTitle: async () => storedTitle }));

const db = {} as Database;
const refField = {
  id: "f1",
  name: "Who",
  shape: { valueType: "ref", constraints: { thingTypeId: "person" } },
} as FieldDefinition;
const entry = { values: { f1: "t1" } };

// What the screens see, captured on each render.
let write: ReturnType<typeof useThingWrite> | undefined;
let titles: Map<string, string> | undefined;

/** A log rail row showing a thing's title, beside the Things page writing. */
function Screen() {
  write = useThingWrite();
  titles = useRefTitles([refField], entry).data;
  return null;
}

let root: TestRoot;
let queryClient: QueryClient;

/** Lets queries and their follow-up renders finish. */
const settle = tick;

/** Runs a write through the hook, then lets what it invalidated refetch. */
async function run(action: () => Promise<unknown>, reach: ThingWriteReach) {
  await act(async () => {
    await write?.(action, reach);
  });
  await settle();
}

// Other screens' reads, which are not mounted here, so invalidating them only marks them stale.
const logDay = queryKeys.logs.day("2026-11-09");
const grid = queryKeys.timelines.grid;
const invalidated = (queryKey: QueryKey) => queryClient.getQueryState(queryKey)?.isInvalidated;

beforeEach(async () => {
  storedTitle = "Alex";
  queryClient = createQueryClient();
  queryClient.setQueryData(logDay, []);
  queryClient.setQueryData(grid, []);
  root = createTestRoot({ queryClient, db });
  await root.renderAsync(<Screen />);
  await settle();
});

afterEach(() => {
  root.unmount();
  queryClient.clear();
});

describe("useThingWrite", () => {
  it("refreshes thing titles shown elsewhere, and nothing else, after a write to things", async () => {
    expect(titles?.get("t1")).toBe("Alex");

    await run(async () => {
      storedTitle = "Alexandra";
    }, "things");

    expect(titles?.get("t1")).toBe("Alexandra");
    expect(invalidated(logDay)).toBe(false);
    expect(invalidated(grid)).toBe(false);
  });

  it("also invalidates timelines, whose categories follow titles, after a title change", async () => {
    await run(async () => {}, "titles");

    expect(invalidated(grid)).toBe(true);
    expect(invalidated(logDay)).toBe(false);
  });

  it("also invalidates log entries after a write that changes references to things", async () => {
    await run(async () => {}, "references");

    expect(invalidated(logDay)).toBe(true);
    expect(invalidated(grid)).toBe(true);
  });

  it("rejects a failed write and invalidates nothing, since core rolled it back", async () => {
    let failure: unknown;
    await act(async () => {
      await write?.(() => Promise.reject(new Error("nope")), "references").catch((e) => {
        failure = e;
      });
    });

    expect(failure).toEqual(new Error("nope"));
    expect(invalidated(queryKeys.things.titles(["t1"]))).toBe(false);
    expect(invalidated(logDay)).toBe(false);
  });
});
