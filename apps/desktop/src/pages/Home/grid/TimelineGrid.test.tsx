// @vitest-environment jsdom
import { createQueryClient } from "@lib/queryClient";
import type { Database, LocalDate, Timeline } from "@spoor/core";
import type { QueryClient } from "@tanstack/react-query";
import { createTestRoot, type TestRoot, tick } from "@test/render";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bufferDays, type HomeDays, homeDaysReducer, initialHomeDays } from "../homeDays";
import { SETTLE_MS } from "./layout/useDayScroll";
import { TimelineGrid } from "./TimelineGrid";
import type { GridView } from "./useGridData";

// The grid's own reads are the day badges' counts: none recorded.
vi.mock("@spoor/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@spoor/core")>()),
  countDayObservations: vi.fn(async () => []),
}));

// Never touched: the one core call that would use it is stubbed.
const db = {} as Database;

const TODAY = "2026-11-09" as LocalDate;

const timeline: Timeline = {
  id: "sleep",
  name: "Sleep",
  description: null,
  exclusive: true,
  defaultThingTypeId: null,
  createdAt: 0,
  updatedAt: 0,
  archivedAt: null,
};
const view: GridView = {
  timeZone: "UTC",
  timelines: [timeline],
  categories: new Map(),
  intervals: [],
};

// jsdom lays nothing out, and doesn't scroll. The scroller is 556px wide with
// a 56px gutter, so each of five days is 100px; scroll positions are stored
// as set, and `scrollTo` is recorded.
const scrolled = new WeakMap<Element, { left: number; top: number }>();
const position = (el: Element) => scrolled.get(el) ?? { left: 0, top: 0 };
const scrollTo = vi.fn();

let root: TestRoot;
let queryClient: QueryClient;
const dispatch = vi.fn();

beforeEach(() => {
  vi.spyOn(Element.prototype, "clientWidth", "get").mockReturnValue(556);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(56);
  vi.spyOn(Element.prototype, "scrollLeft", "get").mockImplementation(function (this: Element) {
    return position(this).left;
  });
  vi.spyOn(Element.prototype, "scrollLeft", "set").mockImplementation(function (
    this: Element,
    left: number,
  ) {
    scrolled.set(this, { ...position(this), left });
  });
  vi.spyOn(Element.prototype, "scrollTop", "set").mockImplementation(function (
    this: Element,
    top: number,
  ) {
    scrolled.set(this, { ...position(this), top });
  });
  Element.prototype.scrollTo = scrollTo;
  queryClient = createQueryClient();
  root = createTestRoot({ queryClient, db, mantine: true });
});

afterEach(() => {
  root.unmount();
  queryClient.clear();
  vi.restoreAllMocks();
  scrollTo.mockReset();
  dispatch.mockReset();
});

/** Shows the grid for `days`, as Home does. */
async function show(days: HomeDays) {
  root.render(
    <TimelineGrid
      read={{ status: "success", data: view, error: null, isPlaceholderData: false }}
      hiddenTimelines={new Set()}
      onShowAllTimelines={() => {}}
      days={bufferDays(days)}
      visible={5}
      activeDay={days.activeDay}
      dispatch={dispatch}
    />,
  );
  await tick();
}

/** Waits out the frames the grid waits before it glides to the window. */
async function frames() {
  await act(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

/** The element that scrolls: the one holding the header and the hours. */
function scroller(): HTMLElement {
  const body = document.querySelector("[data-drag-root]");
  if (!body?.parentElement) throw new Error("No grid");
  return body.parentElement;
}

/** The user scrolls the days to `left` and stops there. */
async function scrollAndStop(left: number) {
  const el = scroller();
  el.scrollLeft = left;
  el.dispatchEvent(new Event("scroll"));
  await act(() => new Promise((resolve) => setTimeout(resolve, SETTLE_MS + 20)));
}

describe("TimelineGrid's sideways scrolling", () => {
  it("renders a window's worth either side, and opens on the window", async () => {
    await show(initialHomeDays(TODAY));
    const days = [...document.querySelectorAll("button[data-day]")].map((b) =>
      b.getAttribute("data-day"),
    );
    expect(days).toHaveLength(15);
    expect(days[5]).toBe("2026-11-05");
    expect(scroller().scrollLeft).toBe(500);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("animates to the window when it pages, from where the days were", async () => {
    const start = initialHomeDays(TODAY);
    await show(start);
    const lefts: number[] = [];
    scrollTo.mockImplementation(function (this: Element) {
      lefts.push(this.scrollLeft);
    });

    await show(homeDaysReducer(start, { type: "pageWindow", by: 1 }));
    await frames();

    // The days that were in view are now the first five; it slides on from there.
    expect(lefts).toEqual([0]);
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ left: 500, behavior: "smooth" });
  });

  it("animates a day when the active day steps past the window", async () => {
    const start = initialHomeDays(TODAY);
    await show(start);
    await show(homeDaysReducer(start, { type: "stepActive", by: 1 }));
    expect(scroller().scrollLeft).toBe(400);
    await frames();
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ left: 500, behavior: "smooth" });
  });

  it("moves the window to the day at the left edge once a scroll settles", async () => {
    await show(initialHomeDays(TODAY));
    dispatch.mockReset();

    await scrollAndStop(700);

    expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: "scroll", start: "2026-11-07" });
  });

  it("re-centres on the new window without moving the days on screen", async () => {
    const start = initialHomeDays(TODAY);
    await show(start);
    await scrollAndStop(700);

    await show(homeDaysReducer(start, { type: "scroll", start: "2026-11-07" }));
    await frames();

    expect(scroller().scrollLeft).toBe(500);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("waits while the days are between two, as while snapping", async () => {
    await show(initialHomeDays(TODAY));
    dispatch.mockReset();

    await scrollAndStop(650);

    expect(dispatch).not.toHaveBeenCalled();
  });

  it("goes straight to the new window when the range changes", async () => {
    const start = initialHomeDays(TODAY);
    await show(start);
    root.render(
      <TimelineGrid
        read={{ status: "success", data: view, error: null, isPlaceholderData: false }}
        hiddenTimelines={new Set()}
        onShowAllTimelines={() => {}}
        days={bufferDays({ windowEnd: TODAY, range: "week" })}
        visible={7}
        activeDay={TODAY}
        dispatch={dispatch}
      />,
    );
    await tick();
    await frames();

    expect(scroller().scrollLeft).toBeCloseTo(500);
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
