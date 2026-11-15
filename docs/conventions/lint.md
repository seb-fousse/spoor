# Lint

`pnpm lint` runs `biome check .` (Biome 2.6.6) over the repo, with the config in
[`biome.jsonc`](../../biome.jsonc). `pnpm lint:fix` applies the safe fixes. The `pre-commit`
hook runs it on staged files, and CI runs it on every PR.

## The base config

- **Biome's recommended rules**, at their default severities. Of those, a warning doesn't fail
  `pnpm lint`; an error does.
- **The formatter:** two-space indents, lines up to 100 characters, double quotes.
- **Imports are sorted** by Biome's `organizeImports` assist.
- **Left out:** SVG files, and the lint fixtures in `tools/biome/fixtures`, which break the rules
  on purpose.

## The desktop rules

Settled in [#146](https://github.com/seb-fousse/spoor/issues/146), and numbered as there. The
other pages name each rule by its number. Each is at `error`. All but rule 5 are scoped to
`apps/desktop/src/**`.

| #   | Rule                                                                                                                          | Tool                                                                                                   | Allowed in                                         | Page                                                                         |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1   | Only the data hooks import `useDatabase` from `@platform/DatabaseProvider`                                                    | `noRestrictedImports`, `importNames`                                                                   | `src/data/`, tests, `src/test/`, the POC pages     | [data.md](data.md#only-data-hooks-touch-the-database-and-the-cache)          |
| 2   | Only the data hooks import `@data/queryKeys`, and `useQuery`, `useMutation` and `useQueryClient` from `@tanstack/react-query` | `noRestrictedImports`, `importNames`                                                                   | `src/data/`, tests, `src/test/`, the POC pages     | [data.md](data.md#only-data-hooks-touch-the-database-and-the-cache)          |
| 3   | `@spoor/core/testing` is imported only by tests                                                                               | `noRestrictedImports`                                                                                  | `*.test.ts(x)`, `src/test/`                        | [testing.md](testing.md#integration-tests-the-real-hooks-on-a-real-database) |
| 4   | Dates and times are formatted only in `lib/format`                                                                            | GritQL, [`format-dates-in-lib-format.grit`](../../tools/biome/plugins/format-dates-in-lib-format.grit) | `lib/format.ts`, tests, `src/test/`, the POC pages | [time.md](time.md#format-only-through-libformat)                             |
| 5   | Core throws only `SpoorError`                                                                                                 | GritQL, [`core-throws-spoor-error.grit`](../../tools/biome/plugins/core-throws-spoor-error.grit)       | core's tests and `testing/`                        | [errors.md](errors.md#core-throws-only-spoorerror)                           |
| 6   | Nothing imports a module's internals past its barrel: `@components/*/**`, `@pages/*/**`, and Home's `grid/` from outside it   | `noRestrictedImports`, `patterns`                                                                      | the grid's own files, for the grid pattern         | [components.md](components.md#barrels-only-at-module-boundaries)             |
| 7   | File names: camelCase or PascalCase, and a `.ts` file camelCase except `theme/components/`                                    | `useFilenamingConvention`, with `requireAscii`                                                         | `vite-env.d.ts`                                    | [components.md](components.md#file-names)                                    |

Rule 5 is the only one on core. It reports `new Error(…)` and `Error(…)` alike, so an error
built ahead of its throw, by a factory, is reported too.

`App.tsx` imports `DatabaseProvider`, which rule 1 allows: the rule names only `useDatabase`.

## The POC exceptions

The POC pages, `pages/Things/`, `pages/Observations/`, `pages/Logs/` and `pages/Timelines/`, are
exempt from rules 1, 2 and 4. They're listed once, as exclusions in the override that sets those
rules, with a comment pointing to [#149](https://github.com/seb-fousse/spoor/issues/149). There's
no `biome-ignore` in them for these rules. Rules 3, 6 and 7 still apply to them. See
[README.md](README.md#the-poc-pages).

## Why the overrides repeat themselves

Each rule is scoped by where it applies. None is turned off where it's allowed, because in Biome
2.6.6 a later override can't undo part of an earlier one:

- **`plugins` only adds.** A later override can't remove a plugin an earlier one added. So a
  plugin goes on only in the overrides whose files it applies to.
- **A later override's `noRestrictedImports` options replace an earlier one's whole**, `paths`
  and `patterns` alike. They're not merged. So the last override that sets `noRestrictedImports`
  for a file must list every import rule that applies to that file.

That's why rule 6's patterns appear in each override that sets `noRestrictedImports`, and
rules 1 to 3's paths are repeated in the grid's. When you change one copy, change them all; the
comment at the top of `overrides` in [`biome.jsonc`](../../biome.jsonc) explains each block.

## Plugins are experimental

Biome still marks GritQL plugins as experimental. Plugin paths in `biome.jsonc` must be relative,
and are written from the repo root, where the config is. [`format-dates-in-lib-format.grit`](../../tools/biome/plugins/format-dates-in-lib-format.grit)
spells out each call, because Biome 2.6.6 fails to compile the shorter form. If a rule can't
work as a plugin, it becomes a small check script run by `pnpm lint` and lefthook. It isn't
dropped.

## The selftest: `pnpm lint:selftest`

[`tools/biome/selftest.mjs`](../../tools/biome/selftest.mjs) lints the fixtures in
[`tools/biome/fixtures/`](../../tools/biome/fixtures) with the repo's config, and checks that
Biome reports exactly what they expect. A rule that silently stops matching, or starts matching
where it shouldn't, fails the build. CI runs it after `pnpm lint`.

- **A fixture sits at the path it stands in for.** `fixtures/apps/desktop/src/lib/format.ts` is
  linted as `apps/desktop/src/lib/format.ts`, in a temporary copy of the repo's layout.
- **A line that should be reported ends with a comment** naming the diagnostic's category, and
  optionally text its message contains:
  `// lint-expect: lint/style/noRestrictedImports "src/data/"`.
- **Every other line must not be reported**, so a fixture without any comment is one the rules
  allow.
- **A diagnostic about the whole file**, such as a bad file name, is expected on the file's
  first line.

Add a fixture with every rule, and with every change to where a rule applies.

- **Source:** [#146](https://github.com/seb-fousse/spoor/issues/146)
