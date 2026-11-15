# React

How components and hooks are written. The rules here build on react.dev, chiefly
[You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect).

## Logic in pure modules; hooks and components stay thin

Put logic in plain functions with no React, in a module of their own beside where they're
used. The hook or component that needs them only wires them to state and events. A pure
module is tested by calling it, with nothing to render.

Home is built this way:

- [`homeDays.ts`](../../apps/desktop/src/pages/Home/homeDays.ts): the day window, as a
  reducer;
- [`grid/layout/gridLayout.ts`](../../apps/desktop/src/pages/Home/grid/layout/gridLayout.ts):
  where each block goes;
- [`grid/edit/blockEdit.ts`](../../apps/desktop/src/pages/Home/grid/edit/blockEdit.ts): which
  edits a block allows;
- [`observations/observationValues.ts`](../../apps/desktop/src/pages/Home/observations/observationValues.ts):
  the rail's values.

Each has its test beside it.

**Why:** logic in a component can only be tested by rendering it, and gets rewritten when the
component does.

- **Source:** react.dev, [Keeping Components Pure](https://react.dev/learn/keeping-components-pure)
- **Lint:** none
- **Example:** [`examples/lib/longestStreak.ts`](../../apps/desktop/examples/lib/longestStreak.ts)
  and its test

## Effects only to sync with something outside React

Use an effect only to keep React in step with something it doesn't own:

- a timer, as in [`hooks/useNow.ts`](../../apps/desktop/src/hooks/useNow.ts) and
  [`hooks/useToday.ts`](../../apps/desktop/src/hooks/useToday.ts);
- a window listener, as in [`keyboard/useShortcuts.ts`](../../apps/desktop/src/keyboard/useShortcuts.ts)
  (or Mantine's `useWindowEvent`, which wraps one);
- the DOM, such as focus or a scroll position, as in `TimelineGrid`;
- an animation frame, as in `FluidSplitter`;
- logging, as `ErrorAlert` does;
- a promise started outside React, as `App` does for the migration.

Don't use one to derive state from props or other state. Compute it while rendering, as
`useGridData` combines its three reads, or reset a component with a `key`.

Two effects still adjust state when a value changes: `ObservationRail`'s number field resets
its draft when the day changes, and `HomeStateProvider` dispatches the midnight rollover when
today changes.

**Why:** an effect that derives state renders twice, and its state can be seen out of step.

- **Source:** react.dev, [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect)
- **Lint:** Biome's recommended `useExhaustiveDependencies` checks each effect's dependencies
- **Example:** [`hooks/useNow.ts`](../../apps/desktop/src/hooks/useNow.ts)

## App-wide state lives in context, read with a throwing `useX()`

State that more than one part of the app shares, or that must outlive a page, goes in a
context:

- **The context starts as `null`**: `createContext<T | null>(null)`.
- **A provider component sets it**, as `<Context value={…}>`. When the value is an object, the
  provider memoizes it, so its consumers don't re-render for nothing.
- **A `useX()` hook reads it with `use()`**, and throws when there's no provider above. No
  caller has to handle a missing value.
- **Mount the provider as high as the state must live.** `App` mounts `HomeStateProvider`
  above the routes, so Home's active day survives going to another page and back.

[`platform/DatabaseProvider.tsx`](../../apps/desktop/src/platform/DatabaseProvider.tsx) is the
smallest instance. [`pages/Home/HomeState.tsx`](../../apps/desktop/src/pages/Home/HomeState.tsx)
holds state, with a reducer.

**Why:** a missing provider is a bug, and the throw finds it on the first render.

- **Source:** react.dev, [Passing Data Deeply with Context](https://react.dev/learn/passing-data-deeply-with-context)
- **Lint:** none
- **Example:** [`platform/DatabaseProvider.tsx`](../../apps/desktop/src/platform/DatabaseProvider.tsx).
  It's the clearest instance, so there's no copy in `examples/`.

## Where a hook goes

- **A data hook** goes in `src/data/`. See [data.md](data.md).
- **A generic hook**, about time, the window or navigation rather than data, goes in
  `src/hooks/`: `useNow`, `useToday`, `useHistoryRoute`.
- **A feature's own hook** stays with the feature: `useGridData` and `useNotice` in Home's
  `grid/`, the drag hooks in `grid/edit/`.

- **Source:** [#141](https://github.com/seb-fousse/spoor/issues/141), [#145](https://github.com/seb-fousse/spoor/issues/145)
- **Lint:** rules 1 and 2 keep data access out of the other two kinds
- **Example:** [`pages/Home/grid/useGridData.ts`](../../apps/desktop/src/pages/Home/grid/useGridData.ts)
