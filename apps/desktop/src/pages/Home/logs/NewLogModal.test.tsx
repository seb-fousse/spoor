// @vitest-environment jsdom
import { createQueryClient } from "@lib/queryClient";
import { queryKeys } from "@lib/queryKeys";
import {
  createLogEntry,
  type Database,
  type DayLogGroup,
  getLogTypeFields,
  type LocalDate,
  type LogEntry,
  type LogType,
  listDayLogEntries,
  listLogTypes,
} from "@spoor/core";
import type { QueryClient } from "@tanstack/react-query";
import { createTestRoot, type TestRoot, tick } from "@test/render";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewLogModal } from "./NewLogModal";
import { useDayLogs } from "./useDayLogs";

// The modal's job is what it does with the cache and its own steps around
// core's reads and writes, not the SQL behind them (core's own tests cover
// that), so the core calls it makes are stubbed and each test says what they return.
vi.mock("@spoor/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@spoor/core")>()),
  createLogEntry: vi.fn(),
  getLogTypeFields: vi.fn(),
  listDayLogEntries: vi.fn(),
  listLogTypes: vi.fn(),
}));

// Never touched: every core call that would use it is stubbed.
const db = {} as Database;

const MONDAY = "2026-11-09" as LocalDate;

// A top-level type without fields or child types: choosing it and pressing Add saves an entry.
const walk = {
  id: "walk",
  name: "Walk",
  description: null,
  parentTypeId: null,
  archivedAt: null,
} as LogType;
const entry = { id: "entry-1", logTypeId: walk.id, day: MONDAY, values: {} } as LogEntry;

/** The day's log groups the rail last showed. */
let railGroups: DayLogGroup[] | undefined;

/** The rail's list, beside the modal, reading the same cache as the real rail. */
function RailList() {
  railGroups = useDayLogs(db, MONDAY).data;
  return null;
}

let root: TestRoot;
// A fresh cache per test, so no test sees another's log types, lists or saves.
let queryClient: QueryClient;
let onClose: ReturnType<typeof vi.fn<() => void>>;

/**
 * Lets every query and save in flight finish, and their results render. TanStack
 * Query tells components on a `setTimeout(0)` of its own, so one tick can run
 * before it does; hence the last tick once nothing is in flight.
 */
async function settle() {
  do await tick();
  while (queryClient.isFetching() + queryClient.isMutating() > 0);
  await tick();
}

/** Renders the rail and the modal, open or closed, then lets them load. */
async function showModal(opened: boolean) {
  root.render(
    <>
      <RailList />
      <NewLogModal db={db} opened={opened} day={MONDAY} onClose={onClose} />
    </>,
  );
  await settle();
}

/** The modal renders in a portal, so look through the whole page. */
function button(name: string): HTMLButtonElement {
  const found = [...document.body.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === name || b.getAttribute("aria-label") === name,
  );
  if (!found) throw new Error(`No "${name}" button`);
  return found;
}

function hasButton(name: string): boolean {
  return [...document.body.querySelectorAll("button")].some((b) => b.textContent?.trim() === name);
}

function shownError(): string | null {
  return document.body.querySelector('[role="alert"]')?.textContent ?? null;
}

async function click(name: string) {
  act(() => button(name).click());
  await settle();
}

/** The user picks the Walk card, then presses Add on its form. */
async function addWalk() {
  await click("Walk");
  await click("Add");
}

async function pressEscape() {
  act(() => {
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  await settle();
}

beforeEach(() => {
  vi.mocked(listLogTypes).mockResolvedValue([walk]);
  vi.mocked(getLogTypeFields).mockResolvedValue([]);
  vi.mocked(listDayLogEntries).mockResolvedValue([]);
  queryClient = createQueryClient();
  onClose = vi.fn<() => void>();
  root = createTestRoot({ queryClient, mantine: true });
  railGroups = undefined;
});

afterEach(() => {
  root.unmount();
  queryClient.clear();
  vi.resetAllMocks();
});

describe("NewLogModal", () => {
  it("lists a new entry in the rail once it is saved, and closes", async () => {
    await showModal(true);
    expect(railGroups).toEqual([]);
    // From now on, the day's list includes the saved entry.
    const group = { logType: walk, entries: [{ ...entry, children: [] }] } as DayLogGroup;
    vi.mocked(createLogEntry).mockResolvedValue(entry);
    vi.mocked(listDayLogEntries).mockResolvedValue([group]);

    await addWalk();

    expect(createLogEntry).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ logTypeId: walk.id, precision: "day" }),
    );
    expect(railGroups).toEqual([group]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("marks every cached day's logs out of date when an entry is saved", async () => {
    // Another day's list, loaded earlier and not on screen: an entry can span days.
    const sunday = queryKeys.logs.day("2026-11-08" as LocalDate);
    queryClient.setQueryData(sunday, []);
    vi.mocked(createLogEntry).mockResolvedValue(entry);
    await showModal(true);

    await addWalk();

    expect(queryClient.getQueryState(sunday)?.isInvalidated).toBe(true);
  });

  it("shows a failed save, keeps the form open, and leaves the rail alone", async () => {
    vi.mocked(createLogEntry).mockRejectedValue(new Error("disk full"));
    await showModal(true);

    await addWalk();

    expect(shownError()).toBe("disk full");
    expect(hasButton("Add")).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    expect(listDayLogEntries).toHaveBeenCalledTimes(1);
  });

  it("clears a failed save's error when the user goes back to the log types", async () => {
    vi.mocked(createLogEntry).mockRejectedValue(new Error("disk full"));
    await showModal(true);
    await addWalk();
    expect(shownError()).toBe("disk full");

    await click("Back to log types");

    expect(shownError()).toBeNull();
    expect(hasButton("Walk")).toBe(true);
  });

  it("clears a failed save's error when the user closes the modal and opens it again", async () => {
    vi.mocked(createLogEntry).mockRejectedValue(new Error("disk full"));
    await showModal(true);
    await addWalk();
    expect(shownError()).toBe("disk full");

    await pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1);
    // The rail closes the modal when asked, and the user opens it again later.
    await showModal(false);
    await showModal(true);

    expect(shownError()).toBeNull();
    expect(hasButton("Walk")).toBe(true);
  });
});
