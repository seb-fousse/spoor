// @vitest-environment jsdom
import { createQueryClient } from "@lib/queryClient";
import {
  type Database,
  type LocalDate,
  listDayObservations,
  type ObservationMetric,
  recordObservation,
} from "@spoor/core";
import type { QueryClient } from "@tanstack/react-query";
import { createTestRoot, type TestRoot, tick } from "@test/render";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ObservationRail } from "./ObservationRail";

// The rail's job here is which errors it shows, not the SQL behind its reads
// and writes (core's own tests cover that), so the core calls it makes are
// stubbed and each test says what they return.
vi.mock("@spoor/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@spoor/core")>()),
  listDayObservations: vi.fn(),
  recordObservation: vi.fn(),
}));

// Never touched: every core call that would use it is stubbed.
const db = {} as Database;

const MONDAY = "2026-11-09" as LocalDate;
const TUESDAY = "2026-11-10" as LocalDate;

const slept = {
  id: "slept",
  name: "Slept well",
  description: null,
  valueType: "boolean",
  constraints: {},
  optionLabels: {},
  archivedAt: null,
} as unknown as ObservationMetric;

let root: TestRoot;
// A fresh cache per test, so no test sees another's loaded days or saves.
let queryClient: QueryClient;

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

/** Shows the rail for `day`, then lets that day load. */
async function showDay(day: LocalDate) {
  root.render(<ObservationRail day={day} />);
  await settle();
}

function shownError(): string | null {
  return document.body.querySelector('[role="alert"]')?.textContent ?? null;
}

/** The user answers "Yes" on the card, which records it. */
async function answerYes() {
  const yes = [...document.body.querySelectorAll("label")].find(
    (l) => l.textContent?.trim() === "Yes",
  );
  if (!yes) throw new Error('No "Yes" option');
  act(() => yes.click());
  await settle();
}

beforeEach(() => {
  // jsdom has none; Mantine's segmented control watches its size with one.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.mocked(listDayObservations).mockResolvedValue([{ metric: slept, observation: null }]);
  queryClient = createQueryClient();
  root = createTestRoot({ queryClient, db, mantine: true });
});

afterEach(() => {
  root.unmount();
  queryClient.clear();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe("ObservationRail", () => {
  it("shows a failed save on its day, and not on other days", async () => {
    vi.mocked(recordObservation).mockRejectedValue(new Error("disk full"));
    await showDay(MONDAY);

    await answerYes();
    expect(recordObservation).toHaveBeenCalledWith(db, slept.id, MONDAY, true);
    expect(shownError()).toContain("disk full");

    await showDay(TUESDAY);
    expect(shownError()).toBeNull();

    await showDay(MONDAY);
    expect(shownError()).toContain("disk full");
  });
});
