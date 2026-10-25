# Spoor

**A local-first personal data tracker.**

Track how you spend your time (timelines), daily values such as steps or mood
(observations), events such as a movie watched or a workout (logs), and the
people, places, and media those events involve (things). You define what to
track; your data stays on your device.

> **Status: scaffold.** Tooling and docs are in place; there are no features
> yet. The data model in [`docs/data-spec.md`](docs/data-spec.md) is a draft.
> Expect breaking changes.

## Quickstart

### Prerequisites

- **Node.js** `^20.19` or `>=22.12` (see [`.nvmrc`](.nvmrc)).
- **pnpm** via [Corepack](https://nodejs.org/api/corepack.html), which ships
  with Node: run `corepack enable` once.
- **Desktop app only:** the Rust toolchain ([rustup](https://rustup.rs)) and
  the [Tauri prerequisites](https://tauri.app/start/prerequisites/). Tests and
  the core package do not need Rust.

### Install and verify

```bash
corepack enable
pnpm install
pnpm typecheck   # TypeScript, all packages
pnpm lint        # Biome lint + format check
pnpm test        # Vitest (core logic)
pnpm build       # build @spoor/core and the desktop frontend
```

### Run the desktop app

```bash
pnpm desktop:dev   # requires Rust
```

## Repository layout

```
spoor/
├── apps/
│   └── desktop/     # Tauri 2 + React + Vite shell (thin; imports @spoor/core)
├── packages/
│   └── core/        # platform-agnostic logic: model, validation, export/import
└── docs/
```

All logic lives in [`packages/core`](packages/core), plain TypeScript with no
UI or platform SDKs. Each app is a thin shell implementing a few platform
interfaces (the "seams"), so a mobile app can reuse core unchanged.

## Documentation

[Contributing](CONTRIBUTING.md) · [Privacy](PRIVACY.md) · [Security](SECURITY.md) · [Data spec](docs/data-spec.md) · [Roadmap](docs/roadmap.md)

## License

[Mozilla Public License 2.0](LICENSE).
