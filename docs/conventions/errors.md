# Errors

Core says what went wrong with a code. The app turns the code into words written for users,
and shows every error the same way.

The worked examples are [`pages/Home/rail/RailPanel.tsx`](../../apps/desktop/src/pages/Home/rail/RailPanel.tsx), a failed read shown
through `ErrorAlert`, and [`pages/Home/logs/NewLogModal.tsx`](../../apps/desktop/src/pages/Home/logs/NewLogModal.tsx), a failed save, with a test
of what the user sees.

## Core throws only `SpoorError`

Every failure core raises on purpose is a `SpoorError`, from
[`packages/core/src/lib/spoor-error.ts`](../../packages/core/src/lib/spoor-error.ts), and
exported from `@spoor/core` with `isSpoorError`. Its `code` says what went wrong and who
caused it:

| Code            | Who caused it                    | For example                                                                                 |
| --------------- | -------------------------------- | ------------------------------------------------------------------------------------------- |
| `invalid`       | the user                         | a required value left out, a value outside its field's constraints, a malformed import file |
| `conflict`      | the user                         | a name already used, an interval overlapping another                                        |
| `archived`      | the user                         | a write to an archived record, or one that needs an archived record                         |
| `newer_version` | the user's data                  | a database or import file written by a newer Spoor                                          |
| `not_found`     | usually a stale screen, or a bug | a record named by id that doesn't exist                                                     |
| `internal`      | a bug                            | corrupt stored data, a failed migration                                                     |

Its `details` say what the app needs to word it, such as `entity`, `field`, `rule` and
`limit`. `SpoorErrorCode`'s doc comment lists the details each code carries. Its `message` is
for developers and may name ids. The app never shows it. Anything else thrown out of core,
such as a SQL error, is a bug.

Core's tests assert an error's `code`, and its `details` where they're the point, never its
message, with `expectSpoorError` from core's own testing folder.

**Why:** the app can tell a failure the user caused from a bug, and word each one without
showing an id.

- **Source:** [#144](https://github.com/seb-fousse/spoor/issues/144), [#160](https://github.com/seb-fousse/spoor/pull/160)
- **Lint:** rule 5 reports any `new Error(…)` or `Error(…)` in core's source, outside its tests
  and `testing/`
- **Example:** [`packages/core/src/lib/spoor-error.ts`](../../packages/core/src/lib/spoor-error.ts)

## Hooks pass the `Error` on; components never read `.message`

Data hooks return core's error as it is, as the query's or mutation's `error`. A component
that catches a promise keeps what it caught, typed `unknown`, not a string. No component reads
`error.message`. It hands the error to `ErrorAlert`.

**Why:** the message is for developers, and turning the error into a string loses its code.

- **Source:** [#144](https://github.com/seb-fousse/spoor/issues/144)
- **Lint:** none. The POC pages still show `error.message`.
- **Example:** `TimelineGrid`'s `run()` keeps the caught error in state, in
  [`pages/Home/grid/TimelineGrid.tsx`](../../apps/desktop/src/pages/Home/grid/TimelineGrid.tsx)

## `describeError` words an error for users

[`lib/errors.ts`](../../apps/desktop/src/lib/errors.ts) exports `describeError(error: unknown)`,
which returns a `DescribedError`, `{ title?, message, expected }`:

- **It words each code**, more precisely when `details` say more: which value rule was broken
  and its limit, which name clashed, which kind of record is archived or gone.
- **It names records the way users do.** A timeline interval is a "block", and a thing or log
  field is a "field".
- **It never names an id**, and never uses the error's `message`.
- **`internal`, and anything that isn't a `SpoorError`, get one text,** "Something went
  wrong", with `expected: false`. `not_found` has its own wording, and `expected: false` too.
- **It's a pure function.** It logs nothing. Translating the text would happen here.

**Why:** one place decides what users read, and it can be tested code by code.

- **Source:** [#144](https://github.com/seb-fousse/spoor/issues/144), [#162](https://github.com/seb-fousse/spoor/pull/162)
- **Lint:** none
- **Example:** [`lib/errors.test.ts`](../../apps/desktop/src/lib/errors.test.ts), which covers every code

## Show every error with `ErrorAlert`

[`components/ErrorAlert`](../../apps/desktop/src/components/ErrorAlert/ErrorAlert.tsx) is the
one way the app shows an error: a red Mantine `Alert`, worded by `describeError`.

- **Give it a `title` saying what was being done**, such as "Could not load logs". A caller's
  title wins over the error's own.
- **Spacing and a close button pass through** to Mantine's `Alert`.
- **It logs what the user can't have caused.** An error with `expected: false` is logged in
  full with `console.error`, once per error: the logging runs in an effect keyed on the error,
  so a re-render doesn't log it again.

It's used by `App`, `TimelineGrid` (for its load error and for failed edits), `RailPanel`,
`NewLogModal` and `CategoryPicker`.

**Why:** errors used to be shown four ways, and some showed a raw UUID.

- **Source:** [#144](https://github.com/seb-fousse/spoor/issues/144), [#162](https://github.com/seb-fousse/spoor/pull/162)
- **Lint:** none
- **Example:** [`pages/Home/logs/NewLogModal.tsx`](../../apps/desktop/src/pages/Home/logs/NewLogModal.tsx),
  tested in [`NewLogModal.test.tsx`](../../apps/desktop/src/pages/Home/logs/NewLogModal.test.tsx)

## How long an error stays on screen

An error stays until the next attempt, going back, or closing:

- **A failed write's error is the mutation's `error`.** Running the write again clears it, and
  so does `reset()`, which a caller runs when the user goes back or closes. `NewLogModal`
  resets on both.
- **An error kept in state is cleared when the next attempt starts.** `TimelineGrid`'s `run()`
  clears it first, and its alert has a close button.
- **A failed read's error stays until the read succeeds.**
- **A save error belongs to what was saved.** `ObservationRail` shows a failed save only on the
  day it was for, from the mutation's `variables`.

**Why:** an error should stay long enough to be read, and never outlive what it's about.

- **Source:** [#144](https://github.com/seb-fousse/spoor/issues/144), [#139](https://github.com/seb-fousse/spoor/issues/139)
- **Lint:** none
- **Example:** the save error and its `reset()` calls in
  [`pages/Home/logs/NewLogModal.tsx`](../../apps/desktop/src/pages/Home/logs/NewLogModal.tsx)

## Tests assert the code or the words

- **A hook test** rejects with a `SpoorError` and checks the mutation's `error` is it.
- **An integration test** checks the error's `code` and `details` with `toMatchObject`.
- **A component test** checks the text `describeError` gives, and that it contains no id.

- **Source:** [#144](https://github.com/seb-fousse/spoor/issues/144)
- **Lint:** none
- **Example:** [`lib/errors.test.ts`](../../apps/desktop/src/lib/errors.test.ts),
  [`pages/Home/logs/NewLogModal.test.tsx`](../../apps/desktop/src/pages/Home/logs/NewLogModal.test.tsx)
