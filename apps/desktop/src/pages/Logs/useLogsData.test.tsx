// @vitest-environment jsdom
import { createQueryClient } from "@lib/queryClient";
import { queryKeys } from "@lib/queryKeys";
import type { Database } from "@spoor/core";
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { createTestRoot, type TestRoot } from "@test/render";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLogEntryWrites, useLogFieldWrites, useLogTypeWrites } from "./useLogsData";

// The writes succeed without a database; only what they invalidate is under test.
vi.mock("@spoor/core", () => {
  const ok = () => vi.fn(async () => undefined);
  return {
    addLogField: ok(),
    createLogEntry: ok(),
    createLogType: ok(),
    deleteLogEntry: ok(),
    deleteLogField: ok(),
    deleteLogType: ok(),
    moveChildEntry: ok(),
    reorderLogFields: ok(),
    setLogTypeArchived: ok(),
    updateLogField: ok(),
  };
});

const db = {} as Database;

type Writes = {
  types: ReturnType<typeof useLogTypeWrites>;
  fields: ReturnType<typeof useLogFieldWrites>;
  entries: ReturnType<typeof useLogEntryWrites>;
};

let writes: Writes | undefined;

function Page() {
  writes = {
    types: useLogTypeWrites(db),
    fields: useLogFieldWrites(db, "type-1"),
    entries: useLogEntryWrites(db),
  };
  return null;
}

let root: TestRoot;
let queryClient: QueryClient;

// What Home reads: a day's logs, the log types, and a type's fields.
const day = queryKeys.logs.day("2026-11-09");
const types = queryKeys.logTypes.list;
const fields = queryKeys.logTypes.fields("type-1");

beforeEach(async () => {
  queryClient = createQueryClient();
  for (const key of [day, types, fields]) queryClient.setQueryData(key, []);
  root = createTestRoot({ queryClient });
  await root.renderAsync(<Page />);
});

afterEach(() => {
  root.unmount();
  queryClient.clear();
});

const invalidated = (key: QueryKey) => queryClient.getQueryState(key)?.isInvalidated;

/** Runs a write from the page's hooks, then reports which of Home's queries it invalidated. */
async function write(run: (w: Writes) => Promise<unknown>) {
  if (!writes) throw new Error("The page did not render");
  const current = writes;
  await act(() => run(current));
  return { day: invalidated(day), types: invalidated(types), fields: invalidated(fields) };
}

describe("the Logs page's writes", () => {
  it.each<[string, (w: Writes) => Promise<unknown>]>([
    ["creating an entry", (w) => w.entries.create({ logTypeId: "type-1", values: {} })],
    ["moving a child entry", (w) => w.entries.move({ id: "entry-1", position: 2 })],
    ["deleting an entry", (w) => w.entries.remove("entry-1")],
  ])("invalidate Home's day logs, not the types, on %s", async (_, run) => {
    expect(await write(run)).toEqual({ day: true, types: false, fields: false });
  });

  it.each<[string, (w: Writes) => Promise<unknown>]>([
    ["creating a type", (w) => w.types.create({ name: "Run", fields: [] })],
    ["adding a field", (w) => w.fields.add({ name: "Distance", valueType: "number" })],
    ["updating a field", (w) => w.fields.update({ fieldId: "field-1", patch: { name: "Km" } })],
    ["reordering fields", (w) => w.fields.reorder(["field-2", "field-1"])],
  ])("invalidate the types and fields, not the day logs, on %s", async (_, run) => {
    expect(await write(run)).toEqual({ day: false, types: true, fields: true });
  });

  it.each<[string, (w: Writes) => Promise<unknown>]>([
    ["archiving a type", (w) => w.types.setArchived({ id: "type-1", archived: true })],
    ["deleting a type", (w) => w.types.remove("type-1")],
    ["deleting a field", (w) => w.fields.remove("field-1")],
  ])("invalidate the types, the fields and the day logs, on %s", async (_, run) => {
    expect(await write(run)).toEqual({ day: true, types: true, fields: true });
  });
});
