# Desktop conventions

How the desktop app (`apps/desktop`) is written: where code goes, how it reads and writes
data, how it shows errors, and how it's tested. Core (`packages/core`) is a separate package
and keeps its own conventions, such as kebab-case file names. Where core sets a rule the app
relies on, such as `SpoorError`, the page says so.

The parent issue is [#149](https://github.com/seb-fousse/spoor/issues/149). Each convention
was settled in one of its sub-issues, and each page links them.

## How a rule reads

Each rule says what to do, then why. Below it:

- **Source**: the issue that settled it, or the outside doc it builds on.
- **Lint**: the rule that enforces it, numbered as in [lint.md](lint.md), or "none" when
  review is the only check.
- **Example**: the real file in `src/` that shows it best.

Conventions that haven't landed yet are marked **planned (#NNN)**, and the PR that lands one
removes its marker. None are planned right now.

## Pages

| Page                           | Covers                                                                                                      |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| [data.md](data.md)             | data hooks in `src/data/`, read factories and their return shape, writes through `useDbWrite`, invalidation |
| [errors.md](errors.md)         | `SpoorError` codes, `describeError`, `ErrorAlert`, how long an error stays on screen                        |
| [components.md](components.md) | folders, barrels and file names; Mantine and theme overrides; CSS modules and tokens; inline styles; `Icon` |
| [react.md](react.md)           | logic in pure modules, effects, app-wide state in context                                                   |
| [time.md](time.md)             | `Instant` and `LocalDate`, the time zone setting, formatting through `lib/format`                           |
| [keyboard.md](keyboard.md)     | the `SHORTCUTS` table, binding shortcuts, `ownsKey`, showing shortcuts                                      |
| [testing.md](testing.md)       | the test harness, pure-module tests, tests that stub core, integration tests on the in-memory database      |
| [typescript.md](typescript.md) | the TypeScript choices we've made                                                                           |
| [tauri.md](tauri.md)           | `platform/`, capabilities, commands and their errors                                                        |
| [lint.md](lint.md)             | every Biome rule and GritQL plugin, the override caveat, the selftest                                       |
| [git.md](git.md)               | commits, sign-off, PRs                                                                                      |

## What `src/` holds

Settled in [#145](https://github.com/seb-fousse/spoor/issues/145). Each top-level folder holds
one kind of code:

| Folder        | Holds                                                                               | Imported as          |
| ------------- | ----------------------------------------------------------------------------------- | -------------------- |
| `components/` | shared UI, one folder per component                                                 | `@components/<Name>` |
| `data/`       | the data hooks, one file per core domain                                            | `@data/<domain>`     |
| `hooks/`      | generic React hooks that aren't about data: `useNow`, `useToday`, `useHistoryRoute` | `@hooks/<name>`      |
| `keyboard/`   | shortcuts: the table, binding and display                                           | `@keyboard`          |
| `lib/`        | pure helpers, no React: formatting, error wording, the query client                 | `@lib/<name>`        |
| `platform/`   | Tauri and the database connection                                                   | `@platform/<name>`   |
| `pages/`      | the app's pages, one folder per page                                                | `@pages/<Name>`      |
| `theme/`      | the Mantine theme, tokens and styles                                                | `@theme`             |
| `test/`       | the test harness                                                                    | `@test/<name>`       |

At `src/`'s root sit `App.tsx`, `main.tsx`, `routes.ts` and `vite-env.d.ts`, where Vite and the
aliases expect them. The aliases are set twice, in `tsconfig.json`'s `paths` and in
`vite.config.ts`, which says to keep them in sync.

**They never ship.** Nothing imports them, and Vite bundles from `index.html`, so the build
leaves them out.

**An example exists only where it adds something.** When one real file is already the
clearest instance, the guide links to it instead. A context provider, for one, is shown by
[`platform/DatabaseProvider.tsx`](../../apps/desktop/src/platform/DatabaseProvider.tsx).

## The POC pages

The Things, Observations, Logs and Timelines pages (`pages/Things/`, `pages/Observations/`,
`pages/Logs/`, `pages/Timelines/`) were built as proofs of concept. They are exempt from most
of this guide and slated for replacement
([#149](https://github.com/seb-fousse/spoor/issues/149)).

- **What they still do:** call core and TanStack Query's hooks directly, format dates their own
  way, and show `error.message` in a plain `Alert` instead of `ErrorAlert`.
- **What they're exempt from:** lint rules 1, 2 and 4. `biome.jsonc` lists them once, as
  exclusions in one override, with no per-line `biome-ignore`.
- **What still applies:** rules 3, 6 and 7. Their imports go through barrels, and their files
  are named like the rest.
- **What changes in them:** only mechanical edits, such as an import path or a hook's new
  name. Their own cleanup waits for the rebuild: one `ValueInput` instead of two, shared value
  formatters, and no components that call core directly.

Don't copy a pattern from a POC page. Copy from Home, `components/` or `data/`.

## Known exceptions

Two files break the layout rules on purpose. Both were left as they are in
[#158](https://github.com/seb-fousse/spoor/pull/158):

- **`main.tsx` imports `./theme/global.css` directly**, past the `@theme` barrel. A barrel can't
  re-export a stylesheet, and moving the import into `theme/index.ts` would change the order in
  which CSS loads.
- **`src/assets/react.svg` is unused.** It's a leftover from the Vite scaffold, in a folder the
  table above doesn't list.
