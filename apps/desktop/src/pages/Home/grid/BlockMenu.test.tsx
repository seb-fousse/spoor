// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { theme } from "@theme";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BlockMenu } from "./BlockMenu";

// Tell React this is a test environment, so `act` flushes renders and effects.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  // jsdom has no media queries. Mantine asks for one to respect reduced motion;
  // saying yes opens the menu at once, without waiting out its transition.
  window.matchMedia = (query: string) =>
    ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
});

let root: Root;
let container: HTMLElement;
let onSplit: ReturnType<typeof vi.fn<() => void>>;
let onDelete: ReturnType<typeof vi.fn<() => void>>;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  onSplit = vi.fn<() => void>();
  onDelete = vi.fn<() => void>();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function show(splitLabel: string | null = "Split at 10:30") {
  act(() =>
    root.render(
      <MantineProvider theme={{ ...theme, respectReducedMotion: true }}>
        <BlockMenu
          top={0.5}
          left={10}
          splitLabel={splitLabel}
          onSplit={onSplit}
          onDelete={onDelete}
          onClose={() => {}}
        />
      </MantineProvider>,
    ),
  );
}

/** The menu renders in a portal, so look through the whole page. */
function item(text: string): HTMLButtonElement {
  const found = [...document.body.querySelectorAll<HTMLButtonElement>("[role='menuitem']")].find(
    (b) => b.textContent?.includes(text),
  );
  if (!found) throw new Error(`No "${text}" item`);
  return found;
}

describe("BlockMenu", () => {
  it("splits the block", () => {
    show();
    act(() => item("Split at 10:30").click());
    expect(onSplit).toHaveBeenCalledOnce();
  });

  it("deletes the block, and shows the key that does it", () => {
    show();
    const remove = item("Delete block");
    expect(remove.getAttribute("aria-keyshortcuts")).toBe("Backspace Delete");
    expect(remove.querySelector("kbd")?.textContent).toBe("⌫");
    act(() => remove.click());
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it("still offers to delete when the block can't be split there", () => {
    show(null);
    expect(item("Split").disabled).toBe(true);
    expect(item("Delete block").disabled).toBe(false);
  });
});
