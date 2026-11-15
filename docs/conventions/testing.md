# Testing

The desktop app's tests run on [Vitest](https://vitest.dev), configured in `test` in
[`apps/desktop/vite.config.ts`](../../apps/desktop/vite.config.ts). `pnpm test` runs them, and
core's, from the repo root. There are three kinds, and each has its example.

## Tests sit next to their file

A test is `Name.test.ts` or `Name.test.tsx`, beside the file it tests. An integration test is
`<domain>.integration.test.tsx`.

- **They run in Node by default.** A test that renders starts with
  `// @vitest-environment jsdom` on its first line.
- **`src/test/setup.ts` runs before every test file.** It tells React it runs under `act`, and
  gives jsdom a media query, so Mantine respects reduced motion and its popovers and modals open
  and close at once.
- **There's no Testing Library.** The harness below renders with React's own `act`, and tests
  query the DOM directly.

- **Source:** [#145](https://github.com/seb-fousse/spoor/issues/145), rule 5
- **Lint:** rule 7 checks the name before the first dot
- **Example:** the tests in [`examples/`](../../apps/desktop/examples)

## The shared harness: `src/test/`

[`test/render.tsx`](../../apps/desktop/src/test/render.tsx):

- **`createTestRoot(providers)`** gives a React root inside the providers asked for: a
  `queryClient`, a `db` for `useDatabase`, and `mantine` for the app's theme. Its container is on
  the page, so portals, focus and `document.body` queries work. It has `render`, `renderAsync`
  (which also lets started promises settle) and `unmount`.
- **`renderHook(useHook, providers)`** renders a hook and returns `{ current }`, its latest
  result. The root unmounts, and the cache is cleared, when the test finishes.
- **`tick()`** waits one real macrotask inside `act`, long enough for TanStack Query to deliver
  a result.
- **`waitFor(check)`** ticks until `check` stops throwing.
- **`run(action)`** runs a write, such as `mutateAsync`, inside `act`, then ticks so what it
  changed renders.

[`test/database.ts`](../../apps/desktop/src/test/database.ts) has `createTestDatabase()`, for
integration tests.

Give each test a fresh cache from `createQueryClient()` in
[`lib/queryClient.ts`](../../apps/desktop/src/lib/queryClient.ts), the app's own defaults, and
clear it afterwards.

- **Source:** [#147](https://github.com/seb-fousse/spoor/issues/147)
- **Lint:** none
- **Example:** [`examples/data/metrics.test.tsx`](../../apps/desktop/examples/data/metrics.test.tsx)

## Pure modules: call them

A pure module's test calls its functions and checks what they return. It renders nothing, so it
needs no environment comment.

- **Source:** [react.md](react.md#logic-in-pure-modules-hooks-and-components-stay-thin)
- **Lint:** none
- **Example:** [`examples/lib/longestStreak.test.ts`](../../apps/desktop/examples/lib/longestStreak.test.ts)

## Hooks and components: stub core

A test of what a hook or component does with the cache, or with its own steps, stubs core's
calls:

- **`vi.mock("@spoor/core", …)`** spreads `importOriginal()` and replaces only the calls under
  test with `vi.fn()`, so the rest of core, such as `SpoorError`, stays real. Each test says what
  the stubs return.
- **The database is `{} as Database`.** It's never touched, since every core call that would use
  it is stubbed.
- **A write's invalidations are checked on cached reads that nothing shows**: set them with
  `setQueryData`, run the write, and read `getQueryState(key)?.isInvalidated`.
- **A component test asserts what the user sees**, such as an error in `describeError`'s words.

**Why:** core's own tests cover the SQL. These tests check what the app adds on top.

- **Source:** [#147](https://github.com/seb-fousse/spoor/issues/147)
- **Lint:** none
- **Example:** [`examples/data/metrics.test.tsx`](../../apps/desktop/examples/data/metrics.test.tsx)
  for a hook; [`examples/components/RenameMetric/RenameMetric.test.tsx`](../../apps/desktop/examples/components/RenameMetric/RenameMetric.test.tsx)
  for a component

## Integration tests: the real hooks on a real database

The stubbed tests leave the wiring between hooks unchecked: that a write's invalidation reaches
every read that shows its data. Get that wrong and nothing errors. The screen just shows stale
data. Integration tests check it:

- **One per domain, in `src/data/`:** `logs`, `observations`, `timelines`, `things` and
  `settings`. Each makes a write, then checks that the reads which should update do. The
  settings test, which has no write, checks that `useTimeZone` reads the stored zone.
- **No `vi.mock`.** The real hooks run against core's real database.
- **`createTestDatabase()`** creates core's in-memory SQLite database, migrates it, and closes it
  when the test finishes. Call it inside the test, seed it with core's own functions, and pass it
  to `renderHook` or `createTestRoot` as `db`.
- **The database comes from `@spoor/core/testing`**, which only tests may import. It runs on
  `better-sqlite3`, a native module and a devDependency of the desktop package, which CI
  installs.

**Why:** this is the drift `queryKeys` exists to prevent, and only a real write followed by a real
read catches it. Check that a new test fails with its write's invalidation removed: one that
still passes isn't testing the wiring.

- **Source:** [#147](https://github.com/seb-fousse/spoor/issues/147)
- **Lint:** rule 3 keeps `@spoor/core/testing` in tests and `src/test/`
- **Example:** [`examples/data/metrics.integration.test.tsx`](../../apps/desktop/examples/data/metrics.integration.test.tsx)

## Types are tested by `tsc`

`pnpm typecheck` compiles the tests too, so a test can assert a type with Vitest's
`expectTypeOf`. At run time it does nothing; a wrong type fails the typecheck.

- **Source:** Vitest, [Testing Types](https://vitest.dev/guide/testing-types)
- **Lint:** none
- **Example:** [`data/readResult.test.ts`](../../apps/desktop/src/data/readResult.test.ts), and the
  type test in [`examples/data/metrics.test.tsx`](../../apps/desktop/examples/data/metrics.test.tsx)

## Core's tests

Core's tests run in Node, on the same in-memory database. They assert an error's `code`, never
its message, with `expectSpoorError`. See [errors.md](errors.md).
