# @spoor/desktop

A thin [Tauri 2](https://tauri.app) + React + Vite shell around
[`@spoor/core`](../../packages/core): the UI and the desktop implementations of
core's platform seams.

## Develop

From the repo root:

```bash
pnpm install          # once
pnpm desktop:dev      # Vite and the Rust shell together (tauri dev)
```

`desktop:dev` needs the Rust toolchain and the
[Tauri prerequisites](https://tauri.app/start/prerequisites/). Frontend only,
without Rust:

```bash
pnpm --filter @spoor/desktop dev        # Vite dev server
pnpm --filter @spoor/desktop build      # typecheck + Vite build
pnpm --filter @spoor/desktop test       # Vitest (IPC mocked)
```

## Layout

- `src/`: React UI.
- `src/platform/`: desktop implementations of core's platform seams
  (`Database` over Tauri IPC).
- `src-tauri/`: Rust side: window, IPC commands, and the SQLite database
  behind core's `Database` seam.
