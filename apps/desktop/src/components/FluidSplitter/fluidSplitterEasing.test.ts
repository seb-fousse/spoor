import { describe, expect, it } from "vitest";
import { type Easing, easeFraction, easeSizes } from "./fluidSplitterEasing";

const FRAME = 1 / 60;
const ease = easeFraction(10, FRAME);

/** Runs the easing over a sequence of targets for the left pane (right = 100 - left). */
function simulate(lefts: number[], maxDelta = 10) {
  let state: Easing = { mid: [lefts[0], 100 - lefts[0]], shown: [lefts[0], 100 - lefts[0]] };
  const shown: number[] = [];
  for (const left of lefts) {
    state = easeSizes([left, 100 - left], state, ease, maxDelta);
    shown.push(state.shown[0]);
  }
  return shown;
}

/** A jerky drag to the left (pointer events bunch up), a pause, a fast drag, then a hold. */
function leftwardDrag() {
  const lefts: number[] = [];
  let left = 70;
  for (let i = 0; i < 40; i++) {
    left -= i % 3 === 0 ? 1.4 : 0.2;
    lefts.push(left);
  }
  for (let i = 0; i < 20; i++) lefts.push(left);
  for (let i = 0; i < 30; i++) {
    left -= 1;
    lefts.push(left);
  }
  for (let i = 0; i < 240; i++) lefts.push(left);
  return lefts;
}

describe("easeSizes", () => {
  it("never moves the panes against the direction of the drag", () => {
    const shown = simulate(leftwardDrag());
    for (let i = 1; i < shown.length; i++) {
      expect(shown[i]).toBeLessThanOrEqual(shown[i - 1] + 1e-9);
    }
  });

  it("never overshoots the target", () => {
    const lefts = leftwardDrag();
    const shown = simulate(lefts);
    shown.forEach((value, i) => {
      expect(value).toBeGreaterThanOrEqual(lefts[i] - 1e-9);
    });
  });

  it("never trails the target by more than maxDelta", () => {
    const lefts = leftwardDrag();
    const shown = simulate(lefts, 3);
    shown.forEach((value, i) => {
      expect(Math.abs(value - lefts[i])).toBeLessThanOrEqual(3 + 1e-9);
    });
  });

  it("settles onto the target once it stops moving", () => {
    const lefts = leftwardDrag();
    const shown = simulate(lefts);
    expect(shown.at(-1)).toBeCloseTo(lefts.at(-1) as number, 3);
  });

  it("keeps two panes summing to the same total", () => {
    let state: Easing = { mid: [70, 30], shown: [70, 30] };
    for (let i = 0; i < 30; i++) {
      state = easeSizes([40, 60], state, ease, 5);
      expect(state.shown[0] + state.shown[1]).toBeCloseTo(100, 9);
    }
  });
});
