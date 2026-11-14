// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { theme } from "@theme";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BlockMenu, PasteMenu } from "./BlockMenu";

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
let onCopy: ReturnType<typeof vi.fn<() => void>>;
let onPaste: ReturnType<typeof vi.fn<() => void>>;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  onSplit = vi.fn<() => void>();
  onDelete = vi.fn<() => void>();
  onCopy = vi.fn<() => void>();
  onPaste = vi.fn<() => void>();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(menu: ReactNode) {
  act(() =>
    root.render(
      <MantineProvider theme={{ ...theme, respectReducedMotion: true }}>{menu}</MantineProvider>,
    ),
  );
}

function show(splitLabel: string | null = "Split at 10:30", { ongoing = false } = {}) {
  render(
    <BlockMenu
      top={0.5}
      left={10}
      splitLabel={splitLabel}
      onSplit={onSplit}
      onCopy={ongoing ? null : onCopy}
      onDelete={onDelete}
      onClose={() => {}}
    />,
  );
}

function showPaste(paste: { label: string } | { reason: string }) {
  render(<PasteMenu top={0.5} left={10} paste={paste} onPaste={onPaste} onClose={() => {}} />);
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
  it("splits the block, and shows the key that does it", () => {
    show();
    const split = item("Split at 10:30");
    expect(split.getAttribute("aria-keyshortcuts")).toBe("C");
    expect(split.querySelector("kbd")?.textContent).toBe("C");
    act(() => split.click());
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

  it("copies the block, and shows the key that does it", () => {
    show();
    const copy = item("Copy");
    expect(copy.getAttribute("aria-keyshortcuts")).toMatch(/^(Meta|Control)\+C$/);
    expect(copy.querySelector("kbd")?.textContent).toMatch(/^(⌘|Ctrl)\+C$/);
    act(() => copy.click());
    expect(onCopy).toHaveBeenCalledOnce();
  });

  it("can't copy an ongoing block, and says why", () => {
    show("Split at 10:30", { ongoing: true });
    expect(item("Copy").disabled).toBe(true);
    expect(item("Copy").title).toBe("An ongoing block has no length to copy");
  });

  it("still offers to delete when the block can't be split there", () => {
    show(null);
    expect(item("Split").disabled).toBe(true);
    expect(item("Delete block").disabled).toBe(false);
  });
});

describe("PasteMenu", () => {
  it("pastes where it lands, and shows the key that does it", () => {
    showPaste({ label: "Paste at 14:00" });
    const paste = item("Paste at 14:00");
    expect(paste.getAttribute("aria-keyshortcuts")).toMatch(/^(Meta|Control)\+V$/);
    act(() => paste.click());
    expect(onPaste).toHaveBeenCalledOnce();
  });

  it("says why it can't paste here", () => {
    showPaste({ reason: "Copied from another timeline" });
    const paste = item("Paste");
    expect(paste.textContent).toContain("Paste");
    expect(paste.disabled).toBe(true);
    expect(paste.title).toBe("Copied from another timeline");
  });
});
