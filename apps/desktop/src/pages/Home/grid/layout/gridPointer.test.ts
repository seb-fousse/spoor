// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { BLOCK_ATTR, isOnBlock, menuAnchor, ownsEvent } from "./gridPointer";

/** A column at x 100–300, y 50–450, the size `getBoundingClientRect` reports. */
function column(): HTMLElement {
  const element = document.createElement("div");
  element.getBoundingClientRect = () => new DOMRect(100, 50, 200, 400);
  return element;
}

describe("isOnBlock", () => {
  it("is true on a block segment and anything inside it", () => {
    const block = document.createElement("div");
    block.setAttribute(BLOCK_ATTR, "interval-1");
    const label = block.appendChild(document.createElement("span"));
    expect(isOnBlock(block)).toBe(true);
    expect(isOnBlock(label)).toBe(true);
  });

  it("is false in an empty stretch", () => {
    expect(isOnBlock(document.createElement("div"))).toBe(false);
  });
});

describe("ownsEvent", () => {
  it("is true for an event inside the handling element", () => {
    const parent = document.createElement("div");
    const child = parent.appendChild(document.createElement("div"));
    expect(ownsEvent({ currentTarget: parent, target: child })).toBe(true);
    expect(ownsEvent({ currentTarget: parent, target: parent })).toBe(true);
  });

  it("is false for an event from elsewhere, such as a portal's", () => {
    const parent = document.createElement("div");
    const portal = document.createElement("div");
    expect(ownsEvent({ currentTarget: parent, target: portal })).toBe(false);
  });
});

describe("menuAnchor", () => {
  it("gives the pointer as a fraction down the column and pixels from its left", () => {
    expect(menuAnchor(column(), { clientX: 150, clientY: 150 })).toEqual({ top: 0.25, left: 50 });
  });

  it("keeps the left offset inside the column", () => {
    expect(menuAnchor(column(), { clientX: 80, clientY: 50 }).left).toBe(0);
    expect(menuAnchor(column(), { clientX: 400, clientY: 50 }).left).toBe(200);
  });
});
