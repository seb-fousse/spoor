import { Box, Splitter, type SplitterPaneProps, type SplitterProps } from "@mantine/core";
import { useReducedMotion } from "@mantine/hooks";
import {
  Children,
  isValidElement,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import classes from "./FluidSplitter.module.css";
import { easeFraction, easeSizes } from "./fluidSplitterEasing";

/*
 * Feel. While dragging, the grabbed point of the line tracks the mouse. The
 * panes, and the straight divider between them, trail behind it (see
 * fluidSplitterEasing.ts): they start at rest, get pulled along (a faster drag
 * opens a bigger gap), and ease back under the mouse once it stops or is let
 * go, never overshooting.
 */
/** How quickly the panes catch up (1/s). Higher keeps them closer behind the mouse. */
const FOLLOW_RATE = 10;
/** Farthest, in px, the panes may trail behind the mouse. */
const MAX_BEND = 128;
/** Once the panes are this close to the mouse, in px, the line is straight again. */
const REST = 0.3;

type FluidSplitterProps = Omit<SplitterProps, "sizes">;

/** Mantine's divider elements. */
const SEPARATOR = '[role="separator"]';

/** Each pane's `defaultSize`, or null if any is not a plain number (percentages). */
function defaultSizes(children: ReactNode): number[] | null {
  const sizes = Children.toArray(children).map((child) =>
    isValidElement<SplitterPaneProps>(child) ? child.props.defaultSize : undefined,
  );
  return sizes.every((size) => typeof size === "number") ? (sizes as number[]) : null;
}

/**
 * Mantine's Splitter, in either orientation, whose divider bends like a string
 * while it is dragged. Four layers, back to front:
 * - the panes, sized to trail behind the mouse;
 * - the straight divider between them (Mantine's own handle);
 * - the "drag space": the wedge between the divider and the bent line, which
 *   covers the pane content there so nothing shows past the bent line;
 * - the bent line, from the divider's ends to the grabbed point at the mouse.
 *
 * Panes need plain-number `defaultSize`s (percentages); otherwise this falls
 * back to a plain Splitter. Takes all other Splitter props; `h` sizes the
 * wrapper, and the Splitter fills it.
 *
 * FluidSplitters can be nested: each one only reacts to its own dividers.
 *
 * Built for two panes. With more, only the held divider bends, and easing each
 * pane separately can briefly leave the sizes not adding up to the total.
 */
export function FluidSplitter({ h, children, onSizeChange, ...props }: FluidSplitterProps) {
  const initial = defaultSizes(children);
  const fluid = initial !== null;
  // Side-by-side panes (the default) have an upright divider that moves along x;
  // stacked panes have a flat one that moves along y.
  const sideBySide = props.orientation !== "vertical";

  const rootRef = useRef<HTMLDivElement>(null);
  const curveRef = useRef<SVGPathElement>(null);
  const spaceRef = useRef<SVGPathElement>(null);
  const reducedMotion = useReducedMotion();
  // Unique per instance, so several splitters never share one pattern.
  const gridId = `fluid-splitter-grid-${useId()}`;

  // The sizes the panes are drawn at. They trail `target`, Mantine's own
  // mouse-driven sizes.
  const [shown, setShown] = useState<number[]>(initial ?? []);

  // Live drag state, kept in a ref so frames don't depend on React state.
  const state = useRef({
    target: initial ?? [],
    /** The easing stage between `target` and the shown sizes. */
    mid: initial ?? [],
    shown: initial ?? [],
    /** Which divider is held: the handle between pane `handle` and `handle + 1`. */
    handle: 0,
    /** The held divider's thickness, in px, measured when it is grabbed. */
    lineWidth: 0,
    dragging: false,
    /** The pointer's position along the divider (y for an upright one, x for a flat one). */
    pointerAlong: 0,
    frame: 0,
    lastTime: 0,
  });

  // Stop the loop and drop the overlay on unmount (and on hot reload).
  useEffect(() => {
    const s = state.current;
    const root = rootRef.current;
    return () => {
      cancelAnimationFrame(s.frame);
      s.frame = 0;
      root?.removeAttribute("data-bending");
    };
  }, []);

  const show = (sizes: number[]) => {
    state.current.shown = sizes;
    // Render now, inside this frame, so the panes and the drawn line agree.
    flushSync(() => setShown(sizes));
  };

  const step = (time: number) => {
    const s = state.current;
    const root = rootRef.current;
    const curve = curveRef.current;
    const space = spaceRef.current;
    if (!root || !curve || !space) {
      s.frame = 0;
      return;
    }

    // Clamp dt so a stalled frame doesn't jump the panes. The first frame's
    // timestamp can predate the grab, so never step backwards.
    const seconds = Math.max(0, Math.min(time - s.lastTime, 32)) / 1000 || 1 / 60;
    s.lastTime = time;

    // "Across" is the axis the divider moves along; "along" runs down its length.
    const box = root.getBoundingClientRect();
    const across = sideBySide ? box.width : box.height;
    const length = sideBySide ? box.height : box.width;
    const total = s.target.reduce((a, b) => a + b, 0);
    // Sizes -> the held divider's centre, in px from the wrapper's start edge.
    const span = across - s.lineWidth;
    const toPx = (sizes: number[]) =>
      (sizes.slice(0, s.handle + 1).reduce((a, b) => a + b, 0) / total) * span + s.lineWidth / 2;

    const eased = easeSizes(
      s.target,
      { mid: s.mid, shown: s.shown },
      easeFraction(FOLLOW_RATE, seconds),
      (MAX_BEND / span) * total,
    );
    s.mid = eased.mid;
    const next = eased.shown;

    const peak = toPx(s.target);
    const line = toPx(next);
    const settled =
      !s.dragging && Math.abs(peak - line) < REST && Math.abs(peak - toPx(s.mid)) < REST;
    if (settled) {
      show(s.target);
      s.mid = s.target;
      root.removeAttribute("data-bending");
      s.frame = 0;
      return;
    }
    show(next);

    // The bent line: from the divider's start, to the grabbed point at the
    // mouse, to the divider's end. Tangents parallel to the divider give a
    // smooth curve. Points are (across, along), swapped for a flat divider.
    const pt = (a: number, b: number) => (sideBySide ? `${a} ${b}` : `${b} ${a}`);
    const start = sideBySide ? box.top : box.left;
    const p = Math.max(0, Math.min(length, s.pointerAlong - start));
    const d =
      `M ${pt(line, 0)} C ${pt(line, p * 0.55)} ${pt(peak, p * 0.45)} ${pt(peak, p)} ` +
      `C ${pt(peak, p + (length - p) * 0.45)} ${pt(line, p + (length - p) * 0.55)} ${pt(line, length)}`;
    curve.setAttribute("d", d);
    // The drag space: the same curve, closed back up along the straight divider.
    space.setAttribute("d", `${d} Z`);
    root.setAttribute("data-bending", "");

    s.frame = requestAnimationFrame(step);
  };

  const handleSizeChange: SplitterProps["onSizeChange"] = (sizes) => {
    onSizeChange?.(sizes);
    const numeric = sizes.map((size) => (typeof size === "number" ? size : parseFloat(size)));
    const s = state.current;
    s.target = numeric;
    // Keyboard steps and double-click resets jump straight there.
    if (!s.dragging && !s.frame) {
      s.mid = numeric;
      show(numeric);
    }
  };

  const onPointerDownCapture = (event: PointerEvent<HTMLDivElement>) => {
    // Mantine only drags with the main button; don't animate for any other.
    if (reducedMotion || event.button !== 0) return;
    const root = rootRef.current;
    if (!root) return;
    // Only this splitter's own dividers: those of a FluidSplitter nested in a
    // pane sit inside this one too, and handle themselves.
    const ownHandles = Array.from(root.querySelectorAll<HTMLElement>(SEPARATOR)).filter(
      (el) => el.closest(`.${classes.root}`) === root,
    );
    const handle = (event.target as HTMLElement).closest<HTMLElement>(SEPARATOR);
    if (!handle || !ownHandles.includes(handle)) return;

    const s = state.current;
    s.handle = ownHandles.indexOf(handle);
    const handleBox = handle.getBoundingClientRect();
    s.lineWidth = sideBySide ? handleBox.width : handleBox.height;
    s.dragging = true;
    const along = (e: { clientX: number; clientY: number }) => (sideBySide ? e.clientY : e.clientX);
    s.pointerAlong = along(event);

    const onMove = (e: globalThis.PointerEvent) => {
      s.pointerAlong = along(e);
    };
    const onUp = () => {
      s.dragging = false;
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);

    // (Re)start the loop; a new grab mid-settle simply carries on from there.
    cancelAnimationFrame(s.frame);
    s.lastTime = performance.now();
    s.frame = requestAnimationFrame(step);
  };

  if (!fluid) {
    return (
      <Splitter h={h} onSizeChange={onSizeChange} {...props}>
        {children}
      </Splitter>
    );
  }

  return (
    <Box ref={rootRef} h={h} className={classes.root} onPointerDownCapture={onPointerDownCapture}>
      <Splitter h="100%" {...props} sizes={shown} onSizeChange={handleSizeChange}>
        {children}
      </Splitter>
      <svg className={classes.overlay} aria-hidden="true">
        <defs>
          {/* Dot-grid paper. In page space, so the dots stay still while the
              gap moves over them, like the sheet underneath showing through. */}
          <pattern id={gridId} width="16" height="16" patternUnits="userSpaceOnUse">
            <rect width="16" height="16" className={classes.paper} />
            <circle cx="8" cy="8" r="1" className={classes.dot} />
          </pattern>
        </defs>
        <path ref={spaceRef} fill={`url(#${gridId})`} />
        <path ref={curveRef} className={classes.curve} />
      </svg>
    </Box>
  );
}
