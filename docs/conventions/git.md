# Git

The full rules are in [CONTRIBUTING.md](../../CONTRIBUTING.md). In short:

- **Conventional Commits, with a package scope:** `feat(core): …`, `fix(desktop): …`,
  `docs: …`. The scopes are `core`, `desktop`, `docs`, `ci`, `repo`, `deps` and `release`; another
  scope only warns. A body line is at most 100 characters. Both are checked by commitlint, from
  [`commitlint.config.js`](../../commitlint.config.js), in the `commit-msg` hook.
- **The body explains why.** The diff shows what.
- **Sign off every commit** with `git commit -s`, for the
  [DCO](https://developercertificate.org/). The `commit-msg` hook rejects a commit without it.
- **Branches** are named `feat/…`, `fix/…`, `docs/…`, `chore/…` or `refactor/…`.
- **Every change goes through a PR**, small and single-purpose, that fills in the
  [PR template](../../.github/PULL_REQUEST_TEMPLATE.md). CI must pass: typecheck, lint, the lint
  selftest, test and build.
- **Squash-merge only.** The PR title becomes the commit on `main`, so it must be a Conventional
  Commit too. CI checks it.
- **The `pre-commit` hook** runs `biome check --write` on the staged files and restages its
  fixes. The hooks are in [`lefthook.yml`](../../lefthook.yml), installed by `pnpm install`.

- **Source:** [CONTRIBUTING.md](../../CONTRIBUTING.md)
- **Lint:** commitlint and the DCO check, in [`lefthook.yml`](../../lefthook.yml); the PR title
  check in [`.github/workflows/pr-title.yml`](../../.github/workflows/pr-title.yml)
