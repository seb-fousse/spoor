import type { LocalDate } from "@spoor/core";
import { type Dispatch, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { HomeDaysAction } from "../../homeDays";
import { type DayStrip, nearestLeft, placement, sameLeft, settledStart } from "./dayScroll";

/**
 * How long the grid waits after the last scroll event before it takes the
 * scroll as settled. Long enough to outlast the gaps in a trackpad's momentum
 * and the snap after it; `scrollend` isn't used, since it isn't clear the
 * macOS webview sends it reliably.
 */
export const SETTLE_MS = 150;

/** Tells the window where the strip settled, if it is on a day boundary. */
function settle(el: HTMLElement, strip: DayStrip, dispatch: Dispatch<HomeDaysAction>) {
  const start = settledStart(el.scrollLeft, strip);
  if (start) dispatch({ type: "scroll", start });
}

/**
 * Scrolling Home's grid sideways, day by day. The grid renders `days`, the
 * window's `visible` days with as many either side, each a `visible`th of the
 * width right of the hour gutter. This keeps the strip in step with the
 * window:
 *
 * - When the days change, the strip keeps what is on screen in place, then
 *   animates to the window, in the centre (see `placement`). An arrow, a day
 *   key or Today animates there; a scroll that settled is already there.
 * - Once a scroll settles on a day boundary, the day at the left edge becomes
 *   the window's start (`scroll`), which re-centres the strip around it, so
 *   there are always days to scroll to either way.
 * - While `dragging` (a block being drawn or moved), it doesn't settle; the
 *   grid's CSS also turns snapping off, so the drag can scroll it smoothly.
 *   When the drag ends, the strip goes to the nearest day boundary.
 *
 * Spread `onScroll` on the scroller, `scrollRef` on it and `gutterRef` on the
 * hour gutter, and size each day column `width` pixels.
 */
export function useDayScroll(
  days: readonly LocalDate[],
  visible: number,
  dragging: boolean,
  dispatch: Dispatch<HomeDaysAction>,
) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  // The width the days share: the scroller's, less its scrollbar and the gutter.
  const [viewport, setViewport] = useState(0);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setViewport(el.clientWidth - (gutterRef.current?.offsetWidth ?? 0));
    measure();
    // jsdom has none; the size it measured above is all it gets.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const width = viewport > 0 ? viewport / visible : 0;

  // The strip as last placed, where it was last scrolled to, and the pending settle.
  const strip = useRef<DayStrip | null>(null);
  const scrolledTo = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const glide = useRef(0);
  const isDragging = useRef(dragging);

  // Before the new days paint, so the strip never shows them out of place.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || width === 0) return;
    // A settle due from before would report where the strip was, not where it is going.
    clearTimeout(timer.current);
    cancelAnimationFrame(glide.current);
    const next = { days, visible, width };
    // Where it was before these days rendered. Not `el.scrollLeft`: reading it
    // lays the new days out, and Chrome then re-snaps to the day that was
    // snapped, which would count the shift twice.
    const { from, to } = placement(scrolledTo.current, strip.current, next);
    strip.current = next;
    el.scrollLeft = from;
    scrolledTo.current = from;
    if (sameLeft(from, to)) return;
    // Two frames on, once the jump above has reached the compositor. Started
    // sooner, while an earlier glide is still running (a second press of an
    // arrow), Chrome merges the two, and the strip stalls short of the window.
    glide.current = requestAnimationFrame(() => {
      glide.current = requestAnimationFrame(() => el.scrollTo({ left: to, behavior: "smooth" }));
    });
  }, [days, visible, width]);

  useEffect(
    () => () => {
      clearTimeout(timer.current);
      cancelAnimationFrame(glide.current);
    },
    [],
  );

  // A drag may leave the strip between two days; snap it to the nearest.
  useEffect(() => {
    isDragging.current = dragging;
    const el = scrollRef.current;
    const s = strip.current;
    if (dragging || !el || !s) return;
    const left = nearestLeft(el.scrollLeft, s);
    if (sameLeft(left, el.scrollLeft)) settle(el, s, dispatch);
    else el.scrollTo({ left, behavior: "smooth" });
  }, [dragging, dispatch]);

  const onScroll = () => {
    if (scrollRef.current) scrolledTo.current = scrollRef.current.scrollLeft;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const el = scrollRef.current;
      const s = strip.current;
      if (el && s && !isDragging.current) settle(el, s, dispatch);
    }, SETTLE_MS);
  };

  return { scrollRef, gutterRef, width, onScroll };
}
