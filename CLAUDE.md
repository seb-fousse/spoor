# Spoor

A local-first personal data tracker. A pnpm monorepo: `packages/core` (TypeScript: data model,
repositories, migrations; no UI) and `apps/desktop` (Tauri 2, React, Mantine, TanStack Query).

## Commands

From the repo root:

- `pnpm typecheck && pnpm lint && pnpm lint:selftest && pnpm test`: everything CI checks,
  except the build (`pnpm build`) and the Rust job.
- `pnpm lint:fix`: Biome's safe fixes and formatting.
- `pnpm --filter @spoor/desktop test`, or `pnpm --filter @spoor/core test`: one package's tests.
- `pnpm desktop:dev`: the app, with Rust (needs the Tauri prerequisites).

## Commits and PRs

See [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/conventions/git.md](docs/conventions/git.md).

- Conventional Commits with a package scope: `feat(desktop): …`, `fix(core): …`, `docs: …`.
- Body lines are at most 100 characters. The body says why.
- Sign off: `git commit -s`. The `commit-msg` hook rejects a commit without it.
- Branch from `main` as `feat/…`, `fix/…`, `docs/…`, `chore/…` or `refactor/…`. PRs are
  squash-merged, so the PR title is a Conventional Commit too.

## Desktop conventions

The guide is [docs/conventions/](docs/conventions/README.md). The checked examples are in
[apps/desktop/examples/](apps/desktop/examples): copy from them, or from Home, never from a POC
page.

- **Data:** only `src/data/` touches `useDatabase`, `queryKeys` and TanStack's hooks. Reads are
  `queryOptions` factories; a read hook returns `UseQueryResult` or `ReadResult`. Each write is
  a hook on `useDbWrite`. [data.md](docs/conventions/data.md),
  [example](apps/desktop/examples/data/metrics.ts)
- **Errors:** core throws `SpoorError` with a code. Show every error with `ErrorAlert`; never
  read `error.message`. [errors.md](docs/conventions/errors.md),
  [example](apps/desktop/examples/components/RenameMetric/RenameMetric.tsx)
- **Layout:** one folder per shared component and per page, each with an `index.ts`. Import
  through barrels, never past them. PascalCase components, camelCase modules.
  [components.md](docs/conventions/components.md),
  [example](apps/desktop/examples/components/RenameMetric)
- **Styles:** Mantine controls, app-wide overrides in `theme/components/`, CSS modules with
  `--app-*` tokens, inline `style` only for computed values. [components.md](docs/conventions/components.md)
- **React:** logic in pure modules; effects only to sync with the outside; shared state in
  context with a throwing `useX()`. [react.md](docs/conventions/react.md),
  [example](apps/desktop/examples/lib/longestStreak.ts)
- **Time:** `Instant` and `LocalDate` from core; format only through `lib/format`, in an explicit
  zone. [time.md](docs/conventions/time.md)
- **Keyboard:** every shortcut in `SHORTCUTS`, bound by id. [keyboard.md](docs/conventions/keyboard.md),
  [example](apps/desktop/examples/components/DayStepper/DayStepper.tsx)
- **Tests:** next to their file; stub core in hook tests; integration tests on
  `createTestDatabase()` with no `vi.mock`. [testing.md](docs/conventions/testing.md),
  [example](apps/desktop/examples/data/metrics.integration.test.tsx)
- **TypeScript:** named exports, no enums, `interface` for shapes. [typescript.md](docs/conventions/typescript.md)
- **Tauri:** only `src/platform/` knows about it. [tauri.md](docs/conventions/tauri.md)
- **Lint:** the rules and the override caveat are in [lint.md](docs/conventions/lint.md). A new
  rule gets a fixture in `tools/biome/fixtures/`.

When a convention changes, update its page and its example in the same PR.
