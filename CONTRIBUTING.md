# Contributing to Spoor

Spoor is a small, mostly solo project. The process below is lightweight and
applies to solo work too.

Spoor keeps **few languages and few dependencies**. A new dependency must
justify its maintenance and supply-chain cost.

## Start from the problem

Features begin as issues using the
[feature template](.github/ISSUE_TEMPLATE/feature.yml): **who** has the
problem, **what** is painful, **how we'll know it worked**, and what is out of
scope. The maintainer may decline features that don't fit the project.

Build in **vertical slices**: one thin feature working end to end, not one
layer at a time.

## Setup

See the [README quickstart](README.md#quickstart):

```bash
corepack enable
pnpm install          # also installs git hooks via lefthook
pnpm test
```

## Workflow

- **Trunk-based.** `main` is always releasable and never committed to
  directly.
- **Branch names:** `feat/...`, `fix/...`, `docs/...`, `chore/...`, `refactor/...`.
- **Every change goes through a PR**, and CI must pass.
- **Squash-merge only.** The PR title becomes the commit on `main`, so it must
  be a valid Conventional Commit. CI checks it.

## Commits

- [**Conventional Commits**](https://www.conventionalcommits.org) with package
  scopes, enforced by commitlint in a git hook:
  - `feat(core): add the trash to log entries`
  - `fix(desktop): stop crash on empty import`
  - `docs: explain the export round-trip guarantee`
- The body explains **why**; the diff shows what.
- **DCO sign-off is required** (`git commit -s`), certifying the
  [Developer Certificate of Origin](https://developercertificate.org/). Spoor
  uses DCO rather than a CLA, which limits later relicensing.

## Pull requests

- **Small and single-purpose**, ideally under ~300 changed lines excluding
  tests.
- Fill in the [PR template](.github/PULL_REQUEST_TEMPLATE.md).
- **Self-review** the diff in the GitHub UI before merging, commenting where a
  reviewer would ask.
