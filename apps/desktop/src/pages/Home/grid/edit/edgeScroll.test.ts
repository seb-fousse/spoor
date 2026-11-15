import { describe, expect, it } from "vitest";
import { EDGE_SPEED, EDGE_ZONE, edgeScroll, edgeSpeed } from "./edgeScroll";

describe("edgeSpeed", () => {
  it("is zero away from both edges", () => {
    expect(edgeSpeed(500, 0, 1000)).toBe(0);
    expect(edgeSpeed(EDGE_ZONE, 0, 1000)).toBe(0);
    expect(edgeSpeed(1000 - EDGE_ZONE, 0, 1000)).toBe(0);
  });

  it("scrolls back near the start, faster nearer the edge", () => {
    const near = edgeSpeed(EDGE_ZONE / 2, 0, 1000);
    expect(near).toBe(-EDGE_SPEED / 2);
    expect(edgeSpeed(0, 0, 1000)).toBe(-EDGE_SPEED);
  });

  it("scrolls on near the end", () => {
    expect(edgeSpeed(1000 - EDGE_ZONE / 2, 0, 1000)).toBe(EDGE_SPEED / 2);
    expect(edgeSpeed(1000, 0, 1000)).toBe(EDGE_SPEED);
  });

  it("goes no faster past an edge", () => {
    expect(edgeSpeed(-300, 0, 1000)).toBe(-EDGE_SPEED);
    expect(edgeSpeed(1600, 0, 1000)).toBe(EDGE_SPEED);
  });
});

describe("edgeScroll", () => {
  const area = { left: 56, right: 856, top: 53, bottom: 653 };

  it("scrolls neither way in the middle", () => {
    expect(edgeScroll({ x: 400, y: 300 }, area)).toEqual({ dx: 0, dy: 0 });
  });

  it("scrolls each axis on its own", () => {
    expect(edgeScroll({ x: 860, y: 300 }, area)).toEqual({ dx: EDGE_SPEED, dy: 0 });
    expect(edgeScroll({ x: 400, y: 40 }, area)).toEqual({ dx: 0, dy: -EDGE_SPEED });
  });

  it("scrolls both ways in a corner", () => {
    expect(edgeScroll({ x: 50, y: 700 }, area)).toEqual({ dx: -EDGE_SPEED, dy: EDGE_SPEED });
  });
});
