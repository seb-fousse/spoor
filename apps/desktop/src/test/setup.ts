/**
 * Runs before every test file, in that file's environment (see `test.setupFiles`
 * in vite.config.ts). Helpers for rendering are in `./render`.
 */

// Tell React this is a test environment, so `act` flushes renders and effects.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no media queries. Mantine asks for one to respect reduced motion;
// saying yes makes its popovers, menus and modals open and close at once,
// without waiting out their transitions (so a modal's reset on close runs too).
if (typeof window !== "undefined") {
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
}
