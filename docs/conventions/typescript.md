# TypeScript

The choices we've made, as the code shows them. This isn't a full style guide. For anything not
here, the [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html) is a
good default.

## Strict compiler options

Every package extends [`tsconfig.base.json`](../../tsconfig.base.json): `strict`, plus
`noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, `noFallthroughCasesInSwitch` and
`noImplicitOverride`. A parameter a function must take but doesn't use is named with a leading
`_`, such as `_db`.

- **Source:** [`tsconfig.base.json`](../../tsconfig.base.json)
- **Lint:** `pnpm typecheck`
- **Example:** `useRecordObservation`'s `(_db, vars) => …` in
  [`data/observations.ts`](../../apps/desktop/src/data/observations.ts)

## Named exports

Export by name, and re-export by name from barrels. The one default export is `App` in
`App.tsx`, from the Vite scaffold, which only `main.tsx` imports.

**Why:** a name is the same at every import, and a rename finds every use.

- **Source:** Google TypeScript Style Guide, [Exports](https://google.github.io/styleguide/tsguide.html#exports)
- **Lint:** none
- **Example:** [`examples/components/RenameMetric/index.ts`](../../apps/desktop/examples/components/RenameMetric/index.ts)

## `as const` objects and unions, not enums

There are no `enum`s. A fixed set of values is one of these:

- **A union of string literals**, such as `SpoorErrorCode` or `ThingWriteReach`.
- **An `as const` array, with its type derived from it**, when code needs the values too:
  `METRIC_VALUE_TYPES` in core, with `MetricValueType = (typeof METRIC_VALUE_TYPES)[number]`.
- **An `as const` object, with its keys as the type**, when each value carries data:
  `SHORTCUTS`, checked with `satisfies`, and `ShortcutId = keyof typeof SHORTCUTS`.

A `switch` over a union lists every case with no `default`, so the compiler fails the build
when a case is added and not handled, as in `describeError`.

- **Source:** TypeScript handbook, [Objects vs Enums](https://www.typescriptlang.org/docs/handbook/enums.html#objects-vs-enums).
  Google's guide allows `enum`; we use none, so the values stay plain strings at run time.
- **Lint:** none
- **Example:** [`keyboard/shortcuts.ts`](../../apps/desktop/src/keyboard/shortcuts.ts)

## `interface` for object shapes, `type` for the rest

- **`interface`** for a named object shape: props (`interface RailPanelProps`), and records such
  as `DescribedError` or `GridMeta`.
- **`type`** for a union, an intersection, a tuple, or a type derived from another: `ReadResult`,
  `CategoryChoice`, `ShortcutBinding`, `GridView = GridMeta & { … }`,
  `FluidSplitterProps = Omit<SplitterProps, "sizes">`.
- **A component's props are `interface <Name>Props`**, unless they're few enough to type inline,
  as `DatabaseProvider`'s are.

- **Source:** Google TypeScript Style Guide, [Interfaces vs type aliases](https://google.github.io/styleguide/tsguide.html#prefer-interfaces)
- **Lint:** none
- **Example:** `RenameMetricProps` in
  [`examples/components/RenameMetric/RenameMetric.tsx`](../../apps/desktop/examples/components/RenameMetric/RenameMetric.tsx)

## Infer types from their source

Don't restate a type another module already gives:

- a data hook's return type is inferred from core and TanStack Query
  ([data.md](data.md#a-read-hook-returns-usequeryresult-or-readresult));
- a write's input comes from core's signature when core doesn't name it, such as
  `Parameters<typeof createLogType>[1]`;
- the cache is typed by a factory's `.queryKey`, not a generic.

**Why:** a hand-written type can drift from what the code really returns.

- **Source:** [#142](https://github.com/seb-fousse/spoor/issues/142)
- **Lint:** none
- **Example:** [`examples/data/metrics.ts`](../../apps/desktop/examples/data/metrics.ts)

## Type-only imports say so

Import a type with `import type`, or `type` inline among values:
`import { type Database, listMetrics } from "@spoor/core"`.

- **Source:** Biome's recommended rules
- **Lint:** Biome's `useImportType`, which warns and has a safe fix
- **Example:** [`examples/data/metrics.ts`](../../apps/desktop/examples/data/metrics.ts)
