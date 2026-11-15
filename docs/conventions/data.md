# Data

How the app reads and writes the database. Every read and write goes through a data hook in
`src/data/`, and those hooks own the query cache: its keys, what each write invalidates, and
what a read returns.

The worked example is [`data/observations.ts`](../../apps/desktop/src/data/observations.ts):
its read factories, read hooks and writes.

## Data hooks live in `src/data/<domain>.ts`

One file per core domain, mirroring core's own: `logs.ts`, `observations.ts`, `timelines.ts`,
`things.ts` and `settings.ts`. Beside them are what they share: `queryKeys.ts`,
`readResult.ts` and `useDbWrite.ts`. Import a domain as `@data/<domain>`. There's no
`data/index.ts`, because each domain file is its own module. If a domain file grows too big,
it becomes a folder, `data/<domain>/`, with an `index.ts`.

**Why:** a hook nobody can find gets written twice, as `NewLogModal`'s own log-types query
once was. One folder also gives the lint rules below a path to name.

- **Source:** [#141](https://github.com/seb-fousse/spoor/issues/141)
- **Lint:** rules 1 and 2 name `src/data/` as the one place allowed
- **Example:** [`data/observations.ts`](../../apps/desktop/src/data/observations.ts)

## Only data hooks touch the database and the cache

Only files in `src/data/` import `useDatabase`, `queryKeys`, or TanStack Query's `useQuery`,
`useMutation` and `useQueryClient`. Components and other hooks read and write through the
data hooks.

- **A feature's composition stays with the feature.** Home's
  [`grid/useGridData.ts`](../../apps/desktop/src/pages/Home/grid/useGridData.ts) combines the
  time zone, the grid's timelines and its intervals. It calls three data hooks, and never
  `useDatabase()` itself.
- **What else may import from these modules:** `App.tsx` mounts `DatabaseProvider`, `main.tsx`
  mounts `QueryClientProvider`, `lib/queryClient.ts` builds the `QueryClient`, and any file may
  use TanStack's other exports, such as `keepPreviousData`. Only the names above are
  restricted.
- **Tests are exempt**, as are the [POC pages](README.md#the-poc-pages).

**Why:** the data hooks own caching and invalidation. A component with its own query or write
can drift from the shared one, say when a write starts having to invalidate more.

- **Source:** [#139](https://github.com/seb-fousse/spoor/issues/139), [#141](https://github.com/seb-fousse/spoor/issues/141)
- **Lint:** rule 1 (`useDatabase`), rule 2 (`queryKeys` and the three hooks)
- **Example:** [`pages/Home/logs/NewLogModal.tsx`](../../apps/desktop/src/pages/Home/logs/NewLogModal.tsx) reads and writes only through hooks

## Every key is in `queryKeys`

Every query key is built in [`data/queryKeys.ts`](../../apps/desktop/src/data/queryKeys.ts).
Keys of local database queries start with `"db"`. Below that, they're grouped by what a write
changes, so one prefix invalidates everything that depends on it: `queryKeys.logs.all`
covers a type's entries, child entries and Home's day lists. The app has one database, so the
database isn't part of any key.

**Why:** a read and the write that invalidates it must agree on the key. In one file, they
can't drift apart.

- **Source:** TanStack, [Query Keys](https://tanstack.com/query/latest/docs/framework/react/guides/query-keys.md);
  TkDodo, [Effective React Query Keys](https://tkdodo.eu/blog/effective-react-query-keys)
- **Lint:** rule 2, which keeps `queryKeys` inside `src/data/`
- **Example:** [`data/queryKeys.ts`](../../apps/desktop/src/data/queryKeys.ts) itself

## Each read is a `queryOptions` factory

Each domain file exports one object of read factories, named after it: `logQueries`,
`observationQueries`, `timelineQueries`, `thingQueries`, `settingsQueries`. Each factory
takes the database and the read's inputs, and returns `queryOptions({ queryKey, queryFn })`.
The read hook spreads the factory into `useQuery`, adding hook-only options such as
`placeholderData` or `select`.

To read or write the cache directly, use the factory's `.queryKey`. It carries the data's
type, so `setQueryData` and `getQueryData` are typed without a generic written by hand. See
`useRecordObservation` in [`data/observations.ts`](../../apps/desktop/src/data/observations.ts).

**Why:** the key and the query function live together, and nothing ties a hand-written
generic to its key.

- **Source:** [#142](https://github.com/seb-fousse/spoor/issues/142); TanStack,
  [queryOptions](https://tanstack.com/query/latest/docs/framework/react/reference/functions/queryOptions.md);
  TkDodo, [The Query Options API](https://tkdodo.eu/blog/the-query-options-api)
- **Lint:** none
- **Example:** `observationQueries` in [`data/observations.ts`](../../apps/desktop/src/data/observations.ts)

## A read hook returns `UseQueryResult` or `ReadResult`

- **A hook that runs one query returns its `UseQueryResult<T, Error>`.** Don't annotate the
  return type: `T` is inferred from core.
- **A hook that combines several queries returns `ReadResult<T>`**, from
  [`data/readResult.ts`](../../apps/desktop/src/data/readResult.ts). It's the part of
  `UseQueryResult` that components use (`status`, `data`, `error` and `isPlaceholderData`), as
  the same discriminated union. `useGridData` returns one.
- **A component that shows a read takes `ReadResult`**, or a `Pick` of it, so it accepts either
  kind. Home's [`rail/RailPanel.tsx`](../../apps/desktop/src/pages/Home/rail/RailPanel.tsx)
  does.
- **No hand-written return interfaces.**

[`data/readResult.test.ts`](../../apps/desktop/src/data/readResult.test.ts) checks, with `tsc`,
that any single query's result is assignable to `ReadResult`.

**Why:** one shape for every caller to learn, typed by what the query really returns.

- **Source:** [#142](https://github.com/seb-fousse/spoor/issues/142)
- **Lint:** none. `tsc` checks the shapes.
- **Example:** `useMetrics` in [`data/observations.ts`](../../apps/desktop/src/data/observations.ts),
  and the type tests in [`data/readResult.test.ts`](../../apps/desktop/src/data/readResult.test.ts)

## A read never hides missing data

A read hook never substitutes a fallback for data that hasn't loaded or failed to load. A
caller that needs a stable empty value, because effects or memos depend on it, uses the
domain's shared constant: `EMPTY_FIELDS` in `logs.ts`; `EMPTY_THING_TYPES`, `EMPTY_THINGS`
and `EMPTY_TITLES` in `things.ts`.

**Why:** a fallback hides errors without the caller choosing to: a failed fields load looked
like a log type with no fields. A new `[]` on every render would re-run the effects that
depend on it.

- **Source:** [#142](https://github.com/seb-fousse/spoor/issues/142)
- **Lint:** none
- **Example:** `NewLogModal` uses `useFields(type.id).data ?? EMPTY_FIELDS`, in
  [`pages/Home/logs/NewLogModal.tsx`](../../apps/desktop/src/pages/Home/logs/NewLogModal.tsx)

## A read that has to wait says so

- **A hook whose caller decides when to load takes `ReadOptions`**, `{ enabled }`, from
  `readResult.ts`. `useLogTypes({ enabled: opened })` waits until Home's new-log modal first
  opens.
- **A read that can't run until its inputs are known waits by itself.** Its factory returns
  `skipToken` as the `queryFn` until then (`observationQueries.counts`,
  `timelineQueries.intervals`), or its hook sets `enabled` from them (`useThings(null)`).

- **Source:** [#139](https://github.com/seb-fousse/spoor/issues/139), [#142](https://github.com/seb-fousse/spoor/issues/142)
- **Lint:** none
- **Example:** `useLogTypes` in [`data/logs.ts`](../../apps/desktop/src/data/logs.ts)

## A read that pages keeps the previous data

A read whose inputs change as the user pages, such as the day, passes
`placeholderData: keepPreviousData`. The previous day's data stays on screen until the new
day's loads, with `isPlaceholderData` true. The UI shows it as stale and not usable:
`RailPanel` marks the list `data-stale` and `inert`.

The reads that do this are `useDayLogs`, `useDayObservations`, `useObservationCounts`,
`useGridIntervals` and `useRefTitles`.

**Why:** paging shouldn't flash an empty list or a loader.

- **Source:** [#142](https://github.com/seb-fousse/spoor/issues/142)
- **Lint:** none
- **Example:** `useDayLogs` in [`data/logs.ts`](../../apps/desktop/src/data/logs.ts)

## Each write is a hook built on `useDbWrite`

Every write goes through
[`useDbWrite`](../../apps/desktop/src/data/useDbWrite.ts):

- **One named hook per write**, such as `useCreateLogEntry` or `useDeleteInterval`. Each is a
  short wrapper around `useDbWrite` and returns the mutation itself,
  `UseMutationResult<Result, Error, Vars>`, with its types inferred from core. Callers get
  `mutateAsync`, `isPending`, `error` and `reset`.
- **`useDbWrite` gets the database itself** and hands it to the write, so write hooks don't
  call `useDatabase()`.
- **It settles only after the refetch.** Once the write succeeds, `update` runs, then every key
  in `invalidates` refetches, and only then does the mutation settle. A caller that awaits
  the write, or watches `isPending`, sees the new data once it settles. The grid's blocks
  don't flicker back to where they were.
- **A failed write invalidates nothing**, since core rolled it back. The mutation's `error` is
  core's error.

Two hooks run a closure instead of one write, for the POC pages: `useThingWrite`, which
returns a function and invalidates by `reach`, and `useTimelinesWrite`. They're built on
`useDbWrite` too. New code writes one named hook per write.

**Why:** with one helper there's one default to copy. The callers that need a write's state,
such as `NewLogModal` with its pending button and its error, get all of it.

- **Source:** [#143](https://github.com/seb-fousse/spoor/issues/143)
- **Lint:** rule 2 keeps `useMutation` and `useQueryClient` inside `src/data/`
- **Example:** `useUpdateMetric` in [`data/observations.ts`](../../apps/desktop/src/data/observations.ts)

## A write invalidates by default

A write lists the keys it invalidates, from `queryKeys`: fixed, or derived from its result and
variables. Pick the prefix that covers every read showing the data, the screens other than
the current one included. The Observations page's writes invalidate `observations.all`,
because a metric's name shows in Home's rail too. Inactive queries only refetch when they're
next shown, so a broad prefix costs little.

Write into the cache with `update` only when the write returns the stored record and reloading
would redo more than it saves. One write does this: `useRecordObservation` writes the
observation into its day's cached list, and invalidates only the other reads that hold it.
It is also the one write hook that calls `useDatabase()` itself, to build the day's
`queryKey`.

**Why:** the query client never refetches `["db"]` queries on its own
([`lib/queryClient.ts`](../../apps/desktop/src/lib/queryClient.ts) sets `staleTime: Infinity`,
with no retries and no refetch on focus). Only the app writes to the database, so a cached
result stays right until a write changes it. A write that forgets to invalidate shows stale
data until the app restarts, and nothing errors. The integration tests in
[testing.md](testing.md) exist to catch that.

- **Source:** [#143](https://github.com/seb-fousse/spoor/issues/143), [#147](https://github.com/seb-fousse/spoor/issues/147)
- **Lint:** none
- **Example:** `useRecordObservation` in [`data/observations.ts`](../../apps/desktop/src/data/observations.ts)
  for `update`; `useUpdateMetric` in the same file
  for the default
