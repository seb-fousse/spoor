// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { ownsKey } from "./ownsKey";

function render(html: string): HTMLElement {
  document.body.innerHTML = html;
  const target = document.querySelector<HTMLElement>("#target");
  if (!target) throw new Error("no #target");
  return target;
}

describe("ownsKey", () => {
  it("is false for plain elements, buttons and no target", () => {
    expect(ownsKey(render(`<div><button id="target">Mon 9</button></div>`), "ArrowLeft")).toBe(
      false,
    );
    expect(ownsKey(document.body, "ArrowLeft")).toBe(false);
    expect(ownsKey(null, "ArrowLeft")).toBe(false);
  });

  it.each([
    `<input id="target">`,
    `<input type="search" id="target">`,
    `<textarea id="target"></textarea>`,
    `<div contenteditable id="target"></div>`,
  ])("gives every key to a text field: %s", (html) => {
    const target = render(html);
    expect(ownsKey(target, "ArrowLeft")).toBe(true);
    expect(ownsKey(target, "k")).toBe(true);
  });

  it.each([
    `<input type="radio" id="target">`,
    `<select id="target"></select>`,
    `<div role="separator" tabindex="0" id="target"></div>`,
    `<div role="tablist"><button role="tab" id="target"></button></div>`,
    `<div role="dialog"><button id="target"></button></div>`,
  ])("gives only the navigation keys to an arrow-key widget: %s", (html) => {
    const target = render(html);
    expect(ownsKey(target, "ArrowLeft")).toBe(true);
    expect(ownsKey(target, "End")).toBe(true);
    expect(ownsKey(target, "k")).toBe(false);
  });

  it("is false for contenteditable=false", () => {
    expect(ownsKey(render(`<div contenteditable="false" id="target"></div>`), "k")).toBe(false);
  });
});
