import { type RefObject, useEffect } from "react";
import { edgeScroll } from "./edgeScroll";

/** The elements the days' scroll area is measured from. */
interface ScrollParts {
  scroller: RefObject<HTMLElement | null>;
  /** The sticky header along the top. */
  header: RefObject<HTMLElement | null>;
  /** The sticky hour gutter down the left. */
  gutter: RefObject<HTMLElement | null>;
}

/**
 * While `active` (a block is being drawn or dragged), scrolls the grid when
 * the pointer nears an edge of the days, or goes past one: sideways to reach
 * days out of view, up and down for hours (see `edgeScroll`).
 *
 * Scrolling moves the days under a pointer that may not move, so after each
 * step the last move is sent again, as a `pointermove` on the element that
 * captured the pointer. The drag's own handlers then see where the pointer is
 * now on the days, as if it had moved there.
 */
export function useEdgeAutoScroll({ scroller, header, gutter }: ScrollParts, active: boolean) {
  useEffect(() => {
    if (!active) return;
    let last: PointerEvent | null = null;
    // Only the user's moves: the ones sent below repeat the last.
    const onMove = (event: PointerEvent) => {
      if (event.isTrusted) last = event;
    };
    window.addEventListener("pointermove", onMove, { capture: true, passive: true });

    let frame = requestAnimationFrame(function step() {
      frame = requestAnimationFrame(step);
      const el = scroller.current;
      if (!el || !last) return;
      const rect = el.getBoundingClientRect();
      const { dx, dy } = edgeScroll(
        { x: last.clientX, y: last.clientY },
        {
          left: rect.left + el.clientLeft + (gutter.current?.offsetWidth ?? 0),
          right: rect.left + el.clientLeft + el.clientWidth,
          top: rect.top + el.clientTop + (header.current?.offsetHeight ?? 0),
          bottom: rect.top + el.clientTop + el.clientHeight,
        },
      );
      if (dx === 0 && dy === 0) return;
      const { scrollLeft, scrollTop } = el;
      el.scrollLeft += dx;
      el.scrollTop += dy;
      // At the end of the days or the hours: nothing moved under the pointer.
      if (el.scrollLeft === scrollLeft && el.scrollTop === scrollTop) return;
      last.target?.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX: last.clientX,
          clientY: last.clientY,
          screenX: last.screenX,
          screenY: last.screenY,
          pointerId: last.pointerId,
          pointerType: last.pointerType,
          isPrimary: last.isPrimary,
          buttons: last.buttons,
        }),
      );
    });

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove, { capture: true });
    };
  }, [active, scroller, header, gutter]);
}
