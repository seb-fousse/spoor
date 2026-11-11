// @vitest-environment jsdom
import type { Database } from "@spoor/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type HomeState, HomeStateProvider, useHomeState } from "./HomeState";
import { windowDays } from "./homeDays";

// Tell React this is a test environment, so `act` flushes renders and effects.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// A database whose only setting is `time_zone`, so "today" doesn't depend on the machine.
const db: Database = {
  execute: async () => {},
  query: async <T,>() => [{ value: JSON.stringify("UTC") }] as T[],
};

/** What the page sees, captured on each render while it is mounted. */
let seen: HomeState | undefined;

function Page() {
  seen = useHomeState();
  return null;
}

/** The app: the provider always mounted, the page only while the user is on Home. */
function App({ onHome }: { onHome: boolean }) {
  return <HomeStateProvider db={db}>{onHome ? <Page /> : null}</HomeStateProvider>;
}

let root: Root;

/** Renders the app, then lets the time zone load. */
async function show(onHome: boolean) {
  seen = undefined;
  await act(async () => {
    root.render(<App onHome={onHome} />);
    // A real macrotask: lets the setting's query and its follow-up renders finish.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** What the page shows after the user comes back to it. */
async function returnHome(): Promise<HomeState> {
  await show(true);
  if (!seen) throw new Error("Home did not render");
  return seen;
}

function current(): HomeState {
  if (!seen) throw new Error("Home is not mounted");
  return seen;
}

/** Midnight passes, and the next minute's check notices. */
function passMidnight() {
  act(() => {
    vi.setSystemTime(Date.UTC(2026, 10, 10, 0, 0, 30));
    vi.advanceTimersByTime(60_000);
  });
}

beforeEach(() => {
  // Fake the clock and the minute check, but keep setTimeout real for `show`.
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(Date.UTC(2026, 10, 9, 12));
  root = createRoot(document.createElement("div"));
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

describe("HomeStateProvider", () => {
  it("opens on five days ending today, with today active", async () => {
    const { today, days } = await returnHome();
    expect(today).toBe("2026-11-09");
    expect(days).toEqual({ activeDay: "2026-11-09", windowEnd: "2026-11-09", range: "5days" });
  });

  it("keeps the active day, the window and the range when the user leaves Home", async () => {
    await show(true);
    act(() => {
      current().dispatch({ type: "setRange", range: "week" });
      current().dispatch({ type: "stepActive", by: -9 });
    });
    const before = current().days;
    expect(windowDays(before)[0]).toBe("2026-10-31");

    await show(false);
    expect(seen).toBeUndefined();
    const after = await returnHome();
    expect(after.days).toEqual(before);
  });

  it("moves a user who left on today to the new today when midnight passes while away", async () => {
    await show(true);
    act(() => current().dispatch({ type: "setRange", range: "day" }));

    await show(false);
    passMidnight();
    const { today, days } = await returnHome();

    expect(today).toBe("2026-11-10");
    expect(days).toEqual({ activeDay: "2026-11-10", windowEnd: "2026-11-10", range: "day" });
  });

  it("leaves a user who left on another day there when midnight passes while away", async () => {
    await show(true);
    act(() => current().dispatch({ type: "stepActive", by: -2 }));
    const before = current().days;

    await show(false);
    passMidnight();
    const { today, days } = await returnHome();

    expect(today).toBe("2026-11-10");
    expect(days).toEqual(before);
  });
});
